import {
  NATIVE_SHORT_BODY_SCOPE,
  NativeShortBodyError,
  type NativeShortBodySnapshot,
  createNativeShortBodySnapshot,
} from '../short-native-body.js';

import { createHash } from 'node:crypto';

import {
  NativeShortMetadataError,
  createNativeShortMetadataSnapshot,
  type NativeShortBinding,
} from '../short-native-metadata.js';

import { validateShortStatusFacts } from '../short-status.js';

import { type StoredBodySnapshot, storedBodyMath } from '../short-native-legacy-codec.js';

/** Synthetic evidence only. None of these constructors issue save or durability authority. */
export const NATIVE_SHORT_BODY_FIXTURE_DATASETS = Object.freeze({
  baseline: 'short_native_body_fixture_baseline',
  preSave: 'short_native_body_fixture_pre_save',
  intent: 'short_native_body_fixture_intent',
  attempt: 'short_native_body_fixture_attempt',
  acknowledgement: 'short_native_body_fixture_acknowledgement',
  after: 'short_native_body_fixture_after',
  result: 'short_native_body_fixture_result',
} as const);

export type NativeShortBodyFixtureStageKind = keyof typeof NATIVE_SHORT_BODY_FIXTURE_DATASETS;

export interface NativeShortBodyFixtureProvenance {
  readonly mode: 'fixture';
  readonly executor: 'dependency-injected-body-owned-run/v1';
}

export interface NativeShortBodyFixtureStageEvidence {
  readonly schema: 'native-short-body-fixture-stage/v1';
  readonly kind: NativeShortBodyFixtureStageKind;
  readonly sequence: number;
  readonly eventAt: string;
  readonly priorStageHash: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface NativeShortBodyFixtureTrace {
  readonly schema: 'native-short-body-fixture-trace/v1';
  readonly scope: typeof NATIVE_SHORT_BODY_SCOPE;
  readonly provenance: NativeShortBodyFixtureProvenance;
  readonly accountId: string;
  readonly workId: string;
  readonly inputHash: string;
  readonly stages: readonly NativeShortBodyFixtureStageEvidence[];
  readonly simulatedAttemptOrdinal: 1 | null;
}

export const REASONS = [
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
  'production_disabled',
  'fixture_not_live',
  'invalid_input',
  'version_conflict',
  'no_change',
  'durability_unverified',
  'acknowledgement_unverified',
  'readback_mismatch',
] as const;

export type Reason = (typeof REASONS)[number];

export interface NativeShortBodyFixtureProjection {
  readonly validated: true;
  readonly verifiedLive: false;
  readonly durable: false;
  readonly bodyIncluded: false;
  readonly status: 'fixture_complete' | 'no_change' | 'capability_unavailable';
  readonly reason: Reason;
  readonly stageHashes: readonly string[];
  readonly summaries: {
    readonly stageCount: number;
    readonly simulatedAttemptOrdinal: 1 | null;
    readonly baselineObserved: boolean;
    readonly preSaveVerified: boolean;
    readonly postAttempted: boolean;
    readonly acknowledged: boolean;
    readonly afterObserved: boolean;
    readonly desiredMatched: boolean;
    readonly pendingAtEnd: number;
    readonly disposalFailures: number;
    readonly quarantined: boolean;
  };
}

type ProofCode =
  | 'invalid_shape'
  | 'resource_limit'
  | 'invalid_trace'
  | 'source_mismatch'
  | 'durability_unverified';

const CODES = new Set<string>([
  'invalid_shape',
  'resource_limit',
  'invalid_trace',
  'source_mismatch',
  'durability_unverified',
]);

export class NativeShortBodyProofError extends Error {
  readonly code: ProofCode;
  constructor(code: ProofCode) {
    const safe = typeof code === 'string' && CODES.has(code) ? code : 'invalid_shape';
    super(`Native short body fixture proof rejected: ${safe}`);
    this.code = safe;
  }
}

export function fail(code: ProofCode): never {
  throw new NativeShortBodyProofError(code);
}

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type Data = Record<string, unknown>;

export const MIB = 1024 * 1024;

const HASH = /^[a-f0-9]{64}$/;

export const BAD_UNICODE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

export const STAGE_KEYS = [
  'schema',
  'kind',
  'sequence',
  'eventAt',
  'priorStageHash',
  'payload',
] as const;

export const KINDS = Object.keys(
  NATIVE_SHORT_BODY_FIXTURE_DATASETS,
) as NativeShortBodyFixtureStageKind[];

export const PAYLOAD_KEYS: Record<NativeShortBodyFixtureStageKind, readonly string[]> = {
  baseline: ['native', 'businessInput', 'inputHash'],
  preSave: ['native', 'sourceVersionHash', 'desiredContentHash'],
  intent: ['sourceVersionHash', 'desiredContentHash', 'hashBasesHash'],
  attempt: ['simulatedOrdinal', 'eventAt'],
  acknowledgement: ['observation'],
  after: ['native', 'comparison'],
  result: ['outcome', 'reason', 'cleanup'],
};

export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Capture descriptors before values. No getter, toJSON, normalization or caller serializer runs. */
export function copy(input: unknown, bytes: number, depthLimit = 72, nodeLimit = 404_096): Json {
  let nodes = 0;
  const active = new Set<object>();
  function visit(value: unknown, depth: number): Json {
    if (++nodes > nodeLimit || depth > depthLimit) fail('resource_limit');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (BAD_UNICODE.test(value)) fail('invalid_shape');
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Object.is(value, -0)) fail('invalid_shape');
      return value;
    }
    if (!value || typeof value !== 'object' || active.has(value)) fail('invalid_shape');
    const array = Array.isArray(value),
      proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
      fail('invalid_shape');
    if (Object.getOwnPropertySymbols(value).length) fail('invalid_shape');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const names = Object.keys(descriptors).filter((name) => !array || name !== 'length');
    if (
      names.some(
        (name) =>
          BAD_UNICODE.test(name) ||
          !descriptors[name]?.enumerable ||
          !Object.hasOwn(descriptors[name]!, 'value'),
      )
    )
      fail('invalid_shape');
    if (
      array &&
      (descriptors.length?.value !== names.length ||
        names.some((name, index) => name !== String(index)))
    )
      fail('invalid_shape');
    active.add(value);
    const out: Json[] | { [key: string]: Json } = array ? [] : {};
    for (const name of names) {
      const child = visit(descriptors[name]!.value, depth + 1);
      if (array) (out as Json[]).push(child);
      else
        Object.defineProperty(out, name, {
          value: child,
          enumerable: true,
          writable: true,
          configurable: true,
        });
    }
    active.delete(value);
    return out;
  }
  try {
    const result = visit(input, 0);
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > bytes) fail('resource_limit');
    return result;
  } catch (error) {
    if (error instanceof NativeShortBodyProofError) throw error;
    fail('invalid_shape');
  }
}

