import {
  type NativeShortCoverWriteRequest,
  fields,
  HASH,
  UPLOAD_NAME,
  freeze,
  type NativeShortCoverEvidenceRef,
  UUID,
  type NativeShortCoverApiResult,
  type NativeShortCoverApiOptions,
  type NativeShortCoverApiReason,
  type NativeShortCoverPhase,
  type NativeShortCoverTransport,
  type NativeShortCoverReceiptFields,
  type NativeShortCoverReceiptStage,
  type NativeShortCoverHeldIntent,
  type NativeShortCoverAcknowledgement,
  type NativeShortCoverReceipt,
} from './read-phase.js';

import {
  NATIVE_SHORT_HASH_BASES,
  type NativeShortMetadataSnapshot,
} from '../short-native-metadata.js';

import { createHash } from 'node:crypto';

import {
  type Cookie,
  type APIRequestContext,
  type BrowserContext,
  type APIRequest,
  type APIResponse,
} from 'playwright';

import { OwnedNativeShortCoverRun } from '../short-native-cover-api.js';

import { type NativeShortCoverImageReference } from '../short-native-cover-image.js';

import {
  type NativeShortCoverPreparedAsset,
  type NativeShortCoverPlan,
} from '../short-native-cover.js';

import {
  type NativeShortMetadataWriteReadPhase,
  type NativeShortFixedReadKind,
} from '../short-native-metadata-api.js';

