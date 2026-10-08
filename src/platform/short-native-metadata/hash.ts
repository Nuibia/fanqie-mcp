import { createHash } from 'node:crypto';

import {
  canonical,
  type Json,
  type NativeShortBinding,
  record,
  keys,
  reject,
  textValue,
  type CategoryId,
  type CategoryRow,
  NATIVE_SHORT_RESOURCE_LIMITS,
  type SavedFields,
  NATIVE_SHORT_HASH_BASES,
  NATIVE_SHORT_METADATA_SCOPE,
  type NativeShortMetadataRawInput,
  type LegacyNativeShortMetadataSnapshot,
  jsonCopy,
  type NativeShortMetadataSnapshot,
  has,
  freeze,
  type RawObject,
  type MathSnapshot,
  type NativeShortMetadataPlan,
} from './reject.js';

import { resolveShortEditorStatus, validateShortStatusFacts } from '../short-status.js';

export function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

export function bind(input: Json): NativeShortBinding {
  const binding = record(input, 'binding_shape');
  keys(binding, ['account', 'work'], 'binding_shape');
  const account = record(binding.account!, 'binding_shape'),
    work = record(binding.work!, 'binding_shape');
  keys(account, ['kind', 'id'], 'binding_shape');
  keys(work, ['kind', 'id'], 'binding_shape');
  if (account.kind !== 'account_id' || work.kind !== 'short') reject('binding_kind');
  const accountId = textValue(account.id, 'account_id', true),
    workId = textValue(work.id, 'work_id', true);
  // Stable IDs are opaque decimal strings; no response sentinel is a request target.
  if (!/^[0-9]{1,30}$/.test(accountId) || !/^[1-9][0-9]{9,21}$/.test(workId)) reject('binding_id');
  return { account: { kind: 'account_id', id: accountId }, work: { kind: 'short', id: workId } };
}

function categoryId(value: Json | undefined): CategoryId {
  if (
    (typeof value !== 'string' || !value || /[,\r\n\u0000]/u.test(value)) &&
    (typeof value !== 'number' || !Number.isSafeInteger(value))
  )
    reject('category_id');
  return value as CategoryId;
}

export function categories(value: Json | undefined, catalog: boolean): CategoryRow[] {
  if (
    !Array.isArray(value) ||
    value.length > NATIVE_SHORT_RESOURCE_LIMITS.categoryCount ||
    (catalog && !value.length)
  )
    reject('category_shape');
  return value.map((row) => {
    const data = record(row, 'category_shape');
    return {
      category_id: categoryId(data.category_id),
      label: textValue(data.label, 'category_label', true),
      name: textValue(data.name, 'category_name', true),
    };
  });
}

// Exact form-representable scalars are an offline semantic domain, not a live API-shape claim.
// Original sign/activity types remain in the full source and preservation hashes.
function sign(value: Json | undefined): 1 | null {
  return value === 1 || value === '1' ? 1 : null;
}

function activity(value: Json | undefined): 0 | 1 | null {
  return value === 0 || value === '0' ? 0 : value === 1 || value === '1' ? 1 : null;
}

export function savedHash(binding: NativeShortBinding, fields: SavedFields): string {
  return hash({
    basis: NATIVE_SHORT_HASH_BASES.savedFields,
    scope: NATIVE_SHORT_METADATA_SCOPE,
    binding,
    fields,
  });
}

export function categorySelectionHash(
  binding: NativeShortBinding,
  rows: readonly CategoryRow[],
): string {
  return hash({
    basis: NATIVE_SHORT_HASH_BASES.categorySelection,
    scope: NATIVE_SHORT_METADATA_SCOPE,
    binding,
    rows,
  });
}

/** Local factory: does not prove owner, freshness, response provenance or live API support. */
export function createHistoricalSnapshotCore(
  input: NativeShortMetadataRawInput,
): LegacyNativeShortMetadataSnapshot {
  // Read outer descriptors too, so an accessor cannot run before validation.
  const outer = record(
    jsonCopy(input, 2 * NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes + 1024),
    'snapshot_input',
  );
  keys(outer, ['binding', 'editData', 'categoryData'], 'snapshot_input');
  const binding = bind(outer.binding!);
  const editData = record(outer.editData!, 'edit_shape'),
    categoryData = record(outer.categoryData!, 'catalog_shape');
  for (const response of [editData, categoryData]) {
    if (
      Buffer.byteLength(JSON.stringify(response), 'utf8') >
      NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes
    )
      reject('json_extent_limit');
  }
  let responseBinding: NativeShortMetadataSnapshot['responseBinding'] = 'absent';
  if (has(editData, 'item_id')) {
    if (editData.item_id === binding.work.id) responseBinding = 'exact';
    else if (editData.item_id === '0') responseBinding = 'sentinel';
    else reject('response_target_mismatch');
  }
  const titles = editData.multi_title;
  if (!Array.isArray(titles) || !titles.length || titles.some((value) => typeof value !== 'string'))
    reject('multi_title_shape');
  const catalog = categories(categoryData.category_list, true);
  const tokens = new Set<string>();
  for (const row of catalog) {
    const token = String(row.category_id);
    if (tokens.has(token)) reject('catalog_duplicate_or_csv_collision');
    tokens.add(token);
  }
  const fields: SavedFields = {
    item_id: binding.work.id,
    content: textValue(editData.content, 'content_missing'),
    multi_title: titles as string[],
    thumb_uri: textValue(editData.thumb_uri, 'thumb_uri_missing'),
    book_thumb_uri: textValue(editData.book_thumb_uri, 'book_thumb_uri_missing'),
    category: categories(editData.category, false).map((row) => row.category_id),
    sign_type: sign(editData.sign_type),
    activity_flag: activity(editData.origin_activity_flag),
  };
  return freeze({
    scope: NATIVE_SHORT_METADATA_SCOPE,
    hashBases: NATIVE_SHORT_HASH_BASES,
    binding,
    editData,
    categoryData,
    responseBinding,
    state:
      editData.publish_status === 0
        ? 'draft'
        : editData.publish_status === 1
          ? 'published'
          : 'unknown',
    catalog,
    savedFields: fields,
    snapshotVersionHash: hash({
      basis: NATIVE_SHORT_HASH_BASES.snapshot,
      scope: NATIVE_SHORT_METADATA_SCOPE,
      binding,
      editData,
      categoryData,
    }),
    catalogHash: hash({ basis: NATIVE_SHORT_HASH_BASES.catalog, categoryData }),
    documentHash: createHash('sha256').update(fields.content, 'utf8').digest('hex'),
    savedFieldsHash: savedHash(binding, fields),
    categorySelectionHash: categorySelectionHash(binding, categories(editData.category, false)),
  });
}

