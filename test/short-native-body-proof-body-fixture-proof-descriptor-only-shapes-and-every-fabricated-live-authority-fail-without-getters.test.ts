import test from 'node:test';

import {
  reference,
  denied,
  cleaned,
  DJOB,
  DT,
  DACCOUNT,
  physical,
  dlink,
} from './helpers/short-native-body-proof-reference.js';

import * as proof from '../src/platform/short-native-body-proof.js';

import {
  validateNativeShortBodyFixtureTrace,
  validateNativeShortBodyLiveProof,
  NativeShortBodyProofError,
  projectNativeShortBodyFixtureTrace,
  createNativeShortBodyFixtureStageEvidence,
} from '../src/platform/short-native-body-proof.js';

import {
  data,
  at,
  utf16,
  sha,
  clone,
  type Data,
  TIMES,
  DRAFT_STATUS_FACTS,
  WORK,
  bytesHash,
} from './helpers/short-native-body-proof-utf16.js';

import assert from 'node:assert/strict';

import {
  durableReference,
  independentAudit,
} from './helpers/short-native-body-proof-durable-reference.js';

test('body fixture proof descriptor-only shapes and every fabricated live authority fail without getters', () => {
  let getters = 0;
  for (const key of Object.keys(reference().trace)) {
    const t = reference().trace;
    Object.defineProperty(t, key, {
      enumerable: true,
      get() {
        getters++;
        return 'synthetic-original';
      },
    });
    denied(() => validateNativeShortBodyFixtureTrace(t, 'complete'), 'invalid_shape');
  }
  const accessor = reference().trace;
  Object.defineProperty(data(data(at(accessor.stages, 0).payload.native).editData), 'opaque', {
    enumerable: true,
    get() {
      getters++;
      return {};
    },
  });
  denied(() => validateNativeShortBodyFixtureTrace(accessor, 'complete'), 'invalid_shape');
  const variants: unknown[] = [new Date(), { ...reference().trace, extra: true }];
  const symbol = reference().trace;
  Object.defineProperty(symbol, Symbol('synthetic'), { value: 1 });
  variants.push(symbol);
  const sparse = reference().trace;
  delete sparse.stages[2];
  variants.push(sparse);
  const cyclic = reference().trace;
  data(at(cyclic.stages, 0).payload.native).cycle = cyclic;
  variants.push(cyclic);
  const serializer = reference().trace;
  data(data(at(serializer.stages, 0).payload.native).editData).toJSON = () => {
    getters++;
    return {};
  };
  variants.push(serializer);
  for (const value of variants)
    denied(() => validateNativeShortBodyFixtureTrace(value, 'complete'), 'invalid_shape');
  for (const fake of [
    reference().trace,
    { brand: true, durable: true },
    { mode: 'live', authority: () => true },
    accessor,
    null,
  ])
    denied(() => validateNativeShortBodyLiveProof(fake), 'durability_unverified');
  assert.equal(getters, 0);
  const sanitized = Reflect.construct(NativeShortBodyProofError, ['private-unrecognized-code']);
  assert.equal(sanitized.code, 'invalid_shape');
  assert.equal(sanitized.message, 'Native short body fixture proof rejected: invalid_shape');
});

test('body fixture proof per-source budgets wrapper ceilings and UTF16 canonical keys stay independent', () => {
  const unicode = {
    '2': 'two',
    '10': 'ten',
    é: 'composed',
    é: 'decomposed',
    '😀': 'astral',
    '￿': 'bmp',
  };
  assert.equal(
    utf16(unicode),
    '{"10":"ten","2":"two","é":"decomposed","é":"composed","😀":"astral","￿":"bmp"}',
  );
  const t = reference({ unknown_keys: unicode }).trace;
  assert.deepEqual(projectNativeShortBodyFixtureTrace(t).stageHashes, t.stages.map(sha));
  const large = reference({ opaque_padding: 'x'.repeat(2 * 1024 * 1024) }).trace;
  assert.equal(projectNativeShortBodyFixtureTrace(large).status, 'fixture_complete');
  const oversized = clone(reference().trace);
  data(data(at(oversized.stages, 0).payload.native).editData).opaque_padding = 'x'.repeat(
    3 * 1024 * 1024,
  );
  denied(() => validateNativeShortBodyFixtureTrace(oversized, 'complete'), 'resource_limit');
  const nodes = clone(reference().trace);
  data(data(at(nodes.stages, 0).payload.native).editData).opaque_nodes = Array(100_001).fill(null);
  denied(() => validateNativeShortBodyFixtureTrace(nodes, 'complete'), 'resource_limit');
  let deep: Data = {};
  const root = deep;
  for (let i = 0; i < 73; i++) {
    const child: Data = {};
    deep.next = child;
    deep = child;
  }
  denied(
    () =>
      createNativeShortBodyFixtureStageEvidence({
        ...at(reference().trace.stages, 0),
        payload: root,
      }),
    'resource_limit',
  );
  denied(
    () =>
      createNativeShortBodyFixtureStageEvidence({
        ...at(reference().trace.stages, 6),
        payload: {
          outcome: 'not_attempted',
          reason: 'x'.repeat(16 * 1024 * 1024),
          cleanup: cleaned(at(TIMES, 6)),
        },
      }),
    'resource_limit',
  );
  const overTrace = { ...reference().trace, huge: 'x'.repeat(32 * 1024 * 1024) };
  denied(() => validateNativeShortBodyFixtureTrace(overTrace, 'complete'), 'resource_limit');
  const invalidNumber = reference().trace;
  data(data(at(invalidNumber.stages, 0).payload.native).editData).opaque_number = -0;
  denied(() => validateNativeShortBodyFixtureTrace(invalidNumber, 'complete'), 'invalid_shape');
  const invalidKey = reference().trace;
  data(data(at(invalidKey.stages, 0).payload.native).editData)['\ud800'] = 1;
  denied(() => validateNativeShortBodyFixtureTrace(invalidKey, 'complete'), 'invalid_shape');
});

