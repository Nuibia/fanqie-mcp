import {
  type EvidenceRef,
  existingGenericReads,
  type Manifest,
  type RuntimeFailure,
} from '../runtime-error.js';
import {
  canonicalJson,
  bodyUnavailable,
  bodyObject,
  sameNativeValue,
} from '../native-closure-signal.js';
import * as bodyProof from '../../../platform/short-native-body-proof.js';
import { PublicReadCoordinator } from '../../public-read.js';
import path from 'node:path';
import { type PrepareOperation } from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';
import {
  type NativeShortBodyReconciliationRowsOperation,
  type NativeShortBodyLaterReadOperation,
  type NativeShortBodySettlementErrorOperation,
} from '../contracts/native-body-native-short-body-signal.js';

import { type RawJobOperation } from '../contracts/jobs-api-with-public-projection-read.js';
import {
  type ListEvidenceOperation,
  type ReadEvidenceOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

interface NativeShortBodyReconciliationRowsDependencies {
  publicReads: PublicReadCoordinator;
  prepare: PrepareOperation;
}

export function createNativeShortBodyReconciliationRows(
  deps: NativeShortBodyReconciliationRowsDependencies,
): NativeShortBodyReconciliationRowsOperation {
  function nativeShortBodyReconciliationRows(
    originalJobId: string,
    accountId: string,
    recovery?: bodyProof.NativeShortBodyOwnedGetRecoveryV2,
  ): { rows: string; refs: EvidenceRef[] } {
    return deps.publicReads.memo(
      'store.nativeShortBodyReconciliationRows',
      [originalJobId, accountId, recovery],
      () => {
        const original =
          deps.prepare(existingGenericReads.compactFilteredJob).get(originalJobId, accountId) ??
          null;
        const evidence = deps
          .prepare('SELECT rowid AS sequence,* FROM evidence WHERE job_id=? ORDER BY rowid LIMIT 8')
          .all(originalJobId);
        const attempts = deps
          .prepare(
            'SELECT rowid AS sequence,* FROM native_short_body_attempts WHERE job_id=? ORDER BY rowid LIMIT 2',
          )
          .all(originalJobId);
        const manifests = deps
          .prepare(
            'SELECT rowid AS sequence,* FROM manifests WHERE job_id=? ORDER BY rowid LIMIT 2',
          )
          .all(originalJobId);
        const history = deps
          .prepare(
            'SELECT rowid AS sequence,* FROM write_reconciliations WHERE original_job_id=? ORDER BY rowid LIMIT 129',
          )
          .all(originalJobId);
        if (
          !original ||
          evidence.length > 7 ||
          attempts.length > 1 ||
          manifests.length !== 0 ||
          history.length > 128
        )
          return bodyUnavailable();
        const readIds = new Set<string>();
        if (recovery) readIds.add(recovery.freshReadJobId);
        for (const row of history) {
          readIds.add(String(row.read_job_id));
          if (Buffer.byteLength(String(row.result_json)) > 256 * 1024) return bodyUnavailable();
          let closure: Record<string, unknown>;
          try {
            closure = bodyObject(JSON.parse(String(row.result_json)));
          } catch {
            return bodyUnavailable();
          }
          if (closure.schema === 'native-short-body-closure/v2' && closure.recovery !== null) {
            const historicalRecovery = bodyObject(closure.recovery);
            if (typeof historicalRecovery.freshReadJobId !== 'string') return bodyUnavailable();
            readIds.add(historicalRecovery.freshReadJobId);
          }
        }
        const reads = [...readIds].sort().map((id) => {
          const job =
            deps.prepare(existingGenericReads.compactFilteredJob).get(id, accountId) ?? null;
          const refs = deps
            .prepare(
              'SELECT rowid AS sequence,* FROM evidence WHERE job_id=? ORDER BY rowid LIMIT 2',
            )
            .all(id);
          const manifests = deps
            .prepare(
              'SELECT rowid AS sequence,* FROM manifests WHERE job_id=? ORDER BY rowid LIMIT 2',
            )
            .all(id);
          const attempts = deps
            .prepare(
              'SELECT rowid AS sequence,* FROM native_short_body_attempts WHERE job_id=? ORDER BY rowid LIMIT 1',
            )
            .all(id);
          if (!job || refs.length !== 1 || manifests.length !== 1 || attempts.length !== 0)
            return bodyUnavailable();
          return { id, job, refs, manifests, attempts };
        });
        const refs: EvidenceRef[] = [...evidence, ...reads.flatMap((read) => read.refs)].map(
          (row) => ({
            id: String(row.id),
            accountId: String(row.account_id),
            jobId: String(row.job_id),
            dataset: String(row.dataset),
            capturedAt: String(row.captured_at),
            path: String(row.path),
            sha256: String(row.sha256),
          }),
        );
        return {
          rows: canonicalJson({ original, evidence, attempts, manifests, history, reads }),
          refs,
        };
      },
    );
  }
  return nativeShortBodyReconciliationRows;
}

interface NativeShortBodyLaterReadDependencies {
  publicReads: PublicReadCoordinator;
  rawJob: RawJobOperation;
  listEvidence: ListEvidenceOperation;
  prepare: PrepareOperation;
  readEvidence: ReadEvidenceOperation;
}

export function createNativeShortBodyLaterRead(
  deps: NativeShortBodyLaterReadDependencies,
): NativeShortBodyLaterReadOperation {
  function nativeShortBodyLaterRead(readId: string) {
    return deps.publicReads.memo('store.nativeShortBodyLaterRead', [readId], () => {
      const readJob = deps.rawJob(readId),
        refs = deps.listEvidence(readId);
      const rows = deps.prepare('SELECT * FROM manifests WHERE job_id=? LIMIT 2').all(readId);
      if (
        !readJob ||
        refs.length !== 1 ||
        refs[0]!.dataset !== bodyProof.NATIVE_SHORT_BODY_DATASETS.reconciliation ||
        rows.length !== 1
      )
        return bodyUnavailable();
      const row = rows[0]!,
        manifest = JSON.parse(String(row.manifest_json)) as Manifest;
      if (
        row.id !== manifest.id ||
        row.account_id !== manifest.accountId ||
        row.job_id !== manifest.jobId ||
        row.scope !== manifest.scope ||
        row.committed_at !== manifest.committedAt ||
        !sameNativeValue(manifest.evidence, refs)
      )
        return bodyUnavailable();
      return { readJob, manifest, ref: refs[0]!, document: deps.readEvidence(refs[0]!) };
    });
  }
  return nativeShortBodyLaterRead;
}

interface NativeShortBodySettlementErrorDependencies {}

export function createNativeShortBodySettlementError(
  deps: NativeShortBodySettlementErrorDependencies,
): NativeShortBodySettlementErrorOperation {
  function nativeShortBodySettlementError(
    status: 'succeeded' | 'failed' | 'uncertain',
  ): RuntimeFailure | null {
    return status === 'succeeded'
      ? null
      : status === 'failed'
        ? {
            code: 'native_body_not_saved',
            message: 'The later platform read confirms the body change was not saved.',
          }
        : {
            code: 'outcome_unknown',
            message: 'The later platform read still cannot determine the body write outcome.',
          };
  }
  return nativeShortBodySettlementError;
}
