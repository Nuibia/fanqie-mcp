import {
  type StoredNative,
  type NativeShortCoverUploadRequest,
  type NativeShortCoverUploadIntent,
  record,
  jsonCopy,
  exactKeys,
  digest,
  reject,
  NATIVE_SHORT_COVER_SCOPE,
  NATIVE_SHORT_COVER_HASH_BASES,
  NATIVE_SHORT_COVER_SERVER_REVISION_POLICY,
  NATIVE_SHORT_COVER_DERIVED_URL_POLICY,
  freeze,
  canonical,
  type Json,
  ACK_TEXT_BYTES,
  hash,
  type NativeShortCoverExpectation,
  type NativeShortCoverUploadAcknowledgementInput,
  type NativeShortCoverPlan,
  type NativeShortCoverComparison,
  type ServerRevision,
  NativeShortCoverError,
  type NativeShortCoverComparisonReason,
} from './reject.js';

import {
  writableBefore,
  validateNativeShortCoverAsset,
  preservationHash,
  assetHash,
  intentHash,
  checkedIntent,
  checkedSnapshot,
  SOURCE_HASH_NAMES,
  requireScope,
  binding,
  revision,
  snapshotRevision,
  derivedUrls,
} from './binding.js';

import {
  NATIVE_SHORT_HASH_BASES,
  type NativeShortMetadataSnapshot,
  type NativeShortBinding,
  createNativeShortMetadataSnapshot,
  type NativeShortMetadataRawInput,
  NATIVE_SHORT_RESOURCE_LIMITS,
  nativeShortMetadataEndpoints,
} from '../short-native-metadata.js';

export function createUploadIntentCore(
  before: StoredNative,
  input: NativeShortCoverUploadRequest,
): NativeShortCoverUploadIntent {
  const request = record(jsonCopy(input), 'request_shape');
  exactKeys(
    request,
    ['expectedSnapshotVersionHash', 'hashBasis', 'expectedState', 'asset'],
    'request_shape',
  );
  const serverRevisionBefore = writableBefore(before);
  if (
    request.hashBasis !== NATIVE_SHORT_HASH_BASES.snapshot ||
    digest(request.expectedSnapshotVersionHash) !== before.snapshotVersionHash
  )
    reject('source_version_mismatch');
  if (request.expectedState !== 'draft') reject('state_not_draft');
  const asset = validateNativeShortCoverAsset(request.asset);
  const payload: Omit<NativeShortCoverUploadIntent, 'intentHash'> = {
    schema: 'native-short-cover-upload-intent/v1',
    scope: NATIVE_SHORT_COVER_SCOPE,
    hashBases: NATIVE_SHORT_COVER_HASH_BASES,
    binding: before.binding,
    expectedState: 'draft',
    sourceVersionHash: before.snapshotVersionHash,
    catalogHash: before.catalogHash,
    documentHash: before.documentHash,
    savedFieldsHash: before.savedFieldsHash,
    categorySelectionHash: before.categorySelectionHash,
    preservationHash: preservationHash(before, true),
    serverRevisionPolicy: NATIVE_SHORT_COVER_SERVER_REVISION_POLICY,
    serverRevisionBefore,
    derivedUrlPolicy: NATIVE_SHORT_COVER_DERIVED_URL_POLICY,
    asset,
    assetHash: assetHash(asset),
  };
  return freeze({ ...payload, intentHash: intentHash(payload) });
}

export function preSave<T extends StoredNative>(
  before: T,
  intent: NativeShortCoverUploadIntent,
): T {
  const expected = checkedIntent(intent),
    beforeRevision = writableBefore(before);
  if (canonical(expected.binding) !== canonical(before.binding)) reject('binding_changed');
  if (
    expected.sourceVersionHash !== before.snapshotVersionHash ||
    expected.catalogHash !== before.catalogHash ||
    expected.documentHash !== before.documentHash ||
    expected.savedFieldsHash !== before.savedFieldsHash ||
    expected.categorySelectionHash !== before.categorySelectionHash ||
    expected.preservationHash !== preservationHash(before, true) ||
    canonical(expected.serverRevisionBefore) !== canonical(beforeRevision)
  )
    reject('source_version_mismatch');
  return before;
}

