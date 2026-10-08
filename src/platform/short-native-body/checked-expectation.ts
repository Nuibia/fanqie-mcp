import {
  type NativeShortBodyExpectation,
  NATIVE_SHORT_BODY_SCOPE,
  NATIVE_SHORT_BODY_REPRESENTATION,
  nativeShortBodyHashBasesForRequest,
  type NativeShortBodyWriteRequest,
  NATIVE_SHORT_BODY_HASH_BASES,
  type NativeShortBodyPlan,
  type BodyNativeSource,
  type BodySource,
  type BodyMathDependencies,
} from './native-short-body-hash-bases-for-request.js';

import {
  dataObject,
  EXPECTATION_KEYS,
  reject,
  sameDerived,
  exactHash,
  hash,
  freeze,
  FORM_KEYS,
  BAD_UNICODE,
  type Json,
  jsonCopy,
  canonical,
} from './reject.js';

import {
  NATIVE_SHORT_SERVER_REVISION_POLICY_V2,
  nativeShortMetadataEndpoints,
} from '../short-native-metadata.js';

import {
  binding,
  validateNativeShortBodyWriteRequest,
  parser,
  markerOf,
  wireOf,
  documentHashes,
  wireHash,
} from './binding.js';

import { revision, validateBodySnapshot, planBodyUpdate } from './create-body-snapshot.js';

import {
  type NativeShortBodyWordNumberExpectationV2,
  NATIVE_SHORT_BODY_WORD_NUMBER_BASIS_V2,
} from '../short-native-body-word-number.js';

import { createHash } from 'node:crypto';

export function checkedExpectation(input: unknown): NativeShortBodyExpectation {
  const captured = dataObject(input),
    requestCaptured = dataObject(captured.writeRequest);
  const v2 = Object.hasOwn(requestCaptured, 'comparisonPolicy');
  const value = dataObject(
    input,
    v2 ? [...EXPECTATION_KEYS, 'derivedWordNumber'] : EXPECTATION_KEYS,
    'expectation_shape',
  );
  if (
    value.scope !== NATIVE_SHORT_BODY_SCOPE ||
    value.representation !== NATIVE_SHORT_BODY_REPRESENTATION ||
    value.expectedState !== 'draft' ||
    value.serverRevisionPolicy !== NATIVE_SHORT_SERVER_REVISION_POLICY_V2
  )
    reject('expectation_scope');
  const bases = nativeShortBodyHashBasesForRequest(
    requestCaptured as unknown as NativeShortBodyWriteRequest,
  );
  sameDerived(value.hashBases, bases, 'expectation_scope');
  const bind = binding(value.binding),
    request = validateNativeShortBodyWriteRequest(value.writeRequest),
    serverRevisionBefore = revision(value.serverRevisionBefore, true);
  const hashes: Record<string, string> = Object.create(null);
  for (const key of [
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
  ])
    hashes[key] = exactHash(value[key]);
  if (request.expectedSnapshotVersionHash !== value.sourceVersionHash)
    reject('expectation_source_mismatch');
  if (typeof value.desiredHtml !== 'string' || !value.desiredHtml.endsWith('<p></p>'))
    reject('expectation_document');
  const document = parser(value.desiredHtml),
    marker = markerOf(document),
    wire = wireOf(document);
  let derivedWordNumber: NativeShortBodyWordNumberExpectationV2 | undefined;
  if (v2) {
    const d = dataObject(value.derivedWordNumber, [
      'policy',
      'before',
      'desired',
      'beforeDocumentHash',
      'desiredDocumentHash',
    ]);
    if (
      d.policy !== NATIVE_SHORT_BODY_WORD_NUMBER_BASIS_V2 ||
      typeof d.before !== 'number' ||
      !Number.isSafeInteger(d.before) ||
      Object.is(d.before, -0) ||
      d.before < 0 ||
      d.desired !== document.characterCount ||
      d.beforeDocumentHash !== value.sourceDocumentHash ||
      d.desiredDocumentHash !== value.expectedDocumentHash
    )
      reject('expectation_document');
    derivedWordNumber = {
      policy: NATIVE_SHORT_BODY_WORD_NUMBER_BASIS_V2,
      before: d.before,
      desired: document.characterCount,
      beforeDocumentHash: exactHash(d.beforeDocumentHash),
      desiredDocumentHash: exactHash(d.desiredDocumentHash),
    };
  }
  if (typeof value.appendedWireTerminal !== 'boolean') reject('expectation_document');
  const appended = value.appendedWireTerminal;
  if (wire.length !== request.paragraphs.length + (appended ? 1 : 0))
    reject('expectation_document');
  for (let index = 0; index < request.paragraphs.length; index++)
    sameDerived(wire[index]!.lines, request.paragraphs[index]!.lines, 'expectation_document');
  if (appended && wire[wire.length - 1]!.rawHtml !== '<p></p>') reject('expectation_document');
  sameDerived(value.effectiveWireParagraphs, wire, 'expectation_document');
  sameDerived(value.marker, marker, 'expectation_document');
  if (
    (request.trial.action === 'clear' && marker.boundary !== null) ||
    (request.trial.action === 'set' && marker.boundary !== request.trial.beforeParagraph)
  )
    reject('expectation_document');
  const computed = documentHashes(bind, document, marker);
  const expectedDocumentHash = createHash('sha256').update(document.rawHtml, 'utf8').digest('hex');
  const submittedVectorHash = hash({
    basis: NATIVE_SHORT_BODY_HASH_BASES.submittedVector,
    binding: bind,
    paragraphs: request.paragraphs,
  });
  const effectiveWireVectorHash = wireHash(bind, wire);
  for (const [key, actual] of Object.entries({
    expectedDocumentHash,
    submittedVectorHash,
    effectiveWireVectorHash,
    ...computed,
  }))
    if (value[key] !== actual) reject('expectation_document');
  return freeze({
    scope: NATIVE_SHORT_BODY_SCOPE,
    representation: NATIVE_SHORT_BODY_REPRESENTATION,
    hashBases: bases,
    ...(derivedWordNumber === undefined ? {} : { derivedWordNumber }),
    binding: bind,
    expectedState: 'draft',
    writeRequest: request,
    sourceVersionHash: hashes.sourceVersionHash!,
    sourceDocumentHash: hashes.sourceDocumentHash!,
    sourceVectorHash: hashes.sourceVectorHash!,
    expectedDocumentHash,
    expectedSavedFieldsHash: hashes.expectedSavedFieldsHash!,
    catalogHash: hashes.catalogHash!,
    categorySelectionHash: hashes.categorySelectionHash!,
    preservationHash: hashes.preservationHash!,
    coversHash: hashes.coversHash!,
    ...computed,
    submittedVectorHash,
    effectiveWireVectorHash,
    effectiveWireParagraphs: wire,
    appendedWireTerminal: appended,
    serverRevisionPolicy: NATIVE_SHORT_SERVER_REVISION_POLICY_V2,
    serverRevisionBefore,
    desiredHtml: document.rawHtml,
    marker,
  });
}

