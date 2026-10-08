import {
  BODY_WORK,
  BODY_UUID,
  BODY_ACCOUNT,
  type BodyReadPhase,
  type NativeShortBodyTransport,
  type NativeShortBodyStageEvidence,
  BODY_STAGE_KEYS,
  BODY_KINDS,
  BODY_PAYLOAD_KEYS,
} from './native-short-body-attempt-row.js';

import {
  fail,
  time,
  count,
  exact,
  digest,
  type Json,
  same,
  copy,
  MIB,
  freeze,
  type Data,
} from './fail.js';

import {
  type NativeShortBodySource,
  type NativeShortBodyRefLink,
  NATIVE_SHORT_BODY_OPERATION,
  NATIVE_SHORT_BODY_RECONCILE_OPERATION,
  type NativeShortBodyStageKind,
} from './inspect.js';

import { type EvidenceRef } from '../../runtime/store.js';

import { type Cleanup, cleanup, assertModernStage } from './same-mode.js';

import { nativeShortMetadataEndpoints } from '../short-native-metadata.js';

import { NATIVE_SHORT_BODY_SCOPE } from '../short-native-body.js';

export const BODY_JOB_KEYS = [
  'id',
  'accountId',
  'ownerId',
  'kind',
  'operation',
  'scope',
  'datasets',
  'idempotencyKey',
  'inputHash',
  'status',
  'requestedAt',
  'startedAt',
  'platformReadStartedAt',
  'platformWriteStartedAt',
  'endedAt',
  'updatedAt',
  'result',
  'error',
  'target',
  'metadata',
  'timeoutMs',
  'deadlineAt',
  'cancellationRequestedAt',
  'cancellationReason',
] as const;

export const BODY_MANIFEST_KEYS = [
  'schemaVersion',
  'id',
  'accountId',
  'jobId',
  'operation',
  'scope',
  'datasets',
  'requestedAt',
  'platformReadStartedAt',
  'committedAt',
  'evidence',
] as const;

export const BODY_RESULT_LINKS = [
  'baseline',
  'preSave',
  'intent',
  'attempt',
  'acknowledgement',
  'after',
] as const;

export const BODY_SETTLEMENT_REASONS = [
  'match',
  'not_applied',
  'partial_read',
  'readback_mismatch',
  'reconciliation_not_live',
] as const;

export function nativeShortBodyScope(workId: string): string {
  if (typeof workId !== 'string' || !BODY_WORK.test(workId)) fail('invalid_shape');
  return `short_native_body.${workId}`;
}

export function nativeShortBodyReconciliationScope(originalJobId: string): string {
  uuid(originalJobId);
  return `short_native_body_reconciliation.${originalJobId}`;
}

export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !BODY_UUID.test(value)) fail('invalid_shape');
  return value;
}

export function account(value: unknown): string {
  if (typeof value !== 'string' || !BODY_ACCOUNT.test(value)) fail('invalid_shape');
  return value;
}

export function durableTime(value: unknown): string {
  const stamp = time(value);
  if (stamp > new Date().toISOString()) fail('invalid_trace');
  return stamp;
}

export function ordered(values: readonly unknown[]): void {
  let prior = '';
  for (const value of values) {
    const next = durableTime(value);
    if (next < prior) fail('invalid_trace');
    prior = next;
  }
}

export function boundedCount(value: unknown, max: number): number {
  const n = count(value);
  if (n > max) fail('invalid_trace');
  return n;
}

export function source(input: unknown): NativeShortBodySource {
  const d = exact(input, ['mode', 'executor']);
  if (
    (d.mode !== 'live' && d.mode !== 'fixture') ||
    d.executor !==
      (d.mode === 'live' ? 'default-body-owned-api/v1' : 'sqlite-owned-body-fixture/v1')
  )
    fail('source_mismatch');
  return d as unknown as NativeShortBodySource;
}

export function link(input: unknown): NativeShortBodyRefLink {
  const d = exact(input, ['id', 'sha256', 'capturedAt']);
  uuid(d.id);
  digest(d.sha256);
  durableTime(d.capturedAt);
  return d as unknown as NativeShortBodyRefLink;
}

export const bodyRefLink = (ref: EvidenceRef): NativeShortBodyRefLink => ({
  id: ref.id,
  sha256: ref.sha256,
  capturedAt: ref.capturedAt,
});

/** Physical Store serialization deliberately rebuilds objects; strict body hashing above emits keys. */
export function physicalCanonical(value: Json): string {
  function orderedValue(item: Json): Json {
    if (item === null || typeof item !== 'object') return item;
    if (Array.isArray(item)) return item.map(orderedValue);
    return Object.fromEntries(
      Object.keys(item)
        .sort()
        .map((key) => [key, orderedValue(item[key]!)]),
    );
  }
  return JSON.stringify(orderedValue(value));
}

