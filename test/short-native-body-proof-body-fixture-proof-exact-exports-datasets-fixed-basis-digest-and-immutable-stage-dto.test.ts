import test from 'node:test';

import assert from 'node:assert/strict';

import * as proof from '../src/platform/short-native-body-proof.js';

import {
  NATIVE_SHORT_BODY_FIXTURE_DATASETS,
  nativeShortBodyHashBasesHash,
  createNativeShortBodyFixtureStageEvidence,
  validateNativeShortBodyFixtureTrace,
  projectNativeShortBodyFixtureTrace,
} from '../src/platform/short-native-body-proof.js';

import {
  sha,
  BASES,
  at,
  bytesHash,
  clone,
  data,
  type Trace,
  TIMES,
} from './helpers/short-native-body-proof-utf16.js';

import { reference, denied, relink, cleaned } from './helpers/short-native-body-proof-reference.js';

test('body fixture proof exact exports datasets fixed basis digest and immutable stage DTO', () => {
  assert.deepEqual(
    Object.keys(proof).sort(),
    [
      'NATIVE_SHORT_BODY_FIXTURE_DATASETS',
      'NativeShortBodyProofError',
      'createNativeShortBodyFixtureStageEvidence',
      'nativeShortBodyHashBasesHash',
      'projectNativeShortBodyFixtureTrace',
      'validateNativeShortBodyFixtureTrace',
      'validateNativeShortBodyLiveProof',
      'NATIVE_SHORT_BODY_OPERATION',
      'NATIVE_SHORT_BODY_RECONCILE_OPERATION',
      'NATIVE_SHORT_BODY_DATASETS',
      'nativeShortBodyScope',
      'nativeShortBodyReconciliationScope',
      'hasReservedNativeShortBodySignal',
      'createNativeShortBodyStageEvidence',
      'validateNativeShortBodyEvidenceContext',
      'validateNativeShortBodyCompletion',
      'createNativeShortBodyOriginalAudit',
      'createNativeShortBodyReconciliationEvidence',
      'validateNativeShortBodyReconciliationContext',
      'createNativeShortBodyClosure',
      'validateNativeShortBodyClosureContext',
      'nativeShortBodyReconciliationInputHash',
      'projectNativeShortBodyEvidenceContext',
      'safeNativeShortBodyJob',
      'nativeShortBodyGraphHash',
      'createNativeShortBodyOwnedGetRecoveryV2',
      'createNativeShortBodyOriginalAuditForRecovery',
      'getNativeShortBodyExpectationMaterial',
      'projectNativeShortBodyReadContext',
    ].sort(),
  );
  assert.deepEqual(NATIVE_SHORT_BODY_FIXTURE_DATASETS, {
    baseline: 'short_native_body_fixture_baseline',
    preSave: 'short_native_body_fixture_pre_save',
    intent: 'short_native_body_fixture_intent',
    attempt: 'short_native_body_fixture_attempt',
    acknowledgement: 'short_native_body_fixture_acknowledgement',
    after: 'short_native_body_fixture_after',
    result: 'short_native_body_fixture_result',
  });
  assert.equal(
    nativeShortBodyHashBasesHash(),
    sha({ schema: 'native-short-body-fixed-hash-bases/v1', hashBases: BASES }),
  );
  const input = at(reference().trace.stages, 0),
    result = createNativeShortBodyFixtureStageEvidence(input);
  assert.deepEqual(result, input);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.payload), true);
  assert.deepEqual(Object.keys(result), [
    'schema',
    'kind',
    'sequence',
    'eventAt',
    'priorStageHash',
    'payload',
  ]);
  assert.equal(
    bytesHash('<p>乙</p><p></p>'),
    'fd1a55ee655370dd7d8b49fe62280c91778044f2dc030438b3010fac4a875110',
  );
});