/** Run both before upload planning and after upload, immediately before a later save attempt. */
export function assertNativeShortCoverPreSave(
  snapshot: NativeShortMetadataSnapshot,
  intent: NativeShortCoverUploadIntent,
): void {
  preSave(checkedSnapshot(snapshot), intent);
}

function ackText(value: Json | undefined): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    /\p{Cc}/u.test(value) ||
    Buffer.byteLength(value, 'utf8') > ACK_TEXT_BYTES
  )
    reject('upload_ack_shape');
  return value;
}

function uriHash(target: NativeShortBinding, uri: string): string {
  return hash({
    basis: NATIVE_SHORT_COVER_HASH_BASES.coverUri,
    scope: NATIVE_SHORT_COVER_SCOPE,
    binding: target,
    uri,
  });
}

function checkedExpectation(input: NativeShortCoverExpectation): NativeShortCoverExpectation {
  const value = record(jsonCopy(input), 'expectation_shape');
  exactKeys(
    value,
    [
      'schema',
      'scope',
      'hashBases',
      'binding',
      'expectedState',
      ...SOURCE_HASH_NAMES,
      'intentHash',
      'assetHash',
      'uploadAckHash',
      'coverUriHash',
      'serverRevisionPolicy',
      'serverRevisionBefore',
      'derivedUrlPolicy',
    ],
    'expectation_shape',
  );
  if (value.schema !== 'native-short-cover-save-expectation/v1') reject('expectation_shape');
  requireScope(value);
  binding(value.binding);
  revision(value.serverRevisionBefore, true);
  for (const key of [
    ...SOURCE_HASH_NAMES,
    'intentHash',
    'assetHash',
    'uploadAckHash',
    'coverUriHash',
  ])
    digest(value[key]);
  return freeze(value as unknown as NativeShortCoverExpectation);
}

/** Hashes the complete strict portable expectation. Local SHA is never a platform image-content claim. */
export function nativeShortCoverDesiredContentHash(input: NativeShortCoverExpectation): string {
  const expectation = checkedExpectation(input);
  return hash({ basis: NATIVE_SHORT_COVER_HASH_BASES.desiredContent, expectation });
}

/** ACK envelope and transport verification belong to the future owned API, not this local planner. */
export function planNativeShortCoverSave(
  snapshot: NativeShortMetadataSnapshot,
  intent: NativeShortCoverUploadIntent,
  input: NativeShortCoverUploadAcknowledgementInput,
): NativeShortCoverPlan {
  return planSaveCore(checkedSnapshot(snapshot), intent, input, createNativeShortMetadataSnapshot);
}

export function planSaveCore(
  snapshot: StoredNative,
  intent: NativeShortCoverUploadIntent,
  input: NativeShortCoverUploadAcknowledgementInput,
  rebuildMetadata: (raw: NativeShortMetadataRawInput) => StoredNative,
): NativeShortCoverPlan {
  const ack = record(jsonCopy(input), 'upload_ack_shape');
  exactKeys(ack, ['picUri', 'picUrl'], 'upload_ack_shape');
  const picUri = ackText(ack.picUri),
    picUrl = ackText(ack.picUrl);
  const expected = checkedIntent(intent),
    before = preSave(snapshot, expected);
  const uploadAckHash = hash({
    basis: NATIVE_SHORT_COVER_HASH_BASES.uploadAck,
    scope: NATIVE_SHORT_COVER_SCOPE,
    binding: before.binding,
    intentHash: expected.intentHash,
    assetHash: expected.assetHash,
    ack: { picUri, picUrl },
  });
  const edit = record(
    jsonCopy(before.editData, NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes),
    'snapshot_shape',
  );
  edit.book_thumb_uri = picUri;
  const desired = rebuildMetadata({
    binding: before.binding,
    editData: edit,
    categoryData: before.categoryData,
  });
  const fields = desired.savedFields;
  const form: Record<string, string> = {
    item_id: before.binding.work.id,
    content: fields.content,
    thumb_uri: fields.thumb_uri,
    book_thumb_uri: fields.book_thumb_uri,
    item_version: '-1',
    multi_title: JSON.stringify(fields.multi_title),
    sign_type: '1',
    activity_flag: String(fields.activity_flag),
  };
  if (fields.category.length) form.category = fields.category.map(String).join(',');
  const expectation: NativeShortCoverExpectation = {
    schema: 'native-short-cover-save-expectation/v1',
    scope: NATIVE_SHORT_COVER_SCOPE,
    hashBases: NATIVE_SHORT_COVER_HASH_BASES,
    binding: before.binding,
    expectedState: 'draft',
    sourceVersionHash: expected.sourceVersionHash,
    intentHash: expected.intentHash,
    assetHash: expected.assetHash,
    uploadAckHash,
    coverUriHash: uriHash(before.binding, picUri),
    catalogHash: before.catalogHash,
    documentHash: before.documentHash,
    savedFieldsHash: desired.savedFieldsHash,
    categorySelectionHash: before.categorySelectionHash,
    preservationHash: expected.preservationHash,
    serverRevisionPolicy: NATIVE_SHORT_COVER_SERVER_REVISION_POLICY,
    serverRevisionBefore: expected.serverRevisionBefore,
    derivedUrlPolicy: NATIVE_SHORT_COVER_DERIVED_URL_POLICY,
  };
  const desiredContentHash = nativeShortCoverDesiredContentHash(expectation),
    endpoints = nativeShortMetadataEndpoints(before.binding.work.id);
  return freeze({
    kind: 'native_short_cover_payload_plan',
    atomicRevision: false,
    expectation,
    intentHash: expected.intentHash,
    uploadAckHash,
    desiredContentHash,
    form,
    request: {
      method: 'POST',
      url: endpoints.save,
      contentType: endpoints.contentType,
      body: new URLSearchParams(form).toString(),
    },
  });
}

