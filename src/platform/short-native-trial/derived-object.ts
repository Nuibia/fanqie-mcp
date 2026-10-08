import {
  reject,
  BAD_UNICODE,
  NATIVE_SHORT_TRIAL_HASH_BASES,
  type StoredNative,
  type JsonObject,
  hash,
  type NativeShortTrialSnapshot,
} from './reject.js';

import {
  NATIVE_SHORT_RESOURCE_LIMITS,
  NATIVE_SHORT_HASH_BASES,
  type NativeShortMetadataSnapshot,
  createNativeShortMetadataSnapshot,
  type NativeShortBinding,
} from '../short-native-metadata.js';

import { ATTRIBUTES } from './validate-native-short-trial-write-request.js';

import { createTrialSnapshotCore } from './create-trial-snapshot-core.js';

/** Derived carriers have an explicit schema, rather than an aggregate JSON budget.
 * The original factory below independently bounds the only source binding/edit/catalog.
 * Repeated paragraph projections may exceed that source's node count without adding input data.
 */
function derivedObject(input: unknown, names: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Object.getOwnPropertySymbols(input).length
  )
    reject('derived_object_shape');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    Object.keys(descriptors).length !== names.length ||
    names.some(
      (name) => !descriptors[name]?.enumerable || !Object.hasOwn(descriptors[name]!, 'value'),
    )
  )
    reject('derived_object_shape');
  return Object.fromEntries(names.map((name) => [name, descriptors[name]!.value]));
}

function derivedPrimitive(input: unknown): void {
  if (input === null || typeof input === 'boolean') return;
  if (typeof input === 'string') {
    if (BAD_UNICODE.test(input)) reject('invalid_unicode');
    return;
  }
  if (typeof input === 'number' && Number.isFinite(input) && !Object.is(input, -0)) return;
  reject('derived_primitive_shape');
}

function derivedArray(
  input: unknown,
  check: (value: unknown) => void,
  maximum: number = NATIVE_SHORT_RESOURCE_LIMITS.nodes,
): void {
  if (
    !Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Array.prototype ||
    Object.getOwnPropertySymbols(input).length
  )
    reject('derived_array_shape');
  const descriptors = Object.getOwnPropertyDescriptors<object>(input),
    length = descriptors.length?.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > maximum)
    reject('derived_array_shape');
  const names = Object.keys(descriptors).filter((name) => name !== 'length');
  if (
    names.length !== length ||
    names.some(
      (name, index) =>
        name !== String(index) ||
        !descriptors[name]!.enumerable ||
        !Object.hasOwn(descriptors[name]!, 'value'),
    )
  )
    reject('derived_array_shape');
  for (const name of names) check(descriptors[name]!.value);
}

function derivedScalars(input: unknown, names: readonly string[]): Record<string, unknown> {
  const values = derivedObject(input, names);
  for (const name of names) derivedPrimitive(values[name]);
  return values;
}

function derivedBinding(input: unknown): void {
  const values = derivedObject(input, ['account', 'work']);
  derivedScalars(values.account, ['kind', 'id']);
  derivedScalars(values.work, ['kind', 'id']);
}

export const LEGACY_NATIVE_SNAPSHOT_FIELDS = [
  'scope',
  'hashBases',
  'binding',
  'editData',
  'categoryData',
  'responseBinding',
  'state',
  'catalog',
  'savedFields',
  'snapshotVersionHash',
  'catalogHash',
  'documentHash',
  'savedFieldsHash',
  'categorySelectionHash',
] as const;

const NATIVE_SNAPSHOT_FIELDS = [...LEGACY_NATIVE_SNAPSHOT_FIELDS, 'statusFacts'] as const;

const TRIAL_SNAPSHOT_FIELDS = [
  'scope',
  'hashBases',
  'binding',
  'native',
  'document',
  'snapshotVersionHash',
  'catalogHash',
  'documentHash',
  'savedFieldsHash',
  'categorySelectionHash',
  'bodyHash',
  'paragraphsHash',
  'trialDocumentHash',
  'coversHash',
] as const;

export function nativeDerived(
  input: unknown,
  fields: readonly string[] = NATIVE_SNAPSHOT_FIELDS,
): Record<string, unknown> {
  const values = derivedObject(input, fields);
  derivedBinding(values.binding);
  derivedScalars(values.hashBases, Object.keys(NATIVE_SHORT_HASH_BASES));
  for (const name of [
    'scope',
    'responseBinding',
    'state',
    'snapshotVersionHash',
    'catalogHash',
    'documentHash',
    'savedFieldsHash',
    'categorySelectionHash',
  ])
    derivedPrimitive(values[name]);
  derivedArray(
    values.catalog,
    (row) => {
      derivedScalars(row, ['category_id', 'label', 'name']);
    },
    NATIVE_SHORT_RESOURCE_LIMITS.categoryCount,
  );
  const saved = derivedObject(values.savedFields, [
    'item_id',
    'content',
    'multi_title',
    'thumb_uri',
    'book_thumb_uri',
    'category',
    'sign_type',
    'activity_flag',
  ]);
  derivedArray(saved.multi_title, derivedPrimitive);
  derivedArray(saved.category, derivedPrimitive, NATIVE_SHORT_RESOURCE_LIMITS.categoryCount);
  for (const name of [
    'item_id',
    'content',
    'thumb_uri',
    'book_thumb_uri',
    'sign_type',
    'activity_flag',
  ])
    derivedPrimitive(saved[name]);
  // editData/categoryData are intentionally untouched here. Their complete JSON,
  // cycles, Unicode, depth, node count and per-response extent belong to the old factory.
  return values;
}

