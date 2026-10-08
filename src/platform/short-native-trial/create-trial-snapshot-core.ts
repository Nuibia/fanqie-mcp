import {
  type StoredNative,
  type NativeShortTrialSnapshot,
  hash,
  NATIVE_SHORT_TRIAL_HASH_BASES,
  freeze,
  NATIVE_SHORT_TRIAL_SCOPE,
  reject,
  object,
  jsonCopy,
  type StoredTrial,
  type NativeShortTrialDocument,
  type NativeShortTrialWriteRequest,
  type NativeShortTrialPlan,
  type NativeShortTrialExpectation,
  canonical,
  HASH,
  action,
  type NativeShortTrialComparison,
} from './reject.js';

import {
  parseNativeShortTrialDocument,
  eligibleBoundary,
  validateNativeShortTrialWriteRequest,
} from './validate-native-short-trial-write-request.js';

import {
  coversHash,
  trialDerived,
  createNativeShortTrialSnapshot,
  derivedEqual,
} from './derived-object.js';

import {
  type NativeShortMetadataSnapshot,
  type NativeShortServerRevision,
  createNativeShortMetadataSnapshot,
  type NativeShortMetadataRawInput,
  NATIVE_SHORT_SERVER_REVISION_POLICY_V2,
  nativeShortMetadataEndpoints,
  NATIVE_SHORT_HASH_BASES,
} from '../short-native-metadata.js';

import { createHash } from 'node:crypto';

import { compareTrialReadbackCore } from './compare-trial-readback-core.js';

export function createTrialSnapshotCore<T extends StoredNative>(
  native: T,
): Omit<NativeShortTrialSnapshot, 'native'> & { readonly native: T } {
  const document = parseNativeShortTrialDocument(native.savedFields.content),
    binding = native.binding;
  const bodyHash = hash({
    basis: NATIVE_SHORT_TRIAL_HASH_BASES.body,
    binding,
    body: document.bodyText,
  });
  const paragraphsHash = hash({
    basis: NATIVE_SHORT_TRIAL_HASH_BASES.paragraphs,
    binding,
    paragraphs: document.paragraphs.map((p) => p.rawHtml),
  });
  const trialDocumentHash = hash({
    basis: NATIVE_SHORT_TRIAL_HASH_BASES.trialDocument,
    binding,
    markerFreeHtml: document.markerFreeHtml,
    bodyHash,
    paragraphsHash,
    paragraphCount: document.paragraphCount,
    eligibleParagraphCount: document.eligibleParagraphCount,
    characterCount: document.characterCount,
    boundary: document.boundary,
    markerAttrs: document.markerAttrs,
  });
  return freeze({
    scope: NATIVE_SHORT_TRIAL_SCOPE,
    hashBases: NATIVE_SHORT_TRIAL_HASH_BASES,
    binding,
    native,
    document,
    snapshotVersionHash: native.snapshotVersionHash,
    catalogHash: native.catalogHash,
    documentHash: native.documentHash,
    savedFieldsHash: native.savedFieldsHash,
    categorySelectionHash: native.categorySelectionHash,
    bodyHash,
    paragraphsHash,
    trialDocumentHash,
    coversHash: coversHash(native),
  });
}

function checkedSnapshot(input: unknown): NativeShortTrialSnapshot {
  const value = trialDerived(input),
    rebuilt = createNativeShortTrialSnapshot(value.native as NativeShortMetadataSnapshot);
  if (!derivedEqual(input, rebuilt)) reject('trial_snapshot_hash_mismatch');
  return rebuilt;
}

/** Internal proof/runtime validation surface. Does not grant provenance or expand source resource limits. */
export function validateNativeShortTrialSnapshot(input: unknown): NativeShortTrialSnapshot {
  return checkedSnapshot(input);
}

