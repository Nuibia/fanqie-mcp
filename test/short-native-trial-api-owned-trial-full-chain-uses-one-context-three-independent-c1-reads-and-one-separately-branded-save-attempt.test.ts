import test from 'node:test';

import { fixture, unavailable } from './helpers/short-native-trial-api-fixture.js';

import assert from 'node:assert/strict';

import {
  HTML,
  business,
  type ReceiptTransform,
  WORK,
} from './helpers/short-native-trial-api-edit.js';

import {
  captureNativeShortTrialWriteRequest,
  type NativeShortTrialReceipt,
} from '../src/platform/short-native-trial-api.js';

test('owned trial full chain uses one context, three independent C1 reads and one separately branded save attempt', async () => {
  const f = fixture(),
    result = await f.run.run();
  assert.equal(result.status, 'success');
  assert.equal(result.reason, null);
  assert.equal(f.clientCreates, 1);
  assert.equal(f.clientDisposes, 1);
  assert.equal(f.calls.filter((c) => c.method === 'GET').length, 15);
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 1);
  assert.deepEqual(
    f.events.filter((event) =>
      ['baseline', 'intent', 'attempt', 'POST', 'acknowledgement'].includes(event),
    ),
    ['baseline', 'intent', 'attempt', 'POST', 'acknowledgement'],
  );
  assert.equal(f.events.filter((event) => event === 'read-boundary').length, 1);
  assert.equal(f.receipts.length, 3);
  assert.equal(new Set(f.receipts.map((receipt) => receipt.schema)).size, 3);
  assert.equal(new Set(f.receipts.map((receipt) => receipt.evidence.id)).size, 3);
  assert.equal(result.save.post.attempts, 1);
  assert.equal(result.save.post.disposed, 1);
  assert.equal(result.save.outcome, 'verified');
  assert.equal(result.save.post.markedAt, result.save.attemptReceipt?.eventAt);
  assert(result.save.post.startedAt! >= result.save.post.markedAt!);
  assert.equal(result.comparison?.matches, true);
  assert.equal(result.desiredContentHash, result.observedContentHash);
  assert.equal(result.snapshot?.document.markerFreeHtml, HTML);
  for (const phase of Object.values(result.phases)) {
    assert.equal(phase.proof.fixedSourceVerified, true);
    assert.equal(phase.requests.own.attempts, 2);
    assert.equal(phase.requests.own.disposed, 2);
    assert(phase.proof.proofCapturedAt);
  }
  assert.equal(result.cleanup.sessionDisposed, true);
  assert(Object.isFrozen(result));
  assert(f.events.indexOf('dispose-done') < f.events.indexOf('owner-callback'));
  for (const call of f.calls) {
    assert.equal(call.options.maxRedirects, 0);
    assert.equal(call.options.maxRetries, 0);
  }
  assert.deepEqual(Object.keys(f.capturedStorage as object), ['storageState']);
  assert.equal(
    (f.capturedStorage as { storageState: { cookies: unknown[]; origins: unknown[] } }).storageState
      .cookies.length,
    1,
  );
  await assert.rejects(() => f.run.run(), /single-use/);
});

test('same Owned class supports read-only full C1 with zero POST and one clean client', async () => {
  const f = fixture({ read: true }),
    result = await f.run.run();
  assert.equal(result.status, 'success');
  assert.equal(result.mode, 'read');
  assert.equal(f.calls.length, 5);
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 0);
  assert.equal(result.save.post.attempts, 0);
  assert.equal(result.snapshot?.document.markerCount, 0);
  assert.equal(f.clientCreates, 1);
  assert.equal(f.clientDisposes, 1);
  assert.equal(f.receipts.length, 0);
});

