import { RuntimeError, type Job, existingGenericReads } from '../runtime-error.js';
import { canonicalJson, hash, timestamp } from '../native-closure-signal.js';
import { PublicReadCoordinator } from '../../public-read.js';
import { hasGenericShortStatusSignal } from '../has-generic-short-status-signal.js';
import {
  type TransactionOperation,
  type PrepareOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';

import { type GetJobOperation } from '../contracts/jobs-api-with-public-projection-read.js';
import {
  type CreationRepairJobsOperation,
  type CreationRepairPriorOperation,
  type CompleteCreationRepairOperation,
} from '../contracts/creation-recovery-generic-creation-prior.js';
import {
  type ListEvidenceOperation,
  type ReadEvidenceOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

import { type GenericWitnessOperation } from '../contracts/generic-status-generic-refs.js';

interface CompleteCreationRepairDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  prepare: PrepareOperation;
  getJob: GetJobOperation;
  creationRepairJobs: CreationRepairJobsOperation;
  listEvidence: ListEvidenceOperation;
  creationRepairPrior: CreationRepairPriorOperation;
  readEvidence: ReadEvidenceOperation;
  genericWitness: GenericWitnessOperation;
}

export function createCompleteCreationRepair(
  deps: CompleteCreationRepairDependencies,
): CompleteCreationRepairOperation {
  function completeCreationRepair(originalId: string, recoveryId: string, repairId: string): Job {
    deps.publicReads.assertMutationAllowed();
    return deps.transaction(() => {
      const reject = (): never => {
        throw new RuntimeError(
          'creation_repair_incomplete',
          'Repair closure requires the complete same-target native draft version and durable proof.',
        );
      };
      const object = (value: unknown): Record<string, unknown> =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      const rootRow = deps.prepare(existingGenericReads.closedRepair).get(recoveryId, originalId);
      const row =
        rootRow?.repair_job_id === repairId
          ? rootRow
          : deps
              .prepare(existingGenericReads.closedSuccessor)
              .get(recoveryId, originalId, repairId);
      const relation = deps.prepare(existingGenericReads.recovery).get(originalId);
      const original = deps.getJob(originalId),
        recovery = deps.getJob(recoveryId),
        repair = deps.getJob(repairId);
      if (
        !row ||
        row.repair_job_id !== repairId ||
        !relation ||
        relation.resume_job_id !== recoveryId ||
        !original ||
        !recovery ||
        !repair ||
        original.accountId !== recovery.accountId ||
        repair.accountId !== original.accountId ||
        repair.operation !== 'repair_created_draft' ||
        repair.kind !== 'write' ||
        repair.status !== 'succeeded' ||
        !repair.endedAt ||
        !repair.platformReadStartedAt ||
        !original.target ||
        canonicalJson(recovery.target) !== canonicalJson(original.target) ||
        canonicalJson(repair.target) !== canonicalJson(original.target)
      )
        return reject();
      if (row.closed_at) {
        if (
          original.status !== 'succeeded' ||
          recovery.status !== 'failed' ||
          recovery.error?.code !== 'superseded_by_verified_repair' ||
          canonicalJson(original.result) !== row.closure_json ||
          canonicalJson(recovery.result) !== row.recovery_closure_json
        )
          return reject();
        return original;
      }
      const chain = deps.creationRepairJobs(originalId, recoveryId);
      if (chain.at(-1)!.id !== repairId)
        throw new RuntimeError(
          'creation_repair_conflict',
          'Only the latest repair can close this allocation.',
        );
      const prior = object(JSON.parse(String(row.prior_json))),
        priorOriginal = object(prior.original),
        priorRecovery = object(prior.recovery),
        bindings = object(JSON.parse(String(row.bindings_json)));
      if (
        relation.closed_at ||
        original.status !== 'uncertain' ||
        recovery.status !== 'uncertain' ||
        canonicalJson({
          status: original.status,
          error: original.error,
          result: original.result,
          target: original.target,
          endedAt: original.endedAt,
          intentRefs: deps.listEvidence(originalId),
        }) !== canonicalJson(priorOriginal) ||
        canonicalJson({
          status: recovery.status,
          error: recovery.error,
          result: recovery.result,
          target: recovery.target,
          endedAt: recovery.endedAt,
          evidence: deps.listEvidence(recoveryId),
          metadata: recovery.metadata,
        }) !== canonicalJson(priorRecovery) ||
        repair.inputHash !== bindings.repairInputHash
      )
        return reject();
      if (
        canonicalJson(prior.repairs ?? []) !==
        canonicalJson(chain.slice(0, -1).map((j) => deps.creationRepairPrior(j)))
      )
        return reject();
      const refs = deps.listEvidence(repairId),
        baseRefs = refs.filter((ref) => ref.dataset === 'creation-repair-baseline'),
        intentRefs = refs.filter((ref) => ref.dataset === 'write-intent');
      if (hasGenericShortStatusSignal([repair, ...refs.map((ref) => deps.readEvidence(ref))]))
        deps.genericWitness(
          repair,
          refs,
          refs.map((ref) => deps.readEvidence(ref)),
        );
      if (
        baseRefs.length !== 1 ||
        intentRefs.length !== 1 ||
        refs.some(
          (ref) =>
            ![
              'creation-repair-baseline',
              'write-intent',
              'creation-repair-verification',
              'write-result',
              ...(Object.hasOwn(repair.metadata, 'genericShortStatus')
                ? ['editable_snapshot']
                : []),
            ].includes(ref.dataset),
        )
      )
        return reject();
      const writeTarget = { kind: 'short', workId: original.target.id },
        baseDoc = deps.readEvidence(baseRefs[0]!),
        baseline = object(baseDoc.payload),
        before = object(baseline.snapshot),
        intentDoc = deps.readEvidence(intentRefs[0]!),
        intent = object(intentDoc.payload);
      if (
        baseDoc.collectionMode !== 'live' ||
        baseDoc.evidenceKind !== 'observation' ||
        canonicalJson(baseline.source) !==
          canonicalJson({ mode: 'live', origin: 'https://fanqienovel.com' }) ||
        baseline.originalJobId !== originalId ||
        baseline.recoveryJobId !== recoveryId ||
        baseline.requestedContentHash !== bindings.requestedContentHash ||
        baseline.expectedContentHash !== bindings.expectedContentHash ||
        canonicalJson(baseline.target) !== canonicalJson(original.target) ||
        canonicalJson(before.target) !== canonicalJson(writeTarget) ||
        before.state !== 'draft' ||
        before.contentHash !== bindings.expectedContentHash ||
        typeof before.title !== 'string' ||
        typeof before.body !== 'string' ||
        typeof before.accountId !== 'string' ||
        typeof before.platformReadAt !== 'string' ||
        before.platformReadAt < repair.platformReadStartedAt ||
        before.platformReadAt > baseRefs[0]!.capturedAt ||
        intentDoc.collectionMode !== 'live' ||
        intentDoc.evidenceKind !== 'local-intent' ||
        canonicalJson(intent.target) !== canonicalJson(original.target) ||
        intent.desiredContentHash !== bindings.desiredContentHash ||
        canonicalJson(intent.expectedStates) !== canonicalJson(['draft_saved']) ||
        baseRefs[0]!.capturedAt > intentRefs[0]!.capturedAt ||
        !repair.platformWriteStartedAt ||
        intentRefs[0]!.capturedAt > repair.platformWriteStartedAt
      )
        return reject();
      const fullSnapshot = (value: unknown, earliest: string, latest: string): boolean => {
        const snapshot = object(value);
        return (
          canonicalJson(snapshot.target) === canonicalJson(writeTarget) &&
          snapshot.accountId === before.accountId &&
          snapshot.state === 'draft' &&
          snapshot.contentHash === bindings.desiredContentHash &&
          typeof snapshot.title === 'string' &&
          hash(snapshot.title) === bindings.requestedTitleHash &&
          typeof snapshot.body === 'string' &&
          hash(snapshot.body.replace(/\r\n?/g, '\n')) === bindings.requestedBodyHash &&
          typeof snapshot.platformReadAt === 'string' &&
          snapshot.platformReadAt >= earliest &&
          snapshot.platformReadAt <= latest
        );
      };
      const result = object(repair.result),
        resultRefs = refs.filter((ref) => ref.dataset === 'write-result'),
        verificationRefs = refs.filter((ref) => ref.dataset === 'creation-repair-verification');
      let proof: unknown;
      if (typeof result.reconciliationJobId !== 'string') {
        if (resultRefs.length !== 1 || verificationRefs.length !== 1) return reject();
        const resultDoc = deps.readEvidence(resultRefs[0]!),
          verificationDoc = deps.readEvidence(verificationRefs[0]!),
          verification = object(verificationDoc.payload);
        if (
          resultDoc.collectionMode !== 'live' ||
          resultDoc.evidenceKind !== 'observation' ||
          canonicalJson(resultDoc.payload) !== canonicalJson(result) ||
          result.status !== 'succeeded' ||
          result.capability !== 'update_draft' ||
          canonicalJson(result.target) !== canonicalJson(writeTarget) ||
          result.contentHash !== bindings.desiredContentHash ||
          result.platformState !== 'draft' ||
          typeof result.verifiedAt !== 'string' ||
          result.verifiedAt < intentRefs[0]!.capturedAt ||
          verificationDoc.collectionMode !== 'live' ||
          verificationDoc.evidenceKind !== 'observation' ||
          canonicalJson(verification.source) !==
            canonicalJson({ mode: 'live', origin: 'https://fanqienovel.com' }) ||
          verification.originalJobId !== originalId ||
          verification.recoveryJobId !== recoveryId ||
          canonicalJson(verification.target) !== canonicalJson(original.target) ||
          !fullSnapshot(
            verification.snapshot,
            result.verifiedAt,
            verificationRefs[0]!.capturedAt,
          ) ||
          verificationRefs[0]!.capturedAt > resultRefs[0]!.capturedAt ||
          resultRefs[0]!.capturedAt > repair.endedAt
        )
          return reject();
        proof = {
          kind: 'saved-verified-repair',
          evidence: resultRefs[0],
          fullReadback: verificationRefs[0],
        };
      } else {
        const reconciliation = deps
          .prepare(existingGenericReads.ledgerJoin)
          .get(repairId, result.reconciliationJobId, 'succeeded');
        if (
          !reconciliation ||
          canonicalJson(JSON.parse(String(reconciliation.result_json))) !== canonicalJson(result) ||
          resultRefs.length > 1 ||
          verificationRefs.length > 1
        )
          return reject();
        const read = deps.getJob(result.reconciliationJobId),
          ref = deps
            .listEvidence(result.reconciliationJobId)
            .find((item) => item.id === reconciliation.evidence_id);
        if (
          !read ||
          read.kind !== 'read' ||
          read.operation !== 'reconcile_write' ||
          read.scope !== 'reconciliation' ||
          read.accountId !== repair.accountId ||
          read.status !== 'succeeded' ||
          !read.platformReadStartedAt ||
          !read.endedAt ||
          !ref ||
          ref.dataset !== 'reconciliation' ||
          canonicalJson(result.evidence) !== canonicalJson(ref) ||
          result.observedStatus !== 'draft_saved' ||
          object(result.result).contentHash !== bindings.desiredContentHash ||
          object(result.result).platformState !== 'draft_saved'
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
          observed.originalJobId !== repairId ||
          observed.inputHash !== repair.inputHash ||
          canonicalJson(observed.target) !== canonicalJson(original.target) ||
          observed.observedStatus !== 'draft_saved' ||
          observed.observedContentHash !== bindings.desiredContentHash ||
          !fullSnapshot(payload.repairVerification, read.platformReadStartedAt, ref.capturedAt) ||
          ref.capturedAt > read.endedAt
        )
          return reject();
        proof = { kind: 'reconciled-verified-repair', reconciliationJobId: read.id, evidence: ref };
      }
      const now = timestamp(),
        link = {
          originalJobId: originalId,
          recoveryJobId: recoveryId,
          repairJobId: repairId,
          target: original.target,
          requestedContentHash: bindings.requestedContentHash,
          desiredContentHash: bindings.desiredContentHash,
          expectedContentHash: bindings.expectedContentHash,
          proof,
          closedAt: now,
        };
      const closure = { creationRepair: link, prior: priorOriginal },
        recoveryClosure = { supersededByVerifiedRepair: link, prior: priorRecovery };
      deps
        .prepare(
          'UPDATE creation_repairs SET closed_at = ?, closure_json = ?, recovery_closure_json = ? WHERE recovery_job_id = ?',
        )
        .run(now, canonicalJson(closure), canonicalJson(recoveryClosure), recoveryId);
      deps
        .prepare(
          'UPDATE creation_repair_successors SET closed_at = ?, closure_json = ?, recovery_closure_json = ? WHERE original_job_id = ? AND recovery_job_id = ?',
        )
        .run(now, canonicalJson(closure), canonicalJson(recoveryClosure), originalId, recoveryId);
      for (const old of chain.slice(0, -1)) {
        const oldClosure = {
          supersededByVerifiedRepair: link,
          prior: deps.creationRepairPrior(old),
        };
        deps
          .prepare(
            'UPDATE jobs SET status = ?, result_json = ?, error_json = ?, updated_at = ? WHERE id = ?',
          )
          .run(
            'failed',
            canonicalJson(oldClosure),
            canonicalJson({
              code: 'superseded_by_verified_repair',
              message:
                'This earlier unknown repair remains a failed attempt; a later verified same-target repair fulfilled the original request.',
            }),
            now,
            old.id,
          );
      }
      deps
        .prepare(
          'UPDATE creation_recoveries SET closed_at = ?, closure_json = ? WHERE original_job_id = ?',
        )
        .run(now, canonicalJson(closure), originalId);
      deps
        .prepare(
          'UPDATE jobs SET status = ?, result_json = ?, error_json = ?, updated_at = ? WHERE id = ?',
        )
        .run(
          'failed',
          canonicalJson(recoveryClosure),
          canonicalJson({
            code: 'superseded_by_verified_repair',
            message:
              'This incomplete save remains a failed attempt; a later verified same-target repair fulfilled the original request.',
          }),
          now,
          recoveryId,
        );
      deps
        .prepare(
          'UPDATE jobs SET status = ?, result_json = ?, error_json = NULL, ended_at = ?, updated_at = ? WHERE id = ?',
        )
        .run('succeeded', canonicalJson(closure), now, now, originalId);
      return deps.getJob(originalId)!;
    });
  }
  return completeCreationRepair;
}
