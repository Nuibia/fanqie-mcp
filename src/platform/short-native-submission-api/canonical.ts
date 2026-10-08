import {
  copy,
  OwnedNativeShortSubmissionRun,
  type OwnedStopSignal,
} from '../short-native-submission-api.js';

import {
  type NativeShortSubmissionWriteRequest,
  validateNativeShortSubmissionWriteRequest,
  type NativeShortSubmissionContract,
  type NativeShortSubmissionBusinessInput,
  type NativeShortSubmissionPlan,
} from '../short-native-submission.js';

import {
  type APIRequest,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
} from 'playwright';

import {
  type NativeShortSubmissionApiReason,
  type NativeShortSubmissionApiOptions,
  type NativeShortSubmissionApiResult,
  type NativeShortSubmissionReceiptStage,
  type NativeShortSubmissionEvidenceRef,
  type NativeShortSubmissionHeldIntent,
  type NativeShortSubmissionTransport,
  type NativeShortSubmissionReceiptFields,
  type NativeShortSubmissionReceipt,
} from './phase.js';

import {
  type NativeShortFixedReadKind,
  type NativeShortMetadataWriteReadPhase,
} from '../short-native-metadata-api.js';

import { type NativeShortMetadataSnapshot } from '../short-native-metadata.js';

function canonical(value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const r = value as Record<string, unknown>;
  return `{${Object.keys(r)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(r[key])}`)
    .join(',')}}`;
}

export const same = (a: unknown, b: unknown) => canonical(copy(a)) === canonical(copy(b));

export function time(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export function captureNativeShortSubmissionWriteRequest(
  input: unknown,
): NativeShortSubmissionWriteRequest | null {
  try {
    return validateNativeShortSubmissionWriteRequest(input);
  } catch {
    return null;
  }
}

export interface FixtureExecution {
  factory: Pick<APIRequest, 'newContext'>;
  contract: NativeShortSubmissionContract;
}

export class PostObservationFailure extends Error {
  constructor(readonly reason: NativeShortSubmissionApiReason) {
    super('Submission acknowledgement unavailable');
  }
}

/** One RAM client; no page, navigation, save, arbitrary URL or retry. */
export interface OwnedNativeShortSubmissionRunOwner {
  owner: OwnedNativeShortSubmissionRun;
  options: NativeShortSubmissionApiOptions | null;
  result: NativeShortSubmissionApiResult;
  api: APIRequestContext | null;
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
    | 'invalid_input'
    | 'version_conflict'
    | 'durability_unverified'
    | 'acknowledgement_unverified'
    | 'readback_mismatch'
    | 'submission_rejected'
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
    | 'invalid_input'
    | 'version_conflict'
    | 'durability_unverified'
    | 'acknowledgement_unverified'
    | 'readback_mismatch'
    | 'submission_rejected'
    | null;
  started: boolean;
  timer: NodeJS.Timeout | undefined;
  cleanupRequested: boolean;
  cleanupResolved: boolean;
  disposal: Promise<void> | null;
  pending: Set<Promise<unknown>>;
  responses: Map<APIResponse<any>, { promise: Promise<void> | null; disposed(): void }>;
  finishCleanup: () => void;
  cleanupDone: Promise<void>;
  notifyStopped: () => void;
  stopped: Promise<OwnedStopSignal>;
  activeConfirmation: NativeShortSubmissionReceiptStage | null;
  brands: Map<NativeShortSubmissionReceiptStage, WeakSet<object>>;
  minted: Set<string>;
  references: Set<string>;
  receiptIdentity: {
    accountId: string;
    jobId: string;
    baseline: NativeShortSubmissionEvidenceRef;
  } | null;
  borrowed: BrowserContext;
  workId: string;
  stop: (reason?: NativeShortSubmissionApiReason) => void;
  fail: (reason: NativeShortSubmissionApiReason) => never;
  check: () => void;
  quarantine: () => void;
  track: <T>(promise: Promise<T>) => Promise<T>;
  wait: <T>(promise: Promise<T>) => Promise<T>;
  ownResponse: (response: APIResponse, disposed: () => void) => APIResponse;
  disposeResponse: (response: APIResponse) => Promise<void>;
  drain: () => void;
  httpOptions: () => {
    maxRedirects: number;
    maxRetries: number;
    failOnStatusCode: boolean;
    timeout: number;
  };
  begin: () => void;
  bytes: (
    response: APIResponse,
    url: string,
    kind: 'json' | 'source',
    post?: boolean,
  ) => Promise<Buffer>;
  json: (
    name: keyof NativeShortSubmissionApiResult['phases'],
    kind: NativeShortFixedReadKind,
    index?: number,
  ) => Promise<Record<string, unknown>>;
  read: (
    name: 'before' | 'preSubmit' | 'after',
    draftMembership: boolean,
  ) => Promise<NativeShortMetadataSnapshot>;
  sources: () => Promise<NativeShortSubmissionContract>;
  business: () => NativeShortSubmissionBusinessInput;
  held: (
    beforeSnapshot: NativeShortMetadataSnapshot,
    snapshot: NativeShortMetadataSnapshot,
    contract: NativeShortSubmissionContract,
    plan: NativeShortSubmissionPlan,
    read: NativeShortMetadataWriteReadPhase,
  ) => NativeShortSubmissionHeldIntent;
  checkFreshPublication: () => void;
  transport: () => NativeShortSubmissionTransport;
  confirm: (
    input: NativeShortSubmissionReceiptFields,
    stage: NativeShortSubmissionReceiptStage,
  ) => NativeShortSubmissionReceipt;
  callback: (stage: NativeShortSubmissionReceiptStage) => Promise<NativeShortSubmissionReceipt>;
  post: () => Promise<void>;
  run: () => Promise<NativeShortSubmissionApiResult>;
}

export type OwnedNativeShortSubmissionRunOperations = Pick<
  OwnedNativeShortSubmissionRunOwner,
  | 'stop'
  | 'fail'
  | 'check'
  | 'quarantine'
  | 'track'
  | 'wait'
  | 'ownResponse'
  | 'disposeResponse'
  | 'drain'
  | 'httpOptions'
  | 'begin'
  | 'bytes'
  | 'json'
  | 'read'
  | 'sources'
  | 'business'
  | 'held'
  | 'checkFreshPublication'
  | 'transport'
  | 'confirm'
  | 'callback'
  | 'post'
  | 'run'
>;
