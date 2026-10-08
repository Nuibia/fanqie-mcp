import test from 'node:test';

import {
  durableReference,
  independentAudit,
  reseal,
} from './helpers/short-native-body-proof-durable-reference.js';

import { independentReconciliation } from './helpers/short-native-body-proof-independent-reconciliation.js';

import assert from 'node:assert/strict';

import * as proof from '../src/platform/short-native-body-proof.js';

import {
  DT,
  denied,
  physical,
  DSOURCE,
  DJOB,
} from './helpers/short-native-body-proof-reference.js';

import {
  clone,
  data,
  modernTuple4,
  raw,
  bytesHash,
  at,
  preservation,
  documentHashes,
  sha,
  BASES,
  BINDING,
} from './helpers/short-native-body-proof-utf16.js';

import { createNativeShortMetadataSnapshot } from '../src/platform/short-native-metadata.js';

test('body durable proof partial immutable closure later matching and historical pointers preserve unknown', () => {
  const d = durableReference({ ackLoss: true }),
    firstAudit = independentAudit(d.context),
    partial = independentReconciliation(d.context, true, firstAudit);
  assert.deepEqual(
    proof.validateNativeShortBodyReconciliationContext(partial.context),
    partial.settlement,
  );
  assert.deepEqual(proof.createNativeShortBodyClosure(partial.context, DT(39)), partial.closure);
  assert.deepEqual(
    proof.validateNativeShortBodyClosureContext(partial.context, partial.closure, DT(39)),
    partial.settlement,
  );
  const continuation = clone(d.context);
  continuation.job.result = partial.closure;
  continuation.job.endedAt = DT(39);
  continuation.job.updatedAt = DT(39);
  const audit = independentAudit(continuation, firstAudit, partial.closure),
    actual = proof.createNativeShortBodyOriginalAudit(continuation, {
      firstAudit: firstAudit as unknown as proof.NativeShortBodyOriginalAudit,
      previousClosure: partial.closure as unknown as proof.NativeShortBodyClosure,
    });
  assert.deepEqual(actual, audit);
  const fresh = independentReconciliation(continuation, false, audit, 50);
  assert.deepEqual(
    proof.validateNativeShortBodyReconciliationContext(fresh.context),
    fresh.settlement,
  );
  assert.deepEqual(proof.createNativeShortBodyClosure(fresh.context, DT(59)), fresh.closure);
  assert.equal(fresh.settlement.result.verifiedLive, false);
  const terminal = clone(continuation);
  terminal.job.result = fresh.closure;
  terminal.job.status = 'succeeded';
  terminal.job.endedAt = DT(59);
  terminal.job.updatedAt = DT(59);
  terminal.job.error = null;
  const projected = proof.projectNativeShortBodyEvidenceContext(terminal);
  assert.equal(projected.status, 'matched');
  assert.equal(projected.verifiedLive, false);
  const forged = clone(fresh.closure);
  forged.reason = 'partial_read';
  denied(() => proof.validateNativeShortBodyClosureContext(fresh.context, forged, DT(59)));
});

test('body durable proof reconciliation strict freshness source identity and paired partial observations fail closed', () => {
  const d = durableReference({ ackLoss: true }),
    r = independentReconciliation(d.context, false);
  const half = clone(r.payload);
  half.native = null;
  denied(() => proof.createNativeShortBodyReconciliationEvidence(half), 'invalid_shape');
  const stale = clone(r.payload);
  data(stale.read).proof = { ...data(data(stale.read).proof), readStartedAt: DT(22) };
  denied(() => proof.createNativeShortBodyReconciliationEvidence(stale), 'invalid_trace');
  const wrong = clone(r.context);
  wrong.readJob.inputHash = data(wrong.original.job).inputHash as string;
  denied(() => proof.validateNativeShortBodyReconciliationContext(wrong), 'source_mismatch');
  const before = clone(r.context);
  before.document.payload.native = modernTuple4(raw());
  before.ref.sha256 = bytesHash(physical(before.document) + '\n');
  denied(() => proof.validateNativeShortBodyReconciliationContext(before), 'source_mismatch');
  const foreign = clone(r.context);
  foreign.ref.accountId = 'foreign';
  denied(() => proof.validateNativeShortBodyReconciliationContext(foreign), 'source_mismatch');
});

