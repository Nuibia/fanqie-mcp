import {
  type NativeShortSubmissionReconciliationContext,
  validateNativeShortSubmissionReconciliationContext,
  validateNativeShortSubmissionClosureContext,
  createNativeShortSubmissionClosure,
} from '../../../platform/short-native-submission-proof.js';
import {
  type AssertNativeShortSubmissionLiveSettlementOperation,
  type GetNativeShortSubmissionOriginalAuditOperation,
  type GetJobOperation,
  type RawJobOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';
import { RuntimeError, type Job } from '../runtime-error.js';
import { canonicalJson, sameNativeValue, timestamp } from '../native-closure-signal.js';
import { randomUUID } from 'node:crypto';
import { PublicReadCoordinator } from '../../public-read.js';

import {
  type NativeShortSubmissionLaterReadOperation,
  type NativeShortSubmissionContextOperation,
  type NativeShortSubmissionSettlementErrorOperation,
  type NativeShortTrialContextOperation,
  type NativeShortTrialSettlementErrorOperation,
  type NativeShortTrialLaterReadOperation,
} from '../contracts/native-states-native-short-submission-context.js';

import {
  type PrepareOperation,
  type AssertOwnershipOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';

import {
  type ReconcileNativeShortSubmissionWriteOperation,
  type AssertNativeShortTrialLiveSettlementOperation,
  type ValidateNativeShortTrialHistoryOperation,
  type GetNativeShortTrialOriginalAuditOperation,
} from '../contracts/jobs-api-reconcile-native-short-submission-write.js';

import {
  type NativeShortTrialOriginalAudit,
  type NativeShortTrialClosure,
  createNativeShortTrialOriginalAudit,
  type NativeShortTrialReconciliationContext,
  validateNativeShortTrialClosureContext,
  NATIVE_SHORT_TRIAL_OPERATION,
} from '../../../platform/short-native-trial-proof.js';
import { isCanonicalNativeTime } from '../../../platform/short-native-metadata-proof.js';

interface AssertNativeShortSubmissionLiveSettlementDependencies {}

export function createAssertNativeShortSubmissionLiveSettlement(
  deps: AssertNativeShortSubmissionLiveSettlementDependencies,
): AssertNativeShortSubmissionLiveSettlementOperation {
  function assertNativeShortSubmissionLiveSettlement(
    context: NativeShortSubmissionReconciliationContext,
    resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: Record<string, unknown> },
  ): void {
    if (resolution.status === 'succeeded') {
      const acknowledgementIndexes = context.original.refs.flatMap((ref, index) =>
        ref.dataset === 'short_native_submission_acknowledgement' ? [index] : [],
      );
      const acknowledgement =
        acknowledgementIndexes.length === 1
          ? (
              context.original.documents[acknowledgementIndexes[0]!]!.payload as {
                observation?: { code?: unknown; accepted?: unknown; useAi?: unknown };
              }
            ).observation
          : null;
      const business = context.original.documents[0]?.payload as {
        businessInput?: { useAi?: unknown };
      };
      const publicAcknowledgement = resolution.result.acknowledgement as {
        code?: unknown;
        accepted?: unknown;
      } | null;
      if (
        context.original.attempts.length !== 1 ||
        !acknowledgement ||
        acknowledgement.code !== 0 ||
        acknowledgement.accepted !== true ||
        ![1, 2].includes(business.businessInput?.useAi as number) ||
        acknowledgement.useAi !== business.businessInput?.useAi ||
        resolution.result.originalSaveDurableAcknowledged !== true ||
        publicAcknowledgement?.code !== 0 ||
        publicAcknowledgement.accepted !== true
      )
        throw Error('Submission success requires its durable accepted acknowledgement');
    }
    const observations = [...context.original.documents, context.document];
    for (const document of observations) {
      if (document.collectionMode !== 'live') throw Error('Submission reconciliation is not live');
      const payload = document.payload as {
        provenance?: { mode?: unknown; executor?: unknown };
        source?: { mode?: unknown; origin?: unknown };
      };
      if (
        payload.provenance &&
        (payload.provenance.mode !== 'live' ||
          payload.provenance.executor !== 'application-default-browser/v1')
      )
        throw Error('Submission provenance is not live');
      if (
        payload.source &&
        (payload.source.mode !== 'live' || payload.source.origin !== 'https://fanqienovel.com')
      )
        throw Error('Submission source is not live');
    }
    const read = context.document.payload as {
      provenance?: { mode?: unknown; executor?: unknown };
      source?: { mode?: unknown; origin?: unknown };
    };
    const before = context.original.documents[0]?.payload as typeof read;
    if (
      read.provenance?.mode !== 'live' ||
      before.provenance?.mode !== 'live' ||
      read.source?.mode !== 'live' ||
      before.source?.mode !== 'live'
    )
      throw Error('Missing live submission observation');
  }
  return assertNativeShortSubmissionLiveSettlement;
}

interface ReconcileNativeShortSubmissionWriteDependencies {
  publicReads: PublicReadCoordinator;
  getNativeShortSubmissionOriginalAudit: GetNativeShortSubmissionOriginalAuditOperation;
  nativeShortSubmissionLaterRead: NativeShortSubmissionLaterReadOperation;
  nativeShortSubmissionContext: NativeShortSubmissionContextOperation;
  assertNativeShortSubmissionLiveSettlement: AssertNativeShortSubmissionLiveSettlementOperation;
  prepare: PrepareOperation;
  nativeShortSubmissionSettlementError: NativeShortSubmissionSettlementErrorOperation;
  getJob: GetJobOperation;
}

export function createReconcileNativeShortSubmissionWrite(
  deps: ReconcileNativeShortSubmissionWriteDependencies,
): ReconcileNativeShortSubmissionWriteOperation {
  function reconcileNativeShortSubmissionWrite(
    originalJob: Job,
    readJob: Job,
    resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: unknown },
  ): Job {
    deps.publicReads.assertMutationAllowed();
    try {
      const audit = deps.getNativeShortSubmissionOriginalAudit(originalJob.id),
        read = deps.nativeShortSubmissionLaterRead(readJob.id);
      if (
        !sameNativeValue(
          audit,
          (read.document.payload as { originalAudit?: unknown }).originalAudit,
        )
      )
        throw Error('Submission audit was not durable');
      const context: NativeShortSubmissionReconciliationContext = {
        original: deps.nativeShortSubmissionContext(originalJob),
        ...read,
      };
      const verified = validateNativeShortSubmissionReconciliationContext(context);
      deps.assertNativeShortSubmissionLiveSettlement(context, verified);
      if (!sameNativeValue(resolution, { status: verified.status, result: verified.result }))
        throw Error('Unsupported submission resolution');
      const now = timestamp(),
        closure = createNativeShortSubmissionClosure(context, now),
        serialized = canonicalJson(closure);
      validateNativeShortSubmissionClosureContext(context, closure, now);
      deps
        .prepare(
          'INSERT INTO write_reconciliations(id,original_job_id,read_job_id,evidence_id,status,created_at,result_json) VALUES(?,?,?,?,?,?,?)',
        )
        .run(
          randomUUID(),
          originalJob.id,
          readJob.id,
          read.ref.id,
          verified.status,
          now,
          serialized,
        );
      deps
        .prepare(
          'UPDATE jobs SET status=?,result_json=?,error_json=?,ended_at=?,updated_at=? WHERE id=?',
        )
        .run(
          verified.status,
          serialized,
          deps.nativeShortSubmissionSettlementError(verified.status) === null
            ? null
            : canonicalJson(deps.nativeShortSubmissionSettlementError(verified.status)),
          now,
          now,
          originalJob.id,
        );
      return deps.getJob(originalJob.id)!;
    } catch {
      throw new RuntimeError(
        'capability_unavailable',
        'Native short submission reconciliation is unavailable.',
      );
    }
  }
  return reconcileNativeShortSubmissionWrite;
}