function checkedForm(
  input: unknown,
  expectation: NativeShortBodyExpectation,
): Readonly<Record<string, string>> {
  const value = dataObject(input, undefined, 'form_shape'),
    keys = Object.hasOwn(value, 'category') ? [...FORM_KEYS, 'category'] : [...FORM_KEYS];
  dataObject(input, keys, 'form_shape');
  const form: Record<string, string> = {};
  // Preserve the original form insertion order for URLSearchParams, independently of hash canonicalization.
  for (const key of keys) {
    const field = value[key];
    if (typeof field !== 'string' || BAD_UNICODE.test(field)) reject('form_shape');
    form[key] = field;
  }
  if (
    form.item_id !== expectation.binding.work.id ||
    form.content !== expectation.desiredHtml ||
    form.item_version !== '-1' ||
    form.sign_type !== '1' ||
    !['0', '1'].includes(form.activity_flag!)
  )
    reject('form_shape');
  let titles: Json;
  try {
    titles = jsonCopy(JSON.parse(form.multi_title!));
  } catch {
    reject('form_shape');
  }
  if (
    !Array.isArray(titles) ||
    !titles.length ||
    titles.some((title) => typeof title !== 'string') ||
    JSON.stringify(titles) !== form.multi_title
  )
    reject('form_shape');
  if (Object.hasOwn(form, 'category')) {
    const tokens = form.category!.split(',');
    if (tokens.some((token) => !token.length) || new Set(tokens).size !== tokens.length)
      reject('form_shape');
  }
  return freeze(form);
}

export function nativeShortBodyDesiredContentHash(input: {
  expectation: NativeShortBodyExpectation;
  form: Readonly<Record<string, string>>;
}): string {
  const value = dataObject(input, ['expectation', 'form']),
    expectation = checkedExpectation(value.expectation),
    form = checkedForm(value.form, expectation);
  return hash({
    basis: nativeShortBodyHashBasesForRequest(expectation.writeRequest).desired,
    expectation,
    form,
  });
}

export function validateNativeShortBodyPlan(input: unknown): NativeShortBodyPlan {
  const value = dataObject(
    input,
    ['kind', 'atomicRevision', 'expectation', 'desiredContentHash', 'form', 'request'],
    'derived_object_shape',
  );
  if (value.kind !== 'native_body_payload_plan' || value.atomicRevision !== false)
    reject('body_plan_hash_mismatch');
  const expectation = checkedExpectation(value.expectation),
    form = checkedForm(value.form, expectation);
  const desiredContentHash = nativeShortBodyDesiredContentHash({ expectation, form });
  if (value.desiredContentHash !== desiredContentHash) reject('body_plan_hash_mismatch');
  const endpoints = nativeShortMetadataEndpoints(expectation.binding.work.id);
  const request = {
    method: 'POST' as const,
    url: endpoints.save,
    contentType: endpoints.contentType,
    body: new URLSearchParams(form).toString(),
  };
  sameDerived(value.request, request, 'form_shape');
  return freeze({
    kind: 'native_body_payload_plan',
    atomicRevision: false,
    expectation,
    desiredContentHash,
    form,
    request,
  });
}

export function assertBodyPreSave<N extends BodyNativeSource>(
  input: BodySource<N>,
  inputPlan: NativeShortBodyPlan,
  deps: BodyMathDependencies<N>,
): void {
  const before = validateBodySnapshot(input, deps),
    expected = validateNativeShortBodyPlan(inputPlan),
    e = expected.expectation;
  if (
    canonical(before.binding) !== canonical(e.binding) ||
    before.snapshotVersionHash !== e.sourceVersionHash ||
    before.documentHash !== e.sourceDocumentHash ||
    !deps.editable(before.native)
  )
    reject('source_version_mismatch');
  const rebuilt = planBodyUpdate(before, e.writeRequest, deps);
  if (canonical(rebuilt) !== canonical(expected)) reject('expectation_source_mismatch');
}