test('body durable proof descriptor resource scopes owner clocks and no caller live authority remain bounded', () => {
  const d = durableReference();
  let calls = 0;
  for (const key of ['accountId', 'job', 'manifest', 'refs', 'documents', 'attempts']) {
    const c = clone(d.context);
    Object.defineProperty(c, key, {
      enumerable: true,
      get() {
        calls++;
        return null;
      },
    });
    denied(() => proof.validateNativeShortBodyEvidenceContext(c, 'prefix'), 'invalid_shape');
  }
  const accessor = clone(d.context);
  Object.defineProperty(data(data(at(accessor.documents, 0).payload).payload), 'native', {
    enumerable: true,
    get() {
      calls++;
      return raw();
    },
  });
  denied(() => proof.validateNativeShortBodyEvidenceContext(accessor, 'prefix'), 'invalid_shape');
  const future = clone(d.context);
  data(at(future.documents, 0).payload).eventAt = '2999-01-01T00:00:00.000Z';
  reseal(future);
  denied(() => proof.validateNativeShortBodyEvidenceContext(future, 'prefix'), 'invalid_trace');
  const negative = clone(d.context);
  data(data(data(at(negative.documents, 0).payload).payload).native).negative = -0;
  denied(() => proof.validateNativeShortBodyEvidenceContext(negative, 'prefix'), 'invalid_shape');
  const unicode = clone(d.context);
  unicode.accountId = 'synthetic-owner-甲';
  denied(() => proof.validateNativeShortBodyEvidenceContext(unicode, 'prefix'), 'invalid_shape');
  const legalLarge = durableReference({ extra: { opaque_padding: 'x'.repeat(600 * 1024) } });
  assert.equal(proof.projectNativeShortBodyEvidenceContext(legalLarge.context).validated, true);
  const meta = clone(d.context);
  meta.job.metadata = { huge: 'x'.repeat(512 * 1024) };
  denied(() => proof.validateNativeShortBodyEvidenceContext(meta, 'prefix'), 'resource_limit');
  assert.equal(calls, 0);
  assert.equal(
    proof.hasReservedNativeShortBodySignal({ schema: 'native-short-body-unknown/v99' }),
    true,
  );
  assert.equal(
    proof.hasReservedNativeShortBodySignal({ business: { trial: { action: 'preserve' } } }),
    false,
  );
  denied(() => proof.validateNativeShortBodyLiveProof(d.context), 'durability_unverified');
});

test('body durable proof protected native five hashes ASCII business golden and full preservation resist drift', () => {
  const snapshot = createNativeShortMetadataSnapshot(raw());
  assert.deepEqual(
    {
      snapshot: snapshot.snapshotVersionHash,
      catalog: snapshot.catalogHash,
      savedFields: snapshot.savedFieldsHash,
      categorySelection: snapshot.categorySelectionHash,
      document: snapshot.documentHash,
    },
    {
      snapshot: '63ea513b3ac2d6b52aecc8dda7cce523b7785c63fe0a06efa678b649f96f80ef',
      catalog: '4bd640296f0cf1be0df9cbcb81b7a64482f2b97dacb048bc50bb7ca00984f0a8',
      savedFields: 'edbe883da985253890b9097d77b9dbaa125888e3e1ef5ea9f129221879a57b46',
      categorySelection: 'aa66ec252d3a4c35c6aeae51a49a730edcb39b948d9d9bd2a5be8f1ade2fe523',
      document: 'b786a99412515b78cf652797135841c86461c6797ea77cc6d84519fa8f7da2b3',
    },
  );
  const d = durableReference();
  assert.equal(
    d.context.job.inputHash,
    '8f29655db015e9bcac3c296afcddd724e0e7cb90ec58b1457e3831396a989bce',
  );
  assert.equal(
    d.base.desiredHash,
    '35841fa116b69b61471ae40d265d903f0f933e6c7c762aeff95e71e61ae6e03b',
  );
  assert.equal(
    d.base.expectation.preservationHash,
    'bd921826b26dad792826dce5ce230fc85af52bddace3896f23fc4ca8f27abc7b',
  );
  for (const [field, value] of [
    ['thumb_uri', 'changed-cover'],
    ['opaque', { keep: [null, true, 'changed'] }],
    ['latest_version', 7],
    ['modify_time', 'invalid'],
  ] as const) {
    const bad = clone(d.context),
      payload = data(data(at(bad.documents, 5).payload).payload),
      native = data(payload.native),
      edit = data(native.editData);
    edit[field] = value;
    reseal(bad);
    denied(() => proof.validateNativeShortBodyEvidenceContext(bad, 'complete'), 'source_mismatch');
  }
  const desiredWrong = clone(d.context);
  data(data(data(at(desiredWrong.documents, 5).payload).payload).native).editData = {
    ...data(data(data(data(at(desiredWrong.documents, 5).payload).payload).native).editData),
    content: '<p>甲</p><p></p>',
  };
  reseal(desiredWrong);
  denied(
    () => proof.validateNativeShortBodyEvidenceContext(desiredWrong, 'complete'),
    'source_mismatch',
  );
});

