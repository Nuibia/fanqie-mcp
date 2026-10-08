import {
  NATIVE_SHORT_HASH_BASES,
  type NativeShortBinding,
  type NativeShortMetadataSnapshot,
  type LegacyNativeShortMetadataSnapshot,
  type NativeShortMetadataRawInput,
  NATIVE_SHORT_SERVER_REVISION_POLICY_V2,
  type NativeShortServerRevision,
  NATIVE_SHORT_RESOURCE_LIMITS,
} from '../short-native-metadata.js';

import { createHash } from 'node:crypto';

export const NATIVE_SHORT_TRIAL_SCOPE = 'short-native-trial/v1' as const;

export const NATIVE_SHORT_TRIAL_HASH_BASES = Object.freeze({
  ...NATIVE_SHORT_HASH_BASES,
  trialDocument: 'short-paragraph-and-pay-tag/v1',
  body: 'semantic-paragraph-lf-body/v1',
  paragraphs: 'ordered-exact-paragraph-html-utf8/v1',
  covers: 'unchanged-full-source-cover-fields/v1',
  preservation: 'full-source-except-content-and-exact-server-revision-fields/v1',
});

export type NativeShortTrialAction =
  { readonly action: 'set'; readonly beforeParagraph: number } | { readonly action: 'clear' };

export interface NativeShortTrialWriteRequest {
  readonly expectedSnapshotVersionHash: string;
  readonly hashBasis: typeof NATIVE_SHORT_HASH_BASES.snapshot;
  readonly expectedState: 'draft';
  readonly metadata: { readonly trial: NativeShortTrialAction };
}

/** Idempotency belongs to the outer App/Queue contract, never to the business hash. */
export interface NativeShortTrialBusinessInput extends NativeShortTrialWriteRequest {
  readonly target: { readonly kind: 'short'; readonly workId: string };
  readonly snapshotScope: typeof NATIVE_SHORT_TRIAL_SCOPE;
}

export interface NativeShortTrialParagraph {
  readonly rawHtml: string;
  readonly text: string;
  readonly characterCount: number;
  readonly eligible: boolean;
}

export interface NativeShortTrialMarkerAttributes {
  readonly 'data-percentage': string;
  readonly 'data-fanqie-type': 'pay_tag';
  readonly 'data-min-text': '200';
  readonly 'data-min-paragraphs': '3';
  readonly 'data-min-radio': '0.3';
  readonly 'data-para-nums': string;
  readonly class: '' | 'fq-pay-node-animation';
}

export interface NativeShortTrialDocument {
  readonly rawHtml: string;
  readonly markerFreeHtml: string;
  readonly bodyText: string;
  readonly paragraphs: readonly NativeShortTrialParagraph[];
  readonly paragraphCount: number;
  readonly eligibleParagraphCount: number;
  readonly characterCount: number;
  readonly markerCount: 0 | 1;
  readonly boundary: number | null;
  readonly prefixCharacterCount: number;
  readonly displayPercent: number | null;
  readonly markerAttrs: NativeShortTrialMarkerAttributes | null;
}

export interface NativeShortTrialSnapshot {
  readonly scope: typeof NATIVE_SHORT_TRIAL_SCOPE;
  readonly hashBases: typeof NATIVE_SHORT_TRIAL_HASH_BASES;
  readonly binding: NativeShortBinding;
  readonly native: NativeShortMetadataSnapshot;
  readonly document: NativeShortTrialDocument;
  readonly snapshotVersionHash: string;
  readonly catalogHash: string;
  readonly documentHash: string;
  readonly savedFieldsHash: string;
  readonly categorySelectionHash: string;
  readonly trialDocumentHash: string;
  readonly bodyHash: string;
  readonly paragraphsHash: string;
  readonly coversHash: string;
}

/** @internal Historical carriers are only inputs to authenticated stored-graph math. */
export type LegacyNativeShortTrialSnapshot = Omit<NativeShortTrialSnapshot, 'native'> & {
  readonly native: LegacyNativeShortMetadataSnapshot;
};

/** @internal The codec supplies one fixed, frozen, pure reconstruction dependency. */
export interface HistoricalMetadataDependencies {
  readonly rebuildMetadata: (raw: NativeShortMetadataRawInput) => LegacyNativeShortMetadataSnapshot;
}

export type StoredNative = NativeShortMetadataSnapshot | LegacyNativeShortMetadataSnapshot;

export type StoredTrial = NativeShortTrialSnapshot | LegacyNativeShortTrialSnapshot;

export interface NativeShortTrialExpectation {
  readonly scope: typeof NATIVE_SHORT_TRIAL_SCOPE;
  readonly hashBases: typeof NATIVE_SHORT_TRIAL_HASH_BASES;
  readonly binding: NativeShortBinding;
  readonly expectedState: 'draft';
  readonly trial: NativeShortTrialAction;
  readonly sourceVersionHash: string;
  readonly sourceDocumentHash: string;
  readonly expectedDocumentHash: string;
  readonly expectedSavedFieldsHash: string;
  readonly catalogHash: string;
  readonly categorySelectionHash: string;
  readonly preservationHash: string;
  readonly coversHash: string;
  readonly bodyHash: string;
  readonly paragraphsHash: string;
  readonly trialDocumentHash: string;
  readonly serverRevisionPolicy: typeof NATIVE_SHORT_SERVER_REVISION_POLICY_V2;
  readonly serverRevisionBefore: NativeShortServerRevision;
  readonly desiredHtml: string;
}

