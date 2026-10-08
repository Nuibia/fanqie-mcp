import {
  NATIVE_SHORT_API_REASONS,
  type NativeShortMetadataWriteReadPhase,
  type NativeShortMetadataApiResult,
  unavailableNativeShortMetadataApi,
} from '../short-native-metadata-api.js';

import { type NativeShortBinding } from '../short-native-metadata.js';

import {
  NATIVE_SHORT_TRIAL_SCOPE,
  NATIVE_SHORT_TRIAL_HASH_BASES,
  type NativeShortTrialSnapshot,
  type NativeShortTrialWriteRequest,
  type NativeShortTrialPlan,
  type NativeShortTrialExpectation,
  type NativeShortTrialComparison,
} from '../short-native-trial.js';

export const ORIGIN = 'https://fanqienovel.com',
  OWNER = /^[0-9]{1,30}$/,
  WORK = /^[1-9][0-9]{9,21}$/;

export const HASH = /^[a-f0-9]{64}$/,
  UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export const NATIVE_SHORT_TRIAL_API_REASONS = [
  ...NATIVE_SHORT_API_REASONS,
  'version_conflict',
  'durability_unverified',
  'readback_mismatch',
] as const;

export type NativeShortTrialApiReason = (typeof NATIVE_SHORT_TRIAL_API_REASONS)[number];

export type NativeShortTrialReceiptStage = 'intent' | 'attempt' | 'acknowledgement';

export interface NativeShortTrialEvidenceRef {
  readonly id: string;
  readonly sha256: string;
  readonly capturedAt: string;
}

export interface NativeShortTrialTransport {
  readonly schema: 'native-short-trial-save-transport/v1';
  readonly provenance: 'static-unobserved';
  readonly method: 'POST';
  readonly url: string;
  readonly encoding: 'application/x-www-form-urlencoded;charset=UTF-8';
}

export interface NativeShortTrialReceiptFields {
  readonly stage: NativeShortTrialReceiptStage;
  readonly accountId: string;
  readonly jobId: string;
  readonly target: { readonly kind: 'short-story'; readonly id: string };
  readonly binding: NativeShortBinding;
  readonly scope: typeof NATIVE_SHORT_TRIAL_SCOPE;
  readonly hashBases: typeof NATIVE_SHORT_TRIAL_HASH_BASES;
  readonly baseline: NativeShortTrialEvidenceRef;
  readonly evidence: NativeShortTrialEvidenceRef;
  readonly sourceVersionHash: string;
  readonly desiredContentHash: string;
  readonly ordinal: 1 | null;
  readonly transport: NativeShortTrialTransport | null;
  readonly eventAt: string;
}

export interface NativeShortTrialReceipt extends NativeShortTrialReceiptFields {
  readonly schema: `native-short-trial-${NativeShortTrialReceiptStage}-receipt/v1`;
}

export interface NativeShortTrialHeldIntent {
  readonly schema: 'native-short-trial-held-intent/v1';
  readonly snapshot: NativeShortTrialSnapshot;
  readonly beforeSnapshot: NativeShortTrialSnapshot;
  readonly businessRequest: NativeShortTrialWriteRequest;
  readonly plan: NativeShortTrialPlan;
  readonly expectation: NativeShortTrialExpectation;
  readonly desiredContentHash: string;
  readonly read: NativeShortMetadataWriteReadPhase;
  readonly checkedAt: string;
}

export interface NativeShortTrialAcknowledgement {
  readonly schema: 'native-short-trial-acknowledgement-observation/v1';
  readonly binding: NativeShortBinding;
  readonly scope: typeof NATIVE_SHORT_TRIAL_SCOPE;
  readonly hashBases: typeof NATIVE_SHORT_TRIAL_HASH_BASES;
  readonly sourceVersionHash: string;
  readonly desiredContentHash: string;
  readonly acknowledgedAt: string;
}

export interface NativeShortTrialApiBaseOptions {
  expectedOwner: { kind: 'account'; id: string };
  deadline: number;
  signal?: AbortSignal;
  assertLease(): void;
  assertBorrowedActive(): void;
  onBeforePlatformRead(): void;
  onVerifiedAccount(accountId: string, checkedAt: string): void | Promise<void>;
  onQuarantine(): void;
}

export interface NativeShortTrialApiReadOptions extends NativeShortTrialApiBaseOptions {
  mode: 'read';
}

