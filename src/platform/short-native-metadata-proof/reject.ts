import {
  NATIVE_SHORT_METADATA_SCOPE,
  type NativeShortMetadataSnapshot,
  type LegacyNativeShortMetadataSnapshot,
  NATIVE_SHORT_RESOURCE_LIMITS,
} from '../short-native-metadata.js';

import {
  type NativeShortMetadataApiResult,
  type NativeShortMetadataHeldBefore,
} from '../short-native-metadata-api.js';

import {
  type NativeShortBaselineEvidence,
  type NativeShortCleanAfterEvidence,
} from './validate-native-short-write-business-input.js';

import { type NativeShortReconciliationEvidence } from './safe-native-short-write-job.js';

import { canonicalJson } from '../../runtime/store.js';

import { createHash } from 'node:crypto';

export const NATIVE_SHORT_READ_OPERATION = 'native_short_metadata_snapshot';

export const NATIVE_SHORT_READ_DATASET = 'short_native_metadata';

export const NATIVE_SHORT_READ_SCHEMA = 'fanqie-short-native-metadata-read-evidence/v1';

export const NATIVE_SHORT_ORIGIN = 'https://fanqienovel.com';

export const nativeShortReadScope = (workId: string) => `short_native_metadata.${workId}`;

export type NativeShortProvenance = {
  executor: 'application-default-browser/v1' | 'dependency-injected-browser/v1';
  mode: 'live' | 'fixture';
};

export interface NativeShortReadEvidence {
  schema: typeof NATIVE_SHORT_READ_SCHEMA;
  scope: typeof NATIVE_SHORT_METADATA_SCOPE;
  result: NativeShortMetadataApiResult;
  source: { origin: typeof NATIVE_SHORT_ORIGIN; mode: 'live' | 'fixture' };
  provenance: NativeShortProvenance;
}

export type StoredSnapshot = NativeShortMetadataSnapshot | LegacyNativeShortMetadataSnapshot;

/** @internal Historical carriers are authenticated only by proof readers. */
export type StoredNativeShortMetadataApiResult = Omit<NativeShortMetadataApiResult, 'snapshot'> & {
  snapshot: StoredSnapshot | null;
};

export type StoredReadEvidence = Omit<NativeShortReadEvidence, 'result'> & {
  result: StoredNativeShortMetadataApiResult;
};

type StoredHeld = Omit<NativeShortMetadataHeldBefore, 'snapshot'> & { snapshot: StoredSnapshot };

export type StoredBaseline = Omit<NativeShortBaselineEvidence, 'held'> & { held: StoredHeld };

export type StoredAfter = Omit<NativeShortCleanAfterEvidence, 'result'> & {
  result: Omit<NativeShortCleanAfterEvidence['result'], 'snapshot'> & {
    snapshot: StoredSnapshot | null;
  };
};

export type StoredReconciliation = Omit<NativeShortReconciliationEvidence, 'result'> & {
  result: StoredNativeShortMetadataApiResult;
};

export class NativeShortProofError extends Error {
  constructor() {
    super('Native short metadata did not meet the fixed evidence contract');
  }
}

export function reject(): never {
  throw new NativeShortProofError();
}

export type Data = Record<string, unknown>;

export const WORK = /^[1-9][0-9]{9,21}$/;

export const ACCOUNT = /^[0-9]{1,30}$/;

export const HASH = /^[a-f0-9]{64}$/;

export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

const RESULT_BYTES = 4 * NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes + 64 * 1024;

/** Inspect descriptors before values; copying never calls a caller's getter/toJSON. */
export function copyNativeShortJson(input: unknown): unknown {
  return copyBoundedNativeJson(
    input,
    RESULT_BYTES,
    4 * NATIVE_SHORT_RESOURCE_LIMITS.nodes,
    NATIVE_SHORT_RESOURCE_LIMITS.depth + 8,
  );
}

export function copyBoundedNativeJson(
  input: unknown,
  bytes: number,
  maxNodes: number,
  maxDepth: number,
): unknown {
  let nodes = 0,
    stringBytes = 0;
  const active = new Set<object>();
  function visit(value: unknown, depth: number): unknown {
    if (++nodes > maxNodes || depth > maxDepth) reject();
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value))
        reject();
      stringBytes += Buffer.byteLength(value);
      if (stringBytes > bytes) reject();
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Object.is(value, -0)) reject();
      return value;
    }
    if (typeof value !== 'object' || active.has(value)) reject();
    const array = Array.isArray(value),
      prototype = Object.getPrototypeOf(value);
    if (
      array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null
    )
      reject();
    if (Object.getOwnPropertySymbols(value).length) reject();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const names = Object.keys(descriptors).filter((name) => !array || name !== 'length');
    if (
      names.some(
        (name) => !Object.hasOwn(descriptors[name]!, 'value') || !descriptors[name]!.enumerable,
      )
    )
      reject();
    if (
      array &&
      (names.length !== descriptors.length!.value ||
        names.some((name, index) => name !== String(index)))
    )
      reject();
    active.add(value);
    const out: unknown[] | Data = array ? [] : (Object.create(null) as Data);
    for (const name of names) {
      stringBytes += Buffer.byteLength(name);
      if (stringBytes > bytes) reject();
      const child = visit(descriptors[name]!.value, depth + 1);
      if (array) (out as unknown[]).push(child);
      else (out as Data)[name] = child;
    }
    active.delete(value);
    return out;
  }
  const copy = visit(input, 0);
  if (Buffer.byteLength(JSON.stringify(copy)) > bytes) reject();
  return copy;
}

export function object(value: unknown): Data {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) reject();
  return value as Data;
}

export function exact(value: unknown, names: readonly string[]): Data {
  const data = object(value),
    keys = Object.keys(data);
  if (keys.length !== names.length || keys.some((key) => !names.includes(key))) reject();
  return data;
}

export function isCanonicalNativeTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export function time(value: unknown): string {
  if (!isCanonicalNativeTime(value)) reject();
  return value;
}

export function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max)
    reject();
  return value;
}

export function ordered(times: unknown[]) {
  let last = '';
  for (const value of times) {
    const next = time(value);
    if (next < last) reject();
    last = next;
  }
}

export const equal = (left: unknown, right: unknown) =>
  canonicalJson(left) === canonicalJson(right);

export const nativeShortInputHash = (workId: string) =>
  createHash('sha256').update(canonicalJson({ workId })).digest('hex');
