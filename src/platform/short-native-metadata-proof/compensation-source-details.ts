import {
  type NativeShortCompensationSourceContext,
  ownData,
  OPERATOR_BASIS,
  compensationDocument,
  OPERATOR_DATASETS,
} from './project-native-short-closure.js';

import {
  reject,
  copyBoundedNativeJson,
  equal,
  exact,
  object,
  UUID,
  NATIVE_SHORT_ORIGIN,
  ordered,
  time,
} from './reject.js';

import { type Job, type EvidenceRef, canonicalJson } from '../../runtime/store.js';

import { compensationHistory } from './compensation-history.js';

import { originalForAudit } from './create-native-short-original-audit.js';

import { compensationRead, summaryRef, assertOperatorSnapshot } from './compensation-read.js';

import {
  digest,
  type NativeShortWriteBusinessInput,
} from './validate-native-short-evidence-context.js';

import {
  evidenceLink,
  writeReadPhase,
  writeCleanup,
} from './validate-native-short-write-business-input.js';

import {
  validateStoredNativeShortApiResult,
  rejectAdditionalNativeSignals,
} from './validate-api-result-core.js';

import {
  type NativeShortMetadataRequest,
  NATIVE_SHORT_HASH_BASES,
  NATIVE_SHORT_METADATA_SCOPE,
} from '../short-native-metadata.js';

import { validateStoredBaseline } from './link.js';

import { storedMetadataMath } from '../short-native-legacy-codec.js';

import { validateCompensationAuthority } from './validate-compensation-authority.js';