test('body fixture proof independently rebuilds compact seven stages and exact body-free projection', () => {
  const { trace } = reference(),
    valid = validateNativeShortBodyFixtureTrace(trace, 'complete');
  assert.deepEqual(valid, trace);
  assert.equal(Object.isFrozen(valid.stages), true);
  const projected = projectNativeShortBodyFixtureTrace(trace);
  assert.deepEqual(projected, {
    validated: true,
    verifiedLive: false,
    durable: false,
    bodyIncluded: false,
    status: 'fixture_complete',
    reason: 'fixture_not_live',
    stageHashes: trace.stages.map(sha),
    summaries: {
      stageCount: 7,
      simulatedAttemptOrdinal: 1,
      baselineObserved: true,
      preSaveVerified: true,
      postAttempted: true,
      acknowledged: true,
      afterObserved: true,
      desiredMatched: true,
      pendingAtEnd: 0,
      disposalFailures: 0,
      quarantined: false,
    },
  });
  assert.deepEqual(projectNativeShortBodyFixtureTrace(clone(trace)), projected);
  const publicBytes = JSON.stringify(projected);
  for (const privateValue of [
    '<p>',
    'businessInput',
    'Synthetic title',
    'lines',
    'native',
    'form',
    'original',
  ])
    assert.equal(publicBytes.includes(privateValue), false);
  const mixed = clone(trace);
  data(at(mixed.stages, 0).payload.native).snapshotVersionHash = '0'.repeat(64);
  denied(() => validateNativeShortBodyFixtureTrace(mixed, 'complete'), 'invalid_shape');
});

test('body fixture proof rejects chain sequence time provenance and independently rechained source forgeries', () => {
  const edits: ((trace: Trace) => void)[] = [
    (t) => {
      at(t.stages, 1).sequence = 3;
    },
    (t) => {
      at(t.stages, 2).priorStageHash = '0'.repeat(64);
    },
    (t) => {
      at(t.stages, 2).eventAt = '2026-10-04T00:00:00.000Z';
    },
    (t) => {
      t.provenance.mode = 'live';
    },
    (t) => {
      t.accountId = 'another-synthetic-owner';
    },
    (t) => {
      t.inputHash = '0'.repeat(64);
    },
    (t) => {
      data(at(t.stages, 0).payload.businessInput).paragraphs = [
        { sourceIndex: null, lines: ['丙'] },
      ];
      relink(t);
    },
    (t) => {
      data(data(at(t.stages, 1).payload.native).editData).opaque = { keep: ['changed'] };
      relink(t);
    },
    (t) => {
      at(t.stages, 2).payload.hashBasesHash = '0'.repeat(64);
      relink(t);
    },
    (t) => {
      data(at(t.stages, 4).payload.observation).desiredContentHash = '0'.repeat(64);
      relink(t);
    },
    (t) => {
      data(at(t.stages, 5).payload.comparison).matches = false;
      relink(t);
    },
  ];
  for (const edit of edits) {
    const t = clone(reference().trace);
    edit(t);
    denied(() => validateNativeShortBodyFixtureTrace(t, 'complete'));
  }
  const duplicate = reference().trace;
  duplicate.stages.splice(4, 0, clone(at(duplicate.stages, 3)));
  denied(() => validateNativeShortBodyFixtureTrace(duplicate, 'complete'));
  const prefix = reference().trace;
  prefix.stages = prefix.stages.slice(0, 3);
  prefix.simulatedAttemptOrdinal = null;
  const projection = projectNativeShortBodyFixtureTrace(prefix, 'prefix');
  assert.equal(projection.reason, 'durability_unverified');
  assert.equal(projection.status, 'capability_unavailable');
  denied(() => validateNativeShortBodyFixtureTrace(prefix, 'complete'), 'invalid_trace');
});

