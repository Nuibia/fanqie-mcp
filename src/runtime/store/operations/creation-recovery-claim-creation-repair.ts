import { RuntimeError, type Job, existingGenericReads } from '../runtime-error.js';
import { canonicalJson, hash, timestamp } from '../native-closure-signal.js';
import { PublicReadCoordinator } from '../../public-read.js';
import {
  type TransactionOperation,
  type PrepareOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';
import {
  type GetJobOperation,
  type RunningJobOperation,
  type ListJobsOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';

import {
  type ListEvidenceOperation,
  type ReadEvidenceOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

import {
  type GenericCreationEnvelopeOperation,
  type CreationRepairJobsOperation,
  type VerifyUnknownRepairChainOperation,
  type GenericRepairEntryOperation,
  type CreationRepairPriorOperation,
  type ClaimCreationRepairOperation,
} from '../contracts/creation-recovery-generic-creation-prior.js';

interface ClaimCreationRepairDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  getJob: GetJobOperation;
  runningJob: RunningJobOperation;
  prepare: PrepareOperation;
  listEvidence: ListEvidenceOperation;
  readEvidence: ReadEvidenceOperation;
  genericCreationEnvelope: GenericCreationEnvelopeOperation;
  creationRepairJobs: CreationRepairJobsOperation;
  verifyUnknownRepairChain: VerifyUnknownRepairChainOperation;
  listJobs: ListJobsOperation;
  genericRepairEntry: GenericRepairEntryOperation;
  creationRepairPrior: CreationRepairPriorOperation;
}

export function createClaimCreationRepair(
  deps: ClaimCreationRepairDependencies,
): ClaimCreationRepairOperation {
  function claimCreationRepair(
    originalId: string,
    recoveryId: string,
    repairId: string,
    bindings: {
      accountId: string;
      originalInputHash: string;
      recoveryInputHash: string;
      repairInputHash: string;
      clientReferenceHash: string;
      requestedContentHash: string;
      desiredContentHash: string;
      expectedContentHash: string;
      requestedTitleHash: string;
      requestedBodyHash: string;
    },
    previousRepairId?: string,
  ): Job {
    deps.publicReads.assertMutationAllowed();
    return deps.transaction(() => {
      const reject = (): never => {
        throw new RuntimeError(
          'creation_repair_unverified',
          'Only the exact original allocation and its currently unknown saved recovery may be repaired.',
        );
      };
      const object = (value: unknown): Record<string, unknown> =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      const original = deps.getJob(originalId),
        recovery = deps.getJob(recoveryId),
        repair = deps.runningJob(repairId);
      const relation = deps.prepare(existingGenericReads.recovery).get(originalId);
      if (
        !original ||
        !recovery ||
        !relation ||
        relation.resume_job_id !== recoveryId ||
        relation.closed_at ||
        original.status !== 'uncertain' ||
        recovery.status !== 'uncertain' ||
        original.error?.code !== 'outcome_unknown' ||
        recovery.error?.code !== 'outcome_unknown' ||
        original.kind !== 'write' ||
        original.operation !== 'create_draft' ||
        recovery.kind !== 'write' ||
        recovery.operation !== 'resume_create_draft' ||
        repair.kind !== 'write' ||
        repair.operation !== 'repair_created_draft' ||
        new Set([originalId, recoveryId, repairId]).size !== 3 ||
        original.accountId !== bindings.accountId ||
        recovery.accountId !== original.accountId ||
        repair.accountId !== original.accountId ||
        original.inputHash !== bindings.originalInputHash ||
        recovery.inputHash !== bindings.recoveryInputHash ||
        repair.inputHash !== bindings.repairInputHash ||
        !original.endedAt ||
        !recovery.endedAt ||
        !original.platformWriteStartedAt ||
        !recovery.platformWriteStartedAt ||
        !recovery.platformReadStartedAt ||
        original.endedAt > recovery.requestedAt ||
        recovery.endedAt > repair.requestedAt ||
        !original.target ||
        original.target.kind !== 'short-story' ||
        !/^\d{10,22}$/.test(original.target.id) ||
        canonicalJson(Object.keys(original.target).sort()) !== canonicalJson(['id', 'kind']) ||
        canonicalJson(recovery.target) !== canonicalJson(original.target) ||
        original.scope !== 'account' ||
        recovery.scope !== 'account' ||
        original.datasets.length ||
        recovery.datasets.length ||
        Object.values(bindings).some((v) => typeof v !== 'string') ||
        Object.entries(bindings).some(([k, v]) => k !== 'accountId' && !/^[a-f0-9]{64}$/.test(v))
      )
        return reject();
      const oldBindings = object(JSON.parse(String(relation.bindings_json))),
        originalPrior = {
          status: original.status,
          error: original.error,
          result: original.result,
          target: original.target,
          endedAt: original.endedAt,
          intentRefs: deps.listEvidence(originalId),
        };
      if (
        canonicalJson(oldBindings) !==
          canonicalJson({
            accountId: bindings.accountId,
            originalInputHash: bindings.originalInputHash,
            resumeInputHash: bindings.recoveryInputHash,
            clientReferenceHash: bindings.clientReferenceHash,
            requestedContentHash: bindings.requestedContentHash,
          }) ||
        canonicalJson(originalPrior) !== relation.prior_json ||
        original.metadata.clientReferenceHash !== bindings.clientReferenceHash ||
        recovery.metadata.creationOriginalJobId !== originalId ||
        recovery.metadata.clientReferenceHash !== bindings.clientReferenceHash ||
        recovery.metadata.requestedContentHash !== bindings.requestedContentHash
      )
        return reject();
      const originalRefs = deps.listEvidence(originalId),
        refs = deps.listEvidence(recoveryId);
      if (
        originalRefs.length !== 1 ||
        originalRefs[0]!.dataset !== 'write-intent' ||
        canonicalJson(original.result) !== canonicalJson({ evidence: originalRefs }) ||
        refs.some(
          (ref) =>
            ![
              'creation-resume-baseline',
              'write-intent',
              'write-result',
              ...(Object.hasOwn(recovery.metadata, 'genericShortStatus')
                ? ['editable_snapshot']
                : []),
            ].includes(ref.dataset),
        )
      )
        return reject();
      if (canonicalJson(recovery.result) !== canonicalJson({ evidence: refs })) {
        const saved = object(recovery.result);
        if (typeof saved.reconciliationJobId !== 'string') return reject();
        const reconciliation = deps
          .prepare(existingGenericReads.ledgerJoin)
          .get(recoveryId, saved.reconciliationJobId, 'uncertain');
        const read = deps.getJob(saved.reconciliationJobId),
          ref = deps
            .listEvidence(saved.reconciliationJobId)
            .find((item) => item.id === reconciliation?.evidence_id);
        if (
          !reconciliation ||
          canonicalJson(JSON.parse(String(reconciliation.result_json))) !== canonicalJson(saved) ||
          !read ||
          read.kind !== 'read' ||
          read.operation !== 'reconcile_write' ||
          read.scope !== 'reconciliation' ||
          read.inputHash !== hash(canonicalJson({ jobId: recoveryId })) ||
          read.status !== 'succeeded' ||
          read.accountId !== original.accountId ||
          !read.platformReadStartedAt ||
          !read.endedAt ||
          read.endedAt > recovery.endedAt ||
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
          observed.originalJobId !== recoveryId ||
          observed.inputHash !== recovery.inputHash ||
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
      const entryDoc = deps.readEvidence(originalRefs[0]!),
        entry = object(entryDoc.payload),
        intentRefs = refs.filter((ref) => ref.dataset === 'write-intent'),
        baselineRefs = refs.filter((ref) => ref.dataset === 'creation-resume-baseline');
      if (
        entryDoc.collectionMode !== 'live' ||
        entryDoc.evidenceKind !== 'local-intent' ||
        !deps.genericCreationEnvelope(original, entry, [
          'capability',
          'clientReferenceHash',
          'phase',
          'requestedContentHash',
        ]) ||
        entry.phase !== 'creation-entry' ||
        entry.capability !== 'create_draft' ||
        entry.clientReferenceHash !== bindings.clientReferenceHash ||
        entry.requestedContentHash !== bindings.requestedContentHash ||
        intentRefs.length !== 1 ||
        baselineRefs.length !== 1 ||
        refs.filter((ref) => ref.dataset === 'write-result').length > 1
      )
        return reject();
      const intentDoc = deps.readEvidence(intentRefs[0]!),
        intent = object(intentDoc.payload),
        baselineDoc = deps.readEvidence(baselineRefs[0]!),
        baseline = object(baselineDoc.payload),
        snapshot = object(baseline.snapshot);
      if (
        intentDoc.collectionMode !== 'live' ||
        intentDoc.evidenceKind !== 'local-intent' ||
        !deps.genericCreationEnvelope(recovery, intent, [
          'desiredContentHash',
          'expectedStates',
          'target',
        ]) ||
        intent.desiredContentHash !== bindings.desiredContentHash ||
        canonicalJson(intent.target) !== canonicalJson(original.target) ||
        canonicalJson(intent.expectedStates) !== canonicalJson(['draft_saved']) ||
        baselineDoc.collectionMode !== 'live' ||
        baselineDoc.evidenceKind !== 'observation' ||
        canonicalJson(baseline.source) !==
          canonicalJson({ mode: 'live', origin: 'https://fanqienovel.com' }) ||
        baseline.originalJobId !== originalId ||
        baseline.requestedContentHash !== bindings.requestedContentHash ||
        canonicalJson(baseline.target) !== canonicalJson(original.target) ||
        canonicalJson(snapshot.target) !==
          canonicalJson({ kind: 'short', workId: original.target.id }) ||
        snapshot.state !== 'draft' ||
        snapshot.title !== '' ||
        snapshot.body !== '' ||
        typeof snapshot.platformReadAt !== 'string' ||
        snapshot.platformReadAt < recovery.platformReadStartedAt ||
        snapshot.platformReadAt > baselineRefs[0]!.capturedAt ||
        baselineRefs[0]!.capturedAt > intentRefs[0]!.capturedAt ||
        intentRefs[0]!.capturedAt > recovery.platformWriteStartedAt ||
        recovery.platformWriteStartedAt > recovery.endedAt
      )
        return reject();
      const ancestors = previousRepairId ? deps.creationRepairJobs(originalId, recoveryId) : [];
      if (
        previousRepairId &&
        (ancestors.length >= 128 ||
          ancestors.at(-1)!.id !== previousRepairId ||
          ancestors.at(-1)!.endedAt! > repair.requestedAt)
      )
        throw new RuntimeError(
          'creation_repair_conflict',
          'Only the latest unknown repair may own this successor.',
        );
      if (previousRepairId) deps.verifyUnknownRepairChain(ancestors, original, recovery, bindings);
      if (
        deps
          .listJobs(original.accountId)
          .some(
            (job) =>
              job.kind === 'write' &&
              job.status === 'uncertain' &&
              ![originalId, recoveryId, ...ancestors.map((j) => j.id)].includes(job.id),
          )
      )
        throw new RuntimeError(
          'unresolved_write',
          'Another unknown write must be reconciled before this same-target repair.',
        );
      const previous = previousRepairId
        ? deps
            .prepare(
              'SELECT repair_job_id, bindings_json FROM creation_repair_successors WHERE previous_repair_job_id = ?',
            )
            .get(previousRepairId)
        : deps
            .prepare(
              'SELECT repair_job_id, bindings_json FROM creation_repairs WHERE recovery_job_id = ?',
            )
            .get(recoveryId);
      if (previous) {
        if (
          previous.repair_job_id !== repairId ||
          previous.bindings_json !== canonicalJson(bindings)
        )
          throw new RuntimeError(
            'creation_repair_conflict',
            'This recovery already owns a durable repair; do not replace it or replay under another key.',
          );
        return original;
      }
      if (
        repair.target ||
        repair.platformWriteStartedAt ||
        !deps.genericRepairEntry(repair, bindings, original.target)
      )
        return reject();
      const prior = {
        original: originalPrior,
        recovery: {
          status: recovery.status,
          error: recovery.error,
          result: recovery.result,
          target: recovery.target,
          endedAt: recovery.endedAt,
          evidence: refs,
          metadata: recovery.metadata,
        },
        ...(previousRepairId ? { repairs: ancestors.map((j) => deps.creationRepairPrior(j)) } : {}),
      };
      if (previousRepairId)
        deps
          .prepare(
            'INSERT INTO creation_repair_successors(previous_repair_job_id,recovery_job_id,original_job_id,repair_job_id,bindings_json,prior_json,created_at) VALUES(?,?,?,?,?,?,?)',
          )
          .run(
            previousRepairId,
            recoveryId,
            originalId,
            repairId,
            canonicalJson(bindings),
            canonicalJson(prior),
            timestamp(),
          );
      else
        deps
          .prepare(
            'INSERT INTO creation_repairs(recovery_job_id,original_job_id,repair_job_id,bindings_json,prior_json,created_at) VALUES(?,?,?,?,?,?)',
          )
          .run(
            recoveryId,
            originalId,
            repairId,
            canonicalJson(bindings),
            canonicalJson(prior),
            timestamp(),
          );
      deps
        .prepare('UPDATE jobs SET target_json = ?, metadata_json = ?, updated_at = ? WHERE id = ?')
        .run(
          canonicalJson(original.target),
          canonicalJson({
            ...repair.metadata,
            creationOriginalJobId: originalId,
            creationRecoveryJobId: recoveryId,
            clientReferenceHash: bindings.clientReferenceHash,
            requestedContentHash: bindings.requestedContentHash,
          }),
          timestamp(),
          repairId,
        );
      return original;
    });
  }
  return claimCreationRepair;
}
