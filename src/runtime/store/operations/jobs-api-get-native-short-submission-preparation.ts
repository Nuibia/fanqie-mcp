import { RuntimeError, type Manifest, type EvidenceRef } from '../runtime-error.js';
import {
  validateNativeShortSubmissionReadContext,
  type NativeShortSubmissionAttemptRow,
  validateNativeShortSubmissionEvidenceContext,
  NATIVE_SHORT_SUBMISSION_OPERATION,
  nativeShortSubmissionScope,
} from '../../../platform/short-native-submission-proof.js';
import {
  type RawJobOperation,
  type GetNativeShortSubmissionPreparationOperation,
  type ListNativeShortSubmissionAttemptsOperation,
  type RunningJobOperation,
  type AssertNotCancelledOperation,
  type RecordNativeShortSubmissionAttemptOperation,
  type ListNativeShortTrialAttemptsOperation,
  type RecordNativeShortTrialAttemptOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';
import {
  type ListEvidenceOperation,
  type ReadEvidenceOperation,
} from '../contracts/evidence-public-evidence-file-size.js';
import {
  type PrepareOperation,
  type EnsureOpenOperation,
  type TransactionOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';

import { PublicReadCoordinator } from '../../public-read.js';

import { sameNativeValue, timestamp } from '../native-closure-signal.js';

import { isCanonicalNativeTime } from '../../../platform/short-native-metadata-proof.js';

import {
  type NativeShortSubmissionContextOperation,
  type NativeShortTrialContextOperation,
} from '../contracts/native-states-native-short-submission-context.js';

import {
  type NativeShortTrialAttemptRow,
  NATIVE_SHORT_TRIAL_OPERATION,
  nativeShortTrialScope,
  validateNativeShortTrialEvidenceContext,
} from '../../../platform/short-native-trial-proof.js';

interface GetNativeShortSubmissionPreparationDependencies {
  rawJob: RawJobOperation;
  listEvidence: ListEvidenceOperation;
  prepare: PrepareOperation;
  readEvidence: ReadEvidenceOperation;
}

export function createGetNativeShortSubmissionPreparation(
  deps: GetNativeShortSubmissionPreparationDependencies,
): GetNativeShortSubmissionPreparationOperation {
  function getNativeShortSubmissionPreparation(
    jobId: string,
    accountId: string,
  ): import('../../../platform/short-native-submission-proof.js').NativeShortSubmissionPreparationContext {
    const job = deps.rawJob(jobId),
      refs = deps.listEvidence(jobId),
      rows = deps.prepare('SELECT manifest_json FROM manifests WHERE job_id=? LIMIT 2').all(jobId);
    if (!job || job.accountId !== accountId || refs.length !== 1 || rows.length !== 1)
      throw new RuntimeError(
        'capability_unavailable',
        'Native submission preparation is unavailable',
      );
    const manifest = JSON.parse(String(rows[0]!.manifest_json)) as Manifest,
      ref = refs[0]!,
      document = deps.readEvidence(ref);
    validateNativeShortSubmissionReadContext({
      accountId,
      job,
      manifest,
      refs,
      documents: [document],
      attempts: [],
    });
    return { job, manifest, ref, document };
  }
  return getNativeShortSubmissionPreparation;
}

interface ListNativeShortSubmissionAttemptsDependencies {
  publicReads: PublicReadCoordinator;
  ensureOpen: EnsureOpenOperation;
  prepare: PrepareOperation;
}

export function createListNativeShortSubmissionAttempts(
  deps: ListNativeShortSubmissionAttemptsDependencies,
): ListNativeShortSubmissionAttemptsOperation {
  function listNativeShortSubmissionAttempts(jobId: string): NativeShortSubmissionAttemptRow[] {
    return deps.publicReads.memo('store.listNativeShortSubmissionAttempts', [jobId], () => {
      deps.ensureOpen();
      const rows = deps
        .prepare('SELECT * FROM native_short_submission_attempts WHERE job_id = ? ORDER BY rowid')
        .all(jobId);
      if (rows.length > 1)
        throw new RuntimeError(
          'capability_unavailable',
          'Native short submission evidence is unavailable.',
        );
      return rows.map((row) => ({
        jobId: String(row.job_id),
        accountId: String(row.account_id),
        ordinal: Number(row.ordinal) as 1,
        evidence: {
          id: String(row.evidence_id),
          sha256: String(row.evidence_sha256),
          capturedAt: String(row.evidence_captured_at),
        },
        eventAt: String(row.event_at),
      }));
    });
  }
  return listNativeShortSubmissionAttempts;
}

interface RecordNativeShortSubmissionAttemptDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  runningJob: RunningJobOperation;
  assertNotCancelled: AssertNotCancelledOperation;
  listEvidence: ListEvidenceOperation;
  readEvidence: ReadEvidenceOperation;
  listNativeShortSubmissionAttempts: ListNativeShortSubmissionAttemptsOperation;
  nativeShortSubmissionContext: NativeShortSubmissionContextOperation;
  prepare: PrepareOperation;
}

export function createRecordNativeShortSubmissionAttempt(
  deps: RecordNativeShortSubmissionAttemptDependencies,
): RecordNativeShortSubmissionAttemptOperation {
  function recordNativeShortSubmissionAttempt(
    jobId: string,
    ref: EvidenceRef,
  ): NativeShortSubmissionAttemptRow {
    deps.publicReads.assertMutationAllowed();
    return deps.transaction(() => {
      try {
        const job = deps.runningJob(jobId);
        deps.assertNotCancelled(job);
        if (
          job.kind !== 'write' ||
          job.operation !== NATIVE_SHORT_SUBMISSION_OPERATION ||
          !job.target ||
          job.target.kind !== 'short-story' ||
          job.scope !== nativeShortSubmissionScope(job.target.id) ||
          job.platformWriteStartedAt === null
        )
          throw Error('Invalid submission attempt');
        const refs = deps.listEvidence(job.id);
        if (
          refs.length === 0 ||
          !sameNativeValue(refs.at(-1), ref) ||
          ref.accountId !== job.accountId ||
          ref.jobId !== job.id
        )
          throw Error('Invalid submission attempt ref');
        const document = deps.readEvidence(ref),
          payload = document.payload as { stage?: unknown; ordinal?: unknown; eventAt?: unknown };
        if (
          payload?.stage !== 'attempt' ||
          payload.ordinal !== 1 ||
          !isCanonicalNativeTime(payload.eventAt) ||
          payload.eventAt > timestamp() ||
          payload.eventAt > ref.capturedAt ||
          payload.eventAt !== job.platformWriteStartedAt
        )
          throw Error('Invalid submission attempt time');
        const existing = deps.listNativeShortSubmissionAttempts(job.id);
        if (existing.length !== 0) throw Error('Duplicate submission attempt');
        const proposed: NativeShortSubmissionAttemptRow = {
          jobId,
          accountId: job.accountId,
          ordinal: 1,
          evidence: { id: ref.id, sha256: ref.sha256, capturedAt: ref.capturedAt },
          eventAt: payload.eventAt,
        };
        validateNativeShortSubmissionEvidenceContext(
          { ...deps.nativeShortSubmissionContext(job), attempts: [...existing, proposed] },
          'prefix',
        );
        deps
          .prepare(
            'INSERT INTO native_short_submission_attempts(job_id,account_id,ordinal,evidence_id,evidence_sha256,evidence_captured_at,event_at) VALUES(?,?,?,?,?,?,?)',
          )
          .run(jobId, job.accountId, 1, ref.id, ref.sha256, ref.capturedAt, payload.eventAt);
        const saved = deps.listNativeShortSubmissionAttempts(job.id);
        if (!sameNativeValue(saved.at(-1), proposed))
          throw Error('Submission attempt persistence mismatch');
        return proposed;
      } catch {
        throw new RuntimeError(
          'capability_unavailable',
          'Native short submission attempt is unavailable.',
        );
      }
    });
  }
  return recordNativeShortSubmissionAttempt;
}

interface ListNativeShortTrialAttemptsDependencies {
  publicReads: PublicReadCoordinator;
  ensureOpen: EnsureOpenOperation;
  prepare: PrepareOperation;
}

export function createListNativeShortTrialAttempts(
  deps: ListNativeShortTrialAttemptsDependencies,
): ListNativeShortTrialAttemptsOperation {
  function listNativeShortTrialAttempts(jobId: string): NativeShortTrialAttemptRow[] {
    return deps.publicReads.memo('store.listNativeShortTrialAttempts', [jobId], () => {
      deps.ensureOpen();
      const rows = deps
        .prepare('SELECT * FROM native_short_trial_attempts WHERE job_id = ? ORDER BY rowid')
        .all(jobId);
      if (rows.length > 1)
        throw new RuntimeError(
          'capability_unavailable',
          'Native short trial evidence is unavailable.',
        );
      return rows.map((row) => ({
        jobId: String(row.job_id),
        accountId: String(row.account_id),
        ordinal: Number(row.ordinal) as 1,
        evidence: {
          id: String(row.evidence_id),
          sha256: String(row.evidence_sha256),
          capturedAt: String(row.evidence_captured_at),
        },
        eventAt: String(row.event_at),
      }));
    });
  }
  return listNativeShortTrialAttempts;
}

interface RecordNativeShortTrialAttemptDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  runningJob: RunningJobOperation;
  assertNotCancelled: AssertNotCancelledOperation;
  listEvidence: ListEvidenceOperation;
  readEvidence: ReadEvidenceOperation;
  listNativeShortTrialAttempts: ListNativeShortTrialAttemptsOperation;
  nativeShortTrialContext: NativeShortTrialContextOperation;
  prepare: PrepareOperation;
}

