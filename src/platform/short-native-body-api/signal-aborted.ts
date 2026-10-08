import {
  NATIVE_SHORT_API_REASONS,
  type NativeShortMetadataWriteReadPhase,
  type NativeShortMetadataApiResult,
  unavailableNativeShortMetadataApi,
} from '../short-native-metadata-api.js';

import {
  type NativeShortBodySnapshot,
  NATIVE_SHORT_BODY_SCOPE,
  type NativeShortBodyWriteRequest,
  type NativeShortBodyPlan,
  type NativeShortBodyExpectation,
  type NativeShortBodyComparison,
  validateNativeShortBodyWriteRequest,
} from '../short-native-body.js';

import {
  type NativeShortBodyFixtureStageEvidence,
  type NativeShortBodyFixtureTrace,
  type NativeShortBodySource,
} from '../short-native-body-proof.js';

import { type APIRequest } from 'playwright';

export const NATIVE_SHORT_BODY_API_REASONS = Object.freeze([
  ...NATIVE_SHORT_API_REASONS,
  'production_disabled',
  'fixture_not_live',
  'invalid_input',
  'version_conflict',
  'no_change',
  'durability_unverified',
  'acknowledgement_unverified',
  'readback_mismatch',
] as const);

export type NativeShortBodyApiReason = (typeof NATIVE_SHORT_BODY_API_REASONS)[number];

export type NativeShortBodyReadPhase = NativeShortMetadataWriteReadPhase;

export interface NativeShortBodyPostObservation {
  readonly schema: 'native-short-body-fixture-acknowledgement/v1';
  readonly binding: NativeShortBodySnapshot['binding'];
  readonly scope: typeof NATIVE_SHORT_BODY_SCOPE;
  readonly sourceVersionHash: string;
  readonly desiredContentHash: string;
  readonly acknowledgedAt: string;
}

export interface NativeShortBodyApiOptions {
  accountId: string;
  expectedOwner: { kind: 'account'; id: string };
  businessRequest: NativeShortBodyWriteRequest;
  deadline: number;
  signal?: AbortSignal;
  assertLease(): void;
  assertBorrowedActive(): void;
  onBeforePlatformRead(): void;
  onVerifiedAccount(accountId: string, checkedAt: string): void | Promise<void>;
  onQuarantine(): void;
  onStage?(stage: NativeShortBodyFixtureStageEvidence): void | Promise<void>;
}

export interface NativeShortBodyBrowserOptions {
  accountId: string;
  expectedOwner: NativeShortBodyApiOptions['expectedOwner'];
  businessRequest: NativeShortBodyWriteRequest;
  authority: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
  assertLease(): void;
  onBeforePlatformRead(): void;
  onVerifiedAccount(accountId: string, checkedAt: string): void | Promise<void>;
}

declare const productionStartIdentity: unique symbol;

/** Only a registered Store binding can issue this private one-shot Start. */
export interface NativeShortBodyProductionStart {
  readonly [productionStartIdentity]: true;
}

export type NativeShortBodyProductionDecision =
  | { readonly allowed: false; readonly result: NativeShortBodyApiResult }
  | { readonly allowed: true; readonly start: NativeShortBodyProductionStart };

export interface NativeShortBodyOwnedRunHandle {
  run(): Promise<NativeShortBodyApiResult>;
  stop(reason?: NativeShortBodyApiReason): void;
  readonly cleanupDone: Promise<void>;
}

export interface NativeShortBodyFixtureApiResult {
  schema: 'native-short-body-api-result/v1';
  scope: typeof NATIVE_SHORT_BODY_SCOPE;
  provenance:
    | { mode: 'fixture'; executor: 'dependency-injected-body-owned-run/v1' }
    | { mode: 'disabled'; executor: 'body-production-disabled/v1' };
  verifiedLive: false;
  durable: false;
  status: 'fixture_complete' | 'no_change' | 'capability_unavailable';
  reason: NativeShortBodyApiReason;
  plan: NativeShortBodyPlan | null;
  expectation: NativeShortBodyExpectation | null;
  snapshot: NativeShortBodySnapshot | null;
  comparison: NativeShortBodyComparison | null;
  desiredContentHash: string | null;
  phases: Record<'before' | 'preSave' | 'after', NativeShortBodyReadPhase>;
  snapshots: Record<'before' | 'preSave' | 'after', NativeShortBodySnapshot | null>;
  save: {
    trace: NativeShortBodyFixtureTrace | null;
    observation: NativeShortBodyPostObservation | null;
    post: {
      attempts: number;
      disposed: number;
      startedAt: string | null;
      acknowledgedAt: string | null;
      acknowledged: boolean;
    };
    outcome: 'not_attempted' | 'fixture_unknown' | 'fixture_matched';
  };
  cleanup: NativeShortMetadataApiResult['cleanup'];
  proof: {
    platformStarted: boolean;
    ownerCallback: boolean;
    atomicRevision: false;
    proofCapturedAt: string | null;
  };
}

