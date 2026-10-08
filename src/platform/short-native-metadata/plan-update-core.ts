import {
  type MathSnapshot,
  type NativeShortMetadataRequest,
  type SnapshotChecker,
  type NativeShortMetadataPlan,
  record,
  jsonCopy,
  keys,
  has,
  type RawObject,
  reject,
  NATIVE_SHORT_HASH_BASES,
  textValue,
  NATIVE_SHORT_RESOURCE_LIMITS,
  type SavedFields,
  freeze,
  NATIVE_SHORT_METADATA_SCOPE,
  type NativeShortMetadataExpectation,
  type NativeShortMetadataComparison,
  canonical,
  type NativeShortMetadataComparisonReason,
  type NativeShortServerRevision,
  type Json,
  NATIVE_SHORT_WRITE_HASH_BASES_V2,
  type NativeShortMetadataPlanV2,
  NATIVE_SHORT_SERVER_REVISION_POLICY_V2,
} from './reject.js';

import {
  categoryMaximum,
  categories,
  nativeShortMetadataEndpoints,
  savedHash,
  preservationHash,
  categorySelectionHash,
  bind,
  hash,
} from './hash.js';

export function planUpdateCore(
  snapshot: MathSnapshot,
  input: NativeShortMetadataRequest,
  check: SnapshotChecker,
): NativeShortMetadataPlan {
  const request = record(jsonCopy(input), 'request_shape');
  keys(
    request,
    ['expectedSnapshotVersionHash', 'hashBasis', 'expectedState', 'title', 'metadata'],
    'unsupported_field',
  );
  const metadata = has(request, 'metadata')
    ? record(request.metadata!, 'metadata_shape')
    : (Object.create(null) as RawObject);
  keys(metadata, ['categories'], 'unsupported_field');
  const requested = { title: has(request, 'title'), categories: has(metadata, 'categories') };
  if (!requested.title && !requested.categories) reject('empty_request');
  const before = check(snapshot);
  if (
    request.hashBasis !== NATIVE_SHORT_HASH_BASES.snapshot ||
    request.expectedSnapshotVersionHash !== before.snapshotVersionHash
  )
    reject('source_version_mismatch');
  if (request.expectedState !== 'draft' || before.state !== 'draft') reject('state_not_draft');
  if (before.savedFields.sign_type !== 1) reject('sign_type_unsupported');
  if (before.savedFields.activity_flag === null) reject('activity_flag_unsupported');
  const categoryMax = categoryMaximum(before.editData);
  const titles = [...before.savedFields.multi_title];
  if (requested.title) {
    const title = textValue(request.title, 'title_invalid', true);
    if (
      /[\r\n\u0000]/u.test(title) ||
      Buffer.byteLength(title, 'utf8') > NATIVE_SHORT_RESOURCE_LIMITS.newTitleUtf8Bytes
    )
      reject('title_resource_or_shape');
    titles[0] = title;
  }
  let ids = [...before.savedFields.category];
  let desiredCategories = categories(before.editData.category, false);
  if (requested.categories) {
    const list = metadata.categories;
    if (!Array.isArray(list) || !list.length || list.some((value) => typeof value !== 'string'))
      reject('requested_category_shape');
    if (list.length > categoryMax.value) reject('category_max_exceeded');
    const authorize = before.editData.authorize_type;
    if (
      !has(before.editData, 'authorize_type') ||
      authorize === null ||
      !['boolean', 'number', 'string'].includes(typeof authorize)
    )
      reject('authorize_type_unsupported');
    const mainLabel = before.catalog[0]!.label;
    const mainIds = new Set(
      before.catalog.filter((row) => row.label === mainLabel).map((row) => row.category_id),
    );
    if (Boolean(authorize) && before.savedFields.category.some((id) => mainIds.has(id)))
      reject('category_locked');
    const lookup = new Map(before.catalog.map((row) => [String(row.category_id), row]));
    const seen = new Set<string>();
    const selected = list.map((value) => {
      const token = value as string;
      if (seen.has(token)) reject('requested_category_duplicate');
      seen.add(token);
      const row = lookup.get(token);
      if (!row) reject('requested_category_unknown');
      return row;
    });
    if (selected.filter((row) => row.label === mainLabel).length !== 1)
      reject('main_category_exactly_one');
    const groups = [...new Set(before.catalog.map((row) => row.label))];
    desiredCategories = selected.sort(
      (left, right) => groups.indexOf(left.label) - groups.indexOf(right.label),
    );
    ids = desiredCategories.map((row) => row.category_id);
  }
  const fields: SavedFields = { ...before.savedFields, multi_title: titles, category: ids };
  const form: Record<string, string> = {
    item_id: before.binding.work.id,
    content: fields.content,
    thumb_uri: fields.thumb_uri,
    book_thumb_uri: fields.book_thumb_uri,
    item_version: '-1',
    multi_title: JSON.stringify(titles),
    sign_type: '1',
    activity_flag: String(fields.activity_flag),
  };
  if (ids.length) form.category = ids.map(String).join(',');
  const endpoints = nativeShortMetadataEndpoints(before.binding.work.id);
  return freeze({
    kind: 'native_metadata_payload_plan',
    atomicRevision: false,
    categoryMax,
    form,
    expectation: {
      scope: NATIVE_SHORT_METADATA_SCOPE,
      hashBases: NATIVE_SHORT_HASH_BASES,
      binding: before.binding,
      expectedState: 'draft',
      requested,
      sourceVersionHash: before.snapshotVersionHash,
      catalogHash: before.catalogHash,
      documentHash: before.documentHash,
      savedFieldsHash: savedHash(before.binding, fields),
      preservationHash: preservationHash(before, requested),
      categorySelectionHash: categorySelectionHash(before.binding, desiredCategories),
    },
    request: {
      method: 'POST',
      url: endpoints.save,
      contentType: endpoints.contentType,
      body: new URLSearchParams(form).toString(),
    },
  });
}

