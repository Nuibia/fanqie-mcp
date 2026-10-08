import {
  type Json,
  record,
  exactKeys,
  reject,
  type NativeShortCoverFit,
  type NativeShortCoverImagePolicy,
  type NativeShortCoverPreparedAsset,
  jsonCopy,
  canonical,
  NATIVE_SHORT_COVER_LIMITS,
  freeze,
  digest,
  type StoredNative,
  SNAPSHOT_BYTES,
  type ServerRevision,
  OWN,
  hash,
  NATIVE_SHORT_COVER_HASH_BASES,
  NATIVE_SHORT_COVER_SCOPE,
  type NativeShortCoverUploadIntent,
  type Data,
  NATIVE_SHORT_COVER_SERVER_REVISION_POLICY,
  NATIVE_SHORT_COVER_DERIVED_URL_POLICY,
  type NativeShortCoverUploadRequest,
} from './reject.js';

import {
  type NativeShortBinding,
  type NativeShortMetadataSnapshot,
  createNativeShortMetadataSnapshot,
  type NativeShortMetadataRawInput,
  NATIVE_SHORT_RESOURCE_LIMITS,
} from '../short-native-metadata.js';

import { createUploadIntentCore } from './create-upload-intent-core.js';

export function binding(value: Json | undefined): NativeShortBinding {
  const data = record(value, 'binding_shape');
  exactKeys(data, ['account', 'work'], 'binding_shape');
  const account = record(data.account, 'binding_shape'),
    work = record(data.work, 'binding_shape');
  exactKeys(account, ['kind', 'id'], 'binding_shape');
  exactKeys(work, ['kind', 'id'], 'binding_shape');
  if (
    account.kind !== 'account_id' ||
    work.kind !== 'short' ||
    typeof account.id !== 'string' ||
    !/^[0-9]{1,30}$/.test(account.id) ||
    typeof work.id !== 'string' ||
    !/^[1-9][0-9]{9,21}$/.test(work.id)
  )
    reject('binding_shape');
  return { account: { kind: 'account_id', id: account.id }, work: { kind: 'short', id: work.id } };
}

function size(value: Json | undefined, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum)
    reject('asset_size_or_dimensions');
  return value;
}

export function nativeShortCoverImagePolicy(
  fit: NativeShortCoverFit = 'cover',
): NativeShortCoverImagePolicy {
  if (fit !== 'cover' && fit !== 'contain') reject('image_fit');
  return Object.freeze({
    version: 'center-cover-or-white-contain/v1',
    fit,
    width: 600,
    height: 800,
    mimeType: 'image/jpeg',
    quality: 0.9,
  });
}

export function validateNativeShortCoverAsset(input: unknown): NativeShortCoverPreparedAsset {
  const value = record(jsonCopy(input), 'asset_shape');
  exactKeys(
    value,
    [
      'sourceSha256',
      'sourceSize',
      'sourceMimeType',
      'sourceWidth',
      'sourceHeight',
      'preparedSha256',
      'preparedSize',
      'policy',
    ],
    'asset_shape',
  );
  const policy = record(value.policy, 'image_policy');
  exactKeys(policy, ['version', 'fit', 'width', 'height', 'mimeType', 'quality'], 'image_policy');
  const fit = policy.fit;
  if (fit !== 'cover' && fit !== 'contain') reject('image_policy');
  const checkedPolicy = nativeShortCoverImagePolicy(fit);
  if (canonical(policy) !== canonical(checkedPolicy)) reject('image_policy');
  if (value.sourceMimeType !== 'image/png' && value.sourceMimeType !== 'image/jpeg')
    reject('asset_mime_type');
  const sourceWidth = size(value.sourceWidth, NATIVE_SHORT_COVER_LIMITS.sourcePixels);
  const sourceHeight = size(value.sourceHeight, NATIVE_SHORT_COVER_LIMITS.sourcePixels);
  if (sourceWidth * sourceHeight > NATIVE_SHORT_COVER_LIMITS.sourcePixels)
    reject('asset_pixel_limit');
  return freeze({
    sourceSha256: digest(value.sourceSha256, 'asset_hash'),
    sourceSize: size(value.sourceSize, NATIVE_SHORT_COVER_LIMITS.sourceBytes),
    sourceMimeType: value.sourceMimeType,
    sourceWidth,
    sourceHeight,
    preparedSha256: digest(value.preparedSha256, 'asset_hash'),
    preparedSize: size(value.preparedSize, NATIVE_SHORT_COVER_LIMITS.preparedBytes),
    policy: checkedPolicy,
  });
}

export function checkedSnapshot(input: NativeShortMetadataSnapshot): NativeShortMetadataSnapshot {
  return checkedSnapshotCore(input, createNativeShortMetadataSnapshot, true);
}

export function checkedSnapshotCore<T extends StoredNative>(
  input: unknown,
  rebuildMetadata: (raw: NativeShortMetadataRawInput) => T,
  modern: boolean,
): T {
  const value = record(jsonCopy(input, SNAPSHOT_BYTES), 'snapshot_shape');
  exactKeys(
    value,
    [
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
      ...(modern ? ['statusFacts'] : []),
    ],
    'snapshot_shape',
  );
  let rebuilt: T;
  try {
    rebuilt = rebuildMetadata({
      binding: binding(value.binding),
      editData: value.editData,
      categoryData: value.categoryData,
    });
  } catch {
    reject('snapshot_invalid');
  }
  // Compare all derived carriers too, not merely the raw-source hash or selected fields.
  if (canonical(value) !== canonical(rebuilt)) reject('snapshot_hash_mismatch');
  return rebuilt;
}