export function trialDerived(
  input: unknown,
  fields: readonly string[] = NATIVE_SNAPSHOT_FIELDS,
): Record<string, unknown> {
  const values = derivedObject(input, TRIAL_SNAPSHOT_FIELDS);
  nativeDerived(values.native, fields);
  derivedBinding(values.binding);
  derivedScalars(values.hashBases, Object.keys(NATIVE_SHORT_TRIAL_HASH_BASES));
  for (const name of [
    'scope',
    'snapshotVersionHash',
    'catalogHash',
    'documentHash',
    'savedFieldsHash',
    'categorySelectionHash',
    'bodyHash',
    'paragraphsHash',
    'trialDocumentHash',
    'coversHash',
  ])
    derivedPrimitive(values[name]);
  const document = derivedObject(values.document, [
    'rawHtml',
    'markerFreeHtml',
    'bodyText',
    'paragraphs',
    'paragraphCount',
    'eligibleParagraphCount',
    'characterCount',
    'markerCount',
    'boundary',
    'prefixCharacterCount',
    'displayPercent',
    'markerAttrs',
  ]);
  derivedArray(document.paragraphs, (row) => {
    derivedScalars(row, ['rawHtml', 'text', 'characterCount', 'eligible']);
  });
  for (const name of [
    'rawHtml',
    'markerFreeHtml',
    'bodyText',
    'paragraphCount',
    'eligibleParagraphCount',
    'characterCount',
    'markerCount',
    'boundary',
    'prefixCharacterCount',
    'displayPercent',
  ])
    derivedPrimitive(document[name]);
  if (document.markerAttrs !== null) derivedScalars(document.markerAttrs, ATTRIBUTES);
  return values;
}

/** Compare descriptors against the bounded reconstruction; never serialize/copy a whole derived carrier. */
export function derivedEqual(input: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return Object.is(input, expected);
  if (Array.isArray(expected)) {
    if (
      !Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Array.prototype ||
      Object.getOwnPropertySymbols(input).length
    )
      return false;
    const descriptors = Object.getOwnPropertyDescriptors<object>(input),
      names = Object.keys(descriptors).filter((name) => name !== 'length');
    if (
      descriptors.length?.value !== expected.length ||
      names.length !== expected.length ||
      names.some(
        (name, index) =>
          name !== String(index) ||
          !descriptors[name]!.enumerable ||
          !Object.hasOwn(descriptors[name]!, 'value'),
      )
    )
      return false;
    return names.every((name, index) => derivedEqual(descriptors[name]!.value, expected[index]));
  }
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Object.getOwnPropertySymbols(input).length
  )
    return false;
  const descriptors = Object.getOwnPropertyDescriptors(input),
    names = Object.keys(expected);
  if (
    Object.keys(descriptors).length !== names.length ||
    names.some(
      (name) => !descriptors[name]?.enumerable || !Object.hasOwn(descriptors[name]!, 'value'),
    )
  )
    return false;
  return names.every((name) =>
    derivedEqual(descriptors[name]!.value, (expected as Record<string, unknown>)[name]),
  );
}

function checkedNative(input: unknown): NativeShortMetadataSnapshot {
  const value = nativeDerived(input);
  const native = createNativeShortMetadataSnapshot({
    binding: value.binding as NativeShortBinding,
    editData: value.editData,
    categoryData: value.categoryData,
  });
  if (!derivedEqual(input, native)) reject('snapshot_hash_mismatch');
  return native;
}

export function coversHash(native: StoredNative): string {
  const covers: JsonObject = Object.create(null);
  for (const key of ['thumb_uri', 'book_thumb_uri', 'thumb_url_list', 'book_thumb_url_list'])
    if (Object.hasOwn(native.editData, key)) covers[key] = native.editData[key]!;
  return hash({ basis: NATIVE_SHORT_TRIAL_HASH_BASES.covers, binding: native.binding, covers });
}

export function createNativeShortTrialSnapshot(
  input: NativeShortMetadataSnapshot,
): NativeShortTrialSnapshot {
  return createTrialSnapshotCore(checkedNative(input));
}
