import { type Job } from '../runtime-error.js';
import {
  bodyUnavailable,
  sameNativeValue,
  bodyObject,
  type NativeReconciliationRow,
  canonicalJson,
  timestamp,
} from '../native-closure-signal.js';
import * as bodyProof from '../../../platform/short-native-body-proof.js';
import { PublicReadCoordinator } from '../../public-read.js';
import {
  type PrepareOperation,
  type AssertOwnershipOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';
import {
  type NativeShortBodyContextOperation,
  type NativeShortBodySettlementErrorOperation,
  type NativeShortBodyRecoveryFromPayloadOperation,
  type NativeShortBodyLaterReadOperation,
  type NativeShortBodyRecoveryFreshReadOperation,
} from '../contracts/native-body-native-short-body-signal.js';

import {
  type ValidateNativeShortBodyHistoryOperation,
  type RawJobOperation,
  type GetNativeShortBodyOriginalAuditOperation,
  type ValidateNativeShortBodyJobOperation,
  type GetJobOperation,
  type ReconcileNativeShortBodyWriteOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';

import { type ListEvidenceOperation } from '../contracts/evidence-public-evidence-file-size.js';

import { randomUUID } from 'node:crypto';

interface ValidateNativeShortBodyHistoryDependencies {
  publicReads: PublicReadCoordinator;
  prepare: PrepareOperation;
  nativeShortBodyContext: NativeShortBodyContextOperation;
  nativeShortBodySettlementError: NativeShortBodySettlementErrorOperation;
  nativeShortBodyRecoveryFromPayload: NativeShortBodyRecoveryFromPayloadOperation;
  nativeShortBodyLaterRead: NativeShortBodyLaterReadOperation;
}

export function createValidateNativeShortBodyHistory(
  deps: ValidateNativeShortBodyHistoryDependencies,
): ValidateNativeShortBodyHistoryOperation {
  function validateNativeShortBodyHistory(job: Job): {
    firstAudit: bodyProof.NativeShortBodyOriginalAudit | null;
    last: bodyProof.NativeShortBodyClosure | null;
  } {
    return deps.publicReads.memo('store.validateNativeShortBodyHistory', [job], () => {
      const rows = deps
        .prepare(
          'SELECT rowid AS sequence,* FROM write_reconciliations WHERE original_job_id=? ORDER BY rowid LIMIT 129',
        )
        .all(job.id);
      if (rows.length > 128) return bodyUnavailable();
      const actual = deps.nativeShortBodyContext(job);
      let firstAudit: bodyProof.NativeShortBodyOriginalAudit | null = null,
        previous: bodyProof.NativeShortBodyClosure | null = null,
        sequence = 0;
      for (const row of rows) {
        if (Buffer.byteLength(String(row.result_json)) > 256 * 1024) return bodyUnavailable();
        const closure = JSON.parse(String(row.result_json)) as bodyProof.NativeShortBodyClosure,
          audit = closure.originalAudit;
        if (
          !['native-short-body-closure/v1', 'native-short-body-closure/v2'].includes(
            closure.schema,
          ) ||
          row.original_job_id !== job.id ||
          row.read_job_id !== closure.reconciliationJobId ||
          row.evidence_id !== closure.evidence.id ||
          row.status !== closure.status ||
          row.created_at !== closure.settledAt ||
          Number(row.sequence) <= sequence ||
          (previous && previous.status !== 'uncertain')
        )
          return bodyUnavailable();
        const endedAt = previous?.settledAt ?? audit.originalEndedAt;
        const replayJob: Job = {
          ...job,
          status: 'uncertain',
          endedAt,
          updatedAt: endedAt,
          result: previous ?? { evidence: actual.refs },
          error: previous ? deps.nativeShortBodySettlementError('uncertain') : audit.originalError,
        };
        const original = { ...actual, job: replayJob };
        const recoveryContext = deps.nativeShortBodyRecoveryFromPayload(closure, job.accountId);
        const auditHistory = previous
          ? { firstAudit: firstAudit!, previousClosure: previous }
          : undefined;
        const expected = recoveryContext
          ? bodyProof.createNativeShortBodyOriginalAuditForRecovery(
              original,
              recoveryContext,
              auditHistory,
            )
          : bodyProof.createNativeShortBodyOriginalAudit(original, auditHistory);
        const read = deps.nativeShortBodyLaterRead(String(row.read_job_id));
        if (
          !sameNativeValue(expected, audit) ||
          !sameNativeValue(expected, bodyObject(read.document.payload).originalAudit)
        )
          return bodyUnavailable();
        const context: bodyProof.NativeShortBodyReconciliationContext = {
          original,
          ...read,
          ...(recoveryContext ? { recoveryContext } : {}),
        };
        const verified = bodyProof.validateNativeShortBodyClosureContext(
          context,
          closure,
          String(row.created_at),
        );
        if (verified.status !== closure.status || !sameNativeValue(verified.result, closure.result))
          return bodyUnavailable();
        firstAudit ??= audit;
        previous = closure;
        sequence = Number(row.sequence);
      }
      if (
        previous &&
        (!sameNativeValue(job.result, previous) ||
          job.status !== previous.status ||
          job.endedAt !== previous.settledAt ||
          job.updatedAt !== previous.settledAt ||
          !sameNativeValue(job.error, deps.nativeShortBodySettlementError(previous.status)))
      )
        return bodyUnavailable();
      return { firstAudit, last: previous };
    });
  }
  return validateNativeShortBodyHistory;
}

interface GetNativeShortBodyOriginalAuditDependencies {
  publicReads: PublicReadCoordinator;
  assertOwnership: AssertOwnershipOperation;
  rawJob: RawJobOperation;
  nativeShortBodyContext: NativeShortBodyContextOperation;
  validateNativeShortBodyHistory: ValidateNativeShortBodyHistoryOperation;
  nativeShortBodyRecoveryFreshRead: NativeShortBodyRecoveryFreshReadOperation;
  nativeShortBodyRecoveryFromPayload: NativeShortBodyRecoveryFromPayloadOperation;
}

export function createGetNativeShortBodyOriginalAudit(
  deps: GetNativeShortBodyOriginalAuditDependencies,
): GetNativeShortBodyOriginalAuditOperation {
  function getNativeShortBodyOriginalAudit(
    jobId: string,
    accountId: string,
    recoveryContext?: bodyProof.NativeShortBodyRecoveryContextV2,
  ): bodyProof.NativeShortBodyOriginalAudit {
    return deps.publicReads.memo(
      'store.getNativeShortBodyOriginalAudit',
      [jobId, accountId, recoveryContext],
      () => {
        deps.assertOwnership();
        const job = deps.rawJob(jobId);
        if (
          !job ||
          job.accountId !== accountId ||
          job.kind !== 'write' ||
          job.status !== 'uncertain' ||
          job.operation !== bodyProof.NATIVE_SHORT_BODY_OPERATION
        )
          return bodyUnavailable();
        const context = deps.nativeShortBodyContext(job),
          history = deps.validateNativeShortBodyHistory(job);
        const actualRecovery = recoveryContext
          ? {
              recovery: recoveryContext.recovery,
              freshRead: deps.nativeShortBodyRecoveryFreshRead(recoveryContext.recovery, accountId),
            }
          : history.last
            ? deps.nativeShortBodyRecoveryFromPayload(history.last, accountId)
            : undefined;
        if (recoveryContext && !sameNativeValue(actualRecovery, recoveryContext))
          return bodyUnavailable();
        const auditHistory = history.last
          ? { firstAudit: history.firstAudit!, previousClosure: history.last }
          : undefined;
        return actualRecovery
          ? bodyProof.createNativeShortBodyOriginalAuditForRecovery(
              context,
              actualRecovery,
              auditHistory,
            )
          : bodyProof.createNativeShortBodyOriginalAudit(context, auditHistory);
      },
    );
  }
  return getNativeShortBodyOriginalAudit;
}

interface ValidateNativeShortBodyJobDependencies {
  publicReads: PublicReadCoordinator;
  validateNativeShortBodyHistory: ValidateNativeShortBodyHistoryOperation;
  nativeShortBodyContext: NativeShortBodyContextOperation;
  listEvidence: ListEvidenceOperation;
  nativeShortBodyLaterRead: NativeShortBodyLaterReadOperation;
  nativeShortBodyRecoveryFromPayload: NativeShortBodyRecoveryFromPayloadOperation;
  rawJob: RawJobOperation;
  prepare: PrepareOperation;
  getNativeShortBodyOriginalAudit: GetNativeShortBodyOriginalAuditOperation;
}

export function createValidateNativeShortBodyJob(
  deps: ValidateNativeShortBodyJobDependencies,
): ValidateNativeShortBodyJobOperation {
  function validateNativeShortBodyJob(job: Job, latest: NativeReconciliationRow | null): void {
    return deps.publicReads.memo('store.validateNativeShortBodyJob', [job, latest], () => {
      if (job.kind === 'write') {
        if (job.operation !== bodyProof.NATIVE_SHORT_BODY_OPERATION) return bodyUnavailable();
        if (latest) deps.validateNativeShortBodyHistory(job);
        else if (job.status === 'succeeded')
          bodyProof.validateNativeShortBodyCompletion(deps.nativeShortBodyContext(job), job.result);
        else if (
          ['native-short-body-closure/v1', 'native-short-body-closure/v2'].includes(
            String(bodyObject(job.result ?? {}).schema),
          )
        )
          return bodyUnavailable();
        else if (deps.listEvidence(job.id).length !== 0)
          bodyProof.validateNativeShortBodyEvidenceContext(
            deps.nativeShortBodyContext(job),
            'prefix',
          );
      } else if (job.status === 'succeeded') {
        if (job.operation !== bodyProof.NATIVE_SHORT_BODY_RECONCILE_OPERATION)
          return bodyUnavailable();
        const read = deps.nativeShortBodyLaterRead(job.id),
          audit = bodyObject(read.document.payload)
            .originalAudit as bodyProof.NativeShortBodyOriginalAudit;
        const recoveryContext = deps.nativeShortBodyRecoveryFromPayload(
          read.document.payload,
          job.accountId,
        );
        const original = deps.rawJob(audit.originalJobId);
        if (!original || original.accountId !== job.accountId) return bodyUnavailable();
        const linked = deps
          .prepare('SELECT id FROM write_reconciliations WHERE original_job_id=? AND read_job_id=?')
          .all(original.id, job.id);
        if (linked.length === 1) deps.validateNativeShortBodyHistory(original);
        else if (
          linked.length !== 0 ||
          !sameNativeValue(
            audit,
            deps.getNativeShortBodyOriginalAudit(original.id, job.accountId, recoveryContext),
          )
        )
          return bodyUnavailable();
        if (linked.length === 0)
          bodyProof.validateNativeShortBodyReconciliationContext({
            original: deps.nativeShortBodyContext(original),
            ...read,
            ...(recoveryContext ? { recoveryContext } : {}),
          });
      }
    });
  }
  return validateNativeShortBodyJob;
}

interface ReconcileNativeShortBodyWriteDependencies {
  publicReads: PublicReadCoordinator;
  nativeShortBodyLaterRead: NativeShortBodyLaterReadOperation;
  nativeShortBodyRecoveryFromPayload: NativeShortBodyRecoveryFromPayloadOperation;
  getNativeShortBodyOriginalAudit: GetNativeShortBodyOriginalAuditOperation;
  nativeShortBodyContext: NativeShortBodyContextOperation;
  prepare: PrepareOperation;
  nativeShortBodySettlementError: NativeShortBodySettlementErrorOperation;
  getJob: GetJobOperation;
}

export function createReconcileNativeShortBodyWrite(
  deps: ReconcileNativeShortBodyWriteDependencies,
): ReconcileNativeShortBodyWriteOperation {
  function reconcileNativeShortBodyWrite(
    original: Job,
    readJob: Job,
    resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: unknown },
  ): Job {
    deps.publicReads.assertMutationAllowed();
    const read = deps.nativeShortBodyLaterRead(readJob.id),
      recoveryContext = deps.nativeShortBodyRecoveryFromPayload(
        read.document.payload,
        original.accountId,
      );
    const audit = deps.getNativeShortBodyOriginalAudit(
      original.id,
      original.accountId,
      recoveryContext,
    );
    if (!sameNativeValue(audit, bodyObject(read.document.payload).originalAudit))
      return bodyUnavailable();
    const context: bodyProof.NativeShortBodyReconciliationContext = {
      original: deps.nativeShortBodyContext(original),
      ...read,
      ...(recoveryContext ? { recoveryContext } : {}),
    };
    const verified = bodyProof.validateNativeShortBodyReconciliationContext(context);
    if (!sameNativeValue(resolution, { status: verified.status, result: verified.result }))
      return bodyUnavailable();
    const now = timestamp(),
      closure = bodyProof.createNativeShortBodyClosure(context, now);
    bodyProof.validateNativeShortBodyClosureContext(context, closure, now);
    deps
      .prepare(
        'INSERT INTO write_reconciliations(id,original_job_id,read_job_id,evidence_id,status,created_at,result_json) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        randomUUID(),
        original.id,
        readJob.id,
        read.ref.id,
        verified.status,
        now,
        canonicalJson(closure),
      );
    const error = deps.nativeShortBodySettlementError(verified.status);
    deps
      .prepare(
        'UPDATE jobs SET status=?,result_json=?,error_json=?,ended_at=?,updated_at=? WHERE id=?',
      )
      .run(
        verified.status,
        canonicalJson(closure),
        error === null ? null : canonicalJson(error),
        now,
        now,
        original.id,
      );
    return deps.getJob(original.id)!;
  }
  return reconcileNativeShortBodyWrite;
}