export function captureNativeShortCoverWriteRequest(
  input: unknown,
): NativeShortCoverWriteRequest | null {
  try {
    const value = fields(input, [
      'expectedSnapshotVersionHash',
      'hashBasis',
      'expectedState',
      'cover',
    ]);
    const cover = fields(value.cover, ['uploadPath', 'sha256', 'fit'], ['uploadPath', 'sha256']);
    if (
      typeof value.expectedSnapshotVersionHash !== 'string' ||
      !HASH.test(value.expectedSnapshotVersionHash) ||
      value.hashBasis !== NATIVE_SHORT_HASH_BASES.snapshot ||
      value.expectedState !== 'draft' ||
      typeof cover.uploadPath !== 'string' ||
      !UPLOAD_NAME.test(cover.uploadPath) ||
      typeof cover.sha256 !== 'string' ||
      !HASH.test(cover.sha256) ||
      (cover.fit !== undefined && cover.fit !== 'cover' && cover.fit !== 'contain')
    )
      return null;
    return freeze({
      expectedSnapshotVersionHash: value.expectedSnapshotVersionHash,
      hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
      expectedState: 'draft' as const,
      cover: {
        uploadPath: cover.uploadPath,
        sha256: cover.sha256,
        ...(cover.fit === undefined ? {} : { fit: cover.fit as 'cover' | 'contain' }),
      },
    });
  } catch {
    return null;
  }
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

export function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function copyRef(input: unknown): NativeShortCoverEvidenceRef {
  const value = fields(input, ['id', 'sha256', 'capturedAt']);
  if (
    typeof value.id !== 'string' ||
    !UUID.test(value.id) ||
    typeof value.sha256 !== 'string' ||
    !HASH.test(value.sha256) ||
    !time(value.capturedAt)
  )
    throw Error('Invalid cover reference');
  return { id: value.id, sha256: value.sha256, capturedAt: value.capturedAt };
}

export function sameData(input: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return input === expected;
  if (Array.isArray(expected)) return false;
  const value = fields(input, Object.keys(expected));
  return Object.keys(expected).every((key) =>
    sameData(value[key], (expected as Record<string, unknown>)[key]),
  );
}

export function copyCookies(input: Cookie[]): Cookie[] {
  const allowed = [
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
  return input
    .map((cookie) => {
      const value = fields(
        cookie,
        allowed,
        allowed.filter((key) => key !== 'partitionKey'),
      );
      if (!['fanqienovel.com', '.fanqienovel.com'].includes(value.domain as string)) return null;
      if (
        ['name', 'value', 'domain', 'path'].some((key) => typeof value[key] !== 'string') ||
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

/** One run, one RAM API client, two separately authorized attempts; no retries. */
export interface OwnedNativeShortCoverRunOwner {
  owner: OwnedNativeShortCoverRun;
  result: NativeShortCoverApiResult;
  options: NativeShortCoverApiOptions;
  businessRequest: NativeShortCoverWriteRequest | null;
  optionsValid: boolean;
  reason: NativeShortCoverApiReason | null;
  api: APIRequestContext | null;
  disposing: Promise<void> | null;
  pending: Set<Promise<unknown>>;
  imageAbortController: AbortController;
  brands: Map<string, WeakSet<object>>;
  minted: Set<string>;
  refs: Set<string>;
  receiptIdentity: {
    accountId: string;
    jobId: string;
    baseline: NativeShortCoverEvidenceRef;
  } | null;
  activeConfirmation: string | null;
  copiedBytes: Buffer<ArrayBufferLike> | null;
  timer: NodeJS.Timeout | undefined;
  started: boolean;
  borrowed: BrowserContext;
  workId: string;
  factory: Pick<APIRequest, 'newContext'>;
  preparer: (
    browser: import('playwright').Browser,
    uploadDir: string,
    reference: NativeShortCoverImageReference,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ) => Promise<{ asset: NativeShortCoverPreparedAsset; bytes: Buffer }>;
  track: <T>(promise: Promise<T>) => Promise<T>;
  stop: (reason?: NativeShortCoverApiReason) => void;
  disposalFailed: () => void;
  startDispose: () => void;
  check: () => void;
  fail: (reason: NativeShortCoverApiReason) => never;
  transport: (phase: NativeShortCoverPhase) => NativeShortCoverTransport;
  responseJson: (
    response: APIResponse,
    url: string,
    requireData?: boolean,
  ) => Promise<Record<string, unknown>>;
  json: (
    phase: NativeShortMetadataWriteReadPhase,
    kind: NativeShortFixedReadKind,
    index?: number,
  ) => Promise<Record<string, unknown>>;
  httpOptions: () => {
    maxRedirects: number;
    maxRetries: number;
    failOnStatusCode: boolean;
    timeout: number;
  };
  read: (phase: NativeShortMetadataWriteReadPhase) => Promise<NativeShortMetadataSnapshot>;
  confirm: (
    input: NativeShortCoverReceiptFields,
    phase: NativeShortCoverPhase,
    stage: NativeShortCoverReceiptStage,
    held: NativeShortCoverHeldIntent,
    observation?: NativeShortCoverAcknowledgement,
  ) => NativeShortCoverReceipt;
  callback: (
    phase: NativeShortCoverPhase,
    stage: NativeShortCoverReceiptStage,
    held: NativeShortCoverHeldIntent,
    observation?: NativeShortCoverAcknowledgement,
  ) => Promise<NativeShortCoverReceipt>;
  post: (
    phase: NativeShortCoverPhase,
    plan?: NativeShortCoverPlan,
  ) => Promise<Record<string, unknown>>;
  held: (
    phase: NativeShortCoverPhase,
    snapshot: NativeShortMetadataSnapshot,
    plan?: NativeShortCoverPlan,
  ) => NativeShortCoverHeldIntent;
  observation: (
    phase: NativeShortCoverPhase,
    plan: NativeShortCoverPlan,
    picUri: string | null,
    picUrl: string | null,
  ) => NativeShortCoverAcknowledgement;
  run: () => Promise<NativeShortCoverApiResult>;
}

export type OwnedNativeShortCoverRunOperations = Pick<
  OwnedNativeShortCoverRunOwner,
  | 'track'
  | 'stop'
  | 'disposalFailed'
  | 'startDispose'
  | 'check'
  | 'fail'
  | 'transport'
  | 'responseJson'
  | 'json'
  | 'httpOptions'
  | 'read'
  | 'confirm'
  | 'callback'
  | 'post'
  | 'held'
  | 'observation'
  | 'run'
>;
