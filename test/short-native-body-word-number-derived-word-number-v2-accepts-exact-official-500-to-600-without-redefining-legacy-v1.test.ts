import test from 'node:test';

import {
  snapshot,
  raw,
  request,
  data,
  WORK,
  POLICY,
  ACCOUNT,
  original,
  OLD,
  OWNER,
  T,
  clone,
  modernTuple4,
  phase,
  clean,
  JOB,
  hashBytes,
} from './helpers/short-native-body-word-number-phase.js';

import * as body from '../src/platform/short-native-body.js';

import assert from 'node:assert/strict';

import * as proof from '../src/platform/short-native-body-proof.js';

import { nativeShortBodyObservedWordNumberV2 } from '../src/platform/short-native-body-word-number.js';

import { createNativeShortMetadataSnapshot } from '../src/platform/short-native-metadata.js';

import { fresh, lease, reseal } from './helpers/short-native-body-word-number-fresh.js';

import { type NativeShortEvidenceContext } from '../src/platform/short-native-metadata-proof.js';

import { type EvidenceDocument, canonicalJson } from '../src/runtime/store.js';

test('derived word number v2 accepts exact official 500 to 600 without redefining legacy v1', () => {
  const before = snapshot(),
    after = snapshot(raw(600, 8)),
    v1 = body.planNativeShortBodyUpdate(before, request(before)),
    v2 = body.planNativeShortBodyUpdate(before, request(before, true));
  assert.equal(
    body.compareNativeShortBodyReadback(v1.expectation, after).reason,
    'preservation_not_proven',
  );
  assert.equal(body.compareNativeShortBodyReadback(v2.expectation, after).matches, true);
  assert.deepEqual(v2.expectation.derivedWordNumber, {
    policy: 'native-short-body-official-character-count-word-number/v2',
    before: 500,
    desired: 600,
    beforeDocumentHash: before.documentHash,
    desiredDocumentHash: after.documentHash,
  });
  assert.deepEqual(body.upgradeNativeShortBodyExpectationForGetV2(before, v1), v2.expectation);
  assert.equal(v1.expectation.hashBases, body.NATIVE_SHORT_BODY_HASH_BASES);
  assert.equal(before.hashBases, body.NATIVE_SHORT_BODY_HASH_BASES);
  assert.notEqual(v1.desiredContentHash, v2.desiredContentHash);
  assert.notEqual(
    proof.nativeShortBodyHashBasesHash(),
    proof.nativeShortBodyHashBasesHash(v2.expectation.writeRequest),
  );
});

test('derived word number v2 rejects missing malformed stale counts and every other metadata drift', () => {
  for (const count of [undefined, '500', -1, 500.5, 499]) {
    const r = raw(500, 7, count);
    if (count === undefined) delete data(r.editData).word_number;
    assert.throws(() => body.planNativeShortBodyUpdate(snapshot(r), request(snapshot(r), true)));
  }
  const before = snapshot(),
    p = body.planNativeShortBodyUpdate(before, request(before, true));
  for (const count of [undefined, '600', 500, 601, -1, 600.5]) {
    const r = raw(600, 8, count);
    if (count === undefined) delete data(r.editData).word_number;
    assert.equal(
      body.compareNativeShortBodyReadback(p.expectation, snapshot(r)).reason,
      'derived_word_number_not_proven',
    );
  }
  for (const change of [
    (r: ReturnType<typeof raw>) => {
      r.editData.opaque.unchanged = false;
    },
    (r: ReturnType<typeof raw>) => {
      r.editData.multi_title = ['changed'];
    },
    (r: ReturnType<typeof raw>) => {
      r.editData.book_thumb_uri = 'changed';
    },
    (r: ReturnType<typeof raw>) => {
      r.categoryData.opaque_catalog = 'changed';
    },
    (r: ReturnType<typeof raw>) => {
      r.editData.latest_version = 9;
    },
  ]) {
    const r = raw(600, 8);
    change(r);
    assert.equal(body.compareNativeShortBodyReadback(p.expectation, snapshot(r)).matches, false);
  }
  assert.throws(() =>
    nativeShortBodyObservedWordNumberV2(createNativeShortMetadataSnapshot(raw(500, 7, 501))),
  );
});