export function revision(value: Json | undefined, before: boolean): ServerRevision {
  const data = record(value, 'server_revision_shape');
  exactKeys(data, ['latestVersion', 'modifyTime'], 'server_revision_shape');
  const latestVersion = data.latestVersion,
    modifyTime = data.modifyTime;
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

export function snapshotRevision(snapshot: StoredNative, before: boolean): ServerRevision {
  if (!OWN(snapshot.editData, 'latest_version') || !OWN(snapshot.editData, 'modify_time'))
    reject('server_revision_shape');
  return revision(
    {
      latestVersion: snapshot.editData.latest_version!,
      modifyTime: snapshot.editData.modify_time!,
    },
    before,
  );
}

export function derivedUrls(snapshot: StoredNative, before: boolean): boolean {
  if (!OWN(snapshot.editData, 'book_thumb_url_list')) return false;
  const value = snapshot.editData.book_thumb_url_list;
  if (!Array.isArray(value) || (!before && !value.length)) return false;
  // Objects can have unknown bounded JSON contents; main_url has not been proven by static schema.
  return value.every((entry) =>
    typeof entry === 'string'
      ? Boolean(entry.trim())
      : entry !== null && typeof entry === 'object' && !Array.isArray(entry),
  );
}

export function preservationHash(snapshot: StoredNative, maskProven: boolean): string {
  const edit = record(
    jsonCopy(snapshot.editData, NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes),
    'snapshot_shape',
  );
  if (maskProven) {
    delete edit.book_thumb_uri;
    delete edit.book_thumb_url_list;
    delete edit.latest_version;
    delete edit.modify_time;
  }
  return hash({
    basis: NATIVE_SHORT_COVER_HASH_BASES.preservation,
    scope: NATIVE_SHORT_COVER_SCOPE,
    binding: snapshot.binding,
    editData: edit,
    categoryData: snapshot.categoryData,
  });
}

export function assetHash(asset: NativeShortCoverPreparedAsset): string {
  return hash({
    basis: NATIVE_SHORT_COVER_HASH_BASES.asset,
    scope: NATIVE_SHORT_COVER_SCOPE,
    asset,
  });
}

export function intentHash(value: Omit<NativeShortCoverUploadIntent, 'intentHash'>): string {
  return hash({ basis: NATIVE_SHORT_COVER_HASH_BASES.intent, intent: value });
}

export function requireScope(data: Data): void {
  if (
    data.scope !== NATIVE_SHORT_COVER_SCOPE ||
    canonical(data.hashBases) !== canonical(NATIVE_SHORT_COVER_HASH_BASES) ||
    data.expectedState !== 'draft' ||
    data.serverRevisionPolicy !== NATIVE_SHORT_COVER_SERVER_REVISION_POLICY ||
    data.derivedUrlPolicy !== NATIVE_SHORT_COVER_DERIVED_URL_POLICY
  )
    reject('carrier_scope');
}

export const SOURCE_HASH_NAMES = [
  'sourceVersionHash',
  'catalogHash',
  'documentHash',
  'savedFieldsHash',
  'categorySelectionHash',
  'preservationHash',
] as const;

export function checkedIntent(input: NativeShortCoverUploadIntent): NativeShortCoverUploadIntent {
  const value = record(jsonCopy(input), 'intent_shape');
  exactKeys(
    value,
    [
      'schema',
      'scope',
      'hashBases',
      'binding',
      'expectedState',
      ...SOURCE_HASH_NAMES,
      'serverRevisionPolicy',
      'serverRevisionBefore',
      'derivedUrlPolicy',
      'asset',
      'assetHash',
      'intentHash',
    ],
    'intent_shape',
  );
  if (value.schema !== 'native-short-cover-upload-intent/v1') reject('intent_shape');
  requireScope(value);
  binding(value.binding);
  revision(value.serverRevisionBefore, true);
  for (const key of [...SOURCE_HASH_NAMES, 'assetHash', 'intentHash']) digest(value[key]);
  const asset = validateNativeShortCoverAsset(value.asset);
  if (value.assetHash !== assetHash(asset)) reject('intent_hash_mismatch');
  const { intentHash: suppliedHash, ...payload } = value;
  if (
    suppliedHash !==
    intentHash(payload as unknown as Omit<NativeShortCoverUploadIntent, 'intentHash'>)
  )
    reject('intent_hash_mismatch');
  return freeze(value as unknown as NativeShortCoverUploadIntent);
}

export function writableBefore(snapshot: StoredNative): ServerRevision {
  if (snapshot.state !== 'draft') reject('state_not_draft');
  if (snapshot.savedFields.sign_type !== 1) reject('sign_type_unsupported');
  if (snapshot.savedFields.activity_flag === null) reject('activity_flag_unsupported');
  const before = snapshotRevision(snapshot, true);
  if (!derivedUrls(snapshot, true)) reject('derived_urls_not_proven');
  return before;
}

/** Local intent only: proves consistency, not owner, provenance, platform upload or freshness. */
export function createNativeShortCoverUploadIntent(
  snapshot: NativeShortMetadataSnapshot,
  input: NativeShortCoverUploadRequest,
): NativeShortCoverUploadIntent {
  return createUploadIntentCore(checkedSnapshot(snapshot), input);
}
