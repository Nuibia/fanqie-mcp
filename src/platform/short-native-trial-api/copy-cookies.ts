import {
  type Cookie,
  type APIRequestContext,
  type BrowserContext,
  type APIRequest,
  type APIResponse,
} from 'playwright';

import {
  fields,
  type NativeShortTrialApiReason,
  type NativeShortTrialApiResult,
  type NativeShortTrialApiOptions,
  type NativeShortTrialReceiptStage,
  type NativeShortTrialEvidenceRef,
  type NativeShortTrialTransport,
  type NativeShortTrialHeldIntent,
  type NativeShortTrialReceiptFields,
  type NativeShortTrialReceipt,
} from './read-phase.js';

import {
  type NativeShortTrialWriteRequest,
  validateNativeShortTrialWriteRequest,
  type NativeShortTrialSnapshot,
  type NativeShortTrialPlan,
} from '../short-native-trial.js';

import { OwnedNativeShortTrialRun } from '../short-native-trial-api.js';

import {
  type NativeShortMetadataWriteReadPhase,
  type NativeShortFixedReadKind,
} from '../short-native-metadata-api.js';

export function copyCookies(input: Cookie[]): Cookie[] {
  const names = [
    'name',
    'value',
    'domain',
    'path',
    'expires',
    'httpOnly',
    'secure',
    'sameSite',
    'partitionKey',
  ];
  if (
    !Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Array.prototype ||
    Object.getOwnPropertySymbols(input).length
  )
    throw Error('Invalid cookie copy');
  const descriptors = Object.getOwnPropertyDescriptors(input),
    keys = Object.keys(descriptors).filter((key) => key !== 'length');
  if (
    keys.length !== input.length ||
    keys.some(
      (key, index) =>
        key !== String(index) ||
        !Object.hasOwn(descriptors[key]!, 'value') ||
        !descriptors[key]!.enumerable,
    )
  )
    throw Error('Invalid cookie copy');
  return keys
    .map((key) => {
      const value = fields(
        descriptors[key]!.value,
        names,
        names.filter((name) => name !== 'partitionKey'),
      );
      if (!['fanqienovel.com', '.fanqienovel.com'].includes(value.domain as string)) return null;
      if (
        ['name', 'value', 'domain', 'path'].some((name) => typeof value[name] !== 'string') ||
        typeof value.expires !== 'number' ||
        !Number.isFinite(value.expires) ||
        typeof value.httpOnly !== 'boolean' ||
        typeof value.secure !== 'boolean' ||
        !['Strict', 'Lax', 'None'].includes(value.sameSite as string) ||
        (value.partitionKey !== undefined && typeof value.partitionKey !== 'string')
      )
        throw Error('Invalid cookie copy');
      return value as unknown as Cookie;
    })
    .filter((cookie): cookie is Cookie => cookie !== null);
}

export function captureNativeShortTrialWriteRequest(
  input: unknown,
): NativeShortTrialWriteRequest | null {
  try {
    return validateNativeShortTrialWriteRequest(input);
  } catch {
    return null;
  }
}

export class PostObservationFailure extends Error {
  constructor(readonly reason: NativeShortTrialApiReason) {
    super('Trial POST observation unavailable');
  }
}

/** One RAM client for read mode or before/preSave/ONE save/after write mode. Never opens a Page. */
export interface OwnedNativeShortTrialRunOwner {
  owner: OwnedNativeShortTrialRun;
  result: NativeShortTrialApiResult;
  options: NativeShortTrialApiOptions;
  businessRequest: NativeShortTrialWriteRequest | null;
  optionsValid: boolean;
  reason:
    | 'context_unavailable'
    | 'identity_unverified'
    | 'owner_changed'
    | 'source_changed'
    | 'redirect_blocked'
    | 'response_unverified'
    | 'response_unavailable'
    | 'bounded_unavailable'
    | 'pagination_inconsistent'
    | 'target_unverified'
    | 'unsupported_schema'
    | 'cancelled'
    | 'timeout'
    | 'cleanup_failed'
    | 'lease_unavailable'
    | 'callback_failed'
    | 'version_conflict'
    | 'durability_unverified'
    | 'readback_mismatch'
    | null;
  postFailure:
    | 'context_unavailable'
    | 'identity_unverified'
    | 'owner_changed'
    | 'source_changed'
    | 'redirect_blocked'
    | 'response_unverified'
    | 'response_unavailable'
    | 'bounded_unavailable'
    | 'pagination_inconsistent'
    | 'target_unverified'
    | 'unsupported_schema'
    | 'cancelled'
    | 'timeout'
    | 'cleanup_failed'
    | 'lease_unavailable'
    | 'callback_failed'
    | 'version_conflict'
    | 'durability_unverified'
    | 'readback_mismatch'
    | null;
  api: APIRequestContext | null;
  disposing: Promise<void> | null;
  pending: Set<Promise<unknown>>;
  brands: Map<NativeShortTrialReceiptStage, WeakSet<object>>;
  minted: Set<NativeShortTrialReceiptStage>;
  refs: Set<string>;
  receiptIdentity: {
    accountId: string;
    jobId: string;
    baseline: NativeShortTrialEvidenceRef;
  } | null;
  activeConfirmation: NativeShortTrialReceiptStage | null;
  timer: NodeJS.Timeout | undefined;
  started: boolean;
  borrowed: BrowserContext;
  workId: string;
  factory: Pick<APIRequest, 'newContext'>;
  track: <T>(promise: Promise<T>) => Promise<T>;
  stop: (reason?: NativeShortTrialApiReason) => void;
  disposalFailed: () => void;
  startDispose: () => void;
  fail: (reason: NativeShortTrialApiReason) => never;
  check: () => void;
  httpOptions: () => {
    maxRedirects: number;
    maxRetries: number;
    failOnStatusCode: boolean;
    timeout: number;
  };
  responseJson: (
    response: APIResponse,
    url: string,
    post?: boolean,
  ) => Promise<Record<string, unknown>>;
  json: (
    phase: NativeShortMetadataWriteReadPhase,
    kind: NativeShortFixedReadKind,
    index?: number,
  ) => Promise<Record<string, unknown>>;
  read: (phase: NativeShortMetadataWriteReadPhase) => Promise<NativeShortTrialSnapshot>;
  transport: () => NativeShortTrialTransport;
  held: (
    snapshot: NativeShortTrialSnapshot,
    beforeSnapshot: NativeShortTrialSnapshot,
    plan: NativeShortTrialPlan,
    read: NativeShortMetadataWriteReadPhase,
  ) => NativeShortTrialHeldIntent;
  confirm: (
    input: NativeShortTrialReceiptFields,
    stage: NativeShortTrialReceiptStage,
  ) => NativeShortTrialReceipt;
  callback: (stage: NativeShortTrialReceiptStage) => Promise<NativeShortTrialReceipt>;
  post: (plan: NativeShortTrialPlan) => Promise<void>;
  assertSaveAcknowledgement: (
    envelope: Record<string, unknown>,
    plan: NativeShortTrialPlan,
  ) => void;
  run: () => Promise<NativeShortTrialApiResult>;
}

export type OwnedNativeShortTrialRunOperations = Pick<
  OwnedNativeShortTrialRunOwner,
  | 'track'
  | 'stop'
  | 'disposalFailed'
  | 'startDispose'
  | 'fail'
  | 'check'
  | 'httpOptions'
  | 'responseJson'
  | 'json'
  | 'read'
  | 'transport'
  | 'held'
  | 'confirm'
  | 'callback'
  | 'post'
  | 'assertSaveAcknowledgement'
  | 'run'
>;
