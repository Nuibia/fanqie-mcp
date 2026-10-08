import {
  type NativeShortMetadataWriteReason,
  type NativeShortMetadataWriteReadPhase,
  type NativeShortMetadataApiResult,
  unavailableNativeShortMetadataApi,
} from '../short-native-metadata-api.js';

import {
  NATIVE_SHORT_HASH_BASES,
  type NativeShortBinding,
  type NativeShortMetadataSnapshot,
} from '../short-native-metadata.js';

import { type NativeShortCoverImageReference } from '../short-native-cover-image.js';

import {
  NATIVE_SHORT_COVER_SCOPE,
  NATIVE_SHORT_COVER_HASH_BASES,
  type NativeShortCoverUploadIntent,
  type NativeShortCoverExpectation,
  type NativeShortCoverPreparedAsset,
  type NativeShortCoverComparison,
} from '../short-native-cover.js';

export const ORIGIN = 'https://fanqienovel.com';

export const UPLOAD_URL = `${ORIGIN}/api/author/data/upload_pic_v1/v0?aid=2503&aid=2503&app_name=muye_novel`;

export const WORK = /^[1-9][0-9]{9,21}$/,
  OWNER = /^[0-9]{1,30}$/,
  HASH = /^[a-f0-9]{64}$/;

export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export const UPLOAD_NAME =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(png|jpg)$/;

export type NativeShortCoverPhase = 'upload' | 'save';

export type NativeShortCoverReceiptStage = 'intent' | 'attempt' | 'acknowledgement';

export type NativeShortCoverApiReason = NativeShortMetadataWriteReason | 'image_unavailable';

export interface NativeShortCoverWriteRequest {
  readonly expectedSnapshotVersionHash: string;
  readonly hashBasis: typeof NATIVE_SHORT_HASH_BASES.snapshot;
  readonly expectedState: 'draft';
  readonly cover: NativeShortCoverImageReference;
}

export interface NativeShortCoverEvidenceRef {
  readonly id: string;
  readonly sha256: string;
  readonly capturedAt: string;
}

export interface NativeShortCoverTransport {
  readonly schema:
    'native-short-cover-upload-transport/v1' | 'native-short-cover-save-transport/v1';
  readonly provenance: 'static-unobserved';
  readonly method: 'POST';
  readonly url: string;
  readonly encoding:
    'multipart-file-temp-image-jpeg' | 'application/x-www-form-urlencoded;charset=UTF-8';
}

export interface NativeShortCoverReceiptFields {
  readonly phase: NativeShortCoverPhase;
  readonly stage: NativeShortCoverReceiptStage;
  readonly accountId: string;
  readonly jobId: string;
  readonly target: { readonly kind: 'short-story'; readonly id: string };
  readonly binding: NativeShortBinding;
  readonly scope: typeof NATIVE_SHORT_COVER_SCOPE;
  readonly hashBases: typeof NATIVE_SHORT_COVER_HASH_BASES;
  readonly baseline: NativeShortCoverEvidenceRef;
  readonly evidence: NativeShortCoverEvidenceRef;
  readonly sourceVersionHash: string;
  readonly assetHash: string;
  readonly intentHash: string;
  readonly uploadAckHash: string | null;
  readonly preSaveVersionHash: string | null;
  readonly desiredContentHash: string | null;
  readonly ordinal: 1 | null;
  readonly transport: NativeShortCoverTransport | null;
  readonly eventAt: string;
}

export interface NativeShortCoverReceipt extends NativeShortCoverReceiptFields {
  readonly schema: `native-short-cover-${NativeShortCoverPhase}-${NativeShortCoverReceiptStage}-receipt/v1`;
}

export interface NativeShortCoverHeldIntent {
  readonly schema: 'native-short-cover-held-intent/v1';
  readonly phase: NativeShortCoverPhase;
  readonly snapshot: NativeShortMetadataSnapshot;
  readonly businessRequest: NativeShortCoverWriteRequest;
  readonly uploadIntent: NativeShortCoverUploadIntent;
  readonly expectation: NativeShortCoverExpectation | null;
  readonly uploadAcknowledgement: NativeShortCoverAcknowledgement | null;
  readonly desiredContentHash: string | null;
  readonly read: NativeShortMetadataWriteReadPhase;
  readonly checkedAt: string;
}

export interface NativeShortCoverAcknowledgement {
  readonly schema: 'native-short-cover-acknowledgement-observation/v1';
  readonly phase: NativeShortCoverPhase;
  readonly binding: NativeShortBinding;
  readonly scope: typeof NATIVE_SHORT_COVER_SCOPE;
  readonly hashBases: typeof NATIVE_SHORT_COVER_HASH_BASES;
  readonly sourceVersionHash: string;
  readonly assetHash: string;
  readonly intentHash: string;
  readonly uploadAckHash: string;
  readonly preSaveVersionHash: string | null;
  readonly desiredContentHash: string;
  readonly acknowledgedAt: string;
  readonly picUri: string | null;
  readonly picUrl: string | null;
}