test('derived word number policy is explicit business identity and exact no change remains POST-free', () => {
  const s = snapshot(),
    legacy = {
      target: { kind: 'short' as const, workId: WORK },
      snapshotScope: body.NATIVE_SHORT_BODY_SCOPE,
      ...request(s),
    },
    v2 = { ...legacy, comparisonPolicy: POLICY };
  assert.notEqual(
    body.nativeShortBodyBusinessInputHash(ACCOUNT, legacy),
    body.nativeShortBodyBusinessInputHash(ACCOUNT, v2),
  );
  assert.equal(Object.hasOwn(body.nativeShortBodyWriteRequest(legacy), 'comparisonPolicy'), false);
  assert.throws(() =>
    body.validateNativeShortBodyWriteRequest({
      ...request(s),
      comparisonPolicy: 'native-short-body-derived-word-number/v3',
    }),
  );
  assert.throws(
    () =>
      body.planNativeShortBodyUpdate(s, {
        ...request(s, true),
        paragraphs: s.sourceParagraphs.map(({ sourceIndex, lines }) => ({ sourceIndex, lines })),
      }),
    { code: 'no_change' },
  );
});

test('owned fresh GET v2 separately validates legacy pending trace without changing its original bytes', () => {
  const d = original(),
    f = fresh(),
    originalBytes = JSON.stringify(d.context),
    r = proof.createNativeShortBodyOwnedGetRecoveryV2(d.context, f, lease),
    context = { recovery: r, freshRead: f };
  assert.throws(() => proof.createNativeShortBodyOriginalAudit(d.context));
  const a = proof.createNativeShortBodyOriginalAuditForRecovery(d.context, context);
  assert.equal(a.schema, 'native-short-body-original-audit/v1');
  assert.equal(JSON.stringify(d.context), originalBytes);
  assert.equal(r.freshReadJobHash, proof.nativeShortBodyGraphHash(f.job));
  assert.equal(r.originalOwnerId, OLD);
  assert.equal(r.leaseOwnerId, OWNER);
  assert.equal(JSON.stringify(r).includes('<p>'), false);
  assert.notEqual(
    proof.nativeShortBodyReconciliationInputHash(ACCOUNT, a),
    proof.nativeShortBodyReconciliationInputHash(ACCOUNT, a, r, POLICY),
  );
  for (const change of [
    (x: NativeShortEvidenceContext) => {
      x.job!.ownerId = OLD;
    },
    (x: NativeShortEvidenceContext) => {
      x.job!.metadata = {};
    },
    (x: NativeShortEvidenceContext) => {
      x.job!.requestedAt = T(22);
    },
    (x: NativeShortEvidenceContext) => {
      x.ref.sha256 = '0'.repeat(64);
    },
    (x: NativeShortEvidenceContext) => {
      x.job!.platformWriteStartedAt = T(43);
    },
    (x: NativeShortEvidenceContext) => {
      x.accountId = 'foreign';
    },
  ]) {
    const x = clone(f);
    change(x);
    assert.throws(() =>
      proof.createNativeShortBodyOwnedGetRecoveryV2(d.context, x, {
        ...lease,
        ownerId: x.job!.ownerId,
      }),
    );
  }
  assert.throws(() =>
    proof.createNativeShortBodyOriginalAuditForRecovery(d.context, {
      ...context,
      recovery: { ...r, freshReadJobHash: '0'.repeat(64) },
    }),
  );
});

test('owned GET recovery never bypasses missing ACK disposed POST or changed historical metadata', () => {
  for (const change of [
    (c: proof.NativeShortBodyEvidenceContext) => {
      data(data(c.documents[6]!.payload).payload).post = {
        attempts: 1,
        disposed: 0,
        startedAt: T(15),
        acknowledgedAt: T(16),
        acknowledged: true,
      };
    },
    (c: proof.NativeShortBodyEvidenceContext) => {
      data(data(data(c.documents[5]!.payload).payload).native).editData = {
        ...data(data(data(data(c.documents[5]!.payload).payload).native).editData),
        word_number: 599,
      };
    },
  ]) {
    const c = clone(original().context);
    change(c);
    reseal(c);
    assert.throws(() => proof.createNativeShortBodyOwnedGetRecoveryV2(c, fresh(), lease));
  }
  const c = clone(original().context);
  c.documents.splice(4, 1);
  c.refs.splice(4, 1);
  assert.throws(() => proof.createNativeShortBodyOwnedGetRecoveryV2(c, fresh(), lease));
});

