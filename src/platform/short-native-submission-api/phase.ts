import {
  NATIVE_SHORT_HASH_BASES,
  type NativeShortBinding,
  type NativeShortMetadataSnapshot,
} from '../short-native-metadata.js';

import {
  NATIVE_SHORT_API_REASONS,
  type NativeShortMetadataWriteReadPhase,
  type NativeShortMetadataApiResult,
  unavailableNativeShortMetadataApi,
} from '../short-native-metadata-api.js';

import {
  type NativeShortPreparedSubmission,
  NATIVE_SHORT_SUBMISSION_SCOPE,
  type NativeShortSubmissionContract,
  type NativeShortSubmissionWriteRequest,
  type NativeShortSubmissionPlan,
  type NativeShortSubmissionExpectation,
  type NativeShortSubmissionComparison,
} from '../short-native-submission.js';

export const ORIGIN = 'https://fanqienovel.com',
  OWNER = /^[0-9]{1,30}$/,
  WORK = /^[1-9][0-9]{9,21}$/;

export const HASH = /^[a-f0-9]{64}$/,
  UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export const SOURCE_KEYS = ['writer', 'main', 'publishShort', 'asyncMain'] as const;

export type SourceKey = (typeof SOURCE_KEYS)[number];

export const NATIVE_SHORT_SUBMISSION_RECEIPT_HASH_BASES = Object.freeze({
  snapshot: NATIVE_SHORT_HASH_BASES.snapshot,
  submission: 'native-short-submission-wire-form/v1',
} as const);

export const NATIVE_SHORT_SUBMISSION_API_REASONS = [
  ...NATIVE_SHORT_API_REASONS,
  'invalid_input',
  'version_conflict',
  'durability_unverified',
  'acknowledgement_unverified',
  'readback_mismatch',
  'submission_rejected',
] as const;

export type NativeShortSubmissionApiReason = (typeof NATIVE_SHORT_SUBMISSION_API_REASONS)[number];

export type NativeShortSubmissionReceiptStage = 'intent' | 'attempt' | 'acknowledgement';

export interface NativeShortSubmissionEvidenceRef {
  readonly id: string;
  readonly sha256: string;
  readonly capturedAt: string;
}

export interface NativeShortSubmissionServicePrepared {
  readonly preparationJobId: string;
  readonly preparationEvidence: NativeShortSubmissionEvidenceRef;
  readonly prepared: NativeShortPreparedSubmission;
}

export interface NativeShortSubmissionTransport {
  readonly schema: 'native-short-submission-publish-transport/v1';
  readonly provenance: 'static-unobserved';
  readonly method: 'POST';
  readonly url: string;
  readonly encoding: 'application/x-www-form-urlencoded;charset=UTF-8';
}

export interface NativeShortSubmissionReceiptFields {
  readonly stage: NativeShortSubmissionReceiptStage;
  readonly accountId: string;
  readonly jobId: string;
  readonly target: { readonly kind: 'short-story'; readonly id: string };
  readonly binding: NativeShortBinding;
  readonly scope: typeof NATIVE_SHORT_SUBMISSION_SCOPE;
  readonly hashBases: typeof NATIVE_SHORT_SUBMISSION_RECEIPT_HASH_BASES;
  readonly baseline: NativeShortSubmissionEvidenceRef;
  readonly evidence: NativeShortSubmissionEvidenceRef;
  readonly sourceVersionHash: string;
  readonly desiredSubmissionHash: string;
  readonly preparationJobId: string;
  readonly preparationEvidence: NativeShortSubmissionEvidenceRef;
  readonly termsHash: string;
  readonly contractHash: string;
  readonly useAi: 1 | 2;
  readonly ordinal: 1 | null;
  readonly transport: NativeShortSubmissionTransport | null;
  readonly eventAt: string;
}

export interface NativeShortSubmissionReceipt extends NativeShortSubmissionReceiptFields {
  readonly schema: `native-short-submission-${NativeShortSubmissionReceiptStage}-receipt/v1`;
}

