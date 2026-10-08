import {
  type NativeShortMetadataApiResult,
  object,
  unavailableNativeShortMetadataApi,
} from './unavailable-native-short-metadata-api.js';

import { shortMetadataApiListUrl } from '../short-metadata-api-schema.js';

import {
  nativeShortMetadataEndpoints,
  type NativeShortMetadataSnapshot,
  createNativeShortMetadataSnapshot,
  type NativeShortMetadataRequest,
  type NativeShortMetadataExpectation,
  type NativeShortMetadataExpectationV2,
  type NativeShortMetadataComparison,
  type NativeShortMetadataComparisonV2,
} from '../short-native-metadata.js';

export const ORIGIN = 'https://fanqienovel.com';

const OWN = `${ORIGIN}/api/user/info/v2`;

export const ACCOUNT = /^[0-9]{1,30}$/;

export const WORK = /^[1-9][0-9]{9,21}$/;

export const NATIVE_SHORT_API_REASONS = [
  'context_unavailable',
  'identity_unverified',
  'owner_changed',
  'source_changed',
  'redirect_blocked',
  'response_unverified',
  'response_unavailable',
  'bounded_unavailable',
  'pagination_inconsistent',
  'target_unverified',
  'unsupported_schema',
  'cancelled',
  'timeout',
  'cleanup_failed',
  'lease_unavailable',
  'callback_failed',
] as const;

export type NativeShortApiReason = (typeof NATIVE_SHORT_API_REASONS)[number];

export type NativeShortFixedReadKind = 'own' | 'list' | 'edit' | 'catalog';

export type RequestKind = NativeShortFixedReadKind;

export interface NativeShortMetadataApiOptions {
  mode: 'read';
  expectedOwner: { kind: 'account'; id: string };
  deadline: number;
  signal?: AbortSignal;
  assertLease(): void;
  assertBorrowedActive(): void;
  onBeforePlatformRead(): void;
  onVerifiedAccount(accountId: string, checkedAt: string): void;
  onQuarantine(): void;
}

export type NativeShortMetadataWriteReason =
  NativeShortApiReason | 'version_conflict' | 'durability_unverified' | 'readback_mismatch';

export interface NativeShortMetadataWriteReadPhase {
  proof: Omit<NativeShortMetadataApiResult['proof'], 'ownerCallback'>;
  requests: NativeShortMetadataApiResult['requests'];
  list: NativeShortMetadataApiResult['list'];
}

/** Closed endpoint resolver: a read kind can never supply an arbitrary URL. */
export function nativeShortMetadataFixedReadUrl(
  workId: string,
  kind: NativeShortFixedReadKind,
  listIndex?: number,
): string {
  if (typeof workId !== 'string' || !WORK.test(workId))
    throw Error('Invalid fixed native metadata read target');
  if (kind === 'list') return shortMetadataApiListUrl(listIndex === undefined ? 0 : listIndex);
  if (listIndex !== undefined) throw Error('Invalid fixed native metadata read index');
  if (kind === 'own') return OWN;
  const endpoints = nativeShortMetadataEndpoints(workId);
  if (kind === 'edit') return endpoints.edit;
  if (kind === 'catalog') return endpoints.catalog;
  throw Error('Invalid fixed native metadata read kind');
}

/** Complete fixed GET semantics; callers retain transport, counters, lifecycle and final owner callback. */
export async function readNativeShortMetadataFixedSnapshot(options: {
  workId: string;
  expectedOwner: { kind: 'account'; id: string };
  phase: NativeShortMetadataWriteReadPhase;
  check(): void;
  fail(reason: NativeShortApiReason): never;
  json(kind: NativeShortFixedReadKind, listIndex?: number): Promise<Record<string, unknown>>;
  captureReadProof?: boolean;
}): Promise<NativeShortMetadataSnapshot> {
  const workId = options.workId,
    expectedOwner = { ...options.expectedOwner },
    phase = options.phase;
  if (
    typeof workId !== 'string' ||
    !WORK.test(workId) ||
    expectedOwner.kind !== 'account' ||
    typeof expectedOwner.id !== 'string' ||
    !ACCOUNT.test(expectedOwner.id)
  )
    options.fail('identity_unverified');
  async function own(which: 'ownerBefore' | 'ownerAfter'): Promise<void> {
    const data = await options.json('own');
    options.check();
    if (typeof data.id !== 'string' || !ACCOUNT.test(data.id)) options.fail('identity_unverified');
    if (data.id !== expectedOwner.id) options.fail('owner_changed');
    phase.proof[which] = true;
  }
  await own('ownerBefore');
  const ids = new Set<string>();
  let total: number | null = null;
  for (let index = 0; index === 0 || index < Math.ceil(total! / 10); index++) {
    const data = await options.json('list', index);
    options.check();
    if (
      typeof data.total_count !== 'number' ||
      !Number.isSafeInteger(data.total_count) ||
      data.total_count < 0 ||
      !Array.isArray(data.item_list)
    )
      options.fail('response_unverified');
    if (data.total_count > 100) options.fail('bounded_unavailable');
    if (total === null) {
      total = data.total_count;
      phase.list.totalCount = total;
    }
    if (data.total_count !== total || data.item_list.length !== Math.min(10, total - index * 10))
      options.fail('pagination_inconsistent');
    for (const value of data.item_list) {
      const row = object(value);
      if (!row || typeof row.item_id !== 'string' || !WORK.test(row.item_id))
        options.fail('response_unverified');
      if (ids.has(row.item_id)) options.fail('pagination_inconsistent');
      ids.add(row.item_id);
    }
    phase.list.pagesRead++;
    phase.list.rowsRead += data.item_list.length;
  }
  if (ids.size !== total) options.fail('pagination_inconsistent');
  phase.proof.paginationComplete = true;
  if (!ids.has(workId)) options.fail('target_unverified');
  phase.proof.targetUnique = true;
  const editData = await options.json('edit');
  options.check();
  const categoryData = await options.json('catalog');
  options.check();
  await own('ownerAfter');
  options.check();
  let snapshot: NativeShortMetadataSnapshot;
  try {
    snapshot = createNativeShortMetadataSnapshot({
      binding: {
        account: { kind: 'account_id', id: expectedOwner.id },
        work: { kind: 'short', id: workId },
      },
      editData,
      categoryData,
    });
  } catch {
    options.fail('unsupported_schema');
  }
  phase.proof.fixedSourceVerified = true;
  phase.proof.readFinishedAt = new Date().toISOString();
  if (options.captureReadProof === true) phase.proof.proofCapturedAt = phase.proof.readFinishedAt;
  return snapshot;
}