test('body durable proof independent compact graph complete no-change and source projection remain safe', () => {
  const d = durableReference();
  assert.deepEqual(proof.validateNativeShortBodyCompletion(d.context, d.result), d.result);
  const p = proof.projectNativeShortBodyEvidenceContext(d.context);
  assert.equal(p.validated, true);
  assert.equal(p.durable, true);
  assert.equal(p.verifiedLive, false);
  assert.equal(p.status, 'matched');
  assert.deepEqual(
    Object.keys(at(p.data, 0)).sort(),
    [
      'schema',
      'status',
      'reason',
      'source',
      'state',
      'statusFacts',
      'statusSource',
      'atomicRevision',
      'hashBasesHash',
      'desiredContentHash',
      'verifiedLive',
      'durable',
      'bodyIncluded',
      'summaries',
    ].sort(),
  );
  assert.equal(at(p.data, 0).state, 'draft');
  assert.deepEqual(at(p.data, 0).statusFacts, DRAFT_STATUS_FACTS);
  const statusRef = at(d.context.refs, 5);
  assert.deepEqual(at(p.data, 0).statusSource, {
    phase: 'after',
    sourceRef: statusRef.id,
    evidenceHash: statusRef.sha256,
    evidenceCapturedAt: statusRef.capturedAt,
  });
  assert.equal(at(p.data, 0).schema, 'native-short-body-summary/v1');
  assert.deepEqual(
    Object.keys(at(p.evidence, 0)).sort(),
    ['id', 'dataset', 'sha256', 'capturedAt'].sort(),
  );
  assert.deepEqual(
    proof.safeNativeShortBodyJob(
      d.context.job as unknown as import('../src/runtime/store.js').Job,
      p,
    ),
    {
      id: DJOB,
      status: 'succeeded',
      operation: 'update_short_body',
      requestedAt: DT(0),
      endedAt: DT(22),
    },
  );
  assert.equal(JSON.stringify(p).includes('synthetic-head-uri'), false);
  assert.equal(JSON.stringify(p).includes('<p>'), false);
  assert.equal(JSON.stringify(p).includes(DACCOUNT), false);
  assert.equal(JSON.stringify(p).includes(WORK), false);
  const nc = durableReference({ noChange: true });
  assert.deepEqual(proof.validateNativeShortBodyCompletion(nc.context, nc.result), nc.result);
  assert.equal(proof.projectNativeShortBodyEvidenceContext(nc.context).status, 'no_change');
  assert.equal(nc.context.attempts.length, 0);
});