/** Hash-only expectation is JSON-portable for later read-only intent/reconcile. Never a save ACK. */
export function compareReadbackCore(
  expected: NativeShortMetadataExpectation,
  snapshot: MathSnapshot,
  check: SnapshotChecker,
): NativeShortMetadataComparison {
  const input = record(jsonCopy(expected), 'expectation_shape');
  keys(
    input,
    [
      'scope',
      'hashBases',
      'binding',
      'expectedState',
      'requested',
      'sourceVersionHash',
      'catalogHash',
      'documentHash',
      'savedFieldsHash',
      'preservationHash',
      'categorySelectionHash',
    ],
    'expectation_shape',
  );
  if (
    input.scope !== NATIVE_SHORT_METADATA_SCOPE ||
    canonical(input.hashBases) !== canonical(NATIVE_SHORT_HASH_BASES) ||
    input.expectedState !== 'draft'
  )
    reject('expectation_scope');
  const binding = bind(input.binding!);
  const requested = record(input.requested!, 'expectation_shape');
  keys(requested, ['title', 'categories'], 'expectation_shape');
  if (
    typeof requested.title !== 'boolean' ||
    typeof requested.categories !== 'boolean' ||
    (!requested.title && !requested.categories)
  )
    reject('expectation_shape');
  for (const key of [
    'sourceVersionHash',
    'catalogHash',
    'documentHash',
    'savedFieldsHash',
    'preservationHash',
    'categorySelectionHash',
  ]) {
    if (typeof input[key] !== 'string' || !/^[0-9a-f]{64}$/.test(input[key] as string))
      reject('expectation_hash');
  }
  const after = check(snapshot);
  const actual = {
    snapshotVersionHash: after.snapshotVersionHash,
    catalogHash: after.catalogHash,
    documentHash: after.documentHash,
    savedFieldsHash: after.savedFieldsHash,
    preservationHash: preservationHash(after, {
      title: requested.title,
      categories: requested.categories,
    }),
    categorySelectionHash: after.categorySelectionHash,
  };
  const reason: NativeShortMetadataComparisonReason =
    canonical(binding) !== canonical(after.binding)
      ? 'binding_changed'
      : after.state !== 'draft'
        ? 'state_not_draft'
        : input.catalogHash !== actual.catalogHash
          ? 'catalog_changed'
          : input.documentHash !== actual.documentHash
            ? 'document_changed'
            : input.savedFieldsHash !== actual.savedFieldsHash
              ? 'saved_fields_changed'
              : input.categorySelectionHash !== actual.categorySelectionHash
                ? 'category_selection_changed'
                : input.preservationHash !== actual.preservationHash
                  ? 'preservation_not_proven'
                  : 'match';
  return freeze({
    matches: reason === 'match',
    reason,
    scope: NATIVE_SHORT_METADATA_SCOPE,
    hashBases: NATIVE_SHORT_HASH_BASES,
    actual,
  });
}

