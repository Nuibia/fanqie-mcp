import { RuntimeError, type Job, type JobStatus, type RuntimeFailure } from '../runtime-error.js';
import { canonicalJson, bodyUnavailable, timestamp } from '../native-closure-signal.js';
import * as bodyProof from '../../../platform/short-native-body-proof.js';
import { PublicReadCoordinator } from '../../public-read.js';
import { captureShortStatusJson } from '../../../platform/short-status.js';
import {
  genericUnavailable,
  genericSame,
  hasGenericShortStatusSignal,
} from '../has-generic-short-status-signal.js';
import * as draftDirectory from '../../../platform/short-draft-directory.js';
import {
  hasReservedNativeShortTrialSignal,
  validateNativeShortTrialCompletion,
} from '../../../platform/short-native-trial-proof.js';
import {
  hasReservedNativeShortSubmissionSignal,
  validateNativeShortSubmissionCompletion,
} from '../../../platform/short-native-submission-proof.js';
import {
  hasReservedNativeShortCoverSignal,
  validateNativeShortCoverCompletion,
} from '../../../platform/short-native-cover-proof.js';
import { hasReservedNativeShortSignal } from '../../../platform/short-native-metadata-proof.js';
import {
  type TransactionOperation,
  type PrepareOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';
import {
  type RunningJobOperation,
  type AssertNotCancelledOperation,
  type GetJobOperation,
  type CompleteWriteJobOperation,
  type FailJobOperation,
  type DecodeJobOperation,
  type RecoverInterruptedOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';

import {
  type ListEvidenceOperation,
  type ReadEvidenceOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

import {
  type NativeShortSubmissionContextOperation,
  type NativeShortTrialContextOperation,
  type NativeShortCoverContextOperation,
} from '../contracts/native-states-native-short-submission-context.js';

import {
  type NativeShortBodySignalOperation,
  type NativeShortBodyContextOperation,
} from '../contracts/native-body-native-short-body-signal.js';

import {
  type GenericWitnessOperation,
  type GenericMutationGraphOperation,
  type GenericQualifyWriteOperation,
} from '../contracts/generic-status-generic-refs.js';

interface CompleteWriteJobDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  runningJob: RunningJobOperation;
  assertNotCancelled: AssertNotCancelledOperation;
  listEvidence: ListEvidenceOperation;
  readEvidence: ReadEvidenceOperation;
  nativeShortSubmissionContext: NativeShortSubmissionContextOperation;
  prepare: PrepareOperation;
  getJob: GetJobOperation;
  nativeShortBodySignal: NativeShortBodySignalOperation;
  nativeShortBodyContext: NativeShortBodyContextOperation;
  nativeShortTrialContext: NativeShortTrialContextOperation;
  nativeShortCoverContext: NativeShortCoverContextOperation;
  genericWitness: GenericWitnessOperation;
  genericMutationGraph: GenericMutationGraphOperation;
  genericQualifyWrite: GenericQualifyWriteOperation;
}

export function createCompleteWriteJob(
  deps: CompleteWriteJobDependencies,
): CompleteWriteJobOperation {
  function completeWriteJob(jobId: string, result: unknown): Job {
    deps.publicReads.assertMutationAllowed();
    return deps.transaction(() => {
      const job = deps.runningJob(jobId);
      deps.assertNotCancelled(job);
      if (job.kind !== 'write' || (!job.platformReadStartedAt && !job.platformWriteStartedAt))
        throw new RuntimeError(
          'platform_not_accessed',
          'Write completion requires a platform action or read-back reconciliation.',
        );
      const submissionSignals = [
        job,
        result,
        ...deps.listEvidence(job.id).map((ref) => deps.readEvidence(ref)),
      ];
      if (hasReservedNativeShortSubmissionSignal(submissionSignals)) {
        try {
          const checked = validateNativeShortSubmissionCompletion(
              deps.nativeShortSubmissionContext(job),
              result,
            ),
            now = timestamp(),
            rejected = checked.business.status === 'failed';
          const error = rejected
            ? {
                code: 'native_submission_rejected',
                message: 'The platform rejected this submission; the attempt will not be replayed.',
              }
            : null;
          deps
            .prepare(
              'UPDATE jobs SET status=?,ended_at=?,updated_at=?,result_json=?,error_json=? WHERE id=?',
            )
            .run(
              rejected ? 'failed' : 'succeeded',
              now,
              now,
              canonicalJson(checked),
              error ? canonicalJson(error) : null,
              jobId,
            );
          return deps.getJob(jobId)!;
        } catch {
          throw new RuntimeError(
            'capability_unavailable',
            'Native submission completion is unavailable',
          );
        }
      }
      if (deps.nativeShortBodySignal(job) || bodyProof.hasReservedNativeShortBodySignal(result)) {
        try {
          const checked = bodyProof.validateNativeShortBodyCompletion(
            deps.nativeShortBodyContext(job),
            result,
          );
          const now = timestamp();
          deps
            .prepare(
              'UPDATE jobs SET status=?,ended_at=?,updated_at=?,result_json=?,error_json=NULL WHERE id=?',
            )
            .run('succeeded', now, now, canonicalJson(checked), jobId);
          return deps.getJob(jobId)!;
        } catch {
          return bodyUnavailable();
        }
      }
      const trialCompletionSignals: unknown[] = [job, result, ...deps.listEvidence(job.id)];
      for (const ref of deps.listEvidence(job.id)) {
        try {
          trialCompletionSignals.push(deps.readEvidence(ref));
        } catch {
          if (hasReservedNativeShortTrialSignal(trialCompletionSignals))
            throw new RuntimeError(
              'capability_unavailable',
              'Native short trial completion is unavailable.',
            );
        }
      }
      if (hasReservedNativeShortTrialSignal(trialCompletionSignals)) {
        try {
          validateNativeShortTrialCompletion(deps.nativeShortTrialContext(job), result);
        } catch {
          throw new RuntimeError(
            'capability_unavailable',
            'Native short trial completion is unavailable.',
          );
        }
      }
      const coverCompletionSignals: unknown[] = [job, result, ...deps.listEvidence(job.id)];
      for (const ref of deps.listEvidence(job.id)) {
        try {
          coverCompletionSignals.push(deps.readEvidence(ref));
        } catch {
          if (hasReservedNativeShortCoverSignal(coverCompletionSignals))
            throw new RuntimeError(
              'capability_unavailable',
              'Native short cover completion is unavailable.',
            );
        }
      }
      if (hasReservedNativeShortCoverSignal(coverCompletionSignals)) {
        try {
          validateNativeShortCoverCompletion(deps.nativeShortCoverContext(job), result);
        } catch {
          throw new RuntimeError(
            'capability_unavailable',
            'Native short cover completion is unavailable.',
          );
        }
      }
      const genericCompletionSignals = [
        job,
        ...deps.listEvidence(job.id).map((ref) => deps.readEvidence(ref)),
      ];
      if (
        !genericCompletionSignals.some(hasReservedNativeShortSubmissionSignal) &&
        !genericCompletionSignals.some(bodyProof.hasReservedNativeShortBodySignal) &&
        !genericCompletionSignals.some(draftDirectory.hasReservedShortDraftDirectorySignal) &&
        !genericCompletionSignals.some(hasReservedNativeShortTrialSignal) &&
        !genericCompletionSignals.some(hasReservedNativeShortCoverSignal) &&
        !genericCompletionSignals.some(hasReservedNativeShortSignal) &&
        hasGenericShortStatusSignal(genericCompletionSignals)
      ) {
        const refs = deps.listEvidence(job.id),
          documents = refs.map((ref) => deps.readEvidence(ref));
        deps.genericWitness(job, refs, documents, true);
        const graph = deps.genericMutationGraph(job.id, job.accountId),
          node = graph.jobs[job.id]!;
        node.job = {
          ...job,
          status: 'succeeded',
          result: captureShortStatusJson(result),
          error: null,
          endedAt: timestamp(),
          updatedAt: timestamp(),
        };
        deps.genericQualifyWrite(node, graph);
        if (!genericSame(node.refs, refs) || !genericSame(node.documents, documents))
          return genericUnavailable();
      }
      const now = timestamp();
      deps
        .prepare(
          'UPDATE jobs SET status = ?, ended_at = ?, updated_at = ?, result_json = ?, error_json = NULL WHERE id = ?',
        )
        .run('succeeded', now, now, canonicalJson(result), jobId);
      return deps.getJob(jobId)!;
    });
  }
  return completeWriteJob;
}

interface FailJobDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  getJob: GetJobOperation;
  terminal: Set<JobStatus>;
  ownerId: `${string}-${string}-${string}-${string}-${string}`;
  listEvidence: ListEvidenceOperation;
  prepare: PrepareOperation;
}

export function createFailJob(deps: FailJobDependencies): FailJobOperation {
  function failJob(jobId: string, error: RuntimeFailure): Job {
    deps.publicReads.assertMutationAllowed();
    return deps.transaction(() => {
      const job = deps.getJob(jobId);
      if (!job || deps.terminal.has(job.status) || job.ownerId !== deps.ownerId)
        throw new RuntimeError(
          'invalid_job_state',
          'Only an active job owned by this service can fail.',
        );
      const evidence = deps.listEvidence(jobId);
      const uncertain = job.kind === 'write' && job.platformWriteStartedAt !== null;
      const cancellation = job.cancellationReason;
      const cause = cancellation ?? error;
      const waitingForLogin = ['requires_login', 'challenge_required'].includes(error.code);
      const status: JobStatus = uncertain
        ? 'uncertain'
        : cancellation
          ? cancellation.code === 'timeout'
            ? 'failed'
            : 'cancelled'
          : waitingForLogin
            ? 'waiting_for_login'
            : job.kind === 'read' && evidence.length > 0
              ? 'partial'
              : 'failed';
      const failure = uncertain
        ? {
            code: 'outcome_unknown',
            message: 'The platform write may have happened; reconcile before retrying.',
            details: { cause },
          }
        : cause;
      const now = timestamp();
      deps
        .prepare(
          'UPDATE jobs SET status = ?, ended_at = ?, updated_at = ?, result_json = ?, error_json = ? WHERE id = ?',
        )
        .run(status, now, now, canonicalJson({ evidence }), canonicalJson(failure), jobId);
      return deps.getJob(jobId)!;
    });
  }
  return failJob;
}

interface RecoverInterruptedDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  prepare: PrepareOperation;
  ownerId: `${string}-${string}-${string}-${string}-${string}`;
  decodeJob: DecodeJobOperation;
  listEvidence: ListEvidenceOperation;
}

