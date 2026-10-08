import {
  NATIVE_SHORT_HASH_BASES,
  type NativeShortMetadataRawInput,
  type LegacyNativeShortMetadataSnapshot,
  type NativeShortMetadataSnapshot,
  type NativeShortBinding,
  NATIVE_SHORT_RESOURCE_LIMITS,
} from '../short-native-metadata.js';

import { createHash } from 'node:crypto';

export class NativeShortCoverError extends Error {
  readonly code: string;
  constructor(code: string) {
    super('Native short cover rejected.');
    this.name = 'NativeShortCoverError';
    this.code = /^[a-z][a-z0-9_]{0,79}$/.test(code) ? code : 'invalid_error_code';
  }
}

export type NativeShortCoverFit = 'cover' | 'contain';

export interface NativeShortCoverImagePolicy {
  readonly version: 'center-cover-or-white-contain/v1';
  readonly fit: NativeShortCoverFit;
  readonly width: 600;
  readonly height: 800;
  readonly mimeType: 'image/jpeg';
  readonly quality: 0.9;
}

export interface NativeShortCoverPreparedAsset {
  readonly sourceSha256: string;
  readonly sourceSize: number;
  readonly sourceMimeType: 'image/png' | 'image/jpeg';
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly preparedSha256: string;
  readonly preparedSize: number;
  readonly policy: NativeShortCoverImagePolicy;
}

export const NATIVE_SHORT_COVER_LIMITS = Object.freeze({
  sourceBytes: 5 * 1024 * 1024,
  sourcePixels: 16 * 1024 * 1024,
  preparedBytes: 5 * 1024 * 1024,
});

export const NATIVE_SHORT_COVER_SCOPE = 'short-native-recommended-cover/v1' as const;

export const NATIVE_SHORT_COVER_HASH_BASES = Object.freeze({
  sourceSnapshot: NATIVE_SHORT_HASH_BASES.snapshot,
  asset: 'native-short-prepared-cover-descriptor/v1',
  intent: 'native-short-cover-upload-intent/v1',
  uploadAck: 'native-short-cover-upload-ack/v1',
  coverUri: 'exact-recommended-cover-uri-and-typed-binding/v1',
  preservation: 'full-source-except-recommended-cover-and-proven-server-revision/v1',
  desiredContent: 'native-short-cover-save-expectation/v1',
});

export const NATIVE_SHORT_COVER_SERVER_REVISION_POLICY =
  'safe-increment-one-and-ascii-decimal-10-nondecreasing/v1' as const;

/** Static schema proves no URL-entry fields. This policy proves JSON structure, not URL content. */
export const NATIVE_SHORT_COVER_DERIVED_URL_POLICY =
  'own-array-nonempty-after-bounded-nonempty-string-or-object/v1' as const;

export interface ServerRevision {
  readonly latestVersion: number;
  readonly modifyTime: string;
}

export interface NativeShortCoverUploadRequest {
  readonly expectedSnapshotVersionHash: string;
  readonly hashBasis: typeof NATIVE_SHORT_HASH_BASES.snapshot;
  readonly expectedState: 'draft';
  readonly asset: NativeShortCoverPreparedAsset;
}

export interface NativeShortCoverUploadAcknowledgementInput {
  readonly picUri: string;
  readonly picUrl: string;
}

/** @internal Fixed pure dependency supplied only by the stored codec. */
export interface HistoricalMetadataDependencies {
  readonly rebuildMetadata: (raw: NativeShortMetadataRawInput) => LegacyNativeShortMetadataSnapshot;
}

export type StoredNative = NativeShortMetadataSnapshot | LegacyNativeShortMetadataSnapshot;

export interface NativeShortCoverUploadIntent {
  readonly schema: 'native-short-cover-upload-intent/v1';
  readonly scope: typeof NATIVE_SHORT_COVER_SCOPE;
  readonly hashBases: typeof NATIVE_SHORT_COVER_HASH_BASES;
  readonly binding: NativeShortBinding;
  readonly expectedState: 'draft';
  readonly sourceVersionHash: string;
  readonly catalogHash: string;
  readonly documentHash: string;
  readonly savedFieldsHash: string;
  readonly categorySelectionHash: string;
  readonly preservationHash: string;
  readonly serverRevisionPolicy: typeof NATIVE_SHORT_COVER_SERVER_REVISION_POLICY;
  readonly serverRevisionBefore: ServerRevision;
  readonly derivedUrlPolicy: typeof NATIVE_SHORT_COVER_DERIVED_URL_POLICY;
  readonly asset: NativeShortCoverPreparedAsset;
  readonly assetHash: string;
  readonly intentHash: string;
}

export interface NativeShortCoverExpectation {
  readonly schema: 'native-short-cover-save-expectation/v1';
  readonly scope: typeof NATIVE_SHORT_COVER_SCOPE;
  readonly hashBases: typeof NATIVE_SHORT_COVER_HASH_BASES;
  readonly binding: NativeShortBinding;
  readonly expectedState: 'draft';
  readonly sourceVersionHash: string;
  readonly intentHash: string;
  readonly assetHash: string;
  readonly uploadAckHash: string;
  readonly coverUriHash: string;
  readonly catalogHash: string;
  readonly documentHash: string;
  readonly savedFieldsHash: string;
  readonly categorySelectionHash: string;
  readonly preservationHash: string;
  readonly serverRevisionPolicy: typeof NATIVE_SHORT_COVER_SERVER_REVISION_POLICY;
  readonly serverRevisionBefore: ServerRevision;
  readonly derivedUrlPolicy: typeof NATIVE_SHORT_COVER_DERIVED_URL_POLICY;
}