export function createRecordNativeShortTrialAttempt(
  deps: RecordNativeShortTrialAttemptDependencies,
): RecordNativeShortTrialAttemptOperation {
  function recordNativeShortTrialAttempt(
    jobId: string,
    ref: EvidenceRef,
  ): NativeShortTrialAttemptRow {
    deps.publicReads.assertMutationAllowed();
    return deps.transaction(() => {
      try {
        const job = deps.runningJob(jobId);
        deps.assertNotCancelled(job);
        if (
          job.kind !== 'write' ||
          job.operation !== NATIVE_SHORT_TRIAL_OPERATION ||
          !job.target ||
          job.target.kind !== 'short-story' ||
          job.scope !== nativeShortTrialScope(job.target.id) ||
          job.platformWriteStartedAt === null
        )
          throw Error('Invalid trial attempt');
        const refs = deps.listEvidence(job.id);
        if (
          refs.length === 0 ||
          !sameNativeValue(refs.at(-1), ref) ||
          ref.accountId !== job.accountId ||
          ref.jobId !== job.id
        )
          throw Error('Invalid trial attempt ref');
        const document = deps.readEvidence(ref),
          payload = document.payload as { stage?: unknown; ordinal?: unknown; eventAt?: unknown };
        if (
          payload?.stage !== 'attempt' ||
          payload.ordinal !== 1 ||
          !isCanonicalNativeTime(payload.eventAt) ||
          payload.eventAt > timestamp() ||
          payload.eventAt > ref.capturedAt ||
          payload.eventAt !== job.platformWriteStartedAt
        )
          throw Error('Invalid trial attempt time');
        const existing = deps.listNativeShortTrialAttempts(job.id);
        if (existing.length !== 0) throw Error('Duplicate trial attempt');
        const proposed: NativeShortTrialAttemptRow = {
          jobId,
          accountId: job.accountId,
          ordinal: 1,
          evidence: { id: ref.id, sha256: ref.sha256, capturedAt: ref.capturedAt },
          eventAt: payload.eventAt,
        };
        validateNativeShortTrialEvidenceContext(
          { ...deps.nativeShortTrialContext(job), attempts: [...existing, proposed] },
          'prefix',
        );
        deps
          .prepare(
            'INSERT INTO native_short_trial_attempts(job_id,account_id,ordinal,evidence_id,evidence_sha256,evidence_captured_at,event_at) VALUES(?,?,?,?,?,?,?)',
          )
          .run(jobId, job.accountId, 1, ref.id, ref.sha256, ref.capturedAt, payload.eventAt);
        const saved = deps.listNativeShortTrialAttempts(job.id);
        if (!sameNativeValue(saved.at(-1), proposed))
          throw Error('Trial attempt persistence mismatch');
        return proposed;
      } catch {
        throw new RuntimeError(
          'capability_unavailable',
          'Native short trial attempt is unavailable.',
        );
      }
    });
  }
  return recordNativeShortTrialAttempt;
}