export function exact(input: unknown, keys: readonly string[]): Data {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_shape');
  const value = input as Data,
    names = Object.keys(value);
  if (names.length !== keys.length || names.some((name) => !keys.includes(name)))
    fail('invalid_shape');
  return value;
}

/** Emit keys directly: reconstructing an object would reorder integer-like keys. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const text = JSON.stringify(value);
    if (typeof text !== 'string') fail('invalid_shape');
    return text;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const fields = value as Data;
  return `{${Object.keys(fields)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(fields[key])}`)
    .join(',')}}`;
}

export const hash = (value: unknown): string =>
  createHash('sha256').update(canonical(value), 'utf8').digest('hex');

export const same = (left: unknown, right: unknown): boolean =>
  canonical(left) === canonical(right);

export function digest(input: unknown): string {
  if (typeof input !== 'string' || !HASH.test(input)) fail('invalid_trace');
  return input;
}

export function time(input: unknown): string {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input))
    fail('invalid_trace');
  const date = new Date(input);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== input) fail('invalid_trace');
  return input;
}

export function count(input: unknown): number {
  if (
    typeof input !== 'number' ||
    !Number.isSafeInteger(input) ||
    Object.is(input, -0) ||
    input < 0
  )
    fail('invalid_trace');
  return input;
}

export function sourceError(error: unknown): never {
  if (
    (error instanceof NativeShortBodyError || error instanceof NativeShortMetadataError) &&
    ['json_resource_limit', 'json_extent_limit', 'document_resource_limit'].includes(error.code)
  )
    fail('resource_limit');
  fail('source_mismatch');
}

export function native(input: unknown): NativeShortBodySnapshot {
  const d = exact(input, ['binding', 'editData', 'categoryData', 'statusFacts']);
  try {
    const metadata = createNativeShortMetadataSnapshot({
      binding: d.binding as NativeShortBinding,
      editData: d.editData,
      categoryData: d.categoryData,
    });
    validateShortStatusFacts(d.statusFacts);
    if (!same(d.statusFacts, metadata.statusFacts)) fail('source_mismatch');
    return createNativeShortBodySnapshot(metadata);
  } catch (error) {
    sourceError(error);
  }
}

export function storedNative(input: unknown): StoredBodySnapshot {
  const d = exact(
    input,
    input !== null && typeof input === 'object' && Object.hasOwn(input, 'statusFacts')
      ? ['binding', 'editData', 'categoryData', 'statusFacts']
      : ['binding', 'editData', 'categoryData'],
  );
  try {
    return storedBodyMath.decodeCompact(d);
  } catch (error) {
    sourceError(error);
  }
}
