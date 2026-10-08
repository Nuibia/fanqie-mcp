import { NATIVE_SHORT_COVER_SCOPE } from '../short-native-cover.js';

import {
  NATIVE_SHORT_HASH_BASES,
  type NativeShortMetadataSnapshot,
  type LegacyNativeShortMetadataSnapshot,
} from '../short-native-metadata.js';

import {
  type NativeShortCoverWriteRequest,
  type NativeShortCoverPhase,
  type NativeShortCoverHeldIntent,
  type NativeShortCoverApiResult,
  captureNativeShortCoverWriteRequest,
} from '../short-native-cover-api.js';

import {
  type Job,
  type Manifest,
  type EvidenceRef,
  type EvidenceDocument,
  canonicalJson,
} from '../../runtime/store.js';

import { createHash } from 'node:crypto';

import {
  isCanonicalNativeTime,
  type NativeShortProvenance,
} from '../short-native-metadata-proof.js';

export const NATIVE_SHORT_COVER_OPERATION = 'update_short_cover' as const;

export const nativeShortCoverScope = (workId: string): string => `short_native_cover.${workId}`;

export const NATIVE_SHORT_COVER_DATASETS = Object.freeze({
  baseline: 'short_native_cover_baseline',
  uploadIntent: 'write-intent',
  uploadAttempt: 'short_native_cover_upload_attempt',
  uploadAck: 'short_native_cover_upload_ack',
  preSave: 'short_native_cover_pre_save',
  saveIntent: 'write-intent',
  saveAttempt: 'short_native_cover_save_attempt',
  saveAck: 'short_native_cover_save_ack',
  after: 'short_native_cover_after',
  result: 'write-result',
  reconciliation: 'reconciliation',
});

export type NativeShortCoverStage = Exclude<
  keyof typeof NATIVE_SHORT_COVER_DATASETS,
  'reconciliation'
>;

export interface NativeShortCoverBusinessInput {
  target: { kind: 'short'; workId: string };
  snapshotScope: typeof NATIVE_SHORT_COVER_SCOPE;
  hashBasis: typeof NATIVE_SHORT_HASH_BASES.snapshot;
  expectedSnapshotVersionHash: string;
  expectedState: 'draft';
  cover: NativeShortCoverWriteRequest['cover'];
}

export interface NativeShortCoverAttemptRow {
  jobId: string;
  accountId: string;
  phase: NativeShortCoverPhase;
  ordinal: 1;
  evidence: { id: string; sha256: string; capturedAt: string };
  eventAt: string;
}

export interface NativeShortCoverEvidenceContext {
  accountId: string;
  job: Job;
  manifest: Manifest | null;
  refs: EvidenceRef[];
  documents: EvidenceDocument[];
  attempts: NativeShortCoverAttemptRow[];
}

export type NativeShortCoverContext = NativeShortCoverEvidenceContext;

export interface NativeShortCoverWriteResultEvidence {
  schema: 'native-short-cover-write-result/v1';
  scope: typeof NATIVE_SHORT_COVER_SCOPE;
  baselineEvidence: NativeShortCoverAttemptRow['evidence'];
  afterEvidence: NativeShortCoverAttemptRow['evidence'];
  business: Record<string, unknown>;
}

export interface NativeShortCoverProjection {
  validated: boolean;
  result: NativeShortCoverWriteResultEvidence | Record<string, unknown> | null;
  evidence: Record<string, unknown>[];
  data: Record<string, unknown>[];
  collectionMode: 'live' | 'fixture' | null;
}

export class NativeShortCoverProofError extends Error {
  constructor() {
    super('Native short cover did not meet the fixed evidence contract');
  }
}

export type Data = Record<string, any>;

export type AuditSnapshot = NativeShortMetadataSnapshot | LegacyNativeShortMetadataSnapshot;

export type AuditHeld = Omit<NativeShortCoverHeldIntent, 'snapshot'> & {
  readonly snapshot: AuditSnapshot;
};

type AuditPhase = Omit<NativeShortCoverApiResult['upload'], 'held'> & { held: AuditHeld | null };

export type AuditResult = Omit<
  NativeShortCoverApiResult,
  'snapshot' | 'snapshots' | 'upload' | 'save'
> & {
  snapshot: AuditSnapshot | null;
  snapshots: {
    before: AuditSnapshot | null;
    preSave: AuditSnapshot | null;
    after: AuditSnapshot | null;
  };
  upload: AuditPhase;
  save: AuditPhase;
};

export const WORK = /^[1-9][0-9]{9,21}$/,
  UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
  HASH = /^[a-f0-9]{64}$/;

export const STAGES: NativeShortCoverStage[] = [
  'baseline',
  'uploadIntent',
  'uploadAttempt',
  'uploadAck',
  'preSave',
  'saveIntent',
  'saveAttempt',
  'saveAck',
  'after',
  'result',
];

