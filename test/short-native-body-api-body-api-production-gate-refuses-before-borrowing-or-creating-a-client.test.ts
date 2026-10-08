import test from 'node:test';

import {
  business,
  WORK,
  PLAIN,
  SET,
  MARKED,
  PRESERVED,
  CHANGED,
  edit,
} from './helpers/short-native-body-api-edit.js';

import assert from 'node:assert/strict';

import {
  deniedProduction,
  fixture,
  safeFailure,
  postCount,
} from './helpers/short-native-body-api-fixture.js';

import {
  captureNativeShortBodyWriteRequest,
  createOwnedNativeShortBodyFixtureRun,
  createOwnedNativeShortBodyRun,
  type NativeShortBodyProductionStart,
} from '../src/platform/short-native-body-api.js';

import { projectNativeShortBodyFixtureTrace } from '../src/platform/short-native-body-proof.js';

test('body API production gate refuses before borrowing or creating a client', async () => {
  const request = business();
  let getters = 0;
  const authority = Object.defineProperty({}, 'live', {
    get() {
      getters++;
      throw Error('Must remain opaque');
    },
  });
  assert.equal(
    deniedProduction({ accountId: 'owner', workId: WORK, businessRequest: request, authority })
      .reason,
    'production_disabled',
  );
  assert.equal(
    deniedProduction({
      accountId: 'owner',
      workId: WORK,
      businessRequest: request,
      authority,
      mode: 'live',
    }).reason,
    'invalid_input',
  );
  for (const bad of [
    { ...request, url: 'https://example.invalid' },
    {
      ...request,
      get trial() {
        getters++;
        return request.trial;
      },
    },
    { ...request, [Symbol('extra')]: 1 },
  ])
    assert.equal(captureNativeShortBodyWriteRequest(bad), null);
  const decision = deniedProduction(
    Object.defineProperty(
      { accountId: 'owner', workId: WORK, businessRequest: request },
      'authority',
      {
        enumerable: true,
        get() {
          getters++;
          return null;
        },
      },
    ),
  );
  assert.equal(decision.reason, 'invalid_input');
  assert.equal(getters, 0);
  const nativeSignal = new AbortController().signal;
  for (const key of ['aborted', 'addEventListener', 'removeEventListener'])
    Object.defineProperty(nativeSignal, key, {
      configurable: true,
      get() {
        getters++;
        throw Error('User signal override forbidden');
      },
    });
  const signalFixture = fixture();
  signalFixture.options.signal = nativeSignal;
  const signalRun = createOwnedNativeShortBodyFixtureRun(
    signalFixture.borrowed,
    WORK,
    signalFixture.options,
    signalFixture.factory,
  );
  assert.equal((await signalRun.run()).status, 'fixture_complete');
  assert.equal(getters, 0);
  const disabled = createOwnedNativeShortBodyRun({} as NativeShortBodyProductionStart);
  assert.equal((await disabled.run()).reason, 'production_disabled');
  await disabled.cleanupDone;
});

test('body fixture before reads bind numeric owner unique target and complete pagination', async () => {
  for (const [faults, reason] of [
    [{ owner: '9999' }, 'owner_changed'],
    [{ duplicate: true }, 'pagination_inconsistent'],
    [{ total: 101 }, 'bounded_unavailable'],
  ] as const) {
    const f = fixture(faults),
      result = await f.run.run();
    safeFailure(result, reason);
    assert.equal(postCount(f), 0);
    assert.equal(f.creates, 1);
    assert.equal(f.disposes, 1);
  }
  const f = fixture(),
    result = await f.run.run();
  assert.equal(result.status, 'fixture_complete');
  assert.equal(result.reason, 'fixture_not_live');
  assert.equal(result.save.outcome, 'fixture_matched');
  assert.equal(f.calls.filter((c) => c.method === 'GET').length, 15);
  assert.equal(postCount(f), 1);
  assert.equal(f.creates, 1);
  assert.equal(f.disposes, 1);
  assert.equal(f.callbacks, 1);
  for (const p of Object.values(result.phases)) {
    assert.equal(p.proof.fixedSourceVerified, true);
    assert.equal(p.requests.own.attempts, 2);
    assert.equal(p.requests.own.disposed, 2);
    assert.equal(p.list.rowsRead, 1);
  }
  for (const call of f.calls) {
    assert.equal(call.options.maxRedirects, 0);
    assert.equal(call.options.maxRetries, 0);
  }
  const storage = f.capturedStorage as { storageState: { cookies: unknown[]; origins: unknown[] } };
  assert.equal(storage.storageState.cookies.length, 1);
  assert.deepEqual(storage.storageState.origins, []);
  assert(result.save.trace);
  const projection = projectNativeShortBodyFixtureTrace(result.save.trace);
  assert.equal(projection.summaries.stageCount, 7);
  assert.equal(projection.summaries.desiredMatched, true);
  assert.equal(projection.durable, false);
  assert.deepEqual(
    result.save.trace.stages.map((s) => s.kind),
    ['baseline', 'preSave', 'intent', 'attempt', 'acknowledgement', 'after', 'result'],
  );
  assert(Object.isFrozen(result));
});

test('body fixture preSave binds complete before plan and unknown metadata', async () => {
  for (const drift of ['unknown', 'cover', 'revision', 'title', 'catalog'] as const) {
    const f = fixture({ drift }),
      result = await f.run.run();
    safeFailure(result, 'version_conflict');
    assert.equal(postCount(f), 0);
    assert(result.snapshots.preSave);
    assert.equal(
      result.save.trace?.stages.some((stage) => stage.kind === 'preSave'),
      false,
    );
  }
  const f = fixture({ request: { ...business(), expectedSnapshotVersionHash: '0'.repeat(64) } }),
    result = await f.run.run();
  safeFailure(result, 'version_conflict');
  assert.equal(f.calls.length, 5);
  assert.equal(postCount(f), 0);
});