export const NATIVE_SHORT_BODY_DURABLE_API_REASONS = Object.freeze([
  ...NATIVE_SHORT_BODY_API_REASONS,
  'match',
] as const);

export type NativeShortBodyDurableApiReason =
  (typeof NATIVE_SHORT_BODY_DURABLE_API_REASONS)[number];

export interface NativeShortBodyDurablePostObservation extends Omit<
  NativeShortBodyPostObservation,
  'schema'
> {
  readonly schema: 'native-short-body-acknowledgement/v1';
}

export interface NativeShortBodyDurableApiResult extends Omit<
  NativeShortBodyFixtureApiResult,
  'schema' | 'provenance' | 'verifiedLive' | 'durable' | 'status' | 'reason' | 'save' | 'proof'
> {
  schema: 'native-short-body-durable-api-result/v1';
  mode: 'write' | 'reconcile';
  provenance: NativeShortBodySource;
  verifiedLive: boolean;
  durable: boolean;
  status: 'complete' | 'no_change' | 'capability_unavailable';
  reason: NativeShortBodyDurableApiReason;
  save: {
    trace: null;
    observation: NativeShortBodyDurablePostObservation | null;
    post: NativeShortBodyFixtureApiResult['save']['post'];
    outcome: 'not_attempted' | 'unknown' | 'matched';
  };
  proof: NativeShortBodyFixtureApiResult['proof'] & { ownerCheckedAt: string | null };
}

export type NativeShortBodyApiResult =
  NativeShortBodyFixtureApiResult | NativeShortBodyDurableApiResult;

export const ORIGIN = 'https://fanqienovel.com';

export const WORK = /^[1-9][0-9]{9,21}$/;

export const ACCOUNT = /^[0-9]{1,30}$/;

export const BAD_UNICODE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

export type Factory = Pick<APIRequest, 'newContext'>;

const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;

export function signalAborted(signal: AbortSignal | undefined): boolean {
  return signal === undefined ? false : (ABORTED.call(signal) as boolean);
}

export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function configAccount(input: unknown): input is string {
  return (
    typeof input === 'string' &&
    input.length > 0 &&
    !/[\r\n\u0000]/.test(input) &&
    !BAD_UNICODE.test(input) &&
    Buffer.byteLength(input, 'utf8') <= 1024
  );
}

function phase(): NativeShortBodyReadPhase {
  const base = unavailableNativeShortMetadataApi('response_unavailable');
  const { ownerCallback: _unused, ...proof } = base.proof;
  return { proof, requests: base.requests, list: base.list };
}

export function unavailableNativeShortBodyApi(
  reason: NativeShortBodyApiReason,
): NativeShortBodyFixtureApiResult {
  const safe = (NATIVE_SHORT_BODY_API_REASONS as readonly string[]).includes(reason)
    ? reason
    : 'invalid_input';
  return {
    schema: 'native-short-body-api-result/v1',
    scope: NATIVE_SHORT_BODY_SCOPE,
    provenance: { mode: 'disabled', executor: 'body-production-disabled/v1' },
    verifiedLive: false,
    durable: false,
    status: 'capability_unavailable',
    reason: safe,
    plan: null,
    expectation: null,
    snapshot: null,
    comparison: null,
    desiredContentHash: null,
    phases: { before: phase(), preSave: phase(), after: phase() },
    snapshots: { before: null, preSave: null, after: null },
    save: {
      trace: null,
      observation: null,
      post: {
        attempts: 0,
        disposed: 0,
        startedAt: null,
        acknowledgedAt: null,
        acknowledged: false,
      },
      outcome: 'not_attempted',
    },
    cleanup: unavailableNativeShortMetadataApi('response_unavailable').cleanup,
    proof: {
      platformStarted: false,
      ownerCallback: false,
      atomicRevision: false,
      proofCapturedAt: null,
    },
  };
}

export function captureNativeShortBodyWriteRequest(
  input: unknown,
): NativeShortBodyWriteRequest | null {
  try {
    return validateNativeShortBodyWriteRequest(input);
  } catch {
    return null;
  }
}

export function compact(snapshot: NativeShortBodySnapshot): Record<string, unknown> {
  return {
    binding: snapshot.binding,
    editData: snapshot.native.editData,
    categoryData: snapshot.native.categoryData,
    statusFacts: snapshot.native.statusFacts,
  };
}
