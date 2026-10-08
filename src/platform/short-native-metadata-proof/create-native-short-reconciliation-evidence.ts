import { type NativeShortMetadataApiResult } from '../short-native-metadata-api.js';

import {
  type NativeShortOriginalAudit,
  type NativeShortReconciliationEvidence,
  validateNativeShortOriginalAudit,
} from './safe-native-short-write-job.js';

import { type NativeShortWriteEvidenceContext } from './clean-after-business.js';

import {
  type NativeShortProvenance,
  reject,
  NATIVE_SHORT_ORIGIN,
  type StoredReconciliation,
  type Data,
} from './reject.js';

import { originalForAudit, recomputeReconciliation } from './create-native-short-original-audit.js';

import { validateNativeShortApiResult } from './validate-api-result-core.js';

import {
  compareNativeShortMetadataReadbackVersioned,
  NATIVE_SHORT_METADATA_SCOPE,
} from '../short-native-metadata.js';

import {
  nativeShortDesiredContentHash,
  observedExpectation,
  carrier,
  expectationVersion,
  comparisonBasis,
  evidenceLink,
  carrierVersion,
} from './validate-native-short-write-business-input.js';

import { type EvidenceRef } from '../../runtime/store.js';

import { nativeShortSnapshotBusiness } from './validate-after-core.js';

export function createNativeShortReconciliationEvidence(
  result: NativeShortMetadataApiResult,
  originalAudit: NativeShortOriginalAudit,
  original: NativeShortWriteEvidenceContext,
  provenance: NativeShortProvenance,
): NativeShortReconciliationEvidence {
  const audit = validateNativeShortOriginalAudit(originalAudit),
    { intent } = originalForAudit(original, audit),
    verified = validateNativeShortApiResult(result);
  if (verified.status !== 'success') reject();
  const comparison = compareNativeShortMetadataReadbackVersioned(
    intent.expectation,
    verified.snapshot!,
  );
  const observedContentHash = nativeShortDesiredContentHash(
    observedExpectation(intent.expectation, verified.snapshot!, comparison),
  );
  return recomputeReconciliation(
    {
      schema: carrier(
        'native-short-metadata-reconciliation',
        expectationVersion(intent.expectation),
      ),
      scope: NATIVE_SHORT_METADATA_SCOPE,
      hashBases: intent.hashBases,
      comparisonBasis: comparisonBasis(expectationVersion(intent.expectation)),
      baselineEvidence: evidenceLink(original.refs[0]!),
      intentEvidence: evidenceLink(original.refs[1]!),
      originalAudit: audit,
      result: verified,
      comparison,
      source: { origin: NATIVE_SHORT_ORIGIN, mode: provenance.mode },
      provenance,
      reconciliation: {
        originalJobId: audit.originalJobId,
        target: audit.target,
        inputHash: audit.inputHash,
        observedContentHash,
        observedStatus: comparison.matches ? 'draft_saved' : 'unknown',
      },
    },
    original,
  ) as NativeShortReconciliationEvidence;
}

export function reconciliationBusiness(
  evidence: StoredReconciliation,
  accountId: string,
  ref: EvidenceRef,
  desiredContentHash: string,
) {
  return {
    schema: carrier(
      'fanqie-short-native-metadata-reconciliation-business',
      carrierVersion(evidence.schema, 'native-short-metadata-reconciliation'),
    ),
    dataset: 'reconciliation',
    status: evidence.reconciliation.observedStatus === 'draft_saved' ? 'succeeded' : 'uncertain',
    platformState: evidence.reconciliation.observedStatus,
    accountId,
    originalJobId: evidence.originalAudit.originalJobId,
    target: evidence.originalAudit.target,
    inputHash: evidence.originalAudit.inputHash,
    ...nativeShortSnapshotBusiness(evidence.result.snapshot!),
    source: evidence.source,
    provenance: evidence.provenance,
    comparisonBasis: comparisonBasis(
      carrierVersion(evidence.schema, 'native-short-metadata-reconciliation'),
    ),
    desiredContentHash,
    observedContentHash: evidence.reconciliation.observedContentHash,
    comparison: evidence.comparison,
    proof: evidence.result.proof,
    requests: evidence.result.requests,
    list: evidence.result.list,
    cleanup: evidence.result.cleanup,
    originalEndedAt: evidence.originalAudit.originalEndedAt,
    priorEndedAt: evidence.originalAudit.priorEndedAt,
    baselineEvidence: evidence.baselineEvidence,
    intentEvidence: evidence.intentEvidence,
    sourceRef: ref.id,
    evidenceHash: ref.sha256,
    evidenceCapturedAt: ref.capturedAt,
  };
}

export function nativeReconciliationDocumentParts(input: unknown): {
  head: Data;
  payload: unknown;
} {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Object.getOwnPropertySymbols(input).length
  )
    reject();
  const descriptors = Object.getOwnPropertyDescriptors(input),
    fields = [
      'schemaVersion',
      'evidenceId',
      'accountId',
      'jobId',
      'dataset',
      'capturedAt',
      'collectionMode',
      'evidenceKind',
      'payload',
    ];
  if (
    Object.keys(descriptors).length !== fields.length ||
    fields.some(
      (name) =>
        !descriptors[name] ||
        !descriptors[name]!.enumerable ||
        !Object.hasOwn(descriptors[name]!, 'value'),
    )
  )
    reject();
  return {
    head: Object.fromEntries(
      fields.filter((name) => name !== 'payload').map((name) => [name, descriptors[name]!.value]),
    ),
    payload: descriptors.payload!.value,
  };
}
