import { RuntimeError, type Job } from '../runtime-error.js';
import { canonicalJson, timestamp } from '../native-closure-signal.js';
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

import { type GenericCreationEnvelopeOperation } from '../contracts/creation-recovery-generic-creation-prior.js';

import { type ClaimCreationRecoveryOperation } from '../contracts/jobs-api-reconcile-native-short-submission-write.js';

interface ClaimCreationRecoveryDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  getJob: GetJobOperation;
  runningJob: RunningJobOperation;
  listEvidence: ListEvidenceOperation;
  readEvidence: ReadEvidenceOperation;
  genericCreationEnvelope: GenericCreationEnvelopeOperation;
  listJobs: ListJobsOperation;
  prepare: PrepareOperation;
}

export function createClaimCreationRecovery(
  deps: ClaimCreationRecoveryDependencies,
): ClaimCreationRecoveryOperation {
  function claimCreationRecovery(
    originalId: string,
    resumeJobId: string,
    bindings: {
      accountId: string;
      originalInputHash: string;
      resumeInputHash: string;
      clientReferenceHash: string;
      requestedContentHash: string;
    },
  ): Job {
    deps.publicReads.assertMutationAllowed();
    return deps.transaction(() => {
      const reject = (): never => {
        throw new RuntimeError(
          'creation_recovery_unverified',
          'Only an initial-only creation with an exact original request and allocated short target may resume.',
        );
      };
      const original = deps.getJob(originalId),
        resume = deps.runningJob(resumeJobId);
      if (
        !original ||
        original.accountId !== bindings.accountId ||
        original.kind !== 'write' ||
        original.operation !== 'create_draft' ||
        original.status !== 'uncertain' ||
        original.error?.code !== 'outcome_unknown' ||
        !original.endedAt ||
        !original.platformWriteStartedAt ||
        original.datasets.length !== 0 ||
        original.scope !== 'account'
      )
        return reject();
      if (
        !original.target ||
        original.target.kind !== 'short-story' ||
        !/^\d{10,22}$/.test(original.target.id) ||
        canonicalJson(Object.keys(original.target).sort()) !== canonicalJson(['id', 'kind'])
      )
        return reject();
      if (
        resume.id === original.id ||
        resume.accountId !== original.accountId ||
        resume.kind !== 'write' ||
        resume.operation !== 'resume_create_draft' ||
        resume.inputHash !== bindings.resumeInputHash ||
        original.inputHash !== bindings.originalInputHash ||
        Object.values(bindings).some((value) => typeof value !== 'string') ||
        [
          bindings.originalInputHash,
          bindings.resumeInputHash,
          bindings.clientReferenceHash,
          bindings.requestedContentHash,
        ].some((value) => !/^[a-f0-9]{64}$/.test(value))
      )
        return reject();
      const refs = deps.listEvidence(originalId);
      if (
        refs.length !== 1 ||
        refs[0]!.dataset !== 'write-intent' ||
        canonicalJson(original.result) !== canonicalJson({ evidence: refs })
      )
        return reject();
      const document = deps.readEvidence(refs[0]!);
      const intent = document.payload as Record<string, unknown> | null;
      if (
        document.collectionMode !== 'live' ||
        document.evidenceKind !== 'local-intent' ||
        !intent ||
        !deps.genericCreationEnvelope(original, intent, [
          'capability',
          'clientReferenceHash',
          'phase',
          'requestedContentHash',
        ]) ||
        intent.phase !== 'creation-entry' ||
        intent.capability !== 'create_draft' ||
        intent.clientReferenceHash !== bindings.clientReferenceHash ||
        intent.requestedContentHash !== bindings.requestedContentHash ||
        original.metadata.clientReferenceHash !== bindings.clientReferenceHash
      )
        return reject();
      if (
        !original.startedAt ||
        !original.platformReadStartedAt ||
        !(
          original.requestedAt <= original.startedAt &&
          original.startedAt <= original.platformReadStartedAt &&
          original.platformReadStartedAt <= refs[0]!.capturedAt &&
          refs[0]!.capturedAt <= original.platformWriteStartedAt &&
          original.platformWriteStartedAt <= original.endedAt &&
          original.endedAt <= resume.requestedAt
        )
      )
        return reject();
      if (
        deps
          .listJobs(original.accountId)
          .some(
            (job) => job.kind === 'write' && job.status === 'uncertain' && job.id !== originalId,
          )
      )
        throw new RuntimeError(
          'unresolved_write',
          'Another unknown write must be reconciled before resuming this creation.',
        );
      const previous = deps
        .prepare(
          'SELECT resume_job_id, bindings_json FROM creation_recoveries WHERE original_job_id = ?',
        )
        .get(originalId);
      if (previous) {
        if (
          previous.resume_job_id !== resumeJobId ||
          previous.bindings_json !== canonicalJson(bindings)
        )
          throw new RuntimeError(
            'creation_recovery_conflict',
            'This creation already has one durable recovery; never replay it with another key.',
          );
        return original;
      }
      if (
        resume.target ||
        resume.platformWriteStartedAt ||
        deps.listEvidence(resumeJobId).length !== 0
      )
        return reject();
      const prior = {
        status: original.status,
        error: original.error,
        result: original.result,
        target: original.target,
        endedAt: original.endedAt,
        intentRefs: refs,
      };
      deps
        .prepare(
          'INSERT INTO creation_recoveries(original_job_id, resume_job_id, bindings_json, prior_json, created_at) VALUES(?, ?, ?, ?, ?)',
        )
        .run(originalId, resumeJobId, canonicalJson(bindings), canonicalJson(prior), timestamp());
      deps
        .prepare('UPDATE jobs SET target_json = ?, metadata_json = ?, updated_at = ? WHERE id = ?')
        .run(
          canonicalJson(original.target),
          canonicalJson({
            ...resume.metadata,
            creationOriginalJobId: originalId,
            clientReferenceHash: bindings.clientReferenceHash,
            requestedContentHash: bindings.requestedContentHash,
          }),
          timestamp(),
          resumeJobId,
        );
      return original;
    });
  }
  return claimCreationRecovery;
}
