import { type ShortResolvedState, type ShortStatusFactsV1 } from '../short-status.js';

export const NATIVE_SHORT_METADATA_SCOPE = 'short-native-metadata/v1' as const;

export const NATIVE_SHORT_HASH_BASES = Object.freeze({
  snapshot: 'full-edit-catalog-and-typed-binding/v1',
  catalog: 'full-category-data-json/v1',
  document: 'exact-html-utf8/v1',
  savedFields: 'cover-v0-reconstructible-fields/v1',
  categorySelection: 'ordered-raw-category-id-label-name/v1',
  preservation: 'full-source-except-requested-first-title-and-category/v1',
});

export const NATIVE_SHORT_RESOURCE_LIMITS = Object.freeze({
  responseJsonBytes: 3 * 1024 * 1024,
  depth: 64,
  nodes: 100_000,
  // A local resource bound, NOT the public component's unresolved ps=25 counter.
  newTitleUtf8Bytes: 1024,
  categoryCount: 10_000,
});

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type RawObject = { [key: string]: Json };

export type CategoryId = string | number;

export interface NativeShortBinding {
  readonly account: { readonly kind: 'account_id'; readonly id: string };
  readonly work: { readonly kind: 'short'; readonly id: string };
}

export interface CategoryRow {
  readonly category_id: CategoryId;
  readonly label: string;
  readonly name: string;
}

export interface SavedFields {
  readonly item_id: string;
  readonly content: string;
  readonly multi_title: readonly string[];
  readonly thumb_uri: string;
  readonly book_thumb_uri: string;
  readonly category: readonly CategoryId[];
  readonly sign_type: 1 | null;
  readonly activity_flag: 0 | 1 | null;
}

export interface NativeShortMetadataSnapshot {
  readonly scope: typeof NATIVE_SHORT_METADATA_SCOPE;
  readonly hashBases: typeof NATIVE_SHORT_HASH_BASES;
  readonly binding: NativeShortBinding;
  readonly editData: Readonly<RawObject>;
  readonly categoryData: Readonly<RawObject>;
  readonly responseBinding: 'exact' | 'sentinel' | 'absent';
  readonly state: ShortResolvedState;
  readonly statusFacts: ShortStatusFactsV1;
  readonly catalog: readonly CategoryRow[];
  readonly savedFields: SavedFields;
  readonly snapshotVersionHash: string;
  readonly catalogHash: string;
  readonly documentHash: string;
  readonly savedFieldsHash: string;
  readonly categorySelectionHash: string;
}

/** @internal Read-only historical math; never a modern writer source. */
export type LegacyNativeShortMetadataSnapshot = Omit<
  NativeShortMetadataSnapshot,
  'statusFacts' | 'state'
> & { readonly state: 'draft' | 'published' | 'unknown' };

export interface NativeShortMetadataRawInput {
  readonly binding: NativeShortBinding;
  readonly editData: unknown;
  readonly categoryData: unknown;
}

export type MathSnapshot = NativeShortMetadataSnapshot | LegacyNativeShortMetadataSnapshot;

export type SnapshotChecker = (input: unknown) => MathSnapshot;

export interface NativeShortMetadataRequest {
  readonly expectedSnapshotVersionHash: string;
  readonly hashBasis: typeof NATIVE_SHORT_HASH_BASES.snapshot;
  readonly expectedState: 'draft';
  readonly title?: string;
  readonly metadata?: { readonly categories?: readonly string[] };
}

export interface NativeShortMetadataExpectation {
  readonly scope: typeof NATIVE_SHORT_METADATA_SCOPE;
  readonly hashBases: typeof NATIVE_SHORT_HASH_BASES;
  readonly binding: NativeShortBinding;
  readonly expectedState: 'draft';
  readonly requested: { readonly title: boolean; readonly categories: boolean };
  readonly sourceVersionHash: string;
  readonly catalogHash: string;
  readonly documentHash: string;
  readonly savedFieldsHash: string;
  readonly preservationHash: string;
  readonly categorySelectionHash: string;
}

export interface NativeShortMetadataPlan {
  readonly kind: 'native_metadata_payload_plan';
  readonly atomicRevision: false;
  readonly expectation: NativeShortMetadataExpectation;
  readonly categoryMax: {
    readonly value: number;
    readonly basis: 'source' | 'public-client-default-8';
  };
  readonly form: Readonly<Record<string, string>>;
  readonly request: {
    readonly method: 'POST';
    readonly url: string;
    readonly contentType: string;
    readonly body: string;
  };
}

export type NativeShortMetadataComparisonReason =
  | 'match'
  | 'binding_changed'
  | 'state_not_draft'
  | 'catalog_changed'
  | 'document_changed'
  | 'saved_fields_changed'
  | 'category_selection_changed'
  | 'preservation_not_proven';

export interface NativeShortMetadataComparison {
  readonly matches: boolean;
  readonly reason: NativeShortMetadataComparisonReason;
  readonly scope: typeof NATIVE_SHORT_METADATA_SCOPE;
  readonly hashBases: typeof NATIVE_SHORT_HASH_BASES;
  readonly actual: {
    readonly snapshotVersionHash: string;
    readonly catalogHash: string;
    readonly documentHash: string;
    readonly savedFieldsHash: string;
    readonly preservationHash: string;
    readonly categorySelectionHash: string;
  };
}