test('narrow constructor capture rejects accessor side channels and freezes owner/business/callback aliases', async () => {
  let getters = 0;
  const valid = business();
  for (const value of [
    { ...valid, url: 'https://example.invalid' },
    { ...valid, metadata: { trial: { action: 'clear', beforeParagraph: 1 } } },
    { ...valid, metadata: { trial: { action: 'set', beforeParagraph: -0 } } },
    {
      ...valid,
      get metadata() {
        getters++;
        return valid.metadata;
      },
    },
    { ...valid, [Symbol('extra')]: true },
  ])
    assert.equal(captureNativeShortTrialWriteRequest(value), null);
  assert.equal(getters, 0);
  const f = fixture({ hold: 'creation' }),
    running = f.run.run();
  await f.entered;
  f.writeOptions.expectedOwner.id = '9999';
  f.writeOptions.onDurableIntent = () => {
    throw Error('private-mutated-callback');
  };
  f.release();
  assert.equal((await running).status, 'success');
});

test('preSave raw drift or failed durable baseline stops before any intent/attempt/POST', async () => {
  const drift = fixture({ drift: true }),
    d = await drift.run.run();
  unavailable(d, 'version_conflict');
  assert.equal(d.save.post.attempts, 0);
  assert.equal(d.save.intentReceipt, null);
  assert(d.snapshots.preSave);
  assert.equal(drift.clientDisposes, 1);
  const baseline = fixture({ baselineFails: true }),
    b = await baseline.run.run();
  unavailable(b, 'callback_failed');
  assert.equal(baseline.calls.length, 5);
  assert.equal(b.save.post.attempts, 0);
  assert.equal(b.snapshots.preSave, null);
});

test('publication changes veto trial POST at before/preSave and preserve ACK after the sole completed save', async () => {
  for (const nonDraftRead of [1, 2, 3] as const) {
    const f = fixture({ nonDraftRead }),
      result = await f.run.run();
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(f.clientDisposes, 1);
    assert.equal(result.save.post.attempts, nonDraftRead === 3 ? 1 : 0);
    assert.equal(
      f.calls.filter((call) => call.method === 'POST').length,
      nonDraftRead === 3 ? 1 : 0,
    );
    const observed =
      result.snapshots[nonDraftRead === 1 ? 'before' : nonDraftRead === 2 ? 'preSave' : 'after'];
    assert.equal(observed?.native.state, 'distribution_stopped');
    assert.equal(observed?.native.statusFacts.draftEditable, false);
    if (nonDraftRead === 3) {
      assert(result.save.acknowledgementReceipt);
      assert.equal(result.save.post.acknowledged, true);
      assert.equal(result.comparison?.reason, 'state_not_draft');
    } else assert.equal(result.save.attemptReceipt, null);
  }
});

test('receipt clones, duplicate minting, wrong binding/time/ordinal and cross-stage substitution cannot issue a POST', async (t) => {
  const cases: Array<{ name: string; transform: ReceiptTransform }> = [
    {
      name: 'clone',
      transform: (stage, fields, confirm) =>
        stage === 'intent' ? structuredClone(confirm(fields)) : confirm(fields),
    },
    {
      name: 'duplicate',
      transform: (stage, fields, confirm) => {
        const receipt = confirm(fields);
        if (stage === 'intent') confirm(fields);
        return receipt;
      },
    },
    {
      name: 'wrong owner',
      transform: (stage, fields, confirm) =>
        confirm(
          stage === 'intent'
            ? {
                ...fields,
                binding: { ...fields.binding, account: { kind: 'account_id', id: '9999' } },
              }
            : fields,
        ),
    },
    {
      name: 'future reference',
      transform: (stage, fields, confirm) =>
        confirm(
          stage === 'intent'
            ? {
                ...fields,
                evidence: { ...fields.evidence, capturedAt: '2099-01-01T00:00:00.000Z' },
              }
            : fields,
        ),
    },
    {
      name: 'attempt ordinal',
      transform: (stage, fields, confirm) =>
        confirm(stage === 'attempt' ? { ...fields, ordinal: null } : fields),
    },
    {
      name: 'wrong transport',
      transform: (stage, fields, confirm) =>
        confirm(
          stage === 'attempt'
            ? { ...fields, transport: { ...fields.transport!, url: 'https://example.invalid' } }
            : fields,
        ),
    },
    {
      name: 'cross stage',
      transform: (() => {
        let prior: NativeShortTrialReceipt;
        return (stage, fields, confirm) => {
          const receipt = confirm(fields);
          if (stage === 'intent') prior = receipt;
          return stage === 'attempt' ? prior : receipt;
        };
      })(),
    },
    {
      name: 'baseline captured after preSave',
      transform: (stage, fields, confirm) =>
        confirm(
          stage === 'intent'
            ? {
                ...fields,
                baseline: { ...fields.baseline, capturedAt: '2099-01-01T00:00:00.000Z' },
              }
            : fields,
        ),
    },
  ];
  for (const value of cases)
    await t.test(value.name, async () => {
      const f = fixture({ transform: value.transform }),
        result = await f.run.run();
      unavailable(result, 'durability_unverified');
      assert.equal(result.save.post.attempts, 0);
      assert.equal(f.clientDisposes, 1);
    });
});

