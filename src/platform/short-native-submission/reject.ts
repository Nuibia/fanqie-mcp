import { createHash } from 'node:crypto';

import {
  type NativeShortMetadataSnapshot,
  createNativeShortMetadataSnapshot,
  type NativeShortBinding,
  NATIVE_SHORT_HASH_BASES,
} from '../short-native-metadata.js';

/** Pure data model. Owned observations and one-attempt authority belong to the outer transport/runtime. */
export const NATIVE_SHORT_SUBMISSION_SCOPE = 'short-native-submission/v1' as const;

export const NATIVE_SHORT_SUBMISSION_TTL_MS = 300_000;

const BASE =
  'https://lf-serial-static.fanqienovel.com/obj/novel-serial-cdn/toutiao/muye/main/static/js/';

export const NATIVE_SHORT_SUBMISSION_SOURCE_PINS = Object.freeze({
  writer: Object.freeze({ url: 'https://fanqienovel.com/main/writer/' }),
  main: Object.freeze({
    url: `${BASE}main.c1caeb5e.js`,
    sha256: 'dc1e913c4b9605a7972d685434d2648a3ad3e2b355b67d666ecf60ce9d009b5d',
  }),
  publishShort: Object.freeze({
    url: `${BASE}async/PublishShort.4c89ddd6.js`,
    sha256: '1d4eaa19df6293a4a2b872632c9c0bbe2322ce62248952bb5a694e8fb436ec46',
  }),
  asyncMain: Object.freeze({
    url: `${BASE}async/async-main.93c6ad0a.js`,
    sha256: '7e330598a0c6b896907d72f72661e98a8365d5c11fbf2ba1767ccbc75aa10643',
  }),
});

export const NATIVE_SHORT_SUBMISSION_TERMS_HASH =
  '705410ad47f05d008278604077f58f8ecdbbcd537194fb3a5b4564b01c9b0887';

export const TERM_SLICE_HASH = 'ca05f142684bdb3d8833c89bb3d18f49017fd16a4ac4b1a341a709b09fdf096c';

export const TERMS_START = 192356,
  TERMS_END = 202397;

export const REQUEST_URL =
  'https://fanqienovel.com/api/author/short_article/publish/v0/?aid=2503&app_name=muye_novel';

export const CONTENT_TYPE = 'application/x-www-form-urlencoded;charset=UTF-8';

export const UNKNOWN_VALIDATION = Object.freeze({
  titleCount: 'unknown',
  validateThreshold: 'unknown',
  checkPre: 'not_called_get_only',
} as const);

export const VALIDATION = Object.freeze({
  ...UNKNOWN_VALIDATION,
  trial: 'supported-native-schema',
  clientFullGate: 'not_proven',
} as const);

export const FORM_KEYS = [
  'content',
  'item_id',
  'multi_title',
  'thumb_uri',
  'book_thumb_uri',
  'category',
  'sign_type',
  'activity_flag',
  'story_origin_divided_chapters',
  'use_ai',
] as const;

const HASH = /^[a-f0-9]{64}$/;

export const BAD_UNICODE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

export class NativeShortSubmissionError extends Error {
  constructor(readonly code: string) {
    super(`Native short submission rejected: ${code}`);
  }
}

export function reject(code: string): never {
  throw new NativeShortSubmissionError(code);
}

export function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Descriptor capture before any spread, property access, stringify or iteration of caller data. */
export function capture(input: unknown): unknown {
  let nodes = 0,
    chars = 0;
  const active = new Set<object>();
  function copy(value: unknown, depth: number): unknown {
    if (++nodes > 800_000 || depth > 64) reject('json_resource_limit');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (BAD_UNICODE.test(value)) reject('invalid_unicode');
      chars += Buffer.byteLength(value, 'utf8');
      if (chars > 32 * 1024 * 1024) reject('json_resource_limit');
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Object.is(value, -0)) reject('invalid_number');
      return value;
    }
    if (!value || typeof value !== 'object') reject('json_invalid_value');
    if (active.has(value)) reject('json_cycle');
    const array = Array.isArray(value),
      proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
      reject('json_non_plain');
    if (Object.getOwnPropertySymbols(value).length) reject('json_symbol_key');
    const ds = Object.getOwnPropertyDescriptors(value),
      keys = Object.keys(ds).filter((k) => !array || k !== 'length');
    for (const key of keys) {
      chars += Buffer.byteLength(key, 'utf8');
      if (chars > 32 * 1024 * 1024) reject('json_resource_limit');
    }
    if (
      keys.some((k) => BAD_UNICODE.test(k) || !ds[k]!.enumerable || !Object.hasOwn(ds[k]!, 'value'))
    )
      reject('json_non_data_property');
    if (
      array &&
      (!Number.isSafeInteger(ds.length?.value) ||
        keys.length !== ds.length!.value ||
        keys.some((k, i) => k !== String(i)))
    )
      reject('json_array_shape');
    active.add(value);
    const out: unknown[] | Record<string, unknown> = array ? [] : Object.create(null);
    for (const k of keys) {
      const child = copy(ds[k]!.value, depth + 1);
      if (array) (out as unknown[]).push(child);
      else (out as Record<string, unknown>)[k] = child;
    }
    active.delete(value);
    return out;
  }
  return copy(input, 0);
}