export interface NativeShortTrialPlan {
  readonly kind: 'native_trial_payload_plan';
  readonly atomicRevision: false;
  readonly expectation: NativeShortTrialExpectation;
  readonly desiredContentHash: string;
  readonly form: Readonly<Record<string, string>>;
  readonly request: {
    readonly method: 'POST';
    readonly url: string;
    readonly contentType: string;
    readonly body: string;
  };
}

export interface NativeShortTrialComparison {
  readonly matches: boolean;
  readonly reason:
    | 'match'
    | 'binding_changed'
    | 'state_not_draft'
    | 'server_revision_not_proven'
    | 'catalog_changed'
    | 'document_changed'
    | 'saved_fields_changed'
    | 'category_selection_changed'
    | 'preservation_not_proven'
    | 'covers_changed'
    | 'body_changed'
    | 'paragraphs_changed'
    | 'trial_changed';
  readonly scope: typeof NATIVE_SHORT_TRIAL_SCOPE;
  readonly hashBases: typeof NATIVE_SHORT_TRIAL_HASH_BASES;
  readonly actual: {
    readonly snapshotVersionHash: string;
    readonly catalogHash: string;
    readonly documentHash: string;
    readonly savedFieldsHash: string;
    readonly categorySelectionHash: string;
    readonly preservationHash: string;
    readonly coversHash: string;
    readonly bodyHash: string;
    readonly paragraphsHash: string;
    readonly trialDocumentHash: string;
    readonly serverRevisionPolicy: typeof NATIVE_SHORT_SERVER_REVISION_POLICY_V2;
    readonly serverRevisionBefore: NativeShortServerRevision;
    readonly serverRevisionAfter: NativeShortServerRevision | null;
  };
}

export class NativeShortTrialError extends Error {
  constructor(readonly code: string) {
    super(`Native short trial rejected: ${code}`);
  }
}

export function reject(code: string): never {
  throw new NativeShortTrialError(code);
}

export const HASH = /^[a-f0-9]{64}$/;

export const BAD_UNICODE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type JsonObject = { [key: string]: Json };

export function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Copy descriptors before values: no getters, sparse arrays, symbols or toJSON calls. */
export function jsonCopy(
  input: unknown,
  extent = 12 * NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes,
): Json {
  let nodes = 0;
  const active = new Set<object>();
  function visit(value: unknown, depth: number): Json {
    if (++nodes > NATIVE_SHORT_RESOURCE_LIMITS.nodes || depth > NATIVE_SHORT_RESOURCE_LIMITS.depth)
      reject('json_resource_limit');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (BAD_UNICODE.test(value)) reject('invalid_unicode');
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Object.is(value, -0)) reject('json_invalid_number');
      return value;
    }
    if (!value || typeof value !== 'object') reject('json_invalid_value');
    if (active.has(value)) reject('json_cycle');
    const array = Array.isArray(value),
      proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
      reject('json_non_plain');
    if (Object.getOwnPropertySymbols(value).length) reject('json_symbol_key');
    const descriptors = Object.getOwnPropertyDescriptors(value),
      names = Object.keys(descriptors).filter((key) => !array || key !== 'length');
    if (
      names.some(
        (key) => !Object.hasOwn(descriptors[key]!, 'value') || !descriptors[key]!.enumerable,
      )
    )
      reject('json_non_data_property');
    if (
      array &&
      (names.length !== value.length || names.some((key, index) => key !== String(index)))
    )
      reject('json_sparse_or_extra_array');
    active.add(value);
    const copy: Json[] | JsonObject = array ? [] : (Object.create(null) as JsonObject);
    for (const name of names) {
      const child = visit(descriptors[name]!.value, depth + 1);
      if (array) (copy as Json[]).push(child);
      else (copy as JsonObject)[name] = child;
    }
    active.delete(value);
    return copy;
  }
  const copy = visit(input, 0);
  if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > extent) reject('json_extent_limit');
  return copy;
}

export function object(input: Json, names?: readonly string[]): JsonObject {
  if (!input || typeof input !== 'object' || Array.isArray(input)) reject('object_shape');
  if (
    names &&
    (Object.keys(input).length !== names.length ||
      names.some((name) => !Object.hasOwn(input, name)))
  )
    reject('unsupported_field');
  return input as JsonObject;
}

/** Only internally constructed values or original data returned by the bounded native factory. */
function canonicalValidated(value: Json): string {
  function order(v: Json): Json {
    if (Array.isArray(v)) return v.map(order);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((key) => [key, order(v[key]!)]),
      );
    return v;
  }
  return JSON.stringify(order(value));
}

export function canonical(value: unknown): string {
  return canonicalValidated(jsonCopy(value));
}

export function hash(value: unknown): string {
  return createHash('sha256')
    .update(canonicalValidated(value as Json), 'utf8')
    .digest('hex');
}

export function action(input: Json): NativeShortTrialAction {
  const value = object(input);
  if (value.action === 'clear') {
    object(value, ['action']);
    return { action: 'clear' };
  }
  object(value, ['action', 'beforeParagraph']);
  if (
    value.action !== 'set' ||
    typeof value.beforeParagraph !== 'number' ||
    !Number.isSafeInteger(value.beforeParagraph) ||
    value.beforeParagraph < 1
  )
    reject('trial_boundary');
  return { action: 'set', beforeParagraph: value.beforeParagraph };
}
