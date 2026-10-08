import {
  type NativeShortTrialReconciliationContext,
  validateNativeShortTrialReconciliationContext,
  validateNativeShortTrialClosureContext,
  createNativeShortTrialClosure,
} from '../../../platform/short-native-trial-proof.js';
import {
  type AssertNativeShortTrialLiveSettlementOperation,
  type GetNativeShortTrialOriginalAuditOperation,
  type ReconcileNativeShortTrialWriteOperation,
  type AssertNativeShortCoverLiveSettlementOperation,
  type ValidateNativeShortCoverHistoryOperation,
  type GetNativeShortCoverOriginalAuditOperation,
} from '../contracts/jobs-api-reconcile-native-short-submission-write.js';
import { RuntimeError, type Job } from '../runtime-error.js';
import { canonicalJson, sameNativeValue, timestamp } from '../native-closure-signal.js';
import { randomUUID } from 'node:crypto';
import { PublicReadCoordinator } from '../../public-read.js';

import {
  type NativeShortTrialLaterReadOperation,
  type NativeShortTrialContextOperation,
  type NativeShortTrialSettlementErrorOperation,
  type NativeShortCoverContextOperation,
  type NativeShortCoverSettlementErrorOperation,
  type NativeShortCoverLaterReadOperation,
} from '../contracts/native-states-native-short-submission-context.js';