/** Private plan: form/body contain content and URI; this is not a public projection or write receipt. */
export interface NativeShortCoverPlan {
  readonly kind: 'native_short_cover_payload_plan';
  readonly atomicRevision: false;
  readonly expectation: NativeShortCoverExpectation;
  readonly intentHash: string;
  readonly uploadAckHash: string;
  readonly desiredContentHash: string;
  readonly form: Readonly<Record<string, string>>;
  readonly request: {
    readonly method: 'POST';
    readonly url: string;
    readonly contentType: string;
    readonly body: string;
  };
}

export type NativeShortCoverComparisonReason =
  | 'match'
  | 'binding_changed'
  | 'state_not_draft'
  | 'server_revision_not_proven'
  | 'derived_urls_not_proven'
  | 'catalog_changed'
  | 'document_changed'
  | 'category_selection_changed'
  | 'cover_uri_changed'
  | 'saved_fields_changed'
  | 'preservation_not_proven';

export interface NativeShortCoverComparison {
  readonly matches: boolean;
  readonly reason: NativeShortCoverComparisonReason;
  readonly scope: typeof NATIVE_SHORT_COVER_SCOPE;
  readonly hashBases: typeof NATIVE_SHORT_COVER_HASH_BASES;
  readonly actual: {
    readonly snapshotVersionHash: string;
    readonly catalogHash: string;
    readonly documentHash: string;
    readonly savedFieldsHash: string;
    readonly categorySelectionHash: string;
    readonly preservationHash: string;
    readonly coverUriHash: string;
    readonly derivedUrlPolicySatisfied: boolean;
    readonly serverRevisionAfter: ServerRevision | null;
  };
}

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type Data = { [key: string]: Json };

export const SNAPSHOT_BYTES = 4 * NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes + 64 * 1024;

const CARRIER_BYTES = 64 * 1024;

export const ACK_TEXT_BYTES = 8 * 1024;

export const OWN = (value: object, key: string): boolean => Object.hasOwn(value, key);

export function reject(code: string): never {
  throw new NativeShortCoverError(code);
}

export function record(value: Json | undefined, code: string): Data {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value))
    reject(code);
  return value;
}

export function exactKeys(value: Data, names: readonly string[], code: string): void {
  const keys = Object.keys(value);
  if (keys.length !== names.length || keys.some((key) => !names.includes(key))) reject(code);
}

function validUnicode(value: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
}

/** Descriptor-first bounded JSON: no getters, toJSON, holes, symbols, prototypes or coercion. */
export function jsonCopy(input: unknown, extent = CARRIER_BYTES): Json {
  let nodes = 0,
    scalarBytes = 0;
  const active = new Set<object>();
  function string(value: string): void {
    if (!validUnicode(value)) reject('json_invalid_unicode');
    scalarBytes += Buffer.byteLength(value, 'utf8');
    if (scalarBytes > extent) reject('json_extent_limit');
  }
  function visit(value: unknown, depth: number): Json {
    if (++nodes > 300_000 || depth > 64) reject('json_resource_limit');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      string(value);
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Object.is(value, -0)) reject('json_invalid_number');
      return value;
    }
    if (typeof value !== 'object') reject('json_invalid_value');
    if (active.has(value)) reject('json_cycle');
    const array = Array.isArray(value),
      prototype = Object.getPrototypeOf(value);
    if (!array && prototype !== Object.prototype && prototype !== null)
      reject('json_non_plain_object');
    if (array && prototype !== Array.prototype) reject('json_non_plain_array');
    if (Object.getOwnPropertySymbols(value).length) reject('json_symbol_key');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const names = Object.keys(descriptors).filter((key) => !array || key !== 'length');
    if (names.length > 300_000 - nodes) reject('json_resource_limit');
    if (names.some((key) => !OWN(descriptors[key]!, 'value') || !descriptors[key]!.enumerable))
      reject('json_non_data_property');
    if (array) {
      const length = descriptors.length?.value as unknown;
      if (
        typeof length !== 'number' ||
        names.length !== length ||
        names.some((key, index) => key !== String(index))
      )
        reject('json_sparse_or_extra_array');
    }
    active.add(value);
    const copy: Json[] | Data = array ? [] : (Object.create(null) as Data);
    for (const key of names) {
      string(key);
      const child = visit(descriptors[key]!.value, depth + 1);
      if (array) (copy as Json[]).push(child);
      else (copy as Data)[key] = child;
    }
    active.delete(value);
    return copy;
  }
  try {
    const copy = visit(input, 0);
    if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > extent) reject('json_extent_limit');
    return copy;
  } catch (error) {
    if (error instanceof NativeShortCoverError) throw error;
    // Proxy traps or reflection failures must not leak caller-controlled diagnostics.
    reject('json_invalid_value');
  }
}

export function canonical(value: unknown): string {
  function ordered(value: Json): Json {
    if (Array.isArray(value)) return value.map(ordered);
    if (value !== null && typeof value === 'object') {
      const copy: Data = Object.create(null) as Data;
      for (const key of Object.keys(value).sort()) copy[key] = ordered(value[key]!);
      return copy;
    }
    return value;
  }
  return JSON.stringify(ordered(value as Json));
}

export function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function digest(value: Json | undefined, code = 'carrier_hash'): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) reject(code);
  return value;
}