function revision(input: unknown, before: boolean): NativeShortServerRevision {
  const value = object(jsonCopy(input), ['latestVersion', 'modifyTime']);
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
  snapshot: StoredTrial,
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

export function preservation(snapshot: StoredTrial): string {
  const edit = object(jsonCopy(snapshot.native.editData));
  delete edit.content;
  delete edit.latest_version;
  delete edit.modify_time;
  return hash({
    basis: NATIVE_SHORT_TRIAL_HASH_BASES.preservation,
    scope: NATIVE_SHORT_TRIAL_SCOPE,
    binding: snapshot.binding,
    editData: edit,
    categoryData: snapshot.native.categoryData,
  });
}

function marker(document: NativeShortTrialDocument, boundary: number): string {
  const prefix = eligibleBoundary(document, boundary);
  return `<div data-percentage="${String(prefix / document.characterCount)}" data-fanqie-type="pay_tag" data-min-text="200" data-min-paragraphs="3" data-min-radio="0.3" data-para-nums="${document.eligibleParagraphCount}" class="fq-pay-node-animation"></div>`;
}

export function planNativeShortTrialUpdate(
  input: NativeShortTrialSnapshot,
  requestInput: NativeShortTrialWriteRequest,
): NativeShortTrialPlan {
  return planTrialUpdateCore(
    checkedSnapshot(input),
    requestInput,
    createNativeShortMetadataSnapshot,
  );
}

export function planTrialUpdateCore(
  before: StoredTrial,
  requestInput: NativeShortTrialWriteRequest,
  rebuildMetadata: (raw: NativeShortMetadataRawInput) => StoredNative,
): NativeShortTrialPlan {
  const request = validateNativeShortTrialWriteRequest(requestInput);
  if (request.expectedSnapshotVersionHash !== before.snapshotVersionHash)
    reject('source_version_mismatch');
  if (before.native.state !== 'draft') reject('state_not_draft');
  if (before.native.savedFields.sign_type !== 1 || before.native.savedFields.activity_flag === null)
    reject('wire_fields_unsupported');
  const serverRevisionBefore = snapshotRevision(before, true),
    trial = request.metadata.trial;
  const desiredHtml =
    trial.action === 'clear'
      ? before.document.markerFreeHtml
      : before.document.paragraphs
          .map(
            (p, index) =>
              `${index === trial.beforeParagraph ? marker(before.document, trial.beforeParagraph) : ''}${p.rawHtml}`,
          )
          .join('');
  // Validate before building the wire; an out-of-range set must not accidentally become a no-op.
  if (trial.action === 'set') eligibleBoundary(before.document, trial.beforeParagraph);
  if (desiredHtml === before.document.rawHtml) reject('no_change');
  const desiredNative = rebuildMetadata({
    binding: before.binding,
    editData: { ...before.native.editData, content: desiredHtml },
    categoryData: before.native.categoryData,
  });
  const desired = createTrialSnapshotCore(desiredNative);
  const expectation: NativeShortTrialExpectation = freeze({
    scope: NATIVE_SHORT_TRIAL_SCOPE,
    hashBases: NATIVE_SHORT_TRIAL_HASH_BASES,
    binding: before.binding,
    expectedState: 'draft',
    trial,
    sourceVersionHash: before.snapshotVersionHash,
    sourceDocumentHash: before.documentHash,
    expectedDocumentHash: desired.documentHash,
    expectedSavedFieldsHash: desired.savedFieldsHash,
    catalogHash: before.catalogHash,
    categorySelectionHash: before.categorySelectionHash,
    preservationHash: preservation(before),
    coversHash: before.coversHash,
    bodyHash: before.bodyHash,
    paragraphsHash: before.paragraphsHash,
    trialDocumentHash: desired.trialDocumentHash,
    serverRevisionPolicy: NATIVE_SHORT_SERVER_REVISION_POLICY_V2,
    serverRevisionBefore,
    desiredHtml,
  });
  const fields = before.native.savedFields;
  const form: Record<string, string> = {
    item_id: before.binding.work.id,
    content: desiredHtml,
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
    kind: 'native_trial_payload_plan',
    atomicRevision: false,
    expectation,
    desiredContentHash: nativeShortTrialDesiredContentHash(expectation),
    form,
    request: {
      method: 'POST',
      url: endpoints.save,
      contentType: endpoints.contentType,
      body: new URLSearchParams(form).toString(),
    },
  });
}