import {
  type PrepareOperation,
  type AssertOwnershipOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';

import {
  type GetJobOperation,
  type RawJobOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';

import {
  type NativeShortCoverOriginalAudit,
  type NativeShortCoverClosure,
  createNativeShortCoverOriginalAudit,
  type NativeShortCoverReconciliationContext,
  validateNativeShortCoverClosureContext,
  NATIVE_SHORT_COVER_OPERATION,
} from '../../../platform/short-native-cover-proof.js';
import { isCanonicalNativeTime } from '../../../platform/short-native-metadata-proof.js';

interface AssertNativeShortTrialLiveSettlementDependencies {}

export function createAssertNativeShortTrialLiveSettlement(
  deps: AssertNativeShortTrialLiveSettlementDependencies,
): AssertNativeShortTrialLiveSettlementOperation {
  function assertNativeShortTrialLiveSettlement(
    context: NativeShortTrialReconciliationContext,
  ): void {
    const observations = [...context.original.documents, context.document];
    for (const document of observations) {
      if (document.collectionMode !== 'live') throw Error('Trial reconciliation is not live');
      const payload = document.payload as {
        provenance?: { mode?: unknown; executor?: unknown };
        source?: { mode?: unknown; origin?: unknown };
      };
      if (
        payload.provenance &&
        (payload.provenance.mode !== 'live' ||
          payload.provenance.executor !== 'application-default-browser/v1')
      )
        throw Error('Trial provenance is not live');
      if (
        payload.source &&
        (payload.source.mode !== 'live' || payload.source.origin !== 'https://fanqienovel.com')
      )
        throw Error('Trial source is not live');
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
      throw Error('Missing live trial observation');
  }
  return assertNativeShortTrialLiveSettlement;
}

interface ReconcileNativeShortTrialWriteDependencies {
  publicReads: PublicReadCoordinator;
  getNativeShortTrialOriginalAudit: GetNativeShortTrialOriginalAuditOperation;
  nativeShortTrialLaterRead: NativeShortTrialLaterReadOperation;
  nativeShortTrialContext: NativeShortTrialContextOperation;
  assertNativeShortTrialLiveSettlement: AssertNativeShortTrialLiveSettlementOperation;
  prepare: PrepareOperation;
  nativeShortTrialSettlementError: NativeShortTrialSettlementErrorOperation;
  getJob: GetJobOperation;
}

export function createReconcileNativeShortTrialWrite(
  deps: ReconcileNativeShortTrialWriteDependencies,
): ReconcileNativeShortTrialWriteOperation {
  function reconcileNativeShortTrialWrite(
    originalJob: Job,
    readJob: Job,
    resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: unknown },
  ): Job {
    deps.publicReads.assertMutationAllowed();
    try {
      const audit = deps.getNativeShortTrialOriginalAudit(originalJob.id),
        read = deps.nativeShortTrialLaterRead(readJob.id);
      if (
        !sameNativeValue(
          audit,
          (read.document.payload as { originalAudit?: unknown }).originalAudit,
        )
      )
        throw Error('Trial audit was not durable');
      const context: NativeShortTrialReconciliationContext = {
        original: deps.nativeShortTrialContext(originalJob),
        ...read,
      };
      const verified = validateNativeShortTrialReconciliationContext(context);
      deps.assertNativeShortTrialLiveSettlement(context);
      if (!sameNativeValue(resolution, { status: verified.status, result: verified.result }))
        throw Error('Unsupported trial resolution');
      const now = timestamp(),
        closure = createNativeShortTrialClosure(context, now),
        serialized = canonicalJson(closure);
      validateNativeShortTrialClosureContext(context, closure, now);
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
          deps.nativeShortTrialSettlementError(verified.status) === null
            ? null
            : canonicalJson(deps.nativeShortTrialSettlementError(verified.status)),
          now,
          now,
          originalJob.id,
        );
      return deps.getJob(originalJob.id)!;
    } catch {
      throw new RuntimeError(
        'capability_unavailable',
        'Native short trial reconciliation is unavailable.',
      );
    }
  }
  return reconcileNativeShortTrialWrite;
}

interface ValidateNativeShortCoverHistoryDependencies {
  publicReads: PublicReadCoordinator;
  prepare: PrepareOperation;
  nativeShortCoverContext: NativeShortCoverContextOperation;
  nativeShortCoverSettlementError: NativeShortCoverSettlementErrorOperation;
  nativeShortCoverLaterRead: NativeShortCoverLaterReadOperation;
  assertNativeShortCoverLiveSettlement: AssertNativeShortCoverLiveSettlementOperation;
}

export function createValidateNativeShortCoverHistory(
  deps: ValidateNativeShortCoverHistoryDependencies,
): ValidateNativeShortCoverHistoryOperation {
  function validateNativeShortCoverHistory(job: Job): {
    firstAudit: NativeShortCoverOriginalAudit | null;
    last: NativeShortCoverClosure | null;
  } {
    return deps.publicReads.memo('store.validateNativeShortCoverHistory', [job], () => {
      const rows = deps
        .prepare(
          'SELECT rowid AS sequence, * FROM write_reconciliations WHERE original_job_id = ? ORDER BY rowid LIMIT 129',
        )
        .all(job.id);
      if (rows.length > 128) throw Error('Cover reconciliation history exceeds its bound');
      const actual = deps.nativeShortCoverContext(job);
      let firstAudit: NativeShortCoverOriginalAudit | null = null,
        previous: NativeShortCoverClosure | null = null;
      let previousSequence = 0;
      for (const row of rows) {
        const closure = JSON.parse(String(row.result_json)) as NativeShortCoverClosure;
        if (
          closure.schema !== 'native-short-cover-closure/v1' ||
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
          throw Error('Invalid cover reconciliation row');
        const audit = closure.originalAudit;
        const replayEndedAt = previous?.settledAt ?? audit.originalEndedAt;
        const replayJob: Job = {
          ...job,
          status: 'uncertain',
          endedAt: replayEndedAt,
          updatedAt: replayEndedAt,
          result: previous ?? { evidence: actual.refs },
          error: previous ? deps.nativeShortCoverSettlementError('uncertain') : audit.priorError,
        };
        const original = { ...actual, job: replayJob };
        const expectedAudit = createNativeShortCoverOriginalAudit(
          original,
          previous ? { firstAudit: firstAudit!, previousClosure: previous } : undefined,
        );
        const read = deps.nativeShortCoverLaterRead(String(row.read_job_id));
        if (
          !sameNativeValue(expectedAudit, audit) ||
          !sameNativeValue(
            expectedAudit,
            (read.document.payload as { originalAudit?: unknown }).originalAudit,
          )
        )
          throw Error('Invalid cover original audit');
        const context: NativeShortCoverReconciliationContext = { original, ...read };
        const verified = validateNativeShortCoverClosureContext(
          context,
          closure,
          String(row.created_at),
        );
        deps.assertNativeShortCoverLiveSettlement(context);
        if (verified.status !== closure.status || !sameNativeValue(verified.result, closure.result))
          throw Error('Invalid cover settlement');
        firstAudit ??= audit;
        previous = closure;
        previousSequence = Number(row.sequence);
      }
      return { firstAudit, last: previous };
    });
  }
  return validateNativeShortCoverHistory;
}

interface GetNativeShortCoverOriginalAuditDependencies {
  publicReads: PublicReadCoordinator;
  assertOwnership: AssertOwnershipOperation;
  rawJob: RawJobOperation;
  nativeShortCoverContext: NativeShortCoverContextOperation;
  validateNativeShortCoverHistory: ValidateNativeShortCoverHistoryOperation;
}

export function createGetNativeShortCoverOriginalAudit(
  deps: GetNativeShortCoverOriginalAuditDependencies,
): GetNativeShortCoverOriginalAuditOperation {
  function getNativeShortCoverOriginalAudit(jobId: string): NativeShortCoverOriginalAudit {
    return deps.publicReads.memo('store.getNativeShortCoverOriginalAudit', [jobId], () => {
      deps.assertOwnership();
      try {
        const job = deps.rawJob(jobId);
        if (
          !job ||
          job.kind !== 'write' ||
          job.status !== 'uncertain' ||
          job.operation !== NATIVE_SHORT_COVER_OPERATION
        )
          throw Error('Invalid cover original');
        const context = deps.nativeShortCoverContext(job),
          history = deps.validateNativeShortCoverHistory(job);
        return createNativeShortCoverOriginalAudit(
          context,
          history.last
            ? { firstAudit: history.firstAudit!, previousClosure: history.last }
            : undefined,
        );
      } catch {
        throw new RuntimeError(
          'capability_unavailable',
          'Native short cover original evidence is unavailable.',
        );
      }
    });
  }
  return getNativeShortCoverOriginalAudit;
}

interface AssertNativeShortCoverLiveSettlementDependencies {}

export function createAssertNativeShortCoverLiveSettlement(
  deps: AssertNativeShortCoverLiveSettlementDependencies,
): AssertNativeShortCoverLiveSettlementOperation {
  function assertNativeShortCoverLiveSettlement(
    context: NativeShortCoverReconciliationContext,
  ): void {
    const observations = [...context.original.documents, context.document];
    for (const document of observations) {
      if (document.collectionMode !== 'live') throw Error('Cover reconciliation is not live');
      const payload = document.payload as {
        provenance?: { mode?: unknown; executor?: unknown };
        source?: { mode?: unknown; origin?: unknown };
      };
      if (
        payload.provenance &&
        (payload.provenance.mode !== 'live' ||
          payload.provenance.executor !== 'application-default-browser/v1')
      )
        throw Error('Cover provenance is not live');
      if (
        payload.source &&
        (payload.source.mode !== 'live' || payload.source.origin !== 'https://fanqienovel.com')
      )
        throw Error('Cover source is not live');
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
      throw Error('Missing live cover observation');
  }
  return assertNativeShortCoverLiveSettlement;
}