test('owned GET v2 closure persists only refs and replays clean graph while retaining historical negative cleanup', () => {
  const d = original(),
    f = fresh(),
    recovery = proof.createNativeShortBodyOwnedGetRecoveryV2(d.context, f, lease),
    recoveryContext = { recovery, freshRead: f },
    audit = proof.createNativeShortBodyOriginalAuditForRecovery(d.context, recoveryContext),
    n = 60;
  const payload = proof.createNativeShortBodyReconciliationEvidence({
    schema: 'native-short-body-reconciliation/v2',
    scope: body.NATIVE_SHORT_BODY_SCOPE,
    comparisonPolicy: POLICY,
    recovery,
    source: { mode: 'fixture', executor: 'sqlite-owned-body-fixture/v1' },
    originalAudit: audit,
    native: modernTuple4(raw(600, 8)),
    read: phase(n + 3),
    ownerCheckedAt: T(n + 4),
    cleanup: clean(n + 6),
    comparison: body.compareNativeShortBodyReadback(
      body.upgradeNativeShortBodyExpectationForGetV2(d.before, d.plan),
      d.after,
    ),
    reason: 'match',
  });
  const id = '77777777-7777-4777-8777-777777777777',
    readId = '66666666-6666-4666-8666-666666666666',
    scope = proof.nativeShortBodyReconciliationScope(JOB),
    document = {
      schemaVersion: 1,
      evidenceId: id,
      accountId: ACCOUNT,
      jobId: readId,
      dataset: proof.NATIVE_SHORT_BODY_DATASETS.reconciliation,
      capturedAt: T(n + 7),
      collectionMode: 'fixture',
      evidenceKind: 'observation',
      payload,
    } as EvidenceDocument;
  const ref = {
      id,
      accountId: ACCOUNT,
      jobId: readId,
      dataset: document.dataset,
      capturedAt: T(n + 7),
      path: `synthetic/${id}.json`,
      sha256: hashBytes(canonicalJson(document) + '\n'),
    },
    manifest = {
      ...f.manifest!,
      id: '88888888-8888-4888-8888-888888888888',
      jobId: readId,
      operation: proof.NATIVE_SHORT_BODY_RECONCILE_OPERATION,
      scope,
      datasets: [document.dataset],
      requestedAt: T(n),
      platformReadStartedAt: T(n + 2),
      committedAt: T(n + 8),
      evidence: [ref],
    };
  const readJob = {
    ...f.job!,
    id: readId,
    operation: proof.NATIVE_SHORT_BODY_RECONCILE_OPERATION,
    scope,
    datasets: manifest.datasets,
    inputHash: proof.nativeShortBodyReconciliationInputHash(ACCOUNT, audit, recovery, POLICY),
    requestedAt: T(n),
    startedAt: T(n + 1),
    platformReadStartedAt: T(n + 2),
    endedAt: T(n + 8),
    updatedAt: T(n + 8),
    result: { manifest },
    metadata: {},
    deadlineAt: T(n + 120001),
  };
  const context = { original: d.context, readJob, manifest, ref, document, recoveryContext };
  const closure = proof.createNativeShortBodyClosure(context, T(n + 9));
  assert.equal(closure.schema, 'native-short-body-closure/v2');
  assert.equal(closure.status, 'succeeded');
  assert.equal(closure.result.verifiedLive, false);
  assert.equal(JSON.stringify(closure).includes('<p>'), false);
  assert.deepEqual(
    proof.validateNativeShortBodyClosureContext(context, closure, T(n + 9)),
    proof.validateNativeShortBodyReconciliationContext(context),
  );
  const settled = {
    ...d.context,
    job: {
      ...d.context.job,
      status: 'succeeded' as const,
      error: null,
      result: closure,
      endedAt: T(n + 9),
      updatedAt: T(n + 9),
    },
  };
  assert.equal(proof.projectNativeShortBodyEvidenceContext(settled).validated, false);
  const projection = proof.projectNativeShortBodyEvidenceContext(settled, recoveryContext),
    summary = data(projection.data[0]);
  assert.equal(projection.validated, true);
  assert.equal(projection.verifiedLive, false);
  assert.equal(summary.schema, 'native-short-body-summary/v2');
  assert.equal(summary.recoveryVerified, true);
  assert.equal(data(summary.summaries).pendingAtEnd, 1);
  assert.equal(data(summary.summaries).quarantined, true);
  assert.equal(data(data(summary.recovery).cleanup).pendingAtEnd, 0);
  const mismatched = {
    ...recoveryContext,
    recovery: { ...recovery, freshReadManifestHash: '0'.repeat(64) },
  };
  assert.equal(proof.projectNativeShortBodyEvidenceContext(settled, mismatched).validated, false);
});