interface ValidateNativeShortTrialHistoryDependencies {
  publicReads: PublicReadCoordinator;
  prepare: PrepareOperation;
  nativeShortTrialContext: NativeShortTrialContextOperation;
  nativeShortTrialSettlementError: NativeShortTrialSettlementErrorOperation;
  nativeShortTrialLaterRead: NativeShortTrialLaterReadOperation;
  assertNativeShortTrialLiveSettlement: AssertNativeShortTrialLiveSettlementOperation;
}

export function createValidateNativeShortTrialHistory(
  deps: ValidateNativeShortTrialHistoryDependencies,
): ValidateNativeShortTrialHistoryOperation {
  function validateNativeShortTrialHistory(job: Job): {
    firstAudit: NativeShortTrialOriginalAudit | null;
    last: NativeShortTrialClosure | null;
  } {
    return deps.publicReads.memo('store.validateNativeShortTrialHistory', [job], () => {
      const rows = deps
        .prepare(
          'SELECT rowid AS sequence, * FROM write_reconciliations WHERE original_job_id = ? ORDER BY rowid LIMIT 129',
        )
        .all(job.id);
      if (rows.length > 128) throw Error('Trial reconciliation history exceeds its bound');
      const actual = deps.nativeShortTrialContext(job);
      let firstAudit: NativeShortTrialOriginalAudit | null = null,
        previous: NativeShortTrialClosure | null = null;
      let previousSequence = 0;
      for (const row of rows) {
        const closure = JSON.parse(String(row.result_json)) as NativeShortTrialClosure;
        if (
          closure.schema !== 'native-short-trial-closure/v1' ||
          row.original_job_id !== job.id ||
          row.read_job_id !== closure.reconciliationJobId ||
          row.evidence_id !== closure.evidence.id ||
          row.status !== closure.status ||
          row.created_at !== closure.settledAt ||
          !isCanonicalNativeTime(row.created_at) ||
          row.created_at > timestamp() ||
          Number(row.sequence) <= previousSequence ||
          (previous &&
            (previous.status !== 'uncertain' ||
              previous.settledAt !== closure.originalAudit.priorEndedAt))
        )
          throw Error('Invalid trial reconciliation row');
        const audit = closure.originalAudit;
        const replayEndedAt = previous?.settledAt ?? audit.originalEndedAt;
        const replayJob: Job = {
          ...job,
          status: 'uncertain',
          endedAt: replayEndedAt,
          updatedAt: replayEndedAt,
          result: previous ?? { evidence: actual.refs },
          error: previous ? deps.nativeShortTrialSettlementError('uncertain') : audit.priorError,
        };
        const original = { ...actual, job: replayJob };
        const expectedAudit = createNativeShortTrialOriginalAudit(
          original,
          previous ? { firstAudit: firstAudit!, previousClosure: previous } : undefined,
        );
        const read = deps.nativeShortTrialLaterRead(String(row.read_job_id));
        if (
          !sameNativeValue(expectedAudit, audit) ||
          !sameNativeValue(
            expectedAudit,
            (read.document.payload as { originalAudit?: unknown }).originalAudit,
          )
        )
          throw Error('Invalid trial original audit');
        const context: NativeShortTrialReconciliationContext = { original, ...read };
        const verified = validateNativeShortTrialClosureContext(
          context,
          closure,
          String(row.created_at),
        );
        deps.assertNativeShortTrialLiveSettlement(context);
        if (verified.status !== closure.status || !sameNativeValue(verified.result, closure.result))
          throw Error('Invalid trial settlement');
        firstAudit ??= audit;
        previous = closure;
        previousSequence = Number(row.sequence);
      }
      return { firstAudit, last: previous };
    });
  }
  return validateNativeShortTrialHistory;
}