/** Write v2 only. The literal C2 snapshot/request bases above remain v1. */
export const NATIVE_SHORT_WRITE_HASH_BASES_V2 = Object.freeze({
  ...NATIVE_SHORT_HASH_BASES,
  preservation:
    'full-source-except-requested-first-title-category-and-exact-server-revision-fields/v2',
});

export const NATIVE_SHORT_SERVER_REVISION_POLICY_V2 =
  'safe-increment-one-and-ascii-decimal-10-nondecreasing/v2' as const;

export interface NativeShortServerRevision {
  readonly latestVersion: number;
  readonly modifyTime: string;
}

export interface NativeShortMetadataExpectationV2 extends Omit<
  NativeShortMetadataExpectation,
  'hashBases'
> {
  readonly version: 2;
  readonly hashBases: typeof NATIVE_SHORT_WRITE_HASH_BASES_V2;
  readonly serverRevisionPolicy: typeof NATIVE_SHORT_SERVER_REVISION_POLICY_V2;
  readonly serverRevisionBefore: NativeShortServerRevision;
}

export interface NativeShortMetadataPlanV2 extends Omit<NativeShortMetadataPlan, 'expectation'> {
  readonly expectation: NativeShortMetadataExpectationV2;
}

export interface NativeShortMetadataComparisonV2 extends Omit<
  NativeShortMetadataComparison,
  'hashBases' | 'reason' | 'actual'
> {
  readonly version: 2;
  readonly hashBases: typeof NATIVE_SHORT_WRITE_HASH_BASES_V2;
  readonly reason: NativeShortMetadataComparisonReason | 'server_revision_not_proven';
  readonly actual: NativeShortMetadataComparison['actual'] & {
    readonly serverRevisionPolicy: typeof NATIVE_SHORT_SERVER_REVISION_POLICY_V2;
    readonly serverRevisionBefore: NativeShortServerRevision;
    readonly serverRevisionAfter: NativeShortServerRevision | null;
  };
}

export type NativeShortMetadataWriteExpectation =
  NativeShortMetadataExpectation | NativeShortMetadataExpectationV2;

export type NativeShortMetadataWritePlan = NativeShortMetadataPlan | NativeShortMetadataPlanV2;

export type NativeShortMetadataWriteComparison =
  NativeShortMetadataComparison | NativeShortMetadataComparisonV2;

export type WriteExpectation = NativeShortMetadataWriteExpectation;

export type WritePlan = NativeShortMetadataWritePlan;

export type WriteComparison = NativeShortMetadataWriteComparison;

export class NativeShortMetadataError extends Error {
  constructor(readonly code: string) {
    super(`Native short metadata rejected: ${code}`);
  }
}

export function reject(code: string): never {
  throw new NativeShortMetadataError(code);
}

export function has(object: object, key: string): boolean {
  return Object.hasOwn(object, key);
}

export function record(value: Json, code: string): RawObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) reject(code);
  return value as RawObject;
}

export function keys(object: RawObject, allowed: readonly string[], code: string): void {
  if (Object.keys(object).some((key) => !allowed.includes(key))) reject(code);
}

export function textValue(value: Json | undefined, code: string, nonempty = false): string {
  if (typeof value !== 'string' || (nonempty && !value.trim())) reject(code);
  return value;
}

export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Validate before reading values: JSON.stringify alone loses holes, accessors and undefined. */
export function jsonCopy(
  input: unknown,
  extent = NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes,
  nodeLimit: number = NATIVE_SHORT_RESOURCE_LIMITS.nodes,
): Json {
  let nodes = 0;
  const active = new Set<object>();
  function visit(value: unknown, depth: number): Json {
    if (++nodes > nodeLimit || depth > NATIVE_SHORT_RESOURCE_LIMITS.depth)
      reject('json_resource_limit');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value))
        reject('json_invalid_unicode');
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Object.is(value, -0)) reject('json_invalid_number');
      return value;
    }
    if (typeof value !== 'object') reject('json_invalid_value');
    if (active.has(value)) reject('json_cycle');
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (!array && prototype !== Object.prototype && prototype !== null)
      reject('json_non_plain_object');
    if (array && prototype !== Array.prototype) reject('json_non_plain_array');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length) reject('json_symbol_key');
    const names = Object.keys(descriptors).filter((key) => !array || key !== 'length');
    if (names.some((key) => !has(descriptors[key]!, 'value') || !descriptors[key]!.enumerable))
      reject('json_non_data_property');
    if (
      array &&
      (names.length !== value.length || names.some((key, index) => key !== String(index)))
    )
      reject('json_sparse_or_extra_array');
    active.add(value);
    const copy: Json[] | RawObject = array ? [] : (Object.create(null) as RawObject);
    for (const key of names) {
      const child = visit(descriptors[key]!.value, depth + 1);
      if (array) (copy as Json[]).push(child);
      else (copy as RawObject)[key] = child;
    }
    active.delete(value);
    return copy;
  }
  const copy = visit(input, 0);
  if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > extent) reject('json_extent_limit');
  return copy;
}

export function canonical(value: unknown): string {
  function ordered(value: Json): Json {
    if (Array.isArray(value)) return value.map(ordered);
    if (value !== null && typeof value === 'object') {
      const result: RawObject = Object.create(null) as RawObject;
      for (const key of Object.keys(value).sort()) result[key] = ordered(value[key]!);
      return result;
    }
    return value;
  }
  // All callers provide already validated JSON or internally constructed JSON.
  return JSON.stringify(ordered(value as Json));
}