export interface NativeShortSubmissionHeldIntent {
  readonly schema: 'native-short-submission-held-intent/v1';
  readonly beforeSnapshot: NativeShortMetadataSnapshot;
  readonly snapshot: NativeShortMetadataSnapshot;
  readonly contract: NativeShortSubmissionContract;
  readonly businessRequest: NativeShortSubmissionWriteRequest;
  readonly servicePrepared: NativeShortSubmissionServicePrepared;
  readonly plan: NativeShortSubmissionPlan;
  readonly expectation: NativeShortSubmissionExpectation;
  readonly desiredSubmissionHash: string;
  readonly read: NativeShortMetadataWriteReadPhase;
  readonly checkedAt: string;
}

export interface NativeShortSubmissionAcknowledgement {
  readonly schema: 'native-short-submission-acknowledgement-observation/v1';
  readonly binding: NativeShortBinding;
  readonly sourceVersionHash: string;
  readonly desiredSubmissionHash: string;
  readonly useAi: 1 | 2;
  readonly code: number;
  readonly message: string | null;
  readonly itemId: string | null;
  readonly accepted: boolean;
  readonly acknowledgedAt: string;
}

export interface BaseOptions {
  expectedOwner: { kind: 'account'; id: string };
  deadline: number;
  signal?: AbortSignal;
  assertLease(): void;
  assertBorrowedActive(): void;
  onBeforePlatformRead(): void;
  onVerifiedAccount(accountId: string, checkedAt: string): void | Promise<void>;
  onQuarantine(): void;
}

export interface NativeShortSubmissionApiPrepareOptions extends BaseOptions {
  mode: 'prepare';
  businessRequest: NativeShortSubmissionWriteRequest;
}

export interface NativeShortSubmissionApiReadOptions extends BaseOptions {
  mode: 'read';
}

export interface NativeShortSubmissionApiSubmitOptions extends BaseOptions {
  mode: 'submit';
  businessRequest: NativeShortSubmissionWriteRequest;
  servicePrepared: NativeShortSubmissionServicePrepared;
  onBaseline(held: NativeShortSubmissionHeldIntent): void | Promise<void>;
  onDurableIntent(
    held: NativeShortSubmissionHeldIntent,
    confirm: (fields: NativeShortSubmissionReceiptFields) => NativeShortSubmissionReceipt,
  ): NativeShortSubmissionReceipt | Promise<NativeShortSubmissionReceipt>;
  onBeforePlatformWrite(
    receipt: NativeShortSubmissionReceipt,
    confirm: (fields: NativeShortSubmissionReceiptFields) => NativeShortSubmissionReceipt,
  ): NativeShortSubmissionReceipt | Promise<NativeShortSubmissionReceipt>;
  onDurableAcknowledgement(
    observation: NativeShortSubmissionAcknowledgement,
    confirm: (fields: NativeShortSubmissionReceiptFields) => NativeShortSubmissionReceipt,
  ): NativeShortSubmissionReceipt | Promise<NativeShortSubmissionReceipt>;
}

export type NativeShortSubmissionApiOptions =
  | NativeShortSubmissionApiPrepareOptions
  | NativeShortSubmissionApiReadOptions
  | NativeShortSubmissionApiSubmitOptions;

export type NativeShortSubmissionBrowserOptions = (
  | Omit<
      NativeShortSubmissionApiPrepareOptions,
      'deadline' | 'assertBorrowedActive' | 'onQuarantine'
    >
  | Omit<NativeShortSubmissionApiReadOptions, 'deadline' | 'assertBorrowedActive' | 'onQuarantine'>
  | Omit<
      NativeShortSubmissionApiSubmitOptions,
      'deadline' | 'assertBorrowedActive' | 'onQuarantine'
    >
) & { timeoutMs?: number };