interface GetNativeShortTrialOriginalAuditDependencies {
  publicReads: PublicReadCoordinator;
  assertOwnership: AssertOwnershipOperation;
  rawJob: RawJobOperation;
  nativeShortTrialContext: NativeShortTrialContextOperation;
  validateNativeShortTrialHistory: ValidateNativeShortTrialHistoryOperation;
}

export function createGetNativeShortTrialOriginalAudit(
  deps: GetNativeShortTrialOriginalAuditDependencies,
): GetNativeShortTrialOriginalAuditOperation {
  function getNativeShortTrialOriginalAudit(jobId: string): NativeShortTrialOriginalAudit {
    return deps.publicReads.memo('store.getNativeShortTrialOriginalAudit', [jobId], () => {
      deps.assertOwnership();
      try {
        const job = deps.rawJob(jobId);
        if (
          !job ||
          job.kind !== 'write' ||
          job.status !== 'uncertain' ||
          job.operation !== NATIVE_SHORT_TRIAL_OPERATION
        )
          throw Error('Invalid trial original');
        const context = deps.nativeShortTrialContext(job),
          history = deps.validateNativeShortTrialHistory(job);
        return createNativeShortTrialOriginalAudit(
          context,
          history.last
            ? { firstAudit: history.firstAudit!, previousClosure: history.last }
            : undefined,
        );
      } catch {
        throw new RuntimeError(
          'capability_unavailable',
          'Native short trial original evidence is unavailable.',
        );
      }
    });
  }
  return getNativeShortTrialOriginalAudit;
}