export function checkedExpectation(
  input: NativeShortTrialExpectation,
): NativeShortTrialExpectation {
  const names = [
    'scope',
    'hashBases',
    'binding',
    'expectedState',
    'trial',
    'sourceVersionHash',
    'sourceDocumentHash',
    'expectedDocumentHash',
    'expectedSavedFieldsHash',
    'catalogHash',
    'categorySelectionHash',
    'preservationHash',
    'coversHash',
    'bodyHash',
    'paragraphsHash',
    'trialDocumentHash',
    'serverRevisionPolicy',
    'serverRevisionBefore',
    'desiredHtml',
  ];
  const value = object(jsonCopy(input), names);
  if (
    value.scope !== NATIVE_SHORT_TRIAL_SCOPE ||
    canonical(value.hashBases) !== canonical(NATIVE_SHORT_TRIAL_HASH_BASES) ||
    value.expectedState !== 'draft' ||
    value.serverRevisionPolicy !== NATIVE_SHORT_SERVER_REVISION_POLICY_V2
  )
    reject('expectation_scope');
  const binding = object(value.binding!, ['account', 'work']),
    account = object(binding.account!, ['kind', 'id']),
    work = object(binding.work!, ['kind', 'id']);
  if (
    account.kind !== 'account_id' ||
    typeof account.id !== 'string' ||
    !/^[0-9]{1,30}$/.test(account.id) ||
    work.kind !== 'short' ||
    typeof work.id !== 'string' ||
    !/^[1-9][0-9]{9,21}$/.test(work.id)
  )
    reject('binding_shape');
  for (const name of [
    'sourceVersionHash',
    'sourceDocumentHash',
    'expectedDocumentHash',
    'expectedSavedFieldsHash',
    'catalogHash',
    'categorySelectionHash',
    'preservationHash',
    'coversHash',
    'bodyHash',
    'paragraphsHash',
    'trialDocumentHash',
  ])
    if (typeof value[name] !== 'string' || !HASH.test(value[name] as string))
      reject('expectation_hash');
  const desired = parseNativeShortTrialDocument(value.desiredHtml as string),
    trial = action(value.trial!);
  if (
    createHash('sha256').update(desired.rawHtml).digest('hex') !== value.expectedDocumentHash ||
    (trial.action === 'clear' && desired.markerCount !== 0) ||
    (trial.action === 'set' && desired.boundary !== trial.beforeParagraph)
  )
    reject('expectation_document');
  revision(value.serverRevisionBefore, true);
  return freeze(value as unknown as NativeShortTrialExpectation);
}

export function nativeShortTrialDesiredContentHash(input: NativeShortTrialExpectation): string {
  return hash({
    basis: 'native-short-trial-desired-and-preservation/v1',
    expectation: checkedExpectation(input),
  });
}

export function assertNativeShortTrialPreSave(
  snapshot: NativeShortTrialSnapshot,
  input: NativeShortTrialExpectation,
): void {
  assertTrialPreSaveCore(checkedSnapshot(snapshot), input, createNativeShortMetadataSnapshot);
}

export function assertTrialPreSaveCore(
  before: StoredTrial,
  input: NativeShortTrialExpectation,
  rebuildMetadata: (raw: NativeShortMetadataRawInput) => StoredNative,
): void {
  const expected = checkedExpectation(input);
  if (
    canonical(before.binding) !== canonical(expected.binding) ||
    before.snapshotVersionHash !== expected.sourceVersionHash ||
    before.documentHash !== expected.sourceDocumentHash ||
    before.native.state !== 'draft'
  )
    reject('source_version_mismatch');
  const plan = planTrialUpdateCore(
    before,
    {
      hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
      expectedSnapshotVersionHash: expected.sourceVersionHash,
      expectedState: 'draft',
      metadata: { trial: expected.trial },
    },
    rebuildMetadata,
  );
  if (canonical(plan.expectation) !== canonical(expected)) reject('expectation_source_mismatch');
}

export function compareNativeShortTrialReadback(
  input: NativeShortTrialExpectation,
  snapshot: NativeShortTrialSnapshot,
): NativeShortTrialComparison {
  return compareTrialReadbackCore(input, checkedSnapshot(snapshot));
}
