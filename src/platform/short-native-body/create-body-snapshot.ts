import {
  type BodyNativeSource,
  type BodyMathDependencies,
  type BodySource,
  type NativeShortBodyErrorCode,
  NATIVE_SHORT_BODY_SCOPE,
  NATIVE_SHORT_BODY_REPRESENTATION,
  NATIVE_SHORT_BODY_HASH_BASES,
  type NativeShortBodySnapshot,
  type NativeShortBodyMarker,
  type NativeShortBodyWriteRequest,
  type NativeShortBodyPlan,
  nativeShortBodyHashBasesForRequest,
  type NativeShortBodyExpectation,
} from './native-short-body-hash-bases-for-request.js';

import {
  NativeShortTrialError,
  type NativeShortTrialDocument,
  type NativeShortTrialMarkerAttributes,
} from '../short-native-trial.js';

import {
  PARSER_CODES,
  parser,
  markerOf,
  wireHash,
  wireOf,
  documentHashes,
  coversHash,
  validateNativeShortBodyWriteRequest,
  preservationHash,
} from './binding.js';

import {
  reject,
  jsonCopy,
  freeze,
  hash,
  dataObject,
  SNAPSHOT_KEYS,
  sameDerived,
  canonical,
} from './reject.js';

import {
  NATIVE_SHORT_RESOURCE_LIMITS,
  type NativeShortMetadataSnapshot,
  type NativeShortServerRevision,
  NATIVE_SHORT_SERVER_REVISION_POLICY_V2,
  nativeShortMetadataEndpoints,
} from '../short-native-metadata.js';

import { modernBodyMathDependencies } from './compare-body-readback.js';

import { nativeShortBodyDesiredContentHash } from './checked-expectation.js';

export function createBodySnapshot<N extends BodyNativeSource>(
  input: N,
  deps: BodyMathDependencies<N>,
): BodySource<N> {
  let native: N;
  try {
    native = deps.rebuildTrial(input).native;
  } catch (error) {
    if (
      error instanceof NativeShortTrialError &&
      PARSER_CODES.has(error.code as NativeShortBodyErrorCode)
    )
      reject(error.code as NativeShortBodyErrorCode);
    reject('snapshot_source_invalid');
  }
  // Bound the original source alone; do not add its repeated derived projections to this budget.
  jsonCopy(
    { binding: native.binding, editData: native.editData, categoryData: native.categoryData },
    2 * NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes + 1024,
  );
  const document = parser(native.savedFields.content),
    marker = markerOf(document),
    sourceParagraphs = document.paragraphs.map((p, sourceIndex) => ({
      sourceIndex,
      lines: p.text.split('\n'),
      rawHtml: p.rawHtml,
    }));
  return freeze({
    scope: NATIVE_SHORT_BODY_SCOPE,
    representation: NATIVE_SHORT_BODY_REPRESENTATION,
    hashBases: NATIVE_SHORT_BODY_HASH_BASES,
    binding: native.binding,
    native,
    document,
    sourceParagraphs,
    marker,
    snapshotVersionHash: native.snapshotVersionHash,
    catalogHash: native.catalogHash,
    documentHash: native.documentHash,
    savedFieldsHash: native.savedFieldsHash,
    categorySelectionHash: native.categorySelectionHash,
    sourceVectorHash: hash({
      basis: NATIVE_SHORT_BODY_HASH_BASES.sourceVector,
      binding: native.binding,
      paragraphs: sourceParagraphs,
    }),
    observedWireVectorHash: wireHash(native.binding, wireOf(document)),
    ...documentHashes(native.binding, document, marker),
    coversHash: coversHash(native),
  });
}

export function validateBodySnapshot<N extends BodyNativeSource>(
  input: unknown,
  deps: BodyMathDependencies<N>,
): BodySource<N> {
  const value = dataObject(input, SNAPSHOT_KEYS, 'derived_object_shape');
  // The dependency's nested validator captures exact own descriptors before rebuilding.
  let native: N;
  try {
    native = deps.rebuildMetadataFromSnapshot(value.native);
  } catch {
    reject('snapshot_source_invalid');
  }
  const rebuilt = createBodySnapshot(native, deps);
  sameDerived(input, rebuilt, 'body_snapshot_hash_mismatch');
  return rebuilt;
}

export function createNativeShortBodySnapshot(
  input: NativeShortMetadataSnapshot,
): NativeShortBodySnapshot {
  return createBodySnapshot(input, modernBodyMathDependencies);
}