export function object(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject('object_shape');
  const result = value as Record<string, unknown>;
  if (
    keys &&
    (Object.keys(result).length !== keys.length || keys.some((k) => !Object.hasOwn(result, k)))
  )
    reject('object_shape');
  return result;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const text = JSON.stringify(value);
    if (typeof text !== 'string') reject('json_invalid_value');
    return text;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`)
    .join(',')}}`;
}

export function hash(value: unknown): string {
  return sha(canonical(value));
}

export function time(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    reject('time_invalid');
  return value;
}

export function fresh(observedAt: string, now: string): void {
  const age = Date.parse(now) - Date.parse(observedAt);
  if (age < 0 || age > NATIVE_SHORT_SUBMISSION_TTL_MS) reject('source_observation_stale');
}

export function string(value: unknown): string {
  if (typeof value !== 'string') reject('string_invalid');
  return value;
}

export function exactHash(value: unknown): string {
  if (typeof value !== 'string' || !HASH.test(value)) reject('hash_invalid');
  return value;
}

export function same(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

export function checkedSnapshot(input: unknown): NativeShortMetadataSnapshot {
  const value = object(capture(input));
  let rebuilt: NativeShortMetadataSnapshot;
  try {
    rebuilt = createNativeShortMetadataSnapshot({
      binding: value.binding as NativeShortBinding,
      editData: value.editData,
      categoryData: value.categoryData,
    });
  } catch {
    reject('snapshot_invalid');
  }
  if (!same(value, rebuilt)) reject('snapshot_hash_mismatch');
  return rebuilt;
}

export interface NativeShortSubmissionWriteRequest {
  readonly expectedSnapshotVersionHash: string;
  readonly hashBasis: typeof NATIVE_SHORT_HASH_BASES.snapshot;
  readonly expectedState: 'draft';
  readonly useAi: 1 | 2;
}

export interface NativeShortSubmissionBusinessInput extends NativeShortSubmissionWriteRequest {
  readonly target: { readonly kind: 'short'; readonly workId: string };
  readonly snapshotScope: typeof NATIVE_SHORT_SUBMISSION_SCOPE;
}

function request(raw: Record<string, unknown>): NativeShortSubmissionWriteRequest {
  if (
    raw.hashBasis !== NATIVE_SHORT_HASH_BASES.snapshot ||
    raw.expectedState !== 'draft' ||
    ![1, 2].includes(raw.useAi as number)
  )
    reject('request_binding');
  return freeze({
    expectedSnapshotVersionHash: exactHash(raw.expectedSnapshotVersionHash),
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedState: 'draft',
    useAi: raw.useAi as 1 | 2,
  });
}

export function validateNativeShortSubmissionWriteRequest(
  input: unknown,
): NativeShortSubmissionWriteRequest {
  return request(
    object(capture(input), ['expectedSnapshotVersionHash', 'hashBasis', 'expectedState', 'useAi']),
  );
}

export function validateNativeShortSubmissionBusinessInput(
  input: unknown,
): NativeShortSubmissionBusinessInput {
  const raw = object(capture(input), [
    'expectedSnapshotVersionHash',
    'hashBasis',
    'expectedState',
    'useAi',
    'target',
    'snapshotScope',
  ]);
  const target = object(raw.target, ['kind', 'workId']);
  if (
    target.kind !== 'short' ||
    typeof target.workId !== 'string' ||
    !/^[1-9][0-9]{9,21}$/.test(target.workId) ||
    raw.snapshotScope !== NATIVE_SHORT_SUBMISSION_SCOPE
  )
    reject('business_binding');
  return freeze({
    ...request(raw),
    target: { kind: 'short', workId: target.workId },
    snapshotScope: NATIVE_SHORT_SUBMISSION_SCOPE,
  });
}

export function nativeShortSubmissionWriteRequest(
  input: NativeShortSubmissionBusinessInput,
): NativeShortSubmissionWriteRequest {
  const business = validateNativeShortSubmissionBusinessInput(input);
  return validateNativeShortSubmissionWriteRequest({
    expectedSnapshotVersionHash: business.expectedSnapshotVersionHash,
    hashBasis: business.hashBasis,
    expectedState: business.expectedState,
    useAi: business.useAi,
  });
}

export function nativeShortSubmissionBusinessInputHash(
  input: NativeShortSubmissionBusinessInput,
): string {
  return hash({
    basis: 'native-short-submission-business/v1',
    business: validateNativeShortSubmissionBusinessInput(input),
  });
}

export interface NativeShortSubmissionSourceDocument {
  readonly url: string;
  readonly body: string;
  readonly observedAt: string;
}