test('body fixture no_change returns no plan form or POST', async () => {
  const f = fixture({ request: business(PLAIN, { action: 'preserve' }), desired: PLAIN }),
    result = await f.run.run();
  assert.equal(result.status, 'no_change');
  assert.equal(result.reason, 'no_change');
  assert.equal(result.plan, null);
  assert.equal(result.expectation, null);
  assert.equal(result.desiredContentHash, null);
  assert.equal(postCount(f), 0);
  assert.equal(f.calls.length, 5);
  assert.equal(result.snapshots.preSave, null);
  assert.equal(result.snapshots.after, null);
  assert.deepEqual(
    result.save.trace?.stages.map((s) => s.kind),
    ['baseline', 'result'],
  );
  assert.equal(result.cleanup.sessionDisposed, true);
});

test('body fixture set preserve and clear compare desired full wire', async () => {
  for (const values of [
    { source: PLAIN, desired: SET, request: business() },
    {
      source: MARKED,
      desired: PRESERVED,
      request: business(MARKED, { action: 'preserve' }, CHANGED),
    },
    { source: MARKED, desired: PLAIN, request: business(MARKED, { action: 'clear' }) },
  ]) {
    const f = fixture(values),
      result = await f.run.run();
    assert.equal(result.status, 'fixture_complete');
    assert.equal(result.comparison?.matches, true);
    assert.equal(result.snapshot?.document.rawHtml, values.desired);
    assert.equal(postCount(f), 1);
    const content = result.plan?.form.content;
    assert.ok(typeof content === 'string');
    assert.equal(content, values.desired);
    assert.equal(
      JSON.stringify(result.snapshot?.native.editData.unknown),
      JSON.stringify(edit().unknown),
    );
  }
  const mismatch = fixture({ afterContent: SET.replace('丙', '戊') }),
    result = await mismatch.run.run();
  safeFailure(result, 'readback_mismatch');
  assert.equal(result.save.outcome, 'fixture_unknown');
  assert.equal(postCount(mismatch), 1);
});

test('body fixture visible ACK target version and time contradictions remain unknown', async () => {
  const bad = [
    { item_id: '7000000002' },
    { latest_version: 7 },
    { latest_version: 9 },
    { latest_version: -0 },
    { modify_time: '1789449999' },
    { modify_time: 1789450001 },
  ];
  for (const contradiction of bad)
    for (const nested of [false, true]) {
      const f = fixture(nested ? { ackData: contradiction } : { ack: contradiction }),
        result = await f.run.run();
      safeFailure(result, 'acknowledgement_unverified');
      assert.equal(result.comparison?.matches, true);
      assert.equal(result.save.outcome, 'fixture_unknown');
      assert.equal(result.save.post.acknowledged, false);
      assert.equal(postCount(f), 1);
      assert.equal(f.calls.length, 16);
    }
  const good = fixture({ ack: { item_id: WORK, latest_version: 8, modify_time: '1789450001' } });
  assert.equal((await good.run.run()).status, 'fixture_complete');
});

test('body fixture lost ACK with matching same-run after remains unknown', async () => {
  const f = fixture({ lostAck: true }),
    result = await f.run.run();
  safeFailure(result, 'response_unavailable');
  assert.equal(result.comparison?.matches, true);
  assert.equal(result.save.outcome, 'fixture_unknown');
  assert.equal(result.save.post.attempts, 1);
  assert.equal(
    result.save.trace?.stages.some((s) => s.kind === 'acknowledgement'),
    false,
  );
  assert.equal(result.save.trace?.simulatedAttemptOrdinal, 1);
  assert.equal(postCount(f), 1);
  assert.equal(
    projectNativeShortBodyFixtureTrace(result.save.trace).summaries.desiredMatched,
    true,
  );
  const incomplete = fixture({ lostAck: true, afterFail: true }),
    failed = await incomplete.run.run();
  safeFailure(failed, 'response_unavailable');
  assert.equal(failed.snapshots.after, null);
  const after = failed.save.trace?.stages.find((s) => s.kind === 'after');
  assert.deepEqual(after?.payload, { native: null, comparison: null });
});

test('body fixture JSON redirects response limits and disposer failures fail closed', async () => {
  for (const response of [
    'url',
    'mime',
    'status',
    'utf8',
    'json',
    'code',
    'bytes',
    'depth',
    'nodes',
  ] as const) {
    const f = fixture({ response }),
      result = await f.run.run();
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.save.outcome, 'fixture_unknown');
    assert.equal(postCount(f), 1);
    assert.equal(result.save.post.acknowledged, false);
    assert.equal(
      result.reason,
      response === 'url'
        ? 'redirect_blocked'
        : response === 'bytes'
          ? 'bounded_unavailable'
          : 'response_unverified',
    );
  }
  for (const dispose of ['api', 'response'] as const) {
    const f = fixture({ dispose }),
      result = await f.run.run();
    safeFailure(result, 'cleanup_failed');
    assert.equal(result.cleanup.quarantined, true);
    assert.equal(result.cleanup.disposalFailures, 1);
    assert.equal(postCount(f), 1);
    assert.equal(f.quarantines > 0, true);
  }
});