test('body durable proof no-change forged success missing cleanup and mixed reserved carriers deny completion', () => {
  const d = durableReference({ noChange: true });
  const bad = clone(d.context),
    last = data(data(at(bad.documents, 1).payload).payload);
  last.outcome = 'matched';
  last.reason = 'fixture_not_live';
  reseal(bad);
  denied(() => proof.validateNativeShortBodyEvidenceContext(bad, 'complete'), 'invalid_trace');
  const pending = clone(durableReference().context),
    final = data(data(at(pending.documents, 6).payload).payload);
  final.cleanup = {
    sessionCreated: true,
    sessionDisposed: false,
    disposalFailures: 1,
    pendingAtEnd: 1,
    quarantined: true,
    checkedAt: DT(21),
  };
  reseal(pending);
  denied(() => proof.validateNativeShortBodyEvidenceContext(pending, 'complete'), 'invalid_trace');
  const extra = clone(d.context);
  data(at(extra.documents, 0).payload).unexpected = true;
  reseal(extra);
  denied(() => proof.validateNativeShortBodyEvidenceContext(extra, 'prefix'), 'invalid_shape');
  for (const signal of [
    { operation: 'update_short_body' },
    { scope: 'short_native_body.unknown' },
    { dataset: 'short_native_body_reconciliation' },
    { schema: 'native-short-body-closure/v999' },
  ])
    assert.equal(proof.hasReservedNativeShortBodySignal(signal), true);
  let getters = 0;
  const carrier = {};
  Object.defineProperty(carrier, 'operation', {
    enumerable: true,
    get() {
      getters++;
      return 'update_short_body';
    },
  });
  assert.equal(proof.hasReservedNativeShortBodySignal(carrier), true);
  assert.equal(getters, 0);
});

test('body durable proof strictly unchanged later observation settles not-applied while revision drift stays unknown', () => {
  const d = durableReference({ ackLoss: true }),
    r = independentReconciliation(d.context, false),
    snapshot = createNativeShortMetadataSnapshot(raw()),
    prior = r.payload.comparison;
  assert.ok(prior !== null);
  const actual = prior.actual;
  r.payload.native = modernTuple4(raw());
  r.payload.comparison = {
    ...prior,
    matches: false,
    reason: 'server_revision_not_proven',
    actual: {
      ...actual,
      snapshotVersionHash: snapshot.snapshotVersionHash,
      documentHash: snapshot.documentHash,
      savedFieldsHash: snapshot.savedFieldsHash,
      preservationHash: preservation(raw(), false),
      ...documentHashes('甲'),
      observedWireVectorHash: sha({
        basis: BASES.effectiveWireVector,
        binding: BINDING,
        paragraphs: [
          { lines: ['甲'], rawHtml: '<p>甲</p>' },
          { lines: [''], rawHtml: '<p></p>' },
        ],
      }),
      serverRevisionAfter: { latestVersion: 7, modifyTime: '1789450000' },
    },
  };
  r.payload.reason = 'not_applied';
  r.context.ref.sha256 = bytesHash(physical(r.context.document) + '\n');
  const expected = {
    status: 'failed',
    reason: 'not_applied',
    result: {
      schema: 'native-short-body-settlement-result/v1',
      source: DSOURCE,
      originalJobId: DJOB,
      readJobId: r.context.readJob.id,
      desiredMatched: false,
      bodyIncluded: false,
      verifiedLive: false,
    },
  };
  assert.deepEqual(proof.validateNativeShortBodyReconciliationContext(r.context), expected);
  const drift = clone(r.context);
  data(drift.document.payload.native).editData = {
    ...data(data(drift.document.payload.native).editData),
    latest_version: 9,
  };
  drift.ref.sha256 = bytesHash(physical(drift.document) + '\n');
  denied(() => proof.validateNativeShortBodyReconciliationContext(drift), 'source_mismatch');
});