export function bodyRead(input: unknown, complete: boolean): BodyReadPhase {
  const d = exact(input, ['proof', 'requests', 'list']),
    p = exact(d.proof, [
      'platformStarted',
      'ownerBefore',
      'ownerAfter',
      'fixedSourceVerified',
      'targetUnique',
      'paginationComplete',
      'atomicRevision',
      'readStartedAt',
      'readFinishedAt',
      'proofCapturedAt',
    ]);
  if (p.atomicRevision !== false) fail('invalid_trace');
  for (const key of [
    'platformStarted',
    'ownerBefore',
    'ownerAfter',
    'fixedSourceVerified',
    'targetUnique',
    'paginationComplete',
  ])
    if (typeof p[key] !== 'boolean' || (complete && p[key] !== true)) fail('invalid_trace');
  const dates = ['readStartedAt', 'readFinishedAt', 'proofCapturedAt'].map((key) => p[key]);
  for (const stamp of dates) if (stamp !== null || complete) durableTime(stamp);
  ordered(dates.filter((value) => value !== null));
  if (!p.platformStarted && dates.some((value) => value !== null)) fail('invalid_trace');
  const l = exact(d.list, ['pagesRead', 'rowsRead', 'totalCount']),
    pages = boundedCount(l.pagesRead, 10),
    rows = boundedCount(l.rowsRead, 100);
  if (l.totalCount !== null) boundedCount(l.totalCount, 100);
  if (complete && (rows < 1 || rows !== l.totalCount || pages !== Math.ceil(rows / 10)))
    fail('invalid_trace');
  const requests = exact(d.requests, ['own', 'list', 'edit', 'catalog']);
  for (const [key, max] of [
    ['own', 2],
    ['list', 10],
    ['edit', 1],
    ['catalog', 1],
  ] as const) {
    const c = exact(requests[key], ['attempts', 'disposed']),
      attempted = boundedCount(c.attempts, max),
      disposed = boundedCount(c.disposed, max);
    if (
      disposed > attempted ||
      (complete && (attempted !== (key === 'list' ? pages : max) || disposed !== attempted))
    )
      fail('invalid_trace');
  }
  return d as unknown as BodyReadPhase;
}

export function durableCleanup(input: unknown, at: string, prior: string | null): Cleanup {
  const c = cleanup(input, at, prior);
  durableTime(c.checkedAt);
  return c;
}

export function bodyTransport(input: unknown, workId: string): NativeShortBodyTransport {
  const d = exact(input, [
      'method',
      'url',
      'contentType',
      'maxRedirects',
      'maxRetries',
      'maxAttempts',
    ]),
    endpoint = nativeShortMetadataEndpoints(workId);
  if (
    !same(d, {
      method: 'POST',
      url: endpoint.save,
      contentType: endpoint.contentType,
      maxRedirects: 0,
      maxRetries: 0,
      maxAttempts: 1,
    })
  )
    fail('source_mismatch');
  return d as unknown as NativeShortBodyTransport;
}

export function hasReservedNativeShortBodySignal(input: unknown): boolean {
  const pending = [input],
    seen = new Set<object>();
  let nodes = 0;
  const reserved = (value: unknown) =>
    typeof value === 'string' &&
    (value.startsWith('native-short-body') ||
      value.startsWith('short-native-body/') ||
      value.startsWith('short_native_body') ||
      value === NATIVE_SHORT_BODY_OPERATION ||
      value === NATIVE_SHORT_BODY_RECONCILE_OPERATION);
  try {
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      if (++nodes > 200_000) return true;
      seen.add(value);
      for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (
          ['schema', 'scope', 'snapshotScope', 'operation', 'dataset', 'datasets'].includes(key) &&
          !Object.hasOwn(d, 'value')
        )
          return true;
        if (!Object.hasOwn(d, 'value')) continue;
        const child: unknown = d.value;
        if (
          ['schema', 'scope', 'snapshotScope', 'operation', 'dataset', 'datasets'].includes(key) &&
          (reserved(child) ||
            (Array.isArray(child) &&
              Object.values(Object.getOwnPropertyDescriptors(child)).some(
                (v) => Object.hasOwn(v, 'value') && reserved(v.value),
              )))
        )
          return true;
        if (child && typeof child === 'object') pending.push(child);
      }
    }
    return false;
  } catch {
    return true;
  }
}

export function capturedBodyStage(input: unknown): NativeShortBodyStageEvidence {
  const d = exact(copy(input, 16 * MIB), BODY_STAGE_KEYS);
  if (
    d.schema !== 'native-short-body-stage/v1' ||
    d.scope !== NATIVE_SHORT_BODY_SCOPE ||
    typeof d.kind !== 'string' ||
    !BODY_KINDS.includes(d.kind as NativeShortBodyStageKind)
  )
    fail('invalid_shape');
  const kind = d.kind as NativeShortBodyStageKind;
  account(d.accountId);
  uuid(d.jobId);
  digest(d.inputHash);
  durableTime(d.eventAt);
  const sequence = boundedCount(d.sequence, 7);
  if (!sequence) fail('invalid_trace');
  if (d.priorStageHash !== null) digest(d.priorStageHash);
  exact(d.payload, BODY_PAYLOAD_KEYS[kind]);
  if (
    kind === 'intent' &&
    Buffer.byteLength(physicalCanonical(d as unknown as Json) + '\n', 'utf8') > 16384
  )
    fail('resource_limit');
  return freeze(d as unknown as NativeShortBodyStageEvidence);
}

export function createNativeShortBodyStageEvidence(input: unknown): NativeShortBodyStageEvidence {
  const stage = capturedBodyStage(input);
  assertModernStage(stage.kind, stage.payload as Data);
  return stage;
}