export function compensationSourceDetails(source: NativeShortCompensationSourceContext) {
  ownData(source, [
    'accountId',
    'original',
    'history',
    'registration',
    'operatorBefore',
    'operator',
    'authority',
  ]);
  ownData(source.original, ['accountId', 'job', 'manifest', 'refs', 'documents']);
  ownData(source.operator, ['accountId', 'job', 'manifest', 'refs', 'documents']);
  ownData(source.operatorBefore, ['job', 'manifest', 'ref', 'document']);
  if (source.registration !== null)
    ownData(source.registration, ['job', 'manifest', 'ref', 'document']);
  for (const value of [source.original.documents, source.operator.documents]) {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      Object.getOwnPropertySymbols(value).length
    )
      reject();
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
      string,
      PropertyDescriptor
    >;
    const names = Object.keys(descriptors).filter((name) => name !== 'length');
    if (
      names.length !== descriptors.length!.value ||
      names.some(
        (name, index) =>
          name !== String(index) ||
          !descriptors[name]!.enumerable ||
          !Object.hasOwn(descriptors[name]!, 'value'),
      )
    )
      reject();
  }
  source = {
    ...source,
    original: {
      ...source.original,
      job: copyBoundedNativeJson(source.original.job, 128 * 1024, 8192, 24) as Job,
      refs: copyBoundedNativeJson(source.original.refs, 64 * 1024, 4096, 20) as EvidenceRef[],
    },
    operator: {
      ...source.operator,
      job: copyBoundedNativeJson(source.operator.job, 128 * 1024, 8192, 24) as Job,
      refs: copyBoundedNativeJson(source.operator.refs, 64 * 1024, 4096, 20) as EvidenceRef[],
    },
    operatorBefore: {
      ...source.operatorBefore,
      job: copyBoundedNativeJson(source.operatorBefore.job, 128 * 1024, 8192, 24) as Job,
    },
  };
  ownData(source.history, ['first', 'current', 'previous']);
  for (const frame of [source.history.first, source.history.current, source.history.previous])
    if (frame) {
      ownData(frame, ['row', 'read']);
      ownData(frame.read, ['job', 'manifest', 'ref', 'document']);
      ownData(frame.row, [
        'id',
        'sequence',
        'originalJobId',
        'readJobId',
        'evidenceId',
        'status',
        'createdAt',
        'resultJson',
      ]);
    }

  if (
    source.accountId !== source.original.accountId ||
    source.accountId !== source.operator.accountId ||
    source.original.job.accountId !== source.accountId ||
    source.operator.job.accountId !== source.accountId ||
    source.operatorBefore.job.accountId !== source.accountId ||
    source.original.manifest !== null ||
    source.operator.manifest !== null
  )
    reject();
  const allRefs = [
    ...source.original.refs,
    source.operatorBefore.ref,
    ...source.operator.refs,
    ...(source.registration ? [source.registration.ref] : []),
    ...[source.history.first, source.history.current, source.history.previous]
      .filter((frame) => frame !== null)
      .map((frame) => frame!.read.ref),
  ];
  const ids = new Map<string, EvidenceRef>();
  for (const ref of allRefs) {
    if (ids.has(ref.id) && !equal(ids.get(ref.id), ref)) reject();
    ids.set(ref.id, ref);
  }
  if (ids.size > 14) reject();
  const history = compensationHistory(source),
    { baseline } = originalForAudit(source.original, history.initial);
  if (
    baseline.schema !== 'native-short-metadata-held-before/v1' ||
    baseline.provenance.mode !== 'live' ||
    baseline.provenance.executor !== 'application-default-browser/v1' ||
    source.original.documents.some((document) => document.collectionMode !== 'live')
  )
    reject();
  const original = baseline.held.snapshot,
    target = { kind: 'short-story' as const, id: original.binding.work.id };
  // The approved operator-before read did not record a Job target. Its full C1
  // result is still bound below to the original typed owner/work and operator run.
  const beforePayload = exact(
    compensationRead(
      source.operatorBefore,
      'operator_short_native_title_restore_before_v1',
      'operator_title_restore_before',
      'operator_title_restore_before',
      digest({
        runId: source.operator.job.metadata.runId,
        originalJobId: source.original.job.id,
        phase: 'before',
      }),
      null,
    ),
    ['schema', 'basis', 'executor', 'mode', 'originalBaseline', 'result'],
  );
  if (
    beforePayload.schema !== 'native-short-metadata-operator-before/v1' ||
    beforePayload.basis !== OPERATOR_BASIS ||
    beforePayload.executor !== 'operator-owned-browser/v1' ||
    beforePayload.mode !== 'live' ||
    !equal(beforePayload.originalBaseline, evidenceLink(source.original.refs[0]!))
  )
    reject();
  if (source.operatorBefore.job.metadata.runId !== source.operator.job.metadata.runId) reject();
  const before = validateStoredNativeShortApiResult(beforePayload.result, {
    accountId: original.binding.account.id,
    workId: target.id,
  });
  if (
    before.status !== 'success' ||
    baseline.businessInput.title !== before.snapshot?.savedFields.multi_title[0] ||
    baseline.held.expectation.requested.categories !== false ||
    source.operatorBefore.job.platformReadStartedAt! > before.proof.readStartedAt! ||
    source.operatorBefore.ref.capturedAt < before.proof.proofCapturedAt! ||
    before.proof.readStartedAt! <= history.prior.priorEndedAt
  )
    reject();
  const operator = object(
    copyBoundedNativeJson(source.operator.job, 128 * 1024, 8192, 24),
  ) as unknown as Job;
  const metadata = exact(operator.metadata, [
    'schema',
    'runId',
    'originalUncertainJobId',
    'verificationBasis',
    'nativeV1VerificationPassed',
  ]);
  if (
    operator.kind !== 'write' ||
    operator.status !== 'succeeded' ||
    operator.operation !== 'operator_short_native_title_restore_v1' ||
    operator.scope !== 'operator_title_restore' ||
    !equal(operator.datasets, []) ||
    !equal(operator.target, target) ||
    operator.error !== null ||
    operator.cancellationRequestedAt !== null ||
    operator.cancellationReason !== null ||
    operator.updatedAt !== operator.endedAt ||
    metadata.schema !== 'native-short-metadata-operator-job/v1' ||
    !UUID.test(String(metadata.runId)) ||
    metadata.originalUncertainJobId !== source.original.job.id ||
    metadata.verificationBasis !== OPERATOR_BASIS ||
    metadata.nativeV1VerificationPassed !== false ||
    operator.idempotencyKey !== `operator-title-restore-${metadata.runId}` ||
    source.operator.refs.length !== 4 ||
    source.operator.documents.length !== 4
  )
    reject();
  const refs = source.operator.refs;
  if (
    new Set([...source.original.refs, source.operatorBefore.ref, ...refs].map((ref) => ref.id))
      .size !==
    source.original.refs.length + 5
  )
    reject();
  const payloads = refs.map((ref, index) =>
    compensationDocument(
      ref,
      source.operator.documents[index]!,
      operator,
      OPERATOR_DATASETS[index]!,
      index === 1 || index === 2,
    ),
  );
  const heldPayload = exact(payloads[0], [
    'schema',
    'basis',
    'executor',
    'mode',
    'originalUncertainJobId',
    'originalBaseline',
    'freshBefore',
    'held',
  ]);
  if (
    heldPayload.schema !== 'native-short-metadata-operator-held/v1' ||
    heldPayload.basis !== OPERATOR_BASIS ||
    heldPayload.executor !== 'operator-owned-browser/v1' ||
    heldPayload.mode !== 'live' ||
    heldPayload.originalUncertainJobId !== source.original.job.id ||
    !equal(heldPayload.originalBaseline, evidenceLink(source.original.refs[0]!)) ||
    !equal(heldPayload.freshBefore, summaryRef(source.operatorBefore.ref))
  )
    reject();
  const request: NativeShortMetadataRequest = {
    expectedSnapshotVersionHash: before.snapshot!.snapshotVersionHash,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedState: 'draft',
    title: original.savedFields.multi_title[0]!,
  };
  const business: NativeShortWriteBusinessInput = {
    target: { kind: 'short', workId: target.id },
    snapshotScope: NATIVE_SHORT_METADATA_SCOPE,
    expectedSnapshotVersionHash: request.expectedSnapshotVersionHash,
    hashBasis: request.hashBasis,
    expectedState: request.expectedState,
    title: request.title!,
  };
  const held = validateStoredBaseline({
    schema: 'native-short-metadata-held-before/v1',
    scope: NATIVE_SHORT_METADATA_SCOPE,
    held: heldPayload.held,
    businessInput: business,
    source: { origin: NATIVE_SHORT_ORIGIN, mode: 'live' },
    provenance: { executor: 'application-default-browser/v1', mode: 'live' },
  }).held;
  if (
    !equal(held.snapshot, before.snapshot) ||
    source.operatorBefore.ref.capturedAt >= held.read.proof.readStartedAt! ||
    operator.platformReadStartedAt! > held.read.proof.readStartedAt!
  )
    reject();
  const operatorInputHash = digest({
    runId: metadata.runId,
    originalJobId: source.original.job.id,
    originalBaselineHash: source.original.refs[0]!.sha256,
    freshRef: summaryRef(source.operatorBefore.ref),
    request,
  });
  if (operator.inputHash !== operatorInputHash) reject();
  const intent = exact(payloads[1], [
    'schema',
    'basis',
    'originalUncertainJobId',
    'originalBaseline',
    'baselineEvidence',
    'freshBefore',
    'expectedSnapshotVersionHash',
    'desiredContentHash',
    'operatorInputHash',
    'target',
    'expectedStates',
    'maximumPostAttempts',
  ]);
  if (
    !equal(intent, {
      schema: 'native-short-metadata-operator-intent/v1',
      basis: OPERATOR_BASIS,
      originalUncertainJobId: source.original.job.id,
      originalBaseline: evidenceLink(source.original.refs[0]!),
      baselineEvidence: summaryRef(refs[0]!),
      freshBefore: summaryRef(source.operatorBefore.ref),
      expectedSnapshotVersionHash: request.expectedSnapshotVersionHash,
      desiredContentHash: held.desiredContentHash,
      operatorInputHash,
      target,
      expectedStates: ['original_title_restored'],
      maximumPostAttempts: 1,
    }) ||
    Buffer.byteLength(canonicalJson(intent)) > 16384
  )
    reject();
  const native = exact(payloads[2], ['schema', 'basis', 'result', 'nativeV1VerificationPassed']);
  if (
    native.schema !== 'native-short-metadata-operator-v1-outcome/v1' ||
    native.basis !== OPERATOR_BASIS ||
    native.nativeV1VerificationPassed !== false
  )
    reject();
  const outcome = exact(native.result, [
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
  ]);
  if (
    outcome.schema !== 'native-short-metadata-api-write/v1' ||
    outcome.status !== 'capability_unavailable' ||
    outcome.reason !== 'readback_mismatch' ||
    ['held', 'receipt', 'snapshot', 'comparison', 'desiredContentHash', 'observedContentHash'].some(
      (key) => outcome[key] !== null,
    )
  )
    reject();
  const phases = exact(outcome.phases, ['before', 'after']),
    phaseBefore = writeReadPhase(phases.before),
    phaseAfter = writeReadPhase(phases.after),
    post = exact(outcome.post, [
      'attempts',
      'disposed',
      'markedAt',
      'startedAt',
      'acknowledgedAt',
      'acknowledged',
    ]),
    cleanup = writeCleanup(outcome.cleanup, true);
  if (
    !equal(phaseBefore.phase, held.read) ||
    post.attempts !== 1 ||
    post.disposed !== 1 ||
    post.acknowledged !== true ||
    post.markedAt !== operator.platformWriteStartedAt ||
    !equal(outcome.proof, {
      platformStarted: true,
      writeMarked: true,
      ownerCallback: false,
      atomicRevision: false,
      proofCapturedAt: null,
    })
  )
    reject();
  ordered([
    operator.requestedAt,
    operator.startedAt,
    operator.platformReadStartedAt,
    held.read.proof.readStartedAt,
    held.cleanup.checkedAt,
    refs[0]!.capturedAt,
    refs[1]!.capturedAt,
    post.markedAt,
    post.startedAt,
    post.acknowledgedAt,
    phaseAfter.proof.readStartedAt,
    phaseAfter.proof.proofCapturedAt,
    cleanup.checkedAt,
    refs[2]!.capturedAt,
  ]);
  const afterPayload = exact(payloads[3], [
    'schema',
    'basis',
    'executor',
    'mode',
    'result',
    'originalBaseline',
    'heldBaseline',
    'nativeOutcome',
    'originalTitleRestored',
    'nonServerRawPreserved',
    'revisionDeltaExactlyOne',
    'opaqueServerTokenNondecreasing',
    'nativeV1VerificationPassed',
  ]);
  if (
    afterPayload.schema !== 'native-short-metadata-operator-after/v1' ||
    afterPayload.basis !== OPERATOR_BASIS ||
    afterPayload.executor !== 'operator-owned-browser/v1' ||
    afterPayload.mode !== 'live' ||
    !equal(afterPayload.originalBaseline, evidenceLink(source.original.refs[0]!)) ||
    !equal(afterPayload.heldBaseline, summaryRef(refs[0]!)) ||
    !equal(afterPayload.nativeOutcome, summaryRef(refs[2]!)) ||
    [
      'originalTitleRestored',
      'nonServerRawPreserved',
      'revisionDeltaExactlyOne',
      'opaqueServerTokenNondecreasing',
    ].some((key) => afterPayload[key] !== true) ||
    afterPayload.nativeV1VerificationPassed !== false
  )
    reject();
  const after = validateStoredNativeShortApiResult(afterPayload.result, {
    accountId: original.binding.account.id,
    workId: target.id,
  });
  if (after.status !== 'success' || after.proof.readStartedAt! <= time(cleanup.checkedAt)) reject();
  if (
    [original, before.snapshot!, after.snapshot!, held.snapshot].some(
      (snapshot) => storedMetadataMath.decodeSnapshot(snapshot).mode !== 'legacy',
    )
  )
    reject();
  assertOperatorSnapshot(original, before.snapshot!, after.snapshot!);
  ordered([after.proof.proofCapturedAt, refs[3]!.capturedAt, operator.endedAt]);
  const expectedResult = {
    schema: 'native-short-metadata-operator-title-restore-result/v1',
    basis: OPERATOR_BASIS,
    runId: metadata.runId,
    originalUncertainJobId: source.original.job.id,
    originalTitleRestored: true,
    nonServerRawPreserved: true,
    revisionDeltaExactlyOne: true,
    opaqueServerTokenNondecreasing: true,
    nativeV1VerificationPassed: false,
    postAttempts: 1,
    acknowledged: true,
    markedAt: post.markedAt,
    baselineEvidence: summaryRef(refs[0]!),
    intentEvidence: summaryRef(refs[1]!),
    nativeOutcomeEvidence: summaryRef(refs[2]!),
    afterEvidence: summaryRef(refs[3]!),
  };
  if (!equal(operator.result, expectedResult)) reject();
  rejectAdditionalNativeSignals(
    { job: operator },
    new Map([
      [JSON.stringify(['job', 'metadata', 'schema']), metadata.schema],
      [JSON.stringify(['job', 'result', 'schema']), expectedResult.schema],
    ]),
  );
  const authority = validateCompensationAuthority(
    source.authority,
    source,
    history.prior,
    before.snapshot!,
  );
  return { history, baseline, original, before, after, authority, target };
}