export interface NativeShortCoverApiOptions {
  mode: 'write';
  uploadDir: string;
  businessRequest: NativeShortCoverWriteRequest;
  expectedOwner: { kind: 'account'; id: string };
  deadline: number;
  signal?: AbortSignal;
  assertLease(): void;
  assertBorrowedActive(): void;
  onBeforePlatformRead(): void;
  onDurableIntent(
    held: NativeShortCoverHeldIntent,
    confirm: (fields: NativeShortCoverReceiptFields) => NativeShortCoverReceipt,
  ): NativeShortCoverReceipt | Promise<NativeShortCoverReceipt>;
  onBeforePlatformWrite(
    receipt: NativeShortCoverReceipt,
    confirmAttempt: (fields: NativeShortCoverReceiptFields) => NativeShortCoverReceipt,
  ): NativeShortCoverReceipt | Promise<NativeShortCoverReceipt>;
  onDurableAcknowledgement(
    observation: NativeShortCoverAcknowledgement,
    confirm: (fields: NativeShortCoverReceiptFields) => NativeShortCoverReceipt,
  ): NativeShortCoverReceipt | Promise<NativeShortCoverReceipt>;
  onVerifiedAccount(accountId: string, checkedAt: string): void | Promise<void>;
  onQuarantine(): void;
}

export interface NativeShortCoverPost {
  attempts: number;
  disposed: number;
  markedAt: string | null;
  startedAt: string | null;
  acknowledgedAt: string | null;
  acknowledged: boolean;
}

export interface NativeShortCoverApiPhaseResult {
  held: NativeShortCoverHeldIntent | null;
  intentReceipt: NativeShortCoverReceipt | null;
  attemptReceipt: NativeShortCoverReceipt | null;
  acknowledgementReceipt: NativeShortCoverReceipt | null;
  observation: NativeShortCoverAcknowledgement | null;
  post: NativeShortCoverPost;
  outcome: 'not_attempted' | 'unknown' | 'acknowledged' | 'verified';
}

/** Private callback observations, not a public DTO or proof of durable storage/fsync. */
export interface NativeShortCoverApiResult {
  schema: 'native-short-cover-api-write/v1';
  status: 'success' | 'capability_unavailable';
  reason: NativeShortCoverApiReason | null;
  asset: NativeShortCoverPreparedAsset | null;
  uploadIntent: NativeShortCoverUploadIntent | null;
  expectation: NativeShortCoverExpectation | null;
  snapshot: NativeShortMetadataSnapshot | null;
  comparison: NativeShortCoverComparison | null;
  desiredContentHash: string | null;
  observedContentHash: string | null;
  phases: {
    before: NativeShortMetadataWriteReadPhase;
    preSave: NativeShortMetadataWriteReadPhase;
    after: NativeShortMetadataWriteReadPhase;
  };
  snapshots: {
    before: NativeShortMetadataSnapshot | null;
    preSave: NativeShortMetadataSnapshot | null;
    after: NativeShortMetadataSnapshot | null;
  };
  upload: NativeShortCoverApiPhaseResult;
  save: NativeShortCoverApiPhaseResult;
  proof: {
    platformStarted: boolean;
    ownerCallback: boolean;
    atomicRevision: false;
    proofCapturedAt: string | null;
  };
  cleanup: NativeShortMetadataApiResult['cleanup'];
}

function readPhase(): NativeShortMetadataWriteReadPhase {
  const initial = unavailableNativeShortMetadataApi('response_unavailable');
  const { ownerCallback: _owner, ...proof } = initial.proof;
  return { proof, requests: initial.requests, list: initial.list };
}

function phaseResult(): NativeShortCoverApiPhaseResult {
  return {
    held: null,
    intentReceipt: null,
    attemptReceipt: null,
    acknowledgementReceipt: null,
    observation: null,
    post: {
      attempts: 0,
      disposed: 0,
      markedAt: null,
      startedAt: null,
      acknowledgedAt: null,
      acknowledged: false,
    },
    outcome: 'not_attempted',
  };
}

export function unavailableNativeShortCoverApi(
  reason: NativeShortCoverApiReason,
): NativeShortCoverApiResult {
  return {
    schema: 'native-short-cover-api-write/v1',
    status: 'capability_unavailable',
    reason,
    asset: null,
    uploadIntent: null,
    expectation: null,
    snapshot: null,
    comparison: null,
    desiredContentHash: null,
    observedContentHash: null,
    phases: { before: readPhase(), preSave: readPhase(), after: readPhase() },
    snapshots: { before: null, preSave: null, after: null },
    upload: phaseResult(),
    save: phaseResult(),
    proof: {
      platformStarted: false,
      ownerCallback: false,
      atomicRevision: false,
      proofCapturedAt: null,
    },
    cleanup: unavailableNativeShortMetadataApi('response_unavailable').cleanup,
  };
}

export function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function fields(
  input: unknown,
  allowed: readonly string[],
  required: readonly string[] = allowed,
): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    throw Error('Invalid cover data');
  const own = Object.getOwnPropertyDescriptors(input);
  if (
    Reflect.ownKeys(own).some(
      (key) =>
        typeof key !== 'string' ||
        !allowed.includes(key) ||
        !Object.hasOwn(own[key]!, 'value') ||
        !own[key]!.enumerable,
    ) ||
    required.some((key) => !Object.hasOwn(own, key))
  )
    throw Error('Invalid cover data');
  return Object.fromEntries(
    Object.entries(own).map(([key, descriptor]) => [key, descriptor.value]),
  );
}