export function serverRevision(value: RawObject, before: boolean): NativeShortServerRevision {
  // jsonCopy has already rejected getters, symbols, inherited and non-enumerable data.
  if (!has(value, 'latestVersion') || !has(value, 'modifyTime')) reject('server_revision_shape');
  keys(value, ['latestVersion', 'modifyTime'], 'server_revision_shape');
  const latestVersion = value.latestVersion,
    modifyTime = value.modifyTime;
  if (
    typeof latestVersion !== 'number' ||
    !Number.isSafeInteger(latestVersion) ||
    latestVersion < 0 ||
    Object.is(latestVersion, -0) ||
    (before && latestVersion === Number.MAX_SAFE_INTEGER) ||
    typeof modifyTime !== 'string' ||
    modifyTime.length !== 10 ||
    !/^[0-9]{10}$/.test(modifyTime)
  )
    reject('server_revision_shape');
  return freeze({ latestVersion, modifyTime });
}

export function snapshotRevision(
  snapshot: MathSnapshot,
  before: boolean,
): NativeShortServerRevision {
  const edit = record(jsonCopy(snapshot.editData), 'edit_shape');
  if (!has(edit, 'latest_version') || !has(edit, 'modify_time')) reject('server_revision_shape');
  return serverRevision(
    { latestVersion: edit.latest_version!, modifyTime: edit.modify_time! },
    before,
  );
}

export function preservationHashV2(
  snapshot: MathSnapshot,
  requested: { title: boolean; categories: boolean },
): string {
  const edit = record(jsonCopy(snapshot.editData), 'edit_shape');
  if (requested.title)
    edit.multi_title = [null, ...snapshot.savedFields.multi_title.slice(1)] as Json[];
  if (requested.categories) delete edit.category;
  delete edit.latest_version;
  delete edit.modify_time;
  return hash({
    basis: NATIVE_SHORT_WRITE_HASH_BASES_V2.preservation,
    scope: NATIVE_SHORT_METADATA_SCOPE,
    binding: snapshot.binding,
    editData: edit,
    categoryData: snapshot.categoryData,
  });
}

/** Same payload contract as v1, with an independently versioned preservation expectation. */
export function planUpdateV2Core(
  snapshot: MathSnapshot,
  input: NativeShortMetadataRequest,
  check: SnapshotChecker,
): NativeShortMetadataPlanV2 {
  const before = check(snapshot),
    revision = snapshotRevision(before, true);
  const legacyPlan = planUpdateCore(before, input, check);
  return freeze({
    ...legacyPlan,
    expectation: {
      ...legacyPlan.expectation,
      version: 2,
      hashBases: NATIVE_SHORT_WRITE_HASH_BASES_V2,
      preservationHash: preservationHashV2(before, legacyPlan.expectation.requested),
      serverRevisionPolicy: NATIVE_SHORT_SERVER_REVISION_POLICY_V2,
      serverRevisionBefore: revision,
    },
  });
}
