import { type Job, existingGenericLedgerSql } from '../runtime-error.js';
import {
  canonicalJson,
  nativeReconciliationUnavailable,
  sameNativeValue,
  timestamp,
  nativeCompensatedError,
  type NativeReconciliationRow,
} from '../native-closure-signal.js';
import { randomUUID } from 'node:crypto';
import { PublicReadCoordinator } from '../../public-read.js';
import {
  type NativeShortCompensationSourceContext,
  copyNativeShortJson,
  validateNativeShortCompensationContext,
  type NativeShortCompensatedClosure,
} from '../../../platform/short-native-metadata-proof.js';
import {
  type NativeLaterReadOperation,
  type GetJobOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';
import {
  type AssertOwnershipOperation,
  type PrepareOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';

import {
  type ReconcileNativeCompensationOperation,
  type NativeReconciliationRowOperation,
} from '../contracts/native-compensation-validate-native-compensation-source-identity.js';

interface ReconcileNativeCompensationDependencies {
  publicReads: PublicReadCoordinator;
  nativeLaterRead: NativeLaterReadOperation;
  assertOwnership: AssertOwnershipOperation;
  prepare: PrepareOperation;
  getJob: GetJobOperation;
}

export function createReconcileNativeCompensation(
  deps: ReconcileNativeCompensationDependencies,
): ReconcileNativeCompensationOperation {
  function reconcileNativeCompensation(
    source: NativeShortCompensationSourceContext,
    readJob: Job,
    resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: unknown },
  ): Job {
    deps.publicReads.assertMutationAllowed();
    const original = source.original.job,
      read = deps.nativeLaterRead(original.id, readJob.id);
    const checked = validateNativeShortCompensationContext({
      source,
      readJob: read.job,
      manifest: read.manifest,
      ref: read.ref,
      document: read.document,
    });
    const requested = copyNativeShortJson(resolution) as typeof resolution;
    if (
      !sameNativeValue(Object.keys(requested).sort(), ['result', 'status']) ||
      requested.status !== checked.status ||
      !sameNativeValue(requested.result, checked.result) ||
      checked.evidence.source.mode !== 'live' ||
      checked.evidence.provenance.mode !== 'live' ||
      checked.evidence.provenance.executor !== 'application-default-browser/v1' ||
      read.document.collectionMode !== 'live' ||
      source.original.documents.some((doc) => doc.collectionMode !== 'live')
    )
      return nativeReconciliationUnavailable();
    const first = source.history.first;
    const closure: NativeShortCompensatedClosure = {
      schema: 'native-short-metadata-compensated-closure/v1',
      target: original.target as NativeShortCompensatedClosure['target'],
      reconciliationJobId: read.job.id,
      evidence: read.ref,
      observedStatus: checked.observedStatus,
      result: checked.result,
      originalAudit: checked.evidence.originalAudit,
      originalAttemptEvidence: first
        ? {
            readJobId: first.row.readJobId,
            evidenceId: first.row.evidenceId,
            evidenceHash: first.read.ref.sha256,
          }
        : null,
    };
    const now = timestamp(),
      serialized = canonicalJson(closure);
    if (Buffer.byteLength(serialized) > 64 * 1024) return nativeReconciliationUnavailable();
    deps.assertOwnership();
    deps
      .prepare(
        'INSERT INTO write_reconciliations(id,original_job_id,read_job_id,evidence_id,status,created_at,result_json) VALUES(?,?,?,?,?,?,?)',
      )
      .run(randomUUID(), original.id, read.job.id, read.ref.id, 'failed', now, serialized);
    deps
      .prepare(
        'UPDATE jobs SET status=?,result_json=?,error_json=?,ended_at=?,updated_at=? WHERE id=?',
      )
      .run('failed', serialized, canonicalJson(nativeCompensatedError), now, now, original.id);
    return deps.getJob(original.id)!;
  }
  return reconcileNativeCompensation;
}

interface NativeReconciliationRowDependencies {
  publicReads: PublicReadCoordinator;
  prepare: PrepareOperation;
}

export function createNativeReconciliationRow(
  deps: NativeReconciliationRowDependencies,
): NativeReconciliationRowOperation {
  function nativeReconciliationRow(
    originalId: string,
    position: 'first' | 'last',
    before?: number,
  ): NativeReconciliationRow | null {
    return deps.publicReads.memo(
      'store.nativeReconciliationRow',
      [originalId, position, before],
      () => {
        const row = deps
          .prepare(existingGenericLedgerSql(position, before))
          .get(...(before === undefined ? [originalId] : [originalId, before]));
        return row
          ? {
              sequence: Number(row.sequence),
              id: String(row.id),
              originalJobId: String(row.original_job_id),
              readJobId: String(row.read_job_id),
              evidenceId: String(row.evidence_id),
              status: String(row.status),
              createdAt: String(row.created_at),
              resultJson: String(row.result_json),
            }
          : null;
      },
    );
  }
  return nativeReconciliationRow;
}
