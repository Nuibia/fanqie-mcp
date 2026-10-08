import test from 'node:test';

import {
  fixture,
  failed,
  ACCOUNT,
  withFactory,
  WORK,
  turn,
  deferred,
} from './helpers/short-native-metadata-api-deferred.js';

import assert from 'node:assert/strict';

import { type NativeShortMetadataApiOptions } from '../src/platform/short-native-metadata-api.js';

import { BrowserSession } from '../src/platform/browser.js';

test('native pre-read callback failure and invalid typed binding perform no GET', async () => {
  const f = fixture({
    beforeRead: () => {
      throw Error('private-boundary');
    },
  });
  failed(await f.run.run(), 'callback_failed');
  assert.equal(f.calls.length, 0);
  for (const owner of [
    { kind: 'author', id: ACCOUNT },
    { kind: 'account', id: 'x' },
  ]) {
    const f = fixture({ owner: owner as NativeShortMetadataApiOptions['expectedOwner'] });
    failed(await f.run.run(), 'identity_unverified');
    assert.equal(f.apiCloses, 0);
  }
});

test('Browser adapter publishes complete private snapshot without navigation and validates final callback epoch', async () => {
  const f = fixture();
  await withFactory(f, async () => {
    assert.equal(
      (await f.session.runNativeShortMetadata(WORK, f.browserOptions)).status,
      'success',
    );
  });
  assert.equal(f.pageTouches, 0);
  await f.session.close();
  const g = fixture({
    callback: () => {
      g.internals.identityEpoch++;
    },
  });
  await withFactory(g, async () =>
    failed(await g.session.runNativeShortMetadata(WORK, g.browserOptions), 'source_changed'),
  );
  await g.session.close();
});

test('Browser adapter close drains late creation before closing borrowed resources', async () => {
  const f = fixture({ hold: 'creation' });
  await withFactory(f, async () => {
    const running = f.session.runNativeShortMetadata(WORK, f.browserOptions);
    await f.entered;
    assert(f.internals.activeNativeShortMetadata);
    let closed = false;
    const closing = f.session.close().then(() => {
      closed = true;
    });
    await turn();
    assert.equal(closed, false);
    assert.equal(f.borrowedCloses, 0);
    f.release();
    failed(await running, 'cancelled');
    await closing;
    assert.equal(f.apiCloses, 1);
    assert.equal(f.borrowedCloses, 1);
    assert(f.events.indexOf('api_disposed') < f.events.indexOf('borrowed_closed'));
  });
});

test('Browser native pending FIFO cannot be bypassed by a public direct Page helper', async () => {
  const f = fixture({ hold: 'get' });
  await withFactory(f, async () => {
    const running = f.session.runNativeShortMetadata(WORK, f.browserOptions);
    await f.entered;
    let helperDone = false;
    const helper = f.session.verifyCurrentAccount(f.page).then((value) => {
      helperDone = true;
      return value;
    });
    await turn();
    assert.equal(f.pageTouches, 0);
    assert.equal(helperDone, false);
    f.controller.abort();
    await turn();
    assert.equal(f.pageTouches, 0);
    assert.equal(helperDone, false);
    f.release();
    failed(await running, 'cancelled');
    assert.equal((await helper).status, 'authenticated');
    assert(f.pageTouches > 0);
  });
  await f.session.close();
});

test('Browser async Page ownership permits internal reentry but an unrelated caller joins FIFO', async () => {
  const f = fixture(),
    gate = deferred<void>(),
    entered = deferred<void>();
  const reader = f.session.withPage(async (page) => {
    assert.equal((await f.session.verifyCurrentAccount(page)).status, 'authenticated');
    entered.resolve();
    await gate.promise;
  });
  await entered.promise;
  const touched = f.pageTouches;
  let done = false;
  const direct = f.session.verifyCurrentAccount(f.page).then((value) => {
    done = true;
    return value;
  });
  await turn();
  assert.equal(done, false);
  assert.equal(f.pageTouches, touched);
  gate.resolve();
  await reader;
  assert.equal((await direct).status, 'authenticated');
  await f.session.close();
});

test('Browser quarantine fences old/new siblings and every public Page helper before reading', async () => {
  const f = fixture({ failDispose: 'api' });
  await withFactory(f, async () =>
    failed(await f.session.runNativeShortMetadata(WORK, f.browserOptions), 'cleanup_failed'),
  );
  assert.equal(f.session.hasUnsafeApiCleanup, true);
  const diagnostic = {
    expectedAccountId: ACCOUNT,
    assertLease() {},
    onBeforePlatformRead() {},
    onVerifiedAccount() {},
  };
  assert.equal(
    (await f.session.diagnoseShortMetadataApiSchema(WORK, diagnostic)).reason,
    'cleanup_failed',
  );
  assert.equal(
    (
      await f.session.diagnoseShortMetadataSchema(WORK, {
        expectedAccountId: ACCOUNT,
        assertLease() {},
        onBeforePlatformRead() {},
        onVerifiedAccount() {},
      })
    ).reason,
    'cleanup_failed',
  );
  failed(await f.session.runNativeShortMetadata(WORK, f.browserOptions), 'cleanup_failed');
  const opts = {
    jobId: 'synthetic-job',
    expectedOwner: { kind: 'account' as const, id: ACCOUNT },
    onVerifiedOwner() {},
  };
  for (const call of [
    () => f.session.verifyCurrentAccount(f.page),
    () => f.session.enterCurrentChapterDirectory(f.page, WORK),
    () => f.session.collectCurrentChapterDirectory(f.page, WORK, opts),
    () => f.session.collectCurrentChapterBody(f.page, WORK, WORK, opts),
    () => f.session.collectCurrentChapterDraftDirectory(f.page, WORK, opts),
    () => f.session.checkLogin(),
    () => f.session.startLogin(),
    () => f.session.inspectCurrentLogin(),
    () => f.session.diagnoseCurrentLoginPage(),
    () => f.session.screenshot(),
    () => f.session.read(async () => 1),
  ])
    await assert.rejects(call(), { code: 'shutdown_incomplete' });
  assert.equal(f.pageTouches, 0);
  await assert.rejects(f.session.close(), { code: 'shutdown_incomplete' });
  assert.equal(f.borrowedCloses, 0);
});

