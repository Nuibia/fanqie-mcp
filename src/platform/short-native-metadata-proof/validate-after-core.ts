import {
  type StoredBaseline,
  type StoredSnapshot,
  type StoredAfter,
  exact,
  copyBoundedNativeJson,
  equal,
  reject,
  ordered,
  NATIVE_SHORT_READ_DATASET,
  type Data,
} from './reject.js';

import { type EvidenceRef } from '../../runtime/store.js';

import {
  NATIVE_SHORT_RESOURCE_LIMITS,
  NATIVE_SHORT_METADATA_SCOPE,
} from '../short-native-metadata.js';

import {
  carrier,
  expectationVersion,
  evidenceLink,
  provenanceFields,
  writeReadPhase,
  compareStored,
  nativeShortDesiredContentHash,
  observedExpectation,
  writeCleanup,
  type NativeShortBaselineEvidence,
  type NativeShortCleanAfterEvidence,
  writeSnapshot,
  statusProjection,
} from './validate-native-short-write-business-input.js';

import { link, validateReceiptCore, validateNativeShortBaselineEvidence } from './link.js';

import { storedMetadataMath } from '../short-native-legacy-codec.js';

import {
  rejectAdditionalNativeSignals,
  type NativeShortEvidenceContext,
} from './validate-api-result-core.js';

import { type NativeShortMetadataApiWriteResult } from '../short-native-metadata-api.js';

import {
  validateNativeShortEvidenceContext,
  categoryMaximum,
  digest,
} from './validate-native-short-evidence-context.js';

export function validateAfterCore(
  input: unknown,
  baseline: StoredBaseline,
  baselineRef: EvidenceRef,
  intentRef: EvidenceRef,
  decode: (input: unknown) => StoredSnapshot,
): StoredAfter {
  const data = exact(
    copyBoundedNativeJson(
      input,
      4 * NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes + 128 * 1024,
      5 * NATIVE_SHORT_RESOURCE_LIMITS.nodes,
      NATIVE_SHORT_RESOURCE_LIMITS.depth + 12,
    ),
    ['schema', 'scope', 'result', 'baselineEvidence', 'intentEvidence', 'source', 'provenance'],
  );
  if (
    data.schema !==
      carrier('native-short-metadata-clean-after', expectationVersion(baseline.held.expectation)) ||
    data.scope !== NATIVE_SHORT_METADATA_SCOPE ||
    !equal(link(data.baselineEvidence), evidenceLink(baselineRef)) ||
    !equal(link(data.intentEvidence), evidenceLink(intentRef)) ||
    !equal(provenanceFields(data), { source: baseline.source, provenance: baseline.provenance })
  )
    reject();
  const result = exact(data.result, [
    'schema',
    'status',
    'reason',
    'receipt',
    'snapshot',
    'comparison',
    'desiredContentHash',
    'observedContentHash',
    'phases',
    'post',
    'proof',
    'cleanup',
  ]);
  if (
    result.schema !==
      carrier('native-short-metadata-api-write', expectationVersion(baseline.held.expectation)) ||
    result.status !== 'success' ||
    result.reason !== null
  )
    reject();
  validateReceiptCore(result.receipt, baseline, baselineRef, intentRef);
  const snapshot = decode(result.snapshot),
    phases = exact(result.phases, ['before', 'after']);
  const before = writeReadPhase(phases.before),
    after = writeReadPhase(phases.after);
  if (!equal(before.phase, baseline.held.read)) reject();
  if (
    storedMetadataMath.decodeSnapshot(snapshot).mode !==
    storedMetadataMath.decodeSnapshot(baseline.held.snapshot).mode
  )
    reject();
  const comparison = compareStored(baseline.held.expectation, snapshot);
  const observed = nativeShortDesiredContentHash(
    observedExpectation(baseline.held.expectation, snapshot, comparison),
  );
  if (
    !comparison.matches ||
    !equal(result.comparison, comparison) ||
    result.desiredContentHash !== baseline.held.desiredContentHash ||
    result.observedContentHash !== observed ||
    observed !== result.desiredContentHash
  )
    reject();
  const post = exact(result.post, [
    'attempts',
    'disposed',
    'markedAt',
    'startedAt',
    'acknowledgedAt',
    'acknowledged',
  ]);
  if (post.attempts !== 1 || post.disposed !== 1 || post.acknowledged !== true) reject();
  const proof = exact(result.proof, [
    'platformStarted',
    'writeMarked',
    'ownerCallback',
    'atomicRevision',
    'proofCapturedAt',
  ]);
  if (
    proof.platformStarted !== true ||
    proof.writeMarked !== true ||
    proof.ownerCallback !== true ||
    proof.atomicRevision !== false
  )
    reject();
  const cleanup = writeCleanup(result.cleanup, true);
  ordered([
    baseline.held.cleanup.checkedAt,
    baselineRef.capturedAt,
    intentRef.capturedAt,
    post.markedAt,
    post.startedAt,
    post.acknowledgedAt,
    after.proof.readStartedAt,
    after.proof.readFinishedAt,
    after.proof.proofCapturedAt,
    cleanup.checkedAt,
    proof.proofCapturedAt,
  ]);
  rejectAdditionalNativeSignals(
    data,
    new Map([
      [JSON.stringify(['schema']), data.schema],
      [JSON.stringify(['result', 'schema']), result.schema],
      [
        JSON.stringify(['result', 'receipt', 'schema']),
        carrier(
          'native-short-metadata-durable-receipt',
          expectationVersion(baseline.held.expectation),
        ),
      ],
    ]),
    [
      JSON.stringify(['result', 'snapshot', 'editData']),
      JSON.stringify(['result', 'snapshot', 'categoryData']),
    ],
  );
  return data as unknown as StoredAfter;
}