test('ACK loss remains unknown with no retry even when the independent full after read exactly matches desired content', async () => {
  const f = fixture({ acknowledgementLost: true }),
    result = await f.run.run();
  unavailable(result, 'response_unavailable');
  assert.equal(result.save.post.attempts, 1);
  assert.equal(result.save.post.acknowledged, false);
  assert.equal(result.save.outcome, 'unknown');
  assert.equal(result.save.acknowledgementReceipt, null);
  assert.equal(result.comparison?.matches, true);
  assert.equal(result.observedContentHash, result.desiredContentHash);
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 1);
  assert.equal(f.calls.filter((c) => c.method === 'GET').length, 15);
  assert.equal(f.clientCreates, 1);
});

test('save envelope URL/code/UTF8/redirect/content-type faults never turn the matching after read into direct success', async (t) => {
  for (const fault of ['url', 'code', 'utf8', 'redirect', 'content-type'] as const)
    await t.test(fault, async () => {
      const f = fixture({ responseFault: fault }),
        result = await f.run.run();
      unavailable(result, fault === 'redirect' ? 'redirect_blocked' : 'response_unverified');
      assert.equal(result.save.post.attempts, 1);
      assert.equal(result.save.post.acknowledged, false);
      assert.equal(result.save.post.disposed, 1);
      assert.equal(result.comparison?.matches, true);
      assert.equal(f.calls.filter((c) => c.method === 'POST').length, 1);
    });
});

test('optional ACK target/revision contradictions withhold observation and durable ACK despite a matching independent after read', async (t) => {
  const contradictions: Record<string, unknown>[] = [
    { item_id: '9999999999' },
    { item_id: 7000000001 },
    { latest_version: 7 },
    { latest_version: 9 },
    { latest_version: '8' },
    { latest_version: -0 },
    { modify_time: '1789449999' },
    { modify_time: 1789450001 },
    { modify_time: '178945000' },
  ];
  for (const [index, data] of contradictions.entries())
    await t.test(String(index), async () => {
      const f = fixture({ ackData: data }),
        result = await f.run.run();
      unavailable(result, 'response_unverified');
      assert.equal(result.save.post.attempts, 1);
      assert.equal(result.save.post.acknowledged, false);
      assert.equal(result.save.observation, null);
      assert.equal(result.save.acknowledgementReceipt, null);
      assert.equal(f.receipts.length, 2);
      assert.equal(f.events.includes('acknowledgement'), false);
      assert.equal(result.comparison?.matches, true);
      assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
    });
  const foreignEnvelope = fixture({
    ackEnvelope: { item_id: '9999999999' },
    ackData: { item_id: WORK, latest_version: 8 },
  });
  unavailable(await foreignEnvelope.run.run(), 'response_unverified');
  const failedCode = fixture({
    ackEnvelope: { code: 7 },
    ackData: { item_id: WORK, latest_version: 8 },
  });
  const failed = await failedCode.run.run();
  unavailable(failed, 'response_unverified');
  assert.equal(failed.save.observation, null);
  const matching = fixture({
    ackData: { item_id: WORK, latest_version: 8, modify_time: '1789450001' },
  });
  assert.equal((await matching.run.run()).status, 'success');
});