export interface NativeShortTrialApiWriteOptions extends NativeShortTrialApiBaseOptions {
  mode: 'write';
  businessRequest: NativeShortTrialWriteRequest;
  onBaseline(held: NativeShortTrialHeldIntent): void | Promise<void>;
  onDurableIntent(
    held: NativeShortTrialHeldIntent,
    confirm: (fields: NativeShortTrialReceiptFields) => NativeShortTrialReceipt,
  ): NativeShortTrialReceipt | Promise<NativeShortTrialReceipt>;
  onBeforePlatformWrite(
    intentReceipt: NativeShortTrialReceipt,
    confirmAttempt: (fields: NativeShortTrialReceiptFields) => NativeShortTrialReceipt,
  ): NativeShortTrialReceipt | Promise<NativeShortTrialReceipt>;
  onDurableAcknowledgement(
    observation: NativeShortTrialAcknowledgement,
    confirm: (fields: NativeShortTrialReceiptFields) => NativeShortTrialReceipt,
  ): NativeShortTrialReceipt | Promise<NativeShortTrialReceipt>;
}

export type NativeShortTrialApiOptions =
  NativeShortTrialApiReadOptions | NativeShortTrialApiWriteOptions;

export interface NativeShortTrialPost {
  attempts: number;
  disposed: number;
  markedAt: string | null;
  startedAt: string | null;
  acknowledgedAt: string | null;
  acknowledged: boolean;
}

export interface NativeShortTrialApiSaveResult {
  held: NativeShortTrialHeldIntent | null;
  intentReceipt: NativeShortTrialReceipt | null;
  attemptReceipt: NativeShortTrialReceipt | null;
  acknowledgementReceipt: NativeShortTrialReceipt | null;
  observation: NativeShortTrialAcknowledgement | null;
  post: NativeShortTrialPost;
  outcome: 'not_attempted' | 'unknown' | 'acknowledged' | 'verified';
}

/** Private observations only. Public projections must construct their own explicit field allowlist. */
export interface NativeShortTrialApiResult {
  schema: 'native-short-trial-api/v1';
  mode: 'read' | 'write';
  status: 'success' | 'capability_unavailable';
  reason: NativeShortTrialApiReason | null;
  plan: NativeShortTrialPlan | null;
  expectation: NativeShortTrialExpectation | null;
  snapshot: NativeShortTrialSnapshot | null;
  comparison: NativeShortTrialComparison | null;
  desiredContentHash: string | null;
  observedContentHash: string | null;
  phases: {
    before: NativeShortMetadataWriteReadPhase;
    preSave: NativeShortMetadataWriteReadPhase;
    after: NativeShortMetadataWriteReadPhase;
  };
  snapshots: {
    before: NativeShortTrialSnapshot | null;
    preSave: NativeShortTrialSnapshot | null;
    after: NativeShortTrialSnapshot | null;
  };
  save: NativeShortTrialApiSaveResult;
  proof: {
    platformStarted: boolean;
    ownerCallback: boolean;
    atomicRevision: false;
    proofCapturedAt: string | null;
  };
  cleanup: NativeShortMetadataApiResult['cleanup'];
}

function readPhase(): NativeShortMetadataWriteReadPhase {
  const result = unavailableNativeShortMetadataApi('response_unavailable'),
    { ownerCallback: _owner, ...proof } = result.proof;
  return { proof, requests: result.requests, list: result.list };
}

export function unavailableNativeShortTrialApi(
  reason: NativeShortTrialApiReason,
  mode: 'read' | 'write' = 'write',
): NativeShortTrialApiResult {
  return {
    schema: 'native-short-trial-api/v1',
    mode,
    status: 'capability_unavailable',
    reason,
    plan: null,
    expectation: null,
    snapshot: null,
    comparison: null,
    desiredContentHash: null,
    observedContentHash: null,
    phases: { before: readPhase(), preSave: readPhase(), after: readPhase() },
    snapshots: { before: null, preSave: null, after: null },
    save: {
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
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Object.getOwnPropertySymbols(input).length
  )
    throw Error('Invalid trial data');
  const own = Object.getOwnPropertyDescriptors(input);
  if (
    Object.keys(own).some(
      (key) =>
        !allowed.includes(key) || !Object.hasOwn(own[key]!, 'value') || !own[key]!.enumerable,
    ) ||
    required.some((key) => !Object.hasOwn(own, key))
  )
    throw Error('Invalid trial data');
  return Object.fromEntries(
    Object.entries(own).map(([key, descriptor]) => [key, descriptor.value]),
  );
}

export function sameData(input: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return input === expected;
  if (Array.isArray(expected)) return false;
  const value = fields(input, Object.keys(expected));
  return Object.keys(expected).every((key) =>
    sameData(value[key], (expected as Record<string, unknown>)[key]),
  );
}

export function time(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

export function copyRef(input: unknown): NativeShortTrialEvidenceRef {
  const value = fields(input, ['id', 'sha256', 'capturedAt']);
  if (
    typeof value.id !== 'string' ||
    !UUID.test(value.id) ||
    typeof value.sha256 !== 'string' ||
    !HASH.test(value.sha256) ||
    !time(value.capturedAt)
  )
    throw Error('Invalid trial reference');
  return { id: value.id, sha256: value.sha256, capturedAt: value.capturedAt };
}