export interface NativeShortSubmissionPost {
  attempts: number;
  disposed: number;
  markedAt: string | null;
  startedAt: string | null;
  acknowledgedAt: string | null;
  acknowledged: boolean;
}

export interface NativeShortSubmissionSourceRead {
  attempts: number;
  disposed: number;
  url: string | null;
  sha256: string | null;
  requestedAt: string | null;
  completedAt: string | null;
}

export interface NativeShortSubmissionApiResult {
  schema: 'native-short-submission-api/v1';
  mode: 'prepare' | 'submit' | 'read';
  status: 'success' | 'capability_unavailable';
  reason: NativeShortSubmissionApiReason | null;
  provenance:
    | { mode: 'live'; executor: 'application-default-submission-owned-run/v1' }
    | { mode: 'fixture'; executor: 'dependency-injected-submission-owned-run/v1' };
  prepared: NativeShortPreparedSubmission | null;
  contract: NativeShortSubmissionContract | null;
  plan: NativeShortSubmissionPlan | null;
  expectation: NativeShortSubmissionExpectation | null;
  snapshot: NativeShortMetadataSnapshot | null;
  comparison: NativeShortSubmissionComparison | null;
  phases: {
    before: NativeShortMetadataWriteReadPhase;
    preSubmit: NativeShortMetadataWriteReadPhase;
    after: NativeShortMetadataWriteReadPhase;
  };
  snapshots: {
    before: NativeShortMetadataSnapshot | null;
    preSubmit: NativeShortMetadataSnapshot | null;
    after: NativeShortMetadataSnapshot | null;
  };
  sourceReads: Record<SourceKey, NativeShortSubmissionSourceRead>;
  sourceReadStartedAt: string | null;
  sourceReadFinishedAt: string | null;
  publish: {
    held: NativeShortSubmissionHeldIntent | null;
    intentReceipt: NativeShortSubmissionReceipt | null;
    attemptReceipt: NativeShortSubmissionReceipt | null;
    acknowledgementReceipt: NativeShortSubmissionReceipt | null;
    observation: NativeShortSubmissionAcknowledgement | null;
    post: NativeShortSubmissionPost;
    outcome: 'not_attempted' | 'unknown' | 'acknowledged' | 'rejected' | 'verified';
  };
  proof: {
    platformStarted: boolean;
    ownerCallback: boolean;
    atomicRevision: false;
    fixedSourcesVerified: boolean;
    proofCapturedAt: string | null;
  };
  cleanup: NativeShortMetadataApiResult['cleanup'];
}

function phase(): NativeShortMetadataWriteReadPhase {
  const r = unavailableNativeShortMetadataApi('response_unavailable');
  const { ownerCallback: _owner, ...proof } = r.proof;
  return { proof, requests: r.requests, list: r.list };
}

export function unavailableNativeShortSubmissionApi(
  reason: NativeShortSubmissionApiReason,
  mode: NativeShortSubmissionApiResult['mode'] = 'submit',
): NativeShortSubmissionApiResult {
  return {
    schema: 'native-short-submission-api/v1',
    mode,
    status: 'capability_unavailable',
    reason,
    provenance: { mode: 'live', executor: 'application-default-submission-owned-run/v1' },
    prepared: null,
    contract: null,
    plan: null,
    expectation: null,
    snapshot: null,
    comparison: null,
    phases: { before: phase(), preSubmit: phase(), after: phase() },
    snapshots: { before: null, preSubmit: null, after: null },
    sourceReads: Object.fromEntries(
      SOURCE_KEYS.map((key) => [
        key,
        { attempts: 0, disposed: 0, url: null, sha256: null, requestedAt: null, completedAt: null },
      ]),
    ) as Record<SourceKey, NativeShortSubmissionSourceRead>,
    sourceReadStartedAt: null,
    sourceReadFinishedAt: null,
    publish: {
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
    },
    proof: {
      platformStarted: false,
      ownerCallback: false,
      atomicRevision: false,
      fixedSourcesVerified: false,
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
