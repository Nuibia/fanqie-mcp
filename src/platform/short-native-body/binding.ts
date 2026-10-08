import {
  type NativeShortBinding,
  NATIVE_SHORT_HASH_BASES,
  type NativeShortMetadataSnapshot,
} from '../short-native-metadata.js';

import {
  dataObject,
  jsonCopy,
  reject,
  freeze,
  REQUEST_KEYS,
  HASH,
  dataArray,
  BAD_UNICODE,
  hash,
  NativeShortBodyError,
} from './reject.js';

import {
  type NativeShortBodyTrialPolicy,
  type NativeShortBodyWriteRequest,
  NATIVE_SHORT_BODY_REPRESENTATION,
  type NativeShortBodyBusinessInput,
  NATIVE_SHORT_BODY_SCOPE,
  NATIVE_SHORT_BODY_RESOURCE_LIMITS,
  nativeShortBodyHashBasesForRequest,
  type NativeShortBodyErrorCode,
  type NativeShortBodyMarker,
  type NativeShortBodyWireParagraph,
  NATIVE_SHORT_BODY_HASH_BASES,
  type BodyNativeSource,
} from './native-short-body-hash-bases-for-request.js';

import {
  NATIVE_SHORT_BODY_COMPARISON_POLICY_V2,
  NATIVE_SHORT_BODY_WORD_NUMBER_BASIS_V2,
  nativeShortBodyObservedWordNumberV2,
} from '../short-native-body-word-number.js';

import {
  type NativeShortTrialDocument,
  parseNativeShortTrialDocument,
  NativeShortTrialError,
} from '../short-native-trial.js';

export function binding(input: unknown): NativeShortBinding {
  const value = dataObject(jsonCopy(input), ['account', 'work']),
    account = dataObject(value.account, ['kind', 'id']),
    work = dataObject(value.work, ['kind', 'id']);
  if (
    account.kind !== 'account_id' ||
    typeof account.id !== 'string' ||
    !/^[0-9]{1,30}$/.test(account.id) ||
    work.kind !== 'short' ||
    typeof work.id !== 'string' ||
    !/^[1-9][0-9]{9,21}$/.test(work.id)
  )
    reject('binding_shape');
  return freeze({
    account: { kind: 'account_id', id: account.id },
    work: { kind: 'short', id: work.id },
  });
}

function policy(input: unknown): NativeShortBodyTrialPolicy {
  const value = dataObject(input);
  if (value.action === 'clear' || value.action === 'preserve') {
    dataObject(input, ['action']);
    return { action: value.action };
  }
  if (value.action !== 'set') reject('trial_action');
  dataObject(input, ['action', 'beforeParagraph']);
  if (
    typeof value.beforeParagraph !== 'number' ||
    !Number.isSafeInteger(value.beforeParagraph) ||
    Object.is(value.beforeParagraph, -0) ||
    value.beforeParagraph < 1
  )
    reject('trial_boundary');
  return { action: 'set', beforeParagraph: value.beforeParagraph };
}