export interface NativeShortMetadataHeldBeforeV1 {
  schema: 'native-short-metadata-held-before/v1';
  phase: 'held-for-write';
  snapshot: NativeShortMetadataSnapshot;
  businessRequest: NativeShortMetadataRequest;
  expectation: NativeShortMetadataExpectation;
  desiredContentHash: string;
  read: NativeShortMetadataWriteReadPhase;
  cleanup: NativeShortMetadataApiResult['cleanup'];
}

export interface NativeShortMetadataHeldBeforeV2 extends Omit<
  NativeShortMetadataHeldBeforeV1,
  'schema' | 'expectation'
> {
  schema: 'native-short-metadata-held-before/v2';
  expectation: NativeShortMetadataExpectationV2;
}

export type NativeShortMetadataHeldBefore =
  NativeShortMetadataHeldBeforeV1 | NativeShortMetadataHeldBeforeV2;

export interface NativeShortMetadataDurableReceiptFields {
  accountId: string;
  jobId: string;
  baseline: { id: string; sha256: string; capturedAt: string };
  intent: { id: string; sha256: string; capturedAt: string };
  target: { kind: 'short-story'; id: string };
  expectedSnapshotVersionHash: string;
  desiredContentHash: string;
}

export interface NativeShortMetadataDurableReceiptV1 extends NativeShortMetadataDurableReceiptFields {
  schema: 'native-short-metadata-durable-receipt/v1';
}

export interface NativeShortMetadataDurableReceiptV2 extends NativeShortMetadataDurableReceiptFields {
  schema: 'native-short-metadata-durable-receipt/v2';
}

export type NativeShortMetadataDurableReceipt =
  NativeShortMetadataDurableReceiptV1 | NativeShortMetadataDurableReceiptV2;

export interface NativeShortMetadataApiWriteOptions {
  mode: 'write';
  businessRequest: NativeShortMetadataRequest;
  expectedOwner: NativeShortMetadataApiOptions['expectedOwner'];
  deadline: number;
  signal?: AbortSignal;
  assertLease(): void;
  assertBorrowedActive(): void;
  onBeforePlatformRead(): void;
  onDurableBeforeWrite(
    held: NativeShortMetadataHeldBefore,
    confirmDurable: (
      fields: NativeShortMetadataDurableReceiptFields,
    ) => NativeShortMetadataDurableReceipt,
  ): NativeShortMetadataDurableReceipt | Promise<NativeShortMetadataDurableReceipt>;
  onBeforePlatformWrite(receipt: NativeShortMetadataDurableReceipt): string | Promise<string>;
  onVerifiedAccount(accountId: string, checkedAt: string): void | Promise<void>;
  onQuarantine(): void;
}

/** Private write result; it never represents the literal C1 closed read contract. */
export interface NativeShortMetadataApiWriteResultV1 {
  schema: 'native-short-metadata-api-write/v1';
  status: 'success' | 'capability_unavailable';
  reason: NativeShortMetadataWriteReason | null;
  held: NativeShortMetadataHeldBeforeV1 | null;
  receipt: NativeShortMetadataDurableReceiptV1 | null;
  snapshot: NativeShortMetadataSnapshot | null;
  comparison: NativeShortMetadataComparison | null;
  desiredContentHash: string | null;
  observedContentHash: string | null;
  phases: { before: NativeShortMetadataWriteReadPhase; after: NativeShortMetadataWriteReadPhase };
  post: {
    attempts: number;
    disposed: number;
    markedAt: string | null;
    startedAt: string | null;
    acknowledgedAt: string | null;
    acknowledged: boolean;
  };
  proof: {
    platformStarted: boolean;
    writeMarked: boolean;
    ownerCallback: boolean;
    atomicRevision: false;
    proofCapturedAt: string | null;
  };
  cleanup: NativeShortMetadataApiResult['cleanup'];
}

export interface NativeShortMetadataApiWriteResultV2 extends Omit<
  NativeShortMetadataApiWriteResultV1,
  'schema' | 'held' | 'receipt' | 'comparison'
> {
  schema: 'native-short-metadata-api-write/v2';
  held: NativeShortMetadataHeldBeforeV2 | null;
  receipt: NativeShortMetadataDurableReceiptV2 | null;
  comparison: NativeShortMetadataComparisonV2 | null;
}

export type NativeShortMetadataApiWriteResult =
  NativeShortMetadataApiWriteResultV1 | NativeShortMetadataApiWriteResultV2;

export function writeReadPhase(): NativeShortMetadataWriteReadPhase {
  const result = unavailableNativeShortMetadataApi('response_unavailable');
  const { ownerCallback: _unused, ...proof } = result.proof;
  return { proof, requests: result.requests, list: result.list };
}
