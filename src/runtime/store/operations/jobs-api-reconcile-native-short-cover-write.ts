import { RuntimeError, type Job } from '../runtime-error.js';
import { canonicalJson, sameNativeValue, timestamp } from '../native-closure-signal.js';
import { randomUUID } from 'node:crypto';
import { PublicReadCoordinator } from '../../public-read.js';
import {
  validateNativeShortCoverReconciliationContext,
  type NativeShortCoverReconciliationContext,
  validateNativeShortCoverClosureContext,
  createNativeShortCoverClosure,
} from '../../../platform/short-native-cover-proof.js';
import {
  type GetNativeShortCoverOriginalAuditOperation,
  type AssertNativeShortCoverLiveSettlementOperation,
  type ReconcileNativeShortCoverWriteOperation,
} from '../contracts/jobs-api-reconcile-native-short-submission-write.js';
import {
  type NativeShortCoverLaterReadOperation,
  type NativeShortCoverContextOperation,
  type NativeShortCoverSettlementErrorOperation,
} from '../contracts/native-states-native-short-submission-context.js';

import { type PrepareOperation } from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';

import { type GetJobOperation } from '../contracts/jobs-api-with-public-projection-read.js';

interface ReconcileNativeShortCoverWriteDependencies {
  publicReads: PublicReadCoordinator;
  getNativeShortCoverOriginalAudit: GetNativeShortCoverOriginalAuditOperation;
  nativeShortCoverLaterRead: NativeShortCoverLaterReadOperation;
  nativeShortCoverContext: NativeShortCoverContextOperation;
  assertNativeShortCoverLiveSettlement: AssertNativeShortCoverLiveSettlementOperation;
  prepare: PrepareOperation;
  nativeShortCoverSettlementError: NativeShortCoverSettlementErrorOperation;
  getJob: GetJobOperation;
}

export function createReconcileNativeShortCoverWrite(
  deps: ReconcileNativeShortCoverWriteDependencies,
): ReconcileNativeShortCoverWriteOperation {
  function reconcileNativeShortCoverWrite(
    originalJob: Job,
    readJob: Job,
    resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: unknown },
  ): Job {
    deps.publicReads.assertMutationAllowed();
    try {
      const audit = deps.getNativeShortCoverOriginalAudit(originalJob.id),
        read = deps.nativeShortCoverLaterRead(readJob.id);
      if (
        !sameNativeValue(
          audit,
          (read.document.payload as { originalAudit?: unknown }).originalAudit,
        )
      )
        throw Error('Cover audit was not durable');
      const context: NativeShortCoverReconciliationContext = {
        original: deps.nativeShortCoverContext(originalJob),
        ...read,
      };
      const verified = validateNativeShortCoverReconciliationContext(context);
      deps.assertNativeShortCoverLiveSettlement(context);
      if (!sameNativeValue(resolution, { status: verified.status, result: verified.result }))
        throw Error('Unsupported cover resolution');
      const now = timestamp(),
        closure = createNativeShortCoverClosure(context, now),
        serialized = canonicalJson(closure);
      validateNativeShortCoverClosureContext(context, closure, now);
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
          deps.nativeShortCoverSettlementError(verified.status) === null
            ? null
            : canonicalJson(deps.nativeShortCoverSettlementError(verified.status)),
          now,
          now,
          originalJob.id,
        );
      return deps.getJob(originalJob.id)!;
    } catch {
      throw new RuntimeError(
        'capability_unavailable',
        'Native short cover reconciliation is unavailable.',
      );
    }
  }
  return reconcileNativeShortCoverWrite;
}
