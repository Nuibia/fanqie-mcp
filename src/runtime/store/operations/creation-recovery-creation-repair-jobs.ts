import { RuntimeError, type Job, existingGenericReads } from '../runtime-error.js';
import { PublicReadCoordinator } from '../../public-read.js';
import {
  type PrepareOperation,
  type EnsureOpenOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';
import { type GetJobOperation } from '../contracts/jobs-api-with-public-projection-read.js';
import {
  type CreationRepairJobsOperation,
  type CreationRepairPriorOperation,
  type GetCreationRepairAncestorIdsOperation,
  type VerifyUnknownRepairChainOperation,
  type GetCreationRepairOperation,
} from '../contracts/creation-recovery-generic-creation-prior.js';

import {
  type ListEvidenceOperation,
  type ReadEvidenceOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

import { canonicalJson, hash } from '../native-closure-signal.js';
import { type GenericWitnessOperation } from '../contracts/generic-status-generic-refs.js';

interface CreationRepairJobsDependencies {
  publicReads: PublicReadCoordinator;
  prepare: PrepareOperation;
  getJob: GetJobOperation;
}

export function createCreationRepairJobs(
  deps: CreationRepairJobsDependencies,
): CreationRepairJobsOperation {
  function creationRepairJobs(originalId: string, recoveryId: string): Job[] {
    return deps.publicReads.memo('store.creationRepairJobs', [originalId, recoveryId], () => {
      const row = deps.prepare(existingGenericReads.firstRepair).get(originalId, recoveryId);
      if (!row)
        throw new RuntimeError(
          'creation_repair_unverified',
          'The initial repair relation is required.',
        );
      const jobs: Job[] = [],
        seen = new Set<string>();
      let id = String(row.repair_job_id);
      while (true) {
        const job = deps.getJob(id);
        if (!job || seen.has(id) || jobs.length >= 128 || job.operation !== 'repair_created_draft')
          throw new RuntimeError(
            'creation_repair_unverified',
            'The saved repair chain is invalid.',
          );
        seen.add(id);
        jobs.push(job);
        const next = deps.prepare(existingGenericReads.successor).get(id);
        if (!next) return jobs;
        if (next.original_job_id !== originalId || next.recovery_job_id !== recoveryId)
          throw new RuntimeError(
            'creation_repair_unverified',
            'The saved successor belongs to a different allocation.',
          );
        id = String(next.repair_job_id);
      }
    });
  }
  return creationRepairJobs;
}

interface CreationRepairPriorDependencies {
  publicReads: PublicReadCoordinator;
  listEvidence: ListEvidenceOperation;
}

export function createCreationRepairPrior(
  deps: CreationRepairPriorDependencies,
): CreationRepairPriorOperation {
  function creationRepairPrior(job: Job): Record<string, unknown> {
    return deps.publicReads.memo('store.creationRepairPrior', [job], () => {
      return {
        id: job.id,
        status: job.status,
        error: job.error,
        result: job.result,
        target: job.target,
        endedAt: job.endedAt,
        evidence: deps.listEvidence(job.id),
        metadata: job.metadata,
      };
    });
  }
  return creationRepairPrior;
}

interface GetCreationRepairAncestorIdsDependencies {
  publicReads: PublicReadCoordinator;
  creationRepairJobs: CreationRepairJobsOperation;
}

export function createGetCreationRepairAncestorIds(
  deps: GetCreationRepairAncestorIdsDependencies,
): GetCreationRepairAncestorIdsOperation {
  function getCreationRepairAncestorIds(
    originalId: string,
    recoveryId: string,
    previousId: string,
  ): string[] {
    return deps.publicReads.memo(
      'store.getCreationRepairAncestorIds',
      [originalId, recoveryId, previousId],
      () => {
        const jobs = deps.creationRepairJobs(originalId, recoveryId);
        if (
          jobs.length >= 128 ||
          jobs.at(-1)!.id !== previousId ||
          jobs.some((job) => job.status !== 'uncertain' || job.error?.code !== 'outcome_unknown')
        )
          throw new RuntimeError(
            'creation_repair_conflict',
            'Only the latest unknown repair may own one successor.',
          );
        return jobs.map((job) => job.id);
      },
    );
  }
  return getCreationRepairAncestorIds;
}

interface VerifyUnknownRepairChainDependencies {
  publicReads: PublicReadCoordinator;
  prepare: PrepareOperation;
  creationRepairPrior: CreationRepairPriorOperation;
  listEvidence: ListEvidenceOperation;
  genericWitness: GenericWitnessOperation;
  readEvidence: ReadEvidenceOperation;
  getJob: GetJobOperation;
}

export function createVerifyUnknownRepairChain(
  deps: VerifyUnknownRepairChainDependencies,
): VerifyUnknownRepairChainOperation {
  function verifyUnknownRepairChain(
    jobs: Job[],
    original: Job,
    recovery: Job,
    bindings: Record<string, string>,
  ): void {
    return deps.publicReads.memo(
      'store.verifyUnknownRepairChain',
      [jobs, original, recovery, bindings],
      () => {
        const reject = (): never => {
          throw new RuntimeError(
            'creation_repair_unverified',
            'Repair ancestors must retain their exact durable request, intent and prior audit.',
          );
        };
        const object = (v: unknown): Record<string, unknown> =>
          v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
        const common = (v: Record<string, unknown>) =>
          Object.fromEntries(
            Object.entries(v).filter(
              ([k]) => !['repairInputHash', 'expectedContentHash'].includes(k),
            ),
          );
        for (let i = 0; i < jobs.length; i++) {
          const job = jobs[i]!,
            row =
              i === 0
                ? deps.prepare(existingGenericReads.repairById).get(job.id)
                : deps.prepare(existingGenericReads.successorByIds).get(job.id, jobs[i - 1]!.id);
          if (
            !row ||
            row.closed_at ||
            row.original_job_id !== original.id ||
            row.recovery_job_id !== recovery.id ||
            job.accountId !== original.accountId ||
            job.kind !== 'write' ||
            job.status !== 'uncertain' ||
            job.error?.code !== 'outcome_unknown' ||
            canonicalJson(job.target) !== canonicalJson(original.target) ||
            job.scope !== 'account' ||
            job.datasets.length ||
            !job.platformReadStartedAt ||
            !job.platformWriteStartedAt ||
            !job.endedAt ||
            (i === 0 ? recovery.endedAt! : jobs[i - 1]!.endedAt!) > job.requestedAt
          )
            return reject();
          const savedBindings = object(JSON.parse(String(row.bindings_json))),
            prior = object(JSON.parse(String(row.prior_json)));
          if (
            canonicalJson(common(savedBindings)) !== canonicalJson(common(bindings)) ||
            job.inputHash !== savedBindings.repairInputHash ||
            canonicalJson(prior.repairs ?? []) !==
              canonicalJson(jobs.slice(0, i).map((j) => deps.creationRepairPrior(j))) ||
            canonicalJson(prior.original) !==
              canonicalJson({
                status: original.status,
                error: original.error,
                result: original.result,
                target: original.target,
                endedAt: original.endedAt,
                intentRefs: deps.listEvidence(original.id),
              }) ||
            canonicalJson(prior.recovery) !==
              canonicalJson({
                status: recovery.status,
                error: recovery.error,
                result: recovery.result,
                target: recovery.target,
                endedAt: recovery.endedAt,
                evidence: deps.listEvidence(recovery.id),
                metadata: recovery.metadata,
              })
          )
            return reject();
          const refs = deps.listEvidence(job.id),
            bases = refs.filter((r) => r.dataset === 'creation-repair-baseline'),
            intents = refs.filter((r) => r.dataset === 'write-intent');
          if (Object.hasOwn(job.metadata, 'genericShortStatus'))
            deps.genericWitness(
              job,
              refs,
              refs.map((ref) => deps.readEvidence(ref)),
            );
          if (
            bases.length !== 1 ||
            intents.length !== 1 ||
            refs.some(
              (r) =>
                ![
                  'creation-repair-baseline',
                  'write-intent',
                  'creation-repair-verification',
                  'write-result',
                  ...(Object.hasOwn(job.metadata, 'genericShortStatus')
                    ? ['editable_snapshot']
                    : []),
                ].includes(r.dataset),
            ) ||
            refs.filter((r) => r.dataset === 'write-result').length > 1 ||
            refs.filter((r) => r.dataset === 'creation-repair-verification').length > 1
          )
            return reject();
          const baseDoc = deps.readEvidence(bases[0]!),
            base = object(baseDoc.payload),
            snapshot = object(base.snapshot),
            intentDoc = deps.readEvidence(intents[0]!),
            intent = object(intentDoc.payload);
          if (
            baseDoc.collectionMode !== 'live' ||
            baseDoc.evidenceKind !== 'observation' ||
            canonicalJson(base.source) !==
              canonicalJson({ mode: 'live', origin: 'https://fanqienovel.com' }) ||
            base.originalJobId !== original.id ||
            base.recoveryJobId !== recovery.id ||
            base.requestedContentHash !== bindings.requestedContentHash ||
            base.expectedContentHash !== savedBindings.expectedContentHash ||
            canonicalJson(base.target) !== canonicalJson(original.target) ||
            snapshot.state !== 'draft' ||
            snapshot.contentHash !== savedBindings.expectedContentHash ||
            canonicalJson(snapshot.target) !==
              canonicalJson({ kind: 'short', workId: original.target!.id }) ||
            typeof snapshot.platformReadAt !== 'string' ||
            snapshot.platformReadAt < job.platformReadStartedAt ||
            snapshot.platformReadAt > bases[0]!.capturedAt ||
            bases[0]!.capturedAt > intents[0]!.capturedAt ||
            intentDoc.collectionMode !== 'live' ||
            intentDoc.evidenceKind !== 'local-intent' ||
            intent.desiredContentHash !== bindings.desiredContentHash ||
            canonicalJson(intent.target) !== canonicalJson(original.target) ||
            canonicalJson(intent.expectedStates) !== canonicalJson(['draft_saved']) ||
            intents[0]!.capturedAt > job.platformWriteStartedAt ||
            job.platformWriteStartedAt > job.endedAt
          )
            return reject();
          if (canonicalJson(job.result) !== canonicalJson({ evidence: refs })) {
            const saved = object(job.result);
            if (typeof saved.reconciliationJobId !== 'string') return reject();
            const reconciliation = deps
              .prepare(existingGenericReads.ledgerJoin)
              .get(job.id, saved.reconciliationJobId, 'uncertain');
            const read = deps.getJob(saved.reconciliationJobId),
              ref = deps
                .listEvidence(saved.reconciliationJobId)
                .find((r) => r.id === reconciliation?.evidence_id);
            if (
              !reconciliation ||
              canonicalJson(JSON.parse(String(reconciliation.result_json))) !==
                canonicalJson(saved) ||
              !read ||
              read.kind !== 'read' ||
              read.accountId !== job.accountId ||
              read.operation !== 'reconcile_write' ||
              read.scope !== 'reconciliation' ||
              read.inputHash !== hash(canonicalJson({ jobId: job.id })) ||
              read.status !== 'succeeded' ||
              !read.platformReadStartedAt ||
              !read.endedAt ||
              !ref ||
              ref.dataset !== 'reconciliation' ||
              canonicalJson(saved.evidence) !== canonicalJson(ref) ||
              saved.observedStatus !== 'unknown'
            )
              return reject();
            const doc = deps.readEvidence(ref),
              payload = object(doc.payload),
              observed = object(payload.reconciliation);
            if (
              doc.collectionMode !== 'live' ||
              doc.evidenceKind !== 'observation' ||
              canonicalJson(payload.source) !==
                canonicalJson({ mode: 'live', origin: 'https://fanqienovel.com' }) ||
              observed.originalJobId !== job.id ||
              observed.inputHash !== job.inputHash ||
              canonicalJson(observed.target) !== canonicalJson(original.target) ||
              observed.observedStatus !== 'unknown' ||
              typeof observed.observedContentHash !== 'string' ||
              !/^[a-f0-9]{64}$/.test(observed.observedContentHash) ||
              object(saved.result).contentHash !== observed.observedContentHash ||
              object(saved.result).platformState !== 'unknown' ||
              ref.capturedAt < read.platformReadStartedAt ||
              ref.capturedAt > read.endedAt
            )
              return reject();
          }
        }
      },
    );
  }
  return verifyUnknownRepairChain;
}

interface GetCreationRepairDependencies {
  publicReads: PublicReadCoordinator;
  ensureOpen: EnsureOpenOperation;
  prepare: PrepareOperation;
}

export function createGetCreationRepair(
  deps: GetCreationRepairDependencies,
): GetCreationRepairOperation {
  function getCreationRepair(
    recoveryId: string,
  ): { repairJobId: string; closedAt: string | null } | null {
    return deps.publicReads.memo('store.getCreationRepair', [recoveryId], () => {
      deps.ensureOpen();
      const row = deps.prepare(existingGenericReads.repairSummary).get(recoveryId);
      return row
        ? { repairJobId: String(row.repair_job_id), closedAt: row.closed_at as string | null }
        : null;
    });
  }
  return getCreationRepair;
}
