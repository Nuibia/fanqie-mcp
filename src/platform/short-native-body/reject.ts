import {
  type NativeShortBodyErrorCode,
  NATIVE_SHORT_BODY_RESOURCE_LIMITS,
} from './native-short-body-hash-bases-for-request.js';

import { createHash } from 'node:crypto';

const ERROR_CODES = new Set<string>([
  'json_resource_limit',
  'json_invalid_number',
  'json_invalid_value',
  'json_cycle',
  'json_non_plain',
  'json_symbol_key',
  'json_non_data_property',
  'json_sparse_or_extra_array',
  'json_extent_limit',
  'invalid_unicode',
  'object_shape',
  'unsupported_field',
  'derived_object_shape',
  'derived_array_shape',
  'account_id_invalid',
  'request_binding',
  'business_binding',
  'binding_shape',
  'paragraph_shape',
  'paragraph_lines',
  'literal_line_break',
  'source_index',
  'source_index_order',
  'source_index_missing',
  'trial_action',
  'trial_boundary',
  'trial_anchor_missing',
  'trial_min_text',
  'trial_min_paragraphs',
  'trial_ratio',
  'unsupported_entity',
  'invalid_entity_scalar',
  'unsupported_text',
  'document_extent_or_unicode',
  'document_grammar',
  'document_resource_limit',
  'marker_attributes',
  'multiple_markers',
  'marker_not_empty',
  'marker_derived_values',
  'snapshot_source_invalid',
  'body_snapshot_hash_mismatch',
  'source_version_mismatch',
  'state_not_draft',
  'wire_fields_unsupported',
  'server_revision_shape',
  'no_change',
  'expectation_shape',
  'expectation_scope',
  'expectation_hash',
  'expectation_document',
  'expectation_source_mismatch',
  'form_shape',
  'body_plan_hash_mismatch',
  'derived_word_number_invalid',
]);

export class NativeShortBodyError extends Error {
  readonly code: NativeShortBodyErrorCode;
  constructor(code: NativeShortBodyErrorCode) {
    const safeCode =
      typeof code === 'string' && ERROR_CODES.has(code) ? code : 'json_invalid_value';
    super(`Native short body rejected: ${safeCode}`);
    this.code = safeCode;
  }
}

export function reject(code: NativeShortBodyErrorCode): never {
  throw new NativeShortBodyError(code);
}

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type Raw = { [key: string]: Json };

export const HASH = /^[a-f0-9]{64}$/;

export const BAD_UNICODE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

export const REQUEST_KEYS = [
  'expectedSnapshotVersionHash',
  'hashBasis',
  'expectedState',
  'representation',
  'paragraphs',
  'trial',
] as const;

export const SNAPSHOT_KEYS = [
  'scope',
  'representation',
  'hashBases',
  'binding',
  'native',
  'document',
  'sourceParagraphs',
  'marker',
  'snapshotVersionHash',
  'catalogHash',
  'documentHash',
  'savedFieldsHash',
  'categorySelectionHash',
  'sourceVectorHash',
  'observedWireVectorHash',
  'bodyHash',
  'paragraphsHash',
  'markerHash',
  'coversHash',
] as const;

export const EXPECTATION_KEYS = [
  'scope',
  'representation',
  'hashBases',
  'binding',
  'expectedState',
  'writeRequest',
  'sourceVersionHash',
  'sourceDocumentHash',
  'sourceVectorHash',
  'expectedDocumentHash',
  'expectedSavedFieldsHash',
  'catalogHash',
  'categorySelectionHash',
  'preservationHash',
  'coversHash',
  'bodyHash',
  'paragraphsHash',
  'markerHash',
  'submittedVectorHash',
  'effectiveWireVectorHash',
  'effectiveWireParagraphs',
  'appendedWireTerminal',
  'serverRevisionPolicy',
  'serverRevisionBefore',
  'desiredHtml',
  'marker',
] as const;

export const FORM_KEYS = [
  'item_id',
  'content',
  'thumb_uri',
  'book_thumb_uri',
  'item_version',
  'multi_title',
  'sign_type',
  'activity_flag',
] as const;