export function validateNativeShortBodySnapshot(input: unknown): NativeShortBodySnapshot {
  return validateBodySnapshot(input, modernBodyMathDependencies);
}

export function revision(input: unknown, before: boolean): NativeShortServerRevision {
  const value = dataObject(input, ['latestVersion', 'modifyTime']);
  if (
    typeof value.latestVersion !== 'number' ||
    !Number.isSafeInteger(value.latestVersion) ||
    Object.is(value.latestVersion, -0) ||
    value.latestVersion < 0 ||
    (before && value.latestVersion === Number.MAX_SAFE_INTEGER) ||
    typeof value.modifyTime !== 'string' ||
    !/^[0-9]{10}$/.test(value.modifyTime)
  )
    reject('server_revision_shape');
  return freeze({ latestVersion: value.latestVersion, modifyTime: value.modifyTime });
}

export function snapshotRevision(
  snapshot: BodySource<BodyNativeSource>,
  before: boolean,
): NativeShortServerRevision {
  return revision(
    {
      latestVersion: snapshot.native.editData.latest_version,
      modifyTime: snapshot.native.editData.modify_time,
    },
    before,
  );
}

function eligibleBoundary(document: NativeShortTrialDocument, index: number): number {
  if (
    !Number.isSafeInteger(index) ||
    Object.is(index, -0) ||
    index < 1 ||
    index >= document.paragraphs.length ||
    !document.paragraphs.slice(index).some((p) => p.eligible)
  )
    reject('trial_boundary');
  if (document.characterCount < 200) reject('trial_min_text');
  if (document.eligibleParagraphCount < 3) reject('trial_min_paragraphs');
  const prefix = document.paragraphs.slice(0, index).reduce((sum, p) => sum + p.characterCount, 0);
  if (10 * prefix < 3 * document.characterCount || prefix <= 0 || prefix >= document.characterCount)
    reject('trial_ratio');
  return prefix;
}

function compiledMarker(
  document: NativeShortTrialDocument,
  index: number,
  className: '' | 'fq-pay-node-animation',
): NativeShortBodyMarker {
  const prefix = eligibleBoundary(document, index);
  const attrs: NativeShortTrialMarkerAttributes = {
    'data-percentage': String(prefix / document.characterCount),
    'data-fanqie-type': 'pay_tag',
    'data-min-text': '200',
    'data-min-paragraphs': '3',
    'data-min-radio': '0.3',
    'data-para-nums': String(document.eligibleParagraphCount),
    class: className,
  };
  const rawHtml = `<div data-percentage="${attrs['data-percentage']}" data-fanqie-type="pay_tag" data-min-text="200" data-min-paragraphs="3" data-min-radio="0.3" data-para-nums="${attrs['data-para-nums']}" class="${className}"></div>`;
  return { rawHtml, boundary: index, attrs };
}

function compile(before: BodySource<BodyNativeSource>, request: NativeShortBodyWriteRequest) {
  const raw = request.paragraphs.map((p) => {
    if (p.sourceIndex !== null) {
      const source = before.sourceParagraphs[p.sourceIndex];
      if (!source) reject('source_index_missing');
      if (canonical(p.lines) === canonical(source.lines)) return source.rawHtml;
    }
    return `<p>${p.lines.map((line) => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('<br>')}</p>`;
  });
  let markerFreeHtml = raw.join('');
  const appendedWireTerminal = !markerFreeHtml.endsWith('<p></p>');
  if (appendedWireTerminal) {
    raw.push('<p></p>');
    markerFreeHtml += '<p></p>';
  }
  const unmarked = parser(markerFreeHtml);
  let marker: NativeShortBodyMarker = { rawHtml: null, boundary: null, attrs: null };
  if (request.trial.action === 'set')
    marker = compiledMarker(unmarked, request.trial.beforeParagraph, 'fq-pay-node-animation');
  if (request.trial.action === 'preserve' && before.marker.boundary !== null) {
    const desiredIndex = request.paragraphs.findIndex(
      (p) => p.sourceIndex === before.marker.boundary,
    );
    if (desiredIndex === -1) reject('trial_anchor_missing');
    marker = compiledMarker(unmarked, desiredIndex, before.marker.attrs!.class);
    if (canonical(marker.attrs) === canonical(before.marker.attrs))
      marker = { ...marker, rawHtml: before.marker.rawHtml };
  }
  const desiredHtml = raw
    .map((html, index) => `${marker.boundary === index ? marker.rawHtml : ''}${html}`)
    .join('');
  const document = parser(desiredHtml);
  return {
    desiredHtml,
    document,
    marker: markerOf(document),
    effectiveWireParagraphs: wireOf(document),
    appendedWireTerminal,
  };
}