/** Independent local readback comparison. Does not fetch an image or authorize a successor write. */
export function compareNativeShortCoverReadback(
  input: NativeShortCoverExpectation,
  snapshot: NativeShortMetadataSnapshot,
): NativeShortCoverComparison {
  return compareReadbackCore(input, checkedSnapshot(snapshot));
}

export function compareReadbackCore(
  input: NativeShortCoverExpectation,
  after: StoredNative,
): NativeShortCoverComparison {
  const expected = checkedExpectation(input);
  let afterRevision: ServerRevision | null = null;
  try {
    afterRevision = snapshotRevision(after, false);
  } catch (error) {
    if (!(error instanceof NativeShortCoverError)) throw error;
  }
  const revisionMatches =
    afterRevision !== null &&
    afterRevision.latestVersion === expected.serverRevisionBefore.latestVersion + 1 &&
    afterRevision.modifyTime >= expected.serverRevisionBefore.modifyTime;
  const urlsMatch = derivedUrls(after, false);
  const actual = {
    snapshotVersionHash: after.snapshotVersionHash,
    catalogHash: after.catalogHash,
    documentHash: after.documentHash,
    savedFieldsHash: after.savedFieldsHash,
    categorySelectionHash: after.categorySelectionHash,
    // No unvalidated revision or malformed URL-list value is hidden, even in failure diagnostics.
    preservationHash: preservationHash(after, revisionMatches && urlsMatch),
    coverUriHash: uriHash(after.binding, after.savedFields.book_thumb_uri),
    derivedUrlPolicySatisfied: urlsMatch,
    serverRevisionAfter: afterRevision,
  };
  const reason: NativeShortCoverComparisonReason =
    canonical(expected.binding) !== canonical(after.binding)
      ? 'binding_changed'
      : after.state !== 'draft'
        ? 'state_not_draft'
        : !revisionMatches
          ? 'server_revision_not_proven'
          : !urlsMatch
            ? 'derived_urls_not_proven'
            : expected.catalogHash !== actual.catalogHash
              ? 'catalog_changed'
              : expected.documentHash !== actual.documentHash
                ? 'document_changed'
                : expected.categorySelectionHash !== actual.categorySelectionHash
                  ? 'category_selection_changed'
                  : expected.coverUriHash !== actual.coverUriHash
                    ? 'cover_uri_changed'
                    : expected.savedFieldsHash !== actual.savedFieldsHash
                      ? 'saved_fields_changed'
                      : expected.preservationHash !== actual.preservationHash
                        ? 'preservation_not_proven'
                        : 'match';
  return freeze({
    matches: reason === 'match',
    reason,
    scope: NATIVE_SHORT_COVER_SCOPE,
    hashBases: NATIVE_SHORT_COVER_HASH_BASES,
    actual,
  });
}