export function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Descriptor capture never evaluates an input getter, toJSON, or inherited field. */
export function dataObject(
  input: unknown,
  keys?: readonly string[],
  code: NativeShortBodyErrorCode = 'object_shape',
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) reject(code);
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) reject('json_non_plain');
  if (Object.getOwnPropertySymbols(input).length) reject('json_symbol_key');
  const descriptors = Object.getOwnPropertyDescriptors<object>(input),
    names = Object.keys(descriptors);
  if (names.some((name) => BAD_UNICODE.test(name))) reject('invalid_unicode');
  if (
    names.some(
      (name) => !descriptors[name]!.enumerable || !Object.hasOwn(descriptors[name]!, 'value'),
    )
  )
    reject('json_non_data_property');
  if (
    keys &&
    (names.length !== keys.length || keys.some((name) => !Object.hasOwn(descriptors, name)))
  )
    reject('unsupported_field');
  const out: Record<string, unknown> = Object.create(null);
  for (const name of names) out[name] = descriptors[name]!.value;
  return out;
}

export function dataArray(input: unknown): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype)
    reject('derived_array_shape');
  if (Object.getOwnPropertySymbols(input).length) reject('json_symbol_key');
  const descriptors = Object.getOwnPropertyDescriptors<object>(input),
    length = descriptors.length?.value as unknown;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0)
    reject('derived_array_shape');
  const names = Object.keys(descriptors).filter((name) => name !== 'length');
  if (names.length !== length || names.some((name, index) => name !== String(index)))
    reject('json_sparse_or_extra_array');
  const result: unknown[] = [];
  for (const name of names) {
    const descriptor = descriptors[name]!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
      reject('json_non_data_property');
    result.push(descriptor.value);
  }
  return result;
}

export function jsonCopy(
  input: unknown,
  extent: number = NATIVE_SHORT_BODY_RESOURCE_LIMITS.inputJsonBytes,
): Json {
  let nodes = 0;
  const active = new Set<object>();
  function visit(value: unknown, depth: number): Json {
    if (
      ++nodes > NATIVE_SHORT_BODY_RESOURCE_LIMITS.nodes ||
      depth > NATIVE_SHORT_BODY_RESOURCE_LIMITS.depth
    )
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
    active.add(value);
    let out: Json;
    if (Array.isArray(value)) out = dataArray(value).map((child) => visit(child, depth + 1));
    else {
      const fields = dataObject(value),
        record: Raw = Object.create(null);
      for (const name of Object.keys(fields)) record[name] = visit(fields[name], depth + 1);
      out = record;
    }
    active.delete(value);
    return out;
  }
  const copy = visit(input, 0);
  if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > extent) reject('json_extent_limit');
  return copy;
}

/** New bases only. Rebuilding an object would reorder integer-like keys. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (typeof encoded !== 'string') reject('json_invalid_value');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const fields = value as Record<string, unknown>;
  return `{${Object.keys(fields)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(fields[key])}`)
    .join(',')}}`;
}

export function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

export function exactHash(value: unknown): string {
  if (typeof value !== 'string' || !HASH.test(value)) reject('expectation_hash');
  return value;
}

/** Derived projections have a fixed schema, not a combined copy-of-source input budget. */
export function sameDerived(
  input: unknown,
  expected: unknown,
  code: NativeShortBodyErrorCode,
): void {
  const active = new Set<object>();
  function visit(value: unknown, wanted: unknown): void {
    if (wanted === null || typeof wanted !== 'object') {
      if (!Object.is(value, wanted)) reject(code);
      return;
    }
    if (!value || typeof value !== 'object') reject(code);
    if (active.has(value)) reject('json_cycle');
    active.add(value);
    if (Array.isArray(wanted)) {
      const items = dataArray(value);
      if (items.length !== wanted.length) reject(code);
      items.forEach((item, index) => visit(item, wanted[index]));
    } else {
      const desired = wanted as Record<string, unknown>,
        fields = dataObject(value, Object.keys(desired));
      for (const name of Object.keys(desired)) visit(fields[name], desired[name]);
    }
    active.delete(value);
  }
  visit(input, expected);
}