export function planBodyUpdate<N extends BodyNativeSource>(
  input: BodySource<N>,
  inputRequest: NativeShortBodyWriteRequest,
  deps: BodyMathDependencies<N>,
): NativeShortBodyPlan {
  const before = validateBodySnapshot(input, deps),
    request = validateNativeShortBodyWriteRequest(inputRequest);
  if (request.expectedSnapshotVersionHash !== before.snapshotVersionHash)
    reject('source_version_mismatch');
  if (!deps.editable(before.native)) reject('state_not_draft');
  const bases = nativeShortBodyHashBasesForRequest(request);
  if (request.comparisonPolicy !== undefined) deps.observedWordNumber(before.native);
  const desired = compile(before, request);
  // A different provenance vector is not a platform change. No form exists on this path.
  if (desired.desiredHtml === before.document.rawHtml) reject('no_change');
  if (before.native.savedFields.sign_type !== 1 || before.native.savedFields.activity_flag === null)
    reject('wire_fields_unsupported');
  const serverRevisionBefore = snapshotRevision(before, true);
  let desiredNative: N;
  try {
    desiredNative = deps.rebuildMetadata({
      binding: before.binding,
      editData: { ...before.native.editData, content: desired.desiredHtml },
      categoryData: before.native.categoryData,
    });
  } catch {
    reject('snapshot_source_invalid');
  }
  const expectation: NativeShortBodyExpectation = freeze({
    scope: NATIVE_SHORT_BODY_SCOPE,
    representation: NATIVE_SHORT_BODY_REPRESENTATION,
    hashBases: bases,
    ...(request.comparisonPolicy === undefined
      ? {}
      : { derivedWordNumber: deps.wordNumberExpectation(before.native, desired.desiredHtml) }),
    binding: before.binding,
    expectedState: 'draft',
    writeRequest: request,
    sourceVersionHash: before.snapshotVersionHash,
    sourceDocumentHash: before.documentHash,
    sourceVectorHash: before.sourceVectorHash,
    expectedDocumentHash: desiredNative.documentHash,
    expectedSavedFieldsHash: desiredNative.savedFieldsHash,
    catalogHash: before.catalogHash,
    categorySelectionHash: before.categorySelectionHash,
    preservationHash: preservationHash(
      before.native,
      deps.observedWordNumber,
      true,
      request.comparisonPolicy,
    ),
    coversHash: before.coversHash,
    ...documentHashes(before.binding, desired.document, desired.marker),
    submittedVectorHash: hash({
      basis: NATIVE_SHORT_BODY_HASH_BASES.submittedVector,
      binding: before.binding,
      paragraphs: request.paragraphs,
    }),
    effectiveWireVectorHash: wireHash(before.binding, desired.effectiveWireParagraphs),
    effectiveWireParagraphs: desired.effectiveWireParagraphs,
    appendedWireTerminal: desired.appendedWireTerminal,
    serverRevisionPolicy: NATIVE_SHORT_SERVER_REVISION_POLICY_V2,
    serverRevisionBefore,
    desiredHtml: desired.desiredHtml,
    marker: desired.marker,
  });
  const fields = before.native.savedFields;
  const form: Record<string, string> = {
    item_id: before.binding.work.id,
    content: desired.desiredHtml,
    thumb_uri: fields.thumb_uri,
    book_thumb_uri: fields.book_thumb_uri,
    item_version: '-1',
    multi_title: JSON.stringify(fields.multi_title),
    sign_type: '1',
    activity_flag: String(fields.activity_flag),
  };
  if (fields.category.length) form.category = fields.category.map(String).join(',');
  const endpoints = nativeShortMetadataEndpoints(before.binding.work.id);
  return freeze({
    kind: 'native_body_payload_plan',
    atomicRevision: false,
    expectation,
    desiredContentHash: nativeShortBodyDesiredContentHash({ expectation, form }),
    form,
    request: {
      method: 'POST',
      url: endpoints.save,
      contentType: endpoints.contentType,
      body: new URLSearchParams(form).toString(),
    },
  });
}