test('body durable proof physical whole-document LF and strict integer UTF16 chains use distinct domains', () => {
  const probe = {
    '10': 'ten',
    '2': 'two',
    '01': 'leading',
    '4294967294': 'max',
    '4294967295': 'not-index',
    '-1': 'negative',
    a: { '10': 1, '2': 2 },
  };
  assert.equal(sha(probe), '75343d2b18dedd23a5993903db077b738a14e715e871c67bcb61b56a770a9052');
  assert.equal(
    bytesHash(physical(probe)),
    '960b03051d0d460edcb15ebd07838a0ce3bd697d898218488290ae61b21e2ebe',
  );
  assert.equal(
    bytesHash(physical(probe) + '\n'),
    '5e77670c021d12bb21c3bd27511f7741161d837bc9994d5a802a9d4f1cb3cd37',
  );
  assert.equal(
    sha({ '\ue000': 'bmp', '𐀀': 'astral', A: 'ascii' }),
    'f95a0bd3b9b15d3c4b79ba7fed8f95f5d7168ce3624e41522e9c4163ea2e5b9c',
  );
  const d = durableReference({ extra: { unknown_keys: probe } });
  assert.equal(proof.projectNativeShortBodyEvidenceContext(d.context).validated, true);
  for (const wrong of [
    sha(at(d.context.documents, 0)),
    bytesHash(physical(at(d.context.documents, 0))),
    bytesHash(physical(at(d.context.documents, 0)) + '\r\n'),
    bytesHash('\ufeff' + physical(at(d.context.documents, 0)) + '\n'),
  ]) {
    const bad = clone(d.context);
    at(bad.refs, 0).sha256 = wrong;
    denied(() => proof.validateNativeShortBodyEvidenceContext(bad, 'complete'), 'source_mismatch');
  }
  const wrongChain = clone(d.context);
  data(at(wrongChain.documents, 1).payload).priorStageHash = at(wrongChain.refs, 0).sha256;
  at(wrongChain.refs, 1).sha256 = bytesHash(physical(at(wrongChain.documents, 1)) + '\n');
  denied(() => proof.validateNativeShortBodyEvidenceContext(wrongChain, 'prefix'), 'invalid_trace');
});

test('body durable proof unique ordinal physical identities prospective completion and ACK-loss reject upgrades', () => {
  const unknown = durableReference({ ackLoss: true });
  const p = proof.projectNativeShortBodyEvidenceContext(unknown.context);
  assert.equal(p.status, 'unknown');
  assert.equal(p.verifiedLive, false);
  assert.equal(data(at(p.data, 0).summaries).desiredMatched, true);
  assert.equal(data(at(p.data, 0).summaries).acknowledged, false);
  denied(
    () => proof.validateNativeShortBodyCompletion(unknown.context, unknown.result),
    'durability_unverified',
  );
  for (const mutate of [
    (c: typeof unknown.context) => {
      c.attempts.push(at(c.attempts, 0));
    },
    (c: typeof unknown.context) => {
      at(c.attempts, 0).eventAt = DT(15);
    },
    (c: typeof unknown.context) => {
      at(c.documents, 0).accountId = 'foreign';
    },
    (c: typeof unknown.context) => {
      at(c.refs, 0).dataset = 'short_native_trial_baseline';
    },
    (c: typeof unknown.context) => {
      c.job.platformWriteStartedAt = null;
    },
  ]) {
    const bad = clone(unknown.context);
    mutate(bad);
    denied(() => proof.validateNativeShortBodyEvidenceContext(bad, 'prefix'));
  }
  const d = durableReference(),
    running = clone(d.context);
  running.job.status = 'running';
  running.job.result = null;
  running.job.endedAt = null;
  running.job.updatedAt = DT(21);
  assert.deepEqual(proof.validateNativeShortBodyCompletion(running, d.result), d.result);
  const lied = clone(d.result);
  lied.ownerCheckedAt = DT(23);
  denied(() => proof.validateNativeShortBodyCompletion(d.context, lied));
});

test('body durable proof original audit four strict preimages retain fixed initial cause and ordinal', () => {
  const d = durableReference({ ackLoss: true }),
    wanted = independentAudit(d.context),
    actual = proof.createNativeShortBodyOriginalAudit(d.context);
  assert.deepEqual(actual, wanted);
  assert.equal(actual.originalResultHash, sha({ evidence: d.context.refs }));
  assert.equal(actual.originalErrorHash, sha(d.context.job.error));
  assert.equal(
    actual.evidenceHash,
    sha({ basis: 'native-short-body-original-evidence/v1', links: d.context.refs.map(dlink) }),
  );
  assert.equal(
    actual.attemptsHash,
    sha({ basis: 'native-short-body-original-attempts/v1', attempts: d.context.attempts }),
  );
  assert.equal(
    proof.nativeShortBodyReconciliationInputHash(DACCOUNT, actual),
    sha({
      basis: 'native-short-body-get-only-reconciliation-input/v1',
      accountId: DACCOUNT,
      originalAuditHash: sha(wanted),
    }),
  );
  assert.notEqual(actual.originalResultHash, sha({ evidence: d.context.refs.map(dlink) }));
  const bad = clone(d.context);
  data(data(bad.job.error).details).cause = {
    code: 'capability_unavailable',
    message: 'PRIVATE body/account',
  };
  denied(() => proof.createNativeShortBodyOriginalAudit(bad), 'source_mismatch');
});
