import { RuntimeError, type EvidenceRef } from '../runtime-error.js';
import { PublicReadCoordinator } from '../../public-read.js';
import {
  type NativeShortCoverAttemptRow,
  NATIVE_SHORT_COVER_OPERATION,
  nativeShortCoverScope,
  validateNativeShortCoverEvidenceContext,
} from '../../../platform/short-native-cover-proof.js';
import {
  type EnsureOpenOperation,
  type PrepareOperation,
  type TransactionOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';

import {
  type ListNativeShortCoverAttemptsOperation,
  type RunningJobOperation,
  type AssertNotCancelledOperation,
  type RecordNativeShortCoverAttemptOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';

import { sameNativeValue, timestamp } from '../native-closure-signal.js';

import { isCanonicalNativeTime } from '../../../platform/short-native-metadata-proof.js';

import {
  type ListEvidenceOperation,
  type ReadEvidenceOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

import { type NativeShortCoverContextOperation } from '../contracts/native-states-native-short-submission-context.js';

interface ListNativeShortCoverAttemptsDependencies {
  publicReads: PublicReadCoordinator;
  ensureOpen: EnsureOpenOperation;
  prepare: PrepareOperation;
}

export function createListNativeShortCoverAttempts(
  deps: ListNativeShortCoverAttemptsDependencies,
): ListNativeShortCoverAttemptsOperation {
  function listNativeShortCoverAttempts(jobId: string): NativeShortCoverAttemptRow[] {
    return deps.publicReads.memo('store.listNativeShortCoverAttempts', [jobId], () => {
      deps.ensureOpen();
      const rows = deps
        .prepare('SELECT * FROM native_short_cover_attempts WHERE job_id = ? ORDER BY rowid')
        .all(jobId);
      if (rows.length > 2)
        throw new RuntimeError(
          'capability_unavailable',
          'Native short cover evidence is unavailable.',
        );
      return rows.map((row) => ({
        jobId: String(row.job_id),
        accountId: String(row.account_id),
        phase: row.phase as 'upload' | 'save',
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
  return listNativeShortCoverAttempts;
}

interface RecordNativeShortCoverAttemptDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  runningJob: RunningJobOperation;
  assertNotCancelled: AssertNotCancelledOperation;
  listEvidence: ListEvidenceOperation;
  readEvidence: ReadEvidenceOperation;
  listNativeShortCoverAttempts: ListNativeShortCoverAttemptsOperation;
  nativeShortCoverContext: NativeShortCoverContextOperation;
  prepare: PrepareOperation;
}

export function createRecordNativeShortCoverAttempt(
  deps: RecordNativeShortCoverAttemptDependencies,
): RecordNativeShortCoverAttemptOperation {
  function recordNativeShortCoverAttempt(
    jobId: string,
    phase: 'upload' | 'save',
    ref: EvidenceRef,
  ): NativeShortCoverAttemptRow {
    deps.publicReads.assertMutationAllowed();
    return deps.transaction(() => {
      try {
        const job = deps.runningJob(jobId);
        deps.assertNotCancelled(job);
        if (
          job.kind !== 'write' ||
          job.operation !== NATIVE_SHORT_COVER_OPERATION ||
          !job.target ||
          job.target.kind !== 'short-story' ||
          job.scope !== nativeShortCoverScope(job.target.id) ||
          job.platformWriteStartedAt === null ||
          !['upload', 'save'].includes(phase)
        )
          throw Error('Invalid cover attempt');
        const refs = deps.listEvidence(job.id);
        if (
          refs.length === 0 ||
          !sameNativeValue(refs.at(-1), ref) ||
          ref.accountId !== job.accountId ||
          ref.jobId !== job.id
        )
          throw Error('Invalid cover attempt ref');
        const document = deps.readEvidence(ref),
          payload = document.payload as {
            phase?: unknown;
            stage?: unknown;
            ordinal?: unknown;
            eventAt?: unknown;
          };
        if (
          payload?.phase !== phase ||
          payload.stage !== 'attempt' ||
          payload.ordinal !== 1 ||
          !isCanonicalNativeTime(payload.eventAt) ||
          payload.eventAt > timestamp() ||
          payload.eventAt > ref.capturedAt ||
          (phase === 'upload' && payload.eventAt !== job.platformWriteStartedAt)
        )
          throw Error('Invalid cover attempt time');
        const existing = deps.listNativeShortCoverAttempts(job.id);
        if (
          existing.some((row) => row.phase === phase) ||
          (phase === 'upload'
            ? existing.length !== 0
            : existing.length !== 1 ||
              existing[0]!.phase !== 'upload' ||
              existing[0]!.eventAt > payload.eventAt)
        )
          throw Error('Duplicate cover attempt');
        const proposed: NativeShortCoverAttemptRow = {
          jobId,
          accountId: job.accountId,
          phase,
          ordinal: 1,
          evidence: { id: ref.id, sha256: ref.sha256, capturedAt: ref.capturedAt },
          eventAt: payload.eventAt,
        };
        validateNativeShortCoverEvidenceContext(
          { ...deps.nativeShortCoverContext(job), attempts: [...existing, proposed] },
          'prefix',
        );
        deps
          .prepare(
            'INSERT INTO native_short_cover_attempts(job_id,account_id,phase,ordinal,evidence_id,evidence_sha256,evidence_captured_at,event_at) VALUES(?,?,?,?,?,?,?,?)',
          )
          .run(jobId, job.accountId, phase, 1, ref.id, ref.sha256, ref.capturedAt, payload.eventAt);
        const saved = deps.listNativeShortCoverAttempts(job.id);
        if (!sameNativeValue(saved.at(-1), proposed))
          throw Error('Cover attempt persistence mismatch');
        return proposed;
      } catch {
        throw new RuntimeError(
          'capability_unavailable',
          'Native short cover attempt is unavailable.',
        );
      }
    });
  }
  return recordNativeShortCoverAttempt;
}