test('body fixture proof ACK loss same-run desired match stays unknown and paired null after cannot match', () => {
  const t = reference().trace;
  t.stages.splice(4, 1);
  const final = at(t.stages, 5);
  final.payload.outcome = 'fixture_unknown';
  final.payload.reason = 'acknowledgement_unverified';
  relink(t);
  const projection = projectNativeShortBodyFixtureTrace(t);
  assert.equal(projection.status, 'capability_unavailable');
  assert.equal(projection.summaries.desiredMatched, true);
  assert.equal(projection.summaries.acknowledged, false);
  const forged = clone(t);
  at(forged.stages, 5).payload.outcome = 'fixture_matched';
  at(forged.stages, 5).payload.reason = 'fixture_not_live';
  relink(forged);
  denied(() => validateNativeShortBodyFixtureTrace(forged, 'complete'), 'invalid_trace');
  const nullAfter = clone(t);
  at(nullAfter.stages, 4).payload = { native: null, comparison: null };
  relink(nullAfter);
  assert.equal(projectNativeShortBodyFixtureTrace(nullAfter).summaries.afterObserved, false);
  const half = clone(nullAfter);
  at(half.stages, 4).payload.native = reference().before;
  relink(half);
  denied(() => validateNativeShortBodyFixtureTrace(half, 'complete'), 'invalid_trace');
  const stale = reference({}, 7).trace;
  const staleProjection = projectNativeShortBodyFixtureTrace(stale);
  assert.equal(staleProjection.reason, 'readback_mismatch');
  assert.equal(staleProjection.summaries.desiredMatched, false);
  assert.equal(
    data(data(at(stale.stages, 5).payload.comparison).actual).serverRevisionAfter !== null,
    true,
  );
});

test('body fixture proof legal failure prefixes no-change and truthful incomplete cleanup remain nonlive', () => {
  const noChange = reference({}, 8, true).trace;
  assert.equal(projectNativeShortBodyFixtureTrace(noChange).status, 'no_change');
  const fake = reference().trace;
  fake.stages = [
    at(fake.stages, 0),
    {
      ...at(fake.stages, 6),
      payload: { outcome: 'not_attempted', reason: 'no_change', cleanup: cleaned(at(TIMES, 1)) },
    },
  ];
  relink(fake);
  denied(() => validateNativeShortBodyFixtureTrace(fake, 'complete'), 'invalid_trace');
  for (let size = 0; size <= 6; size++) {
    const t = reference().trace;
    t.stages = t.stages.slice(0, size);
    t.stages.push({
      schema: 'native-short-body-fixture-stage/v1',
      kind: 'result',
      sequence: size + 1,
      eventAt: at(TIMES, 6),
      priorStageHash: null,
      payload: {
        outcome: size >= 4 ? 'fixture_unknown' : 'not_attempted',
        reason: 'cancelled',
        cleanup: cleaned(at(TIMES, 6)),
      },
    });
    relink(t);
    assert.equal(projectNativeShortBodyFixtureTrace(t).status, 'capability_unavailable');
  }
  const pending = reference().trace;
  const final = at(pending.stages, 6);
  final.payload.outcome = 'fixture_unknown';
  final.payload.reason = 'cleanup_failed';
  final.payload.cleanup = {
    sessionCreated: true,
    sessionDisposed: false,
    disposalFailures: 1,
    pendingAtEnd: 2,
    quarantined: true,
    checkedAt: at(TIMES, 6),
  };
  relink(pending);
  assert.deepEqual(projectNativeShortBodyFixtureTrace(pending).summaries, {
    stageCount: 7,
    simulatedAttemptOrdinal: 1,
    baselineObserved: true,
    preSaveVerified: true,
    postAttempted: true,
    acknowledged: true,
    afterObserved: true,
    desiredMatched: true,
    pendingAtEnd: 2,
    disposalFailures: 1,
    quarantined: true,
  });
  const falseSuccess = clone(pending);
  at(falseSuccess.stages, 6).payload.outcome = 'fixture_matched';
  at(falseSuccess.stages, 6).payload.reason = 'fixture_not_live';
  relink(falseSuccess);
  denied(() => validateNativeShortBodyFixtureTrace(falseSuccess, 'complete'), 'invalid_trace');
  const noAttempt = clone(noChange);
  at(noAttempt.stages, 1).payload.outcome = 'fixture_unknown';
  at(noAttempt.stages, 1).payload.reason = 'timeout';
  relink(noAttempt);
  denied(() => validateNativeShortBodyFixtureTrace(noAttempt, 'complete'), 'invalid_trace');
});