export const ORIGIN = 'https://fanqienovel.com',
  UPLOAD_URL = `${ORIGIN}/api/author/data/upload_pic_v1/v0?aid=2503&aid=2503&app_name=muye_novel`;

export function fail(): never {
  throw new NativeShortCoverProofError();
}

export const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

export const hash = (a: unknown) => createHash('sha256').update(canonicalJson(a)).digest('hex');

export const bytesHash = (a: string) => createHash('sha256').update(a).digest('hex');

export const refLink = (ref: EvidenceRef) => ({
  id: ref.id,
  sha256: ref.sha256,
  capturedAt: ref.capturedAt,
});

export function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Every caller value is copied through descriptors; no getter, coercion or toJSON is evaluated. */
export function copy(input: unknown, limit = 16 * 1024 * 1024): any {
  let nodes = 0,
    size = 0;
  const active = new Set<object>();
  function visit(value: unknown, depth: number): unknown {
    if (++nodes > 1_500_000 || depth > 80) fail();
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Object.is(value, -0)) fail();
      return value;
    }
    if (typeof value === 'string') {
      if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value))
        fail();
      size += Buffer.byteLength(value);
      if (size > limit) fail();
      return value;
    }
    if (!value || typeof value !== 'object' || active.has(value)) fail();
    const array = Array.isArray(value),
      proto = Object.getPrototypeOf(value);
    if (
      (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) ||
      Object.getOwnPropertySymbols(value).length
    )
      fail();
    const descriptors = Object.getOwnPropertyDescriptors(value),
      keys = Object.keys(descriptors).filter((key) => !array || key !== 'length');
    if (
      keys.some(
        (key) => !Object.hasOwn(descriptors[key]!, 'value') || !descriptors[key]!.enumerable,
      ) ||
      (array &&
        (keys.length !== descriptors.length!.value || keys.some((key, i) => key !== String(i))))
    )
      fail();
    active.add(value);
    const out: any = array ? [] : Object.create(null);
    for (const key of keys) {
      size += Buffer.byteLength(key);
      if (size > limit) fail();
      out[key] = visit(descriptors[key]!.value, depth + 1);
    }
    active.delete(value);
    return out;
  }
  try {
    const out = visit(input, 0);
    if (Buffer.byteLength(JSON.stringify(out)) > limit) fail();
    return out;
  } catch {
    fail();
  }
}

export function object(value: unknown): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Data;
}

export function exact(value: unknown, keys: readonly string[]): Data {
  const data = object(value);
  if (
    Object.keys(data).length !== keys.length ||
    Object.keys(data).some((key) => !keys.includes(key))
  )
    fail();
  return data;
}

export function time(value: unknown): string {
  if (!isCanonicalNativeTime(value) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    fail();
  return value;
}

export function order(values: unknown[]): void {
  let prior = '';
  for (const value of values) {
    const next = time(value);
    if (next < prior) fail();
    prior = next;
  }
}

export function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) fail();
  return value;
}

export function provenance(value: unknown): NativeShortProvenance {
  const p = exact(value, ['executor', 'mode']);
  if (
    !['live', 'fixture'].includes(p.mode) ||
    p.executor !==
      (p.mode === 'live' ? 'application-default-browser/v1' : 'dependency-injected-browser/v1')
  )
    fail();
  return p as NativeShortProvenance;
}

export function validateNativeShortCoverBusinessInput(
  input: unknown,
): NativeShortCoverBusinessInput {
  const d = exact(copy(input, 16_384), [
      'target',
      'snapshotScope',
      'hashBasis',
      'expectedSnapshotVersionHash',
      'expectedState',
      'cover',
    ]),
    target = exact(d.target, ['kind', 'workId']);
  if (
    target.kind !== 'short' ||
    typeof target.workId !== 'string' ||
    !WORK.test(target.workId) ||
    d.snapshotScope !== NATIVE_SHORT_COVER_SCOPE
  )
    fail();
  const request = captureNativeShortCoverWriteRequest({
    expectedSnapshotVersionHash: d.expectedSnapshotVersionHash,
    hashBasis: d.hashBasis,
    expectedState: d.expectedState,
    cover: d.cover,
  });
  if (!request) fail();
  return freeze<NativeShortCoverBusinessInput>({
    target: { kind: 'short', workId: target.workId },
    snapshotScope: NATIVE_SHORT_COVER_SCOPE,
    ...request,
  });
}

export const nativeShortCoverBusinessInputHash = (input: NativeShortCoverBusinessInput): string =>
  hash(validateNativeShortCoverBusinessInput(input));

export function nativeShortCoverWriteRequest(
  input: NativeShortCoverBusinessInput,
): NativeShortCoverWriteRequest {
  const {
    target: _target,
    snapshotScope: _scope,
    ...request
  } = validateNativeShortCoverBusinessInput(input);
  return freeze(request);
}
