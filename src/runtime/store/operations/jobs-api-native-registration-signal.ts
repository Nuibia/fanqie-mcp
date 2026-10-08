import { type Job, type Manifest, type EvidenceDocument } from '../runtime-error.js';
import {
  canonicalJson,
  nativeRegistrationDataset,
  nativeRegistrationOperation,
  nativeReconciliationUnavailable,
  nativeRegistrationScope,
} from '../native-closure-signal.js';
import { PublicReadCoordinator } from '../../public-read.js';
import {
  type NativeRegistrationSignalOperation,
  type DecodeJobOperation,
  type NativeRegistrationRowsOperation,
  type ValidateNativeRegistrationJobOperation,
  type RawJobOperation,
  type NativeLaterReadOperation,
  type AssertNativeLiveSettlementOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';

import { type PrepareOperation } from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';

import { type GetNativeCompensationContextOperation } from '../contracts/native-compensation-validate-native-compensation-source-identity.js';

import {
  type NativeBoundedReferencesOperation,
  type ReadEvidenceOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

import { validateNativeShortReconciliationContext } from '../../../platform/short-native-metadata-proof.js';

interface NativeRegistrationSignalDependencies {
  publicReads: PublicReadCoordinator;
}

export function createNativeRegistrationSignal(
  deps: NativeRegistrationSignalDependencies,
): NativeRegistrationSignalOperation {
  function nativeRegistrationSignal(job: Job): boolean {
    return deps.publicReads.memo('store.nativeRegistrationSignal', [job], () => {
      return (
        job.operation === nativeRegistrationOperation ||
        job.scope.startsWith(nativeRegistrationDataset) ||
        job.datasets.some((dataset) => dataset.startsWith(nativeRegistrationDataset)) ||
        canonicalJson(job.metadata).includes('native-short-metadata-compensation-registration') ||
        canonicalJson(job.result).includes('native-short-metadata-compensation-registration')
      );
    });
  }
  return nativeRegistrationSignal;
}

interface NativeRegistrationRowsDependencies {
  publicReads: PublicReadCoordinator;
  prepare: PrepareOperation;
  decodeJob: DecodeJobOperation;
}

export function createNativeRegistrationRows(
  deps: NativeRegistrationRowsDependencies,
): NativeRegistrationRowsOperation {
  function nativeRegistrationRows(original: Job): Job[] {
    return deps.publicReads.memo('store.nativeRegistrationRows', [original], () => {
      const scope = nativeRegistrationScope(original.id);
      const rows = deps
        .prepare(
          "SELECT * FROM jobs WHERE (operation = ? OR scope LIKE 'native_compensation_attestation%' OR datasets_json LIKE '%native_compensation_attestation%' OR metadata_json LIKE '%native-short-metadata-compensation-registration%' OR result_json LIKE '%native-short-metadata-compensation-registration%') AND (scope = ? OR idempotency_key = ? OR CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.originalJobId') ELSE NULL END = ?) LIMIT 2",
        )
        .all(nativeRegistrationOperation, scope, original.id, original.id);
      // An unmatched broken reserved marker is a fixed negative probe, not an
      // unbounded load of this account's administrative history.
      const broken = deps
        .prepare(
          "SELECT 1 FROM jobs WHERE account_id = ? AND (operation = ? OR scope LIKE 'native_compensation_attestation%' OR datasets_json LIKE '%native_compensation_attestation%' OR metadata_json LIKE '%native-short-metadata-compensation-registration%' OR result_json LIKE '%native-short-metadata-compensation-registration%') AND CASE WHEN json_valid(metadata_json) THEN json_type(metadata_json, '$.originalJobId') IS NOT 'text' ELSE 1 END LIMIT 1",
        )
        .get(original.accountId, nativeRegistrationOperation);
      if (broken) return nativeReconciliationUnavailable();
      const matching = rows.map((row) => deps.decodeJob(row as Record<string, unknown>));
      if (
        matching.some(
          (job) =>
            job.accountId !== original.accountId ||
            job.scope !== scope ||
            job.metadata.originalJobId !== original.id ||
            job.idempotencyKey !== original.id,
        )
      )
        return nativeReconciliationUnavailable();
      if (matching.length > 1) return nativeReconciliationUnavailable();
      return matching;
    });
  }
  return nativeRegistrationRows;
}

interface ValidateNativeRegistrationJobDependencies {
  publicReads: PublicReadCoordinator;
  getNativeCompensationContext: GetNativeCompensationContextOperation;
}

export function createValidateNativeRegistrationJob(
  deps: ValidateNativeRegistrationJobDependencies,
): ValidateNativeRegistrationJobOperation {
  function validateNativeRegistrationJob(job: Job): void {
    return deps.publicReads.memo('store.validateNativeRegistrationJob', [job], () => {
      const originalId = job.metadata.originalJobId;
      if (typeof originalId !== 'string') return nativeReconciliationUnavailable();
      const source = deps.getNativeCompensationContext(originalId);
      if (!source || source.registration?.job.id !== job.id)
        return nativeReconciliationUnavailable();
    });
  }
  return validateNativeRegistrationJob;
}

interface NativeLaterReadDependencies {
  publicReads: PublicReadCoordinator;
  rawJob: RawJobOperation;
  nativeBoundedReferences: NativeBoundedReferencesOperation;
  prepare: PrepareOperation;
  readEvidence: ReadEvidenceOperation;
}

export function createNativeLaterRead(deps: NativeLaterReadDependencies): NativeLaterReadOperation {
  function nativeLaterRead(originalId: string, readId: string) {
    return deps.publicReads.memo('store.nativeLaterRead', [originalId, readId], () => {
      const job = deps.rawJob(readId),
        refs = deps.nativeBoundedReferences(readId, 1);
      const manifests = deps
        .prepare('SELECT manifest_json FROM manifests WHERE job_id = ? LIMIT 2')
        .all(readId);
      if (
        !job ||
        refs.length !== 1 ||
        refs[0]!.dataset !== 'reconciliation' ||
        manifests.length !== 1 ||
        job.id === originalId
      )
        return nativeReconciliationUnavailable();
      return {
        job,
        manifest: JSON.parse(String(manifests[0]!.manifest_json)) as Manifest,
        ref: refs[0]!,
        document: deps.readEvidence(refs[0]!),
      };
    });
  }
  return nativeLaterRead;
}

interface AssertNativeLiveSettlementDependencies {
  publicReads: PublicReadCoordinator;
}

export function createAssertNativeLiveSettlement(
  deps: AssertNativeLiveSettlementDependencies,
): AssertNativeLiveSettlementOperation {
  function assertNativeLiveSettlement(
    checked: ReturnType<typeof validateNativeShortReconciliationContext>,
    documents: EvidenceDocument[],
    later: EvidenceDocument,
  ): void {
    return deps.publicReads.memo(
      'store.assertNativeLiveSettlement',
      [checked, documents, later],
      () => {
        const baseline = documents[0]?.payload as
          | { source?: { mode?: unknown }; provenance?: { mode?: unknown; executor?: unknown } }
          | undefined;
        if (
          checked.evidence.source.mode !== 'live' ||
          checked.evidence.provenance.mode !== 'live' ||
          checked.evidence.provenance.executor !== 'application-default-browser/v1' ||
          baseline?.source?.mode !== 'live' ||
          baseline.provenance?.mode !== 'live' ||
          baseline.provenance.executor !== 'application-default-browser/v1' ||
          documents.some((document) => document.collectionMode !== 'live') ||
          later.collectionMode !== 'live'
        )
          nativeReconciliationUnavailable();
      },
    );
  }
  return assertNativeLiveSettlement;
}
