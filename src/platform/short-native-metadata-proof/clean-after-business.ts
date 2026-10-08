import { type StoredAfter } from './reject.js';

import {
  type EvidenceRef,
  type Job,
  type Manifest,
  type EvidenceDocument,
} from '../../runtime/store.js';

import {
  carrier,
  carrierVersion,
  comparisonBasis,
  type NativeShortWriteResultEvidence,
  evidenceLink,
  type NativeShortCleanAfterEvidence,
  writeSnapshot,
} from './validate-native-short-write-business-input.js';

import {
  NATIVE_SHORT_AFTER_DATASET,
  NATIVE_SHORT_BASELINE_DATASET,
} from './validate-native-short-evidence-context.js';

import { nativeShortSnapshotBusiness } from './validate-after-core.js';

import { NATIVE_SHORT_METADATA_SCOPE } from '../short-native-metadata.js';

import { type NativeShortSafeClosure } from './safe-native-short-write-job.js';

function cleanAfterBusiness(
  after: StoredAfter,
  accountId: string,
  ref: EvidenceRef,
): Record<string, unknown> {
  const result = after.result,
    snapshot = result.snapshot!;
  return {
    schema: carrier(
      'fanqie-short-native-metadata-write-business',
      carrierVersion(after.schema, 'native-short-metadata-clean-after'),
    ),
    dataset: NATIVE_SHORT_AFTER_DATASET,
    status: 'success',
    platformState: 'draft_saved',
    accountId,
    target: { kind: 'short-story', id: snapshot.binding.work.id },
    ...nativeShortSnapshotBusiness(snapshot),
    source: { ...after.source },
    provenance: { ...after.provenance },
    comparisonBasis: comparisonBasis(
      carrierVersion(after.schema, 'native-short-metadata-clean-after'),
    ),
    desiredContentHash: result.desiredContentHash,
    observedContentHash: result.observedContentHash,
    proof: result.proof,
    phases: result.phases,
    post: result.post,
    cleanup: result.cleanup,
    sourceRef: ref.id,
    evidenceHash: ref.sha256,
    evidenceCapturedAt: ref.capturedAt,
  };
}

export function createWriteResultCore(
  after: StoredAfter,
  baselineRef: EvidenceRef,
  intentRef: EvidenceRef,
  afterRef: EvidenceRef,
): NativeShortWriteResultEvidence {
  return {
    schema: carrier(
      'native-short-metadata-write-result',
      carrierVersion(after.schema, 'native-short-metadata-clean-after'),
    ) as NativeShortWriteResultEvidence['schema'],
    scope: NATIVE_SHORT_METADATA_SCOPE,
    baselineEvidence: evidenceLink(baselineRef),
    intentEvidence: evidenceLink(intentRef),
    afterEvidence: evidenceLink(afterRef),
    business: cleanAfterBusiness(after, afterRef.accountId, afterRef),
  };
}

export function createNativeShortWriteResultEvidence(
  after: NativeShortCleanAfterEvidence,
  baselineRef: EvidenceRef,
  intentRef: EvidenceRef,
  afterRef: EvidenceRef,
): NativeShortWriteResultEvidence {
  writeSnapshot(after.result.snapshot);
  return createWriteResultCore(after, baselineRef, intentRef, afterRef);
}

export interface NativeShortWriteEvidenceContext {
  accountId: string;
  job: Job;
  manifest: Manifest | null;
  refs: EvidenceRef[];
  documents: EvidenceDocument[];
}

export interface NativeShortWriteProjection {
  validated: boolean;
  result: NativeShortWriteResultEvidence | NativeShortSafeClosure | null;
  evidence: Record<string, unknown>[];
  data: Record<string, unknown>[];
  collectionMode: 'live' | 'fixture' | null;
}

export const WRITE_DATASETS = [
  NATIVE_SHORT_BASELINE_DATASET,
  'write-intent',
  NATIVE_SHORT_AFTER_DATASET,
  'write-result',
];

export const safeWriteRef = (ref: EvidenceRef) => ({
  id: ref.id,
  accountId: ref.accountId,
  jobId: ref.jobId,
  dataset: ref.dataset,
  capturedAt: ref.capturedAt,
  sha256: ref.sha256,
});