export function createNativeShortMetadataSnapshot(
  input: NativeShortMetadataRawInput,
): NativeShortMetadataSnapshot {
  const original = createHistoricalSnapshotCore(input),
    statusFacts = resolveShortEditorStatus(original.editData);
  return freeze({ ...original, state: statusFacts.resolvedState, statusFacts });
}

const SNAPSHOT_KEYS = [
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

function capturedSnapshot(input: unknown, modern: boolean): RawObject {
  const names: readonly string[] = modern ? [...SNAPSHOT_KEYS, 'statusFacts'] : SNAPSHOT_KEYS;
  // Keep the snapshot envelope gate ahead of traversal. Its own accessors are
  // shape failures and must never run; nested JSON retains the original gates.
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Object.getOwnPropertySymbols(input).length
  )
    reject('snapshot_shape');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    Object.keys(descriptors).length !== names.length ||
    names.some(
      (key) =>
        !Object.hasOwn(descriptors, key) ||
        !Object.hasOwn(descriptors[key]!, 'value') ||
        descriptors[key]!.enumerable !== true,
    )
  )
    reject('snapshot_shape');
  // Derived carriers repeat bounded raw fields. Raw constructors retain their original source bounds.
  const value = record(
    jsonCopy(
      input,
      8 * NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes + 4096,
      8 * NATIVE_SHORT_RESOURCE_LIMITS.nodes,
    ),
    'snapshot_shape',
  );
  if (Object.keys(value).length !== names.length || names.some((key) => !has(value, key)))
    reject('snapshot_shape');
  return value;
}

export function checkedSnapshot(input: unknown): NativeShortMetadataSnapshot {
  const value = capturedSnapshot(input, true);
  try {
    validateShortStatusFacts(value.statusFacts);
  } catch {
    reject('snapshot_hash_mismatch');
  }
  const rebuilt = createNativeShortMetadataSnapshot({
    binding: value.binding as unknown as NativeShortBinding,
    editData: value.editData,
    categoryData: value.categoryData,
  });
  if (canonical(value) !== canonical(rebuilt)) reject('snapshot_hash_mismatch');
  return rebuilt;
}

export function checkedHistoricalSnapshot(input: unknown): LegacyNativeShortMetadataSnapshot {
  const value = capturedSnapshot(input, false);
  const rebuilt = createHistoricalSnapshotCore({
    binding: value.binding as unknown as NativeShortBinding,
    editData: value.editData,
    categoryData: value.categoryData,
  });
  if (canonical(value) !== canonical(rebuilt)) reject('snapshot_hash_mismatch');
  return rebuilt;
}

export function preservationHash(
  snapshot: MathSnapshot,
  requested: { title: boolean; categories: boolean },
): string {
  const edit = record(jsonCopy(snapshot.editData), 'edit_shape');
  if (requested.title)
    edit.multi_title = [null, ...snapshot.savedFields.multi_title.slice(1)] as Json[];
  if (requested.categories) delete edit.category;
  return hash({
    basis: NATIVE_SHORT_HASH_BASES.preservation,
    scope: NATIVE_SHORT_METADATA_SCOPE,
    binding: snapshot.binding,
    editData: edit,
    categoryData: snapshot.categoryData,
  });
}

export function categoryMaximum(edit: Readonly<RawObject>): NativeShortMetadataPlan['categoryMax'] {
  if (!has(edit, 'category_max_count')) return { value: 8, basis: 'public-client-default-8' };
  const value = edit.category_max_count;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > NATIVE_SHORT_RESOURCE_LIMITS.categoryCount
  )
    reject('category_max_count');
  return { value, basis: 'source' };
}

export function nativeShortMetadataEndpoints(workId: string): {
  readonly edit: string;
  readonly catalog: string;
  readonly save: string;
  readonly contentType: string;
} {
  if (!/^[1-9][0-9]{9,21}$/.test(workId)) reject('work_id');
  const url = (path: string, extra: Record<string, string> = {}) => {
    const result = new URL(path, 'https://fanqienovel.com');
    result.search = new URLSearchParams({
      ...extra,
      aid: '2503',
      app_name: 'muye_novel',
    }).toString();
    return result.href;
  };
  return freeze({
    edit: url('/api/author/short_article/edit/v1/', { item_id: workId, image_fmt_list: '270x480' }),
    catalog: url('/api/author/short_article/get_category_list/v1/'),
    save: url('/api/author/short_article/cover/v0/'),
    contentType: 'application/x-www-form-urlencoded;charset=UTF-8',
  });
}
