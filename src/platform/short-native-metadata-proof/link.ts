import {
  type EvidenceLink,
  carrierVersion,
  provenanceFields,
  validateNativeShortWriteBusinessInput,
  nativeShortWriteRequest,
  nativeShortDesiredContentHash,
  writeReadPhase,
  writeCleanup,
  type NativeShortBaselineEvidence,
  writeSnapshot,
  storedSnapshot,
  type NativeShortWriteIntent,
  carrier,
  expectationVersion,
  evidenceLink,
  comparisonBasis,
} from './validate-native-short-write-business-input.js';

import {
  exact,
  UUID,
  HASH,
  reject,
  type StoredSnapshot,
  type StoredBaseline,
  copyBoundedNativeJson,
  equal,
  ordered,
  type NativeShortProvenance,
  NATIVE_SHORT_ORIGIN,
} from './reject.js';

import {
  NATIVE_SHORT_RESOURCE_LIMITS,
  NATIVE_SHORT_METADATA_SCOPE,
  type WriteExpectation,
} from '../short-native-metadata.js';

import { storedMetadataMath } from '../short-native-legacy-codec.js';

import { rejectAdditionalNativeSignals } from './validate-api-result-core.js';

import {
  type NativeShortMetadataHeldBefore,
  type NativeShortMetadataDurableReceipt,
} from '../short-native-metadata-api.js';

import { type NativeShortWriteBusinessInput } from './validate-native-short-evidence-context.js';

import { type EvidenceRef } from '../../runtime/store.js';

export function link(value: unknown): EvidenceLink {
  const data = exact(value, ['id', 'sha256']);
  if (
    typeof data.id !== 'string' ||
    !UUID.test(data.id) ||
    typeof data.sha256 !== 'string' ||
    !HASH.test(data.sha256)
  )
    reject();
  return data as EvidenceLink;
}

function validateBaselineCore(
  input: unknown,
  decode: (input: unknown) => StoredSnapshot,
): StoredBaseline {
  const data = exact(
    copyBoundedNativeJson(
      input,
      5 * NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes + 128 * 1024,
      5 * NATIVE_SHORT_RESOURCE_LIMITS.nodes,
      NATIVE_SHORT_RESOURCE_LIMITS.depth + 12,
    ),
    ['schema', 'scope', 'held', 'businessInput', 'source', 'provenance'],
  );
  const version = carrierVersion(data.schema, 'native-short-metadata-held-before');
  if (data.scope !== NATIVE_SHORT_METADATA_SCOPE) reject();
  provenanceFields(data);
  const business = validateNativeShortWriteBusinessInput(data.businessInput);
  const held = exact(data.held, [
    'schema',
    'phase',
    'snapshot',
    'businessRequest',
    'expectation',
    'desiredContentHash',
    'read',
    'cleanup',
  ]);
  if (
    held.schema !== data.schema ||
    held.phase !== 'held-for-write' ||
    !equal(held.businessRequest, nativeShortWriteRequest(business))
  )
    reject();
  const snapshot = decode(held.snapshot);
  if (snapshot.binding.work.id !== business.target.workId) reject();
  let expectation: WriteExpectation;
  try {
    const d = storedMetadataMath.decodeSnapshot(snapshot);
    expectation = (
      version === 1
        ? storedMetadataMath.planUpdate(d, nativeShortWriteRequest(business))
        : storedMetadataMath.planUpdateV2(d, nativeShortWriteRequest(business))
    ).expectation;
  } catch {
    reject();
  }
  if (
    !equal(held.expectation, expectation) ||
    held.desiredContentHash !== nativeShortDesiredContentHash(expectation)
  )
    reject();
  const read = writeReadPhase(held.read),
    cleanup = writeCleanup(held.cleanup, false);
  ordered([read.proof.proofCapturedAt, cleanup.checkedAt]);
  rejectAdditionalNativeSignals(
    data,
    new Map([
      [JSON.stringify(['schema']), data.schema],
      [JSON.stringify(['held', 'schema']), data.schema],
    ]),
    [
      JSON.stringify(['held', 'snapshot', 'editData']),
      JSON.stringify(['held', 'snapshot', 'categoryData']),
    ],
  );
  return data as unknown as StoredBaseline;
}

export function validateNativeShortBaselineEvidence(input: unknown): NativeShortBaselineEvidence {
  return validateBaselineCore(input, writeSnapshot) as NativeShortBaselineEvidence;
}

export function validateStoredBaseline(input: unknown): StoredBaseline {
  return validateBaselineCore(input, storedSnapshot);
}

export function createNativeShortBaselineEvidence(
  held: NativeShortMetadataHeldBefore,
  businessInput: NativeShortWriteBusinessInput,
  provenance: NativeShortProvenance,
): NativeShortBaselineEvidence {
  return validateNativeShortBaselineEvidence({
    schema: held.schema,
    scope: NATIVE_SHORT_METADATA_SCOPE,
    held,
    businessInput,
    source: { origin: NATIVE_SHORT_ORIGIN, mode: provenance.mode },
    provenance,
  });
}