export function validateNativeShortCleanAfterEvidence(
  input: unknown,
  baseline: NativeShortBaselineEvidence,
  baselineRef: EvidenceRef,
  intentRef: EvidenceRef,
): NativeShortCleanAfterEvidence {
  return validateAfterCore(
    input,
    validateNativeShortBaselineEvidence(baseline),
    baselineRef,
    intentRef,
    writeSnapshot,
  ) as NativeShortCleanAfterEvidence;
}

export function createNativeShortCleanAfterEvidence(
  result: NativeShortMetadataApiWriteResult,
  baseline: NativeShortBaselineEvidence,
  baselineRef: EvidenceRef,
  intentRef: EvidenceRef,
): NativeShortCleanAfterEvidence {
  // Validate descriptor shape before destructuring an in-memory collector value.
  const descriptors = Object.getOwnPropertyDescriptors(result);
  const names = [
    'schema',
    'status',
    'reason',
    'held',
    'receipt',
    'snapshot',
    'comparison',
    'desiredContentHash',
    'observedContentHash',
    'phases',
    'post',
    'proof',
    'cleanup',
  ];
  if (
    Object.getOwnPropertySymbols(result).length ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(result)) ||
    Object.keys(descriptors).length !== names.length ||
    names.some(
      (name) =>
        !descriptors[name] ||
        !descriptors[name]!.enumerable ||
        !Object.hasOwn(descriptors[name]!, 'value'),
    )
  )
    reject();
  if (
    !equal(
      validateNativeShortBaselineEvidence({ ...baseline, held: descriptors.held!.value }).held,
      baseline.held,
    )
  )
    reject();
  const clean = Object.fromEntries(
    names.filter((name) => name !== 'held').map((name) => [name, descriptors[name]!.value]),
  );
  return validateNativeShortCleanAfterEvidence(
    {
      schema: carrier(
        'native-short-metadata-clean-after',
        expectationVersion(baseline.held.expectation),
      ),
      scope: NATIVE_SHORT_METADATA_SCOPE,
      result: clean,
      baselineEvidence: evidenceLink(baselineRef),
      intentEvidence: evidenceLink(intentRef),
      source: baseline.source,
      provenance: baseline.provenance,
    },
    baseline,
    baselineRef,
    intentRef,
  );
}

/** Authorized business fields only; full HTML/tail titles/URIs stay private. */
export function projectNativeShortEvidence(
  input: unknown,
  context: NativeShortEvidenceContext,
): Record<string, unknown> {
  const wrapper = validateNativeShortEvidenceContext(input, context),
    result = wrapper.result,
    snapshot = result.snapshot!;
  return {
    schema: 'fanqie-short-native-metadata-business/v1',
    dataset: NATIVE_SHORT_READ_DATASET,
    status: 'success',
    accountId: context.accountId,
    target: { kind: 'short-story', id: snapshot.binding.work.id },
    ...nativeShortSnapshotBusiness(snapshot),
    ...statusProjection(snapshot, context.ref, 'read'),
    source: { ...wrapper.source },
    provenance: { ...wrapper.provenance },
    proof: { ...result.proof },
    requests: Object.fromEntries(
      Object.entries(result.requests).map(([name, counts]) => [name, { ...counts }]),
    ),
    list: { ...result.list },
    cleanup: { ...result.cleanup },
    sourceRef: context.ref.id,
    evidenceHash: context.ref.sha256,
    evidenceCapturedAt: context.ref.capturedAt,
  };
}

export function nativeShortSnapshotBusiness(snapshot: StoredSnapshot): Record<string, unknown> {
  const selection = (snapshot.editData.category as readonly Data[]).map((row) => ({
    category_id: row.category_id,
    label: row.label,
    name: row.name,
  }));
  return {
    scope: snapshot.scope,
    hashBases: { ...snapshot.hashBases },
    snapshotVersionHash: snapshot.snapshotVersionHash,
    catalogHash: snapshot.catalogHash,
    documentHash: snapshot.documentHash,
    savedFieldsHash: snapshot.savedFieldsHash,
    categorySelectionHash: snapshot.categorySelectionHash,
    state: snapshot.state,
    firstTitle: snapshot.savedFields.multi_title[0],
    currentSelection: selection,
    catalog: snapshot.catalog.map((row) => ({ ...row })),
    categoryMaximum: categoryMaximum(snapshot),
    tailTitles: {
      count: snapshot.savedFields.multi_title.length - 1,
      hash: digest(snapshot.savedFields.multi_title.slice(1)),
      basis: 'ordered-tail-titles-json/v1',
    },
    covers: [
      {
        role: 'thumb_uri',
        count: 1,
        hash: digest(snapshot.savedFields.thumb_uri),
        basis: 'exact-uri-json/v1',
      },
      {
        role: 'book_thumb_uri',
        count: 1,
        hash: digest(snapshot.savedFields.book_thumb_uri),
        basis: 'exact-uri-json/v1',
      },
    ],
  };
}