export function createRecoverInterrupted(
  deps: RecoverInterruptedDependencies,
): RecoverInterruptedOperation {
  function recoverInterrupted(): number {
    deps.publicReads.assertMutationAllowed();
    return deps.transaction(() => {
      const abandoned = deps
        .prepare("SELECT * FROM jobs WHERE status IN ('queued', 'running') AND owner_id != ?")
        .all(deps.ownerId);
      const now = timestamp();
      for (const row of abandoned) {
        const job = deps.decodeJob(row as Record<string, unknown>);
        const uncertain = job.kind === 'write' && job.status === 'running';
        const failure: RuntimeFailure = uncertain
          ? {
              code: 'outcome_unknown',
              message: 'A previous service stopped during this write; reconcile before retrying.',
            }
          : {
              code: 'interrupted',
              message: 'The previous service stopped before this job completed.',
            };
        deps
          .prepare(
            'UPDATE jobs SET status = ?, ended_at = ?, updated_at = ?, result_json = ?, error_json = ? WHERE id = ?',
          )
          .run(
            uncertain ? 'uncertain' : 'failed',
            now,
            now,
            canonicalJson({ evidence: deps.listEvidence(job.id) }),
            canonicalJson(failure),
            job.id,
          );
      }
      return abandoned.length;
    });
  }
  return recoverInterrupted;
}