function writeRequest(input: unknown): NativeShortBodyWriteRequest {
  const captured = dataObject(input),
    keys = Object.hasOwn(captured, 'comparisonPolicy')
      ? [...REQUEST_KEYS, 'comparisonPolicy']
      : REQUEST_KEYS;
  const value = dataObject(input, keys);
  if (
    Object.hasOwn(value, 'comparisonPolicy') &&
    value.comparisonPolicy !== NATIVE_SHORT_BODY_COMPARISON_POLICY_V2
  )
    reject('request_binding');
  if (
    typeof value.expectedSnapshotVersionHash !== 'string' ||
    !HASH.test(value.expectedSnapshotVersionHash) ||
    value.hashBasis !== NATIVE_SHORT_HASH_BASES.snapshot ||
    value.expectedState !== 'draft' ||
    value.representation !== NATIVE_SHORT_BODY_REPRESENTATION
  )
    reject('request_binding');
  const paragraphs = dataArray(value.paragraphs);
  if (!paragraphs.length) reject('paragraph_shape');
  let previous = -1;
  const checked = paragraphs.map((inputRow) => {
    const row = dataObject(inputRow, ['sourceIndex', 'lines'], 'paragraph_shape'),
      index = row.sourceIndex;
    let sourceIndex: number | null = null;
    if (index !== null) {
      if (
        typeof index !== 'number' ||
        !Number.isSafeInteger(index) ||
        Object.is(index, -0) ||
        index < 0
      )
        reject('source_index');
      if (index <= previous) reject('source_index_order');
      previous = index;
      sourceIndex = index;
    }
    const rawLines = dataArray(row.lines);
    if (!rawLines.length) reject('paragraph_lines');
    const lines = rawLines.map((line) => {
      if (typeof line !== 'string') reject('paragraph_lines');
      if (BAD_UNICODE.test(line)) reject('invalid_unicode');
      if (/[\n\r\u0000]/u.test(line)) reject('literal_line_break');
      return line;
    });
    return { sourceIndex, lines };
  });
  return freeze({
    ...(Object.hasOwn(value, 'comparisonPolicy')
      ? { comparisonPolicy: NATIVE_SHORT_BODY_COMPARISON_POLICY_V2 }
      : {}),
    expectedSnapshotVersionHash: value.expectedSnapshotVersionHash,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedState: 'draft',
    representation: NATIVE_SHORT_BODY_REPRESENTATION,
    paragraphs: checked,
    trial: policy(value.trial),
  });
}

export function validateNativeShortBodyWriteRequest(input: unknown): NativeShortBodyWriteRequest {
  return writeRequest(jsonCopy(input));
}

export function validateNativeShortBodyBusinessInput(input: unknown): NativeShortBodyBusinessInput {
  const captured = dataObject(jsonCopy(input)),
    keys = Object.hasOwn(captured, 'comparisonPolicy')
      ? [...REQUEST_KEYS, 'comparisonPolicy']
      : REQUEST_KEYS;
  const value = dataObject(captured, [...keys, 'target', 'snapshotScope']),
    target = dataObject(value.target, ['kind', 'workId']);
  if (
    target.kind !== 'short' ||
    typeof target.workId !== 'string' ||
    !/^[1-9][0-9]{9,21}$/.test(target.workId) ||
    value.snapshotScope !== NATIVE_SHORT_BODY_SCOPE
  )
    reject('business_binding');
  const request: Record<string, unknown> = Object.create(null);
  for (const key of keys) request[key] = value[key];
  return freeze({
    target: { kind: 'short', workId: target.workId },
    snapshotScope: NATIVE_SHORT_BODY_SCOPE,
    ...writeRequest(request),
  });
}

export function nativeShortBodyWriteRequest(
  input: NativeShortBodyBusinessInput,
): NativeShortBodyWriteRequest {
  const value = validateNativeShortBodyBusinessInput(input),
    request: Record<string, unknown> = Object.create(null);
  for (const key of Object.hasOwn(value, 'comparisonPolicy')
    ? [...REQUEST_KEYS, 'comparisonPolicy']
    : REQUEST_KEYS)
    request[key] = value[key as keyof NativeShortBodyBusinessInput];
  return validateNativeShortBodyWriteRequest(request);
}

export function nativeShortBodyBusinessInputHash(
  accountId: string,
  input: NativeShortBodyBusinessInput,
): string {
  if (
    typeof accountId !== 'string' ||
    !accountId.length ||
    BAD_UNICODE.test(accountId) ||
    /[\r\n\u0000]/u.test(accountId) ||
    Buffer.byteLength(accountId, 'utf8') > NATIVE_SHORT_BODY_RESOURCE_LIMITS.accountIdUtf8Bytes
  )
    reject('account_id_invalid');
  const business = validateNativeShortBodyBusinessInput(input);
  return hash({
    basis: nativeShortBodyHashBasesForRequest(business).business,
    accountId,
    target: business.target,
    input: business,
  });
}

export const PARSER_CODES = new Set<NativeShortBodyErrorCode>([
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
  'trial_boundary',
  'trial_min_text',
  'trial_min_paragraphs',
  'trial_ratio',
]);