export function createNativeShortWriteIntent(
  baseline: NativeShortBaselineEvidence,
  baselineRef: EvidenceRef,
): NativeShortWriteIntent {
  const before = validateNativeShortBaselineEvidence(baseline),
    expectation = before.held.expectation;
  return validateNativeShortWriteIntent(
    {
      schema: carrier('native-short-metadata-intent', expectationVersion(expectation)),
      scope: NATIVE_SHORT_METADATA_SCOPE,
      hashBases: expectation.hashBases,
      binding: expectation.binding,
      target: { kind: 'short-story', id: expectation.binding.work.id },
      expectedSnapshotVersionHash: expectation.sourceVersionHash,
      expectation,
      baselineEvidence: evidenceLink(baselineRef),
      comparisonBasis: comparisonBasis(expectationVersion(expectation)),
      desiredContentHash: nativeShortDesiredContentHash(expectation),
      expectedStates: ['draft_saved'],
    },
    before,
    baselineRef,
  );
}

export function validateIntentCore(
  input: unknown,
  baseline: StoredBaseline,
  baselineRef: EvidenceRef,
): NativeShortWriteIntent {
  const data = exact(copyBoundedNativeJson(input, 16384, 4096, 20), [
    'schema',
    'scope',
    'hashBases',
    'binding',
    'target',
    'expectedSnapshotVersionHash',
    'expectation',
    'baselineEvidence',
    'comparisonBasis',
    'desiredContentHash',
    'expectedStates',
  ]);
  const expected = baseline.held.expectation;
  if (
    data.schema !== carrier('native-short-metadata-intent', expectationVersion(expected)) ||
    data.scope !== NATIVE_SHORT_METADATA_SCOPE ||
    !equal(data.hashBases, expected.hashBases) ||
    !equal(data.binding, expected.binding) ||
    !equal(data.target, { kind: 'short-story', id: expected.binding.work.id }) ||
    data.expectedSnapshotVersionHash !== expected.sourceVersionHash ||
    !equal(data.expectation, expected) ||
    !equal(link(data.baselineEvidence), evidenceLink(baselineRef)) ||
    data.comparisonBasis !== comparisonBasis(expectationVersion(expected)) ||
    data.desiredContentHash !== nativeShortDesiredContentHash(expected) ||
    !equal(data.expectedStates, ['draft_saved'])
  )
    reject();
  rejectAdditionalNativeSignals(data, new Map([[JSON.stringify(['schema']), data.schema]]));
  return data as unknown as NativeShortWriteIntent;
}

export function validateNativeShortWriteIntent(
  input: unknown,
  baseline: NativeShortBaselineEvidence,
  baselineRef: EvidenceRef,
): NativeShortWriteIntent {
  return validateIntentCore(input, validateNativeShortBaselineEvidence(baseline), baselineRef);
}

export function validateReceiptCore(
  value: unknown,
  baseline: StoredBaseline,
  baselineRef: EvidenceRef,
  intentRef: EvidenceRef,
): NativeShortMetadataDurableReceipt {
  const receipt = exact(value, [
    'schema',
    'accountId',
    'jobId',
    'baseline',
    'intent',
    'target',
    'expectedSnapshotVersionHash',
    'desiredContentHash',
  ]);
  const named = (ref: EvidenceRef) => ({
    id: ref.id,
    sha256: ref.sha256,
    capturedAt: ref.capturedAt,
  });
  if (
    receipt.schema !==
      carrier(
        'native-short-metadata-durable-receipt',
        expectationVersion(baseline.held.expectation),
      ) ||
    receipt.accountId !== baselineRef.accountId ||
    receipt.jobId !== baselineRef.jobId ||
    intentRef.accountId !== baselineRef.accountId ||
    intentRef.jobId !== baselineRef.jobId ||
    baselineRef.id === intentRef.id ||
    !equal(receipt.baseline, named(baselineRef)) ||
    !equal(receipt.intent, named(intentRef)) ||
    !equal(receipt.target, { kind: 'short-story', id: baseline.held.snapshot.binding.work.id }) ||
    receipt.expectedSnapshotVersionHash !== baseline.businessInput.expectedSnapshotVersionHash ||
    receipt.desiredContentHash !== baseline.held.desiredContentHash
  )
    reject();
  ordered([baseline.held.cleanup.checkedAt, baselineRef.capturedAt, intentRef.capturedAt]);
  return receipt as unknown as NativeShortMetadataDurableReceipt;
}

export function validateNativeShortDurableReceipt(
  value: unknown,
  baseline: NativeShortBaselineEvidence,
  baselineRef: EvidenceRef,
  intentRef: EvidenceRef,
): NativeShortMetadataDurableReceipt {
  return validateReceiptCore(
    value,
    validateNativeShortBaselineEvidence(baseline),
    baselineRef,
    intentRef,
  );
}