test('Browser close grace failure retains borrowed resources until actual native done; no repeated cleanup', async () => {
  const f = fixture({ hold: 'creation' });
  await withFactory(f, async () => {
    const running = f.session.runNativeShortMetadata(WORK, f.browserOptions);
    await f.entered;
    const original = globalThis.setTimeout;
    globalThis.setTimeout = ((
      fn: Parameters<typeof setTimeout>[0],
      ms?: number,
      ...args: unknown[]
    ) => original(fn, ms === 25_000 ? 5 : ms, ...args)) as typeof setTimeout;
    try {
      await assert.rejects(f.session.close(), { code: 'shutdown_incomplete' });
    } finally {
      globalThis.setTimeout = original;
    }
    assert.equal(f.borrowedCloses, 0);
    assert(f.internals.context);
    assert(f.internals.activeNativeShortMetadata);
    f.release();
    failed(await running, 'cancelled');
    await f.session.close();
    assert.equal(f.borrowedCloses, 1);
    assert.equal(f.apiCloses, 1);
  });
});

test('Browser cold/cancelled native calls never launch a context, navigate or mark a platform read', async () => {
  const f = fixture();
  const cold = new BrowserSession({ profileDir: '/no-launch', headless: true });
  failed(await cold.runNativeShortMetadata(WORK, f.browserOptions), 'context_unavailable');
  f.controller.abort();
  failed(await cold.runNativeShortMetadata(WORK, f.browserOptions), 'cancelled');
  assert.equal(f.events.length, 0);
  assert.equal(f.pageTouches, 0);
  await cold.close();
});

test('native owner and deadline are captured once and cannot be changed through caller option aliases', async () => {
  const f = fixture({ hold: 'get' });
  const running = f.run.run();
  await f.entered;
  f.options.expectedOwner.id = '9999';
  f.options.signal = new AbortController().signal;
  f.release();
  const result = await running;
  assert.equal(result.status, 'success');
  assert.equal(result.snapshot!.binding.account.id, ACCOUNT);
});

test('Browser stop/done exists during the first pending cookies await, before an API handle exists', async () => {
  const f = fixture({ hold: 'cookies' });
  await withFactory(f, async () => {
    const running = f.session.runNativeShortMetadata(WORK, f.browserOptions);
    await f.entered;
    assert(f.internals.activeNativeShortMetadata);
    assert.equal(f.apiCloses, 0);
    let settled = false;
    const closing = f.session.close().then(() => {
      settled = true;
    });
    await turn();
    assert.equal(settled, false);
    assert.equal(f.borrowedCloses, 0);
    f.release();
    failed(await running, 'cancelled');
    await closing;
    assert.equal(f.apiCloses, 0);
    assert.equal(f.borrowedCloses, 1);
  });
});

for (const fence of ['lease', 'source'] as const)
  test(`native ${fence} is rechecked after cleanup before verified callback`, async () => {
    let invalid = false;
    const f = fixture({
      hold: 'api_dispose',
      lease: () => {
        if (invalid && fence === 'lease') throw Error('private');
      },
      source: () => {
        if (invalid && fence === 'source') throw Error('private');
      },
    });
    const running = f.run.run();
    await f.entered;
    invalid = true;
    f.release();
    failed(await running, fence === 'lease' ? 'lease_unavailable' : 'source_changed');
    assert.equal(f.callbacks, 0);
  });

test('native typed bindings reject runtime numeric coercion before cookies or client creation', async () => {
  for (const owner of [
    { kind: 'account', id: 1001 },
    { kind: 'account', id: new String(ACCOUNT) },
  ]) {
    const f = fixture({ owner: owner as NativeShortMetadataApiOptions['expectedOwner'] });
    failed(await f.run.run(), 'identity_unverified');
    assert.equal(f.events.length, 0);
    assert.equal(f.apiCloses, 0);
  }
  for (const workId of [1234567890, new String(WORK)]) {
    const f = fixture({ workId: workId as string });
    failed(await f.run.run(), 'identity_unverified');
    assert.equal(f.events.length, 0);
    assert.equal(f.apiCloses, 0);
  }
});

test('Browser captures native typed binding before waiting for its FIFO slot', async () => {
  const f = fixture(),
    gate = deferred<void>(),
    entered = deferred<void>();
  const reader = f.session.withPage(async () => {
    entered.resolve();
    await gate.promise;
  });
  await entered.promise;
  await withFactory(f, async () => {
    const options = { ...f.browserOptions, expectedOwner: { ...f.browserOptions.expectedOwner } };
    const running = f.session.runNativeShortMetadata(WORK, options);
    options.expectedOwner.id = '9999';
    gate.resolve();
    await reader;
    const result = await running;
    assert.equal(result.status, 'success');
    assert.equal(result.snapshot!.binding.account.id, ACCOUNT);
  });
  await f.session.close();
});