export function parser(raw: string): NativeShortTrialDocument {
  try {
    return parseNativeShortTrialDocument(raw);
  } catch (error) {
    if (
      error instanceof NativeShortTrialError &&
      PARSER_CODES.has(error.code as NativeShortBodyErrorCode)
    )
      reject(error.code as NativeShortBodyErrorCode);
    throw new NativeShortBodyError('snapshot_source_invalid');
  }
}

export function markerOf(document: NativeShortTrialDocument): NativeShortBodyMarker {
  if (document.boundary === null) return freeze({ rawHtml: null, boundary: null, attrs: null });
  const prefixLength = document.paragraphs
    .slice(0, document.boundary)
    .reduce((size, p) => size + p.rawHtml.length, 0);
  const suffixLength = document.paragraphs
    .slice(document.boundary)
    .reduce((size, p) => size + p.rawHtml.length, 0);
  return freeze({
    rawHtml: document.rawHtml.slice(prefixLength, document.rawHtml.length - suffixLength),
    boundary: document.boundary,
    attrs: document.markerAttrs,
  });
}

export function wireOf(
  document: NativeShortTrialDocument,
): readonly NativeShortBodyWireParagraph[] {
  return document.paragraphs.map((p) => ({ lines: p.text.split('\n'), rawHtml: p.rawHtml }));
}

export function wireHash(
  bind: NativeShortBinding,
  paragraphs: readonly NativeShortBodyWireParagraph[],
): string {
  return hash({
    basis: NATIVE_SHORT_BODY_HASH_BASES.effectiveWireVector,
    binding: bind,
    paragraphs,
  });
}

export function documentHashes(
  bind: NativeShortBinding,
  document: NativeShortTrialDocument,
  marker: NativeShortBodyMarker,
) {
  return {
    bodyHash: hash({
      basis: NATIVE_SHORT_BODY_HASH_BASES.body,
      binding: bind,
      body: document.bodyText,
    }),
    paragraphsHash: hash({
      basis: NATIVE_SHORT_BODY_HASH_BASES.paragraphs,
      binding: bind,
      paragraphs: document.paragraphs.map((p) => p.rawHtml),
    }),
    markerHash: hash({ basis: NATIVE_SHORT_BODY_HASH_BASES.marker, binding: bind, marker }),
  };
}

export function coversHash(native: BodyNativeSource): string {
  const covers: Record<string, unknown> = Object.create(null);
  for (const key of ['thumb_uri', 'book_thumb_uri', 'thumb_url_list', 'book_thumb_url_list'])
    if (Object.hasOwn(native.editData, key)) covers[key] = native.editData[key];
  return hash({ basis: NATIVE_SHORT_BODY_HASH_BASES.covers, binding: native.binding, covers });
}

export function preservationHash<N extends BodyNativeSource>(
  native: N,
  observed: (native: N) => number,
  validRevision = true,
  comparisonPolicy?: typeof NATIVE_SHORT_BODY_COMPARISON_POLICY_V2,
): string {
  const bases = nativeShortBodyHashBasesForRequest({ comparisonPolicy });
  const editData: Record<string, unknown> = { ...native.editData };
  if (!validRevision)
    return hash({
      basis: bases.invalidRevisionPreservation,
      binding: native.binding,
      editData,
      categoryData: native.categoryData,
    });
  delete editData.content;
  delete editData.latest_version;
  delete editData.modify_time;
  if (comparisonPolicy !== undefined) {
    observed(native);
    editData.word_number = {
      policy: NATIVE_SHORT_BODY_WORD_NUMBER_BASIS_V2,
      derivedFrom: 'parsed-official-character-count',
    };
  }
  return hash({
    basis: bases.preservation,
    scope: NATIVE_SHORT_BODY_SCOPE,
    binding: native.binding,
    editData,
    categoryData: native.categoryData,
  });
}

export function observedWordNumber(native: NativeShortMetadataSnapshot): number {
  try {
    return nativeShortBodyObservedWordNumberV2(native);
  } catch {
    reject('derived_word_number_invalid');
  }
}
