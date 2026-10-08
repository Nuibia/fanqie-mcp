import test from 'node:test';

import {
  fixture,
  lost,
  flush,
  deferred,
  applicationFixture,
} from './helpers/service-lease-fatal-deferred.js';

import assert from 'node:assert/strict';

import { rmSync } from 'node:fs';

import { RuntimeError, Store } from '../src/runtime/store.js';

import { type JobContext } from '../src/runtime/jobs.js';

import { createHttpServer } from '../src/transport/http.js';

import path from 'node:path';

test('permanent loss notifies once after transaction rollback; late listener replays and failures are contained', async () => {
  const f = fixture();
  let notifications = 0;
  let late = 0;
  let rollbackProved = false;
  try {
    f.store.onServiceLeaseLost((signal) => {
      notifications++;
      assert.deepEqual(signal, { code: 'service_lease_lost' });
      assert(Object.isFrozen(signal));
      f.db.exec('BEGIN IMMEDIATE');
      f.db.exec('ROLLBACK');
      rollbackProved = true;
    });
    f.store.onServiceLeaseLost(() => {
      throw Error('PRIVATE_SYNTHETIC_LISTENER');
    });
    f.store.onServiceLeaseLost(async () => {
      throw Error('PRIVATE_SYNTHETIC_ASYNC_LISTENER');
    });
    f.expire();
    assert.throws(
      () =>
        f.store.createJob({
          accountId: 'synthetic',
          kind: 'read',
          operation: 'never',
          datasets: ['works'],
        }),
      lost,
    );
    assert.equal(f.store.hasLostServiceLease(), true);
    assert.equal(notifications, 0);
    for (let i = 0; i < 3; i++) assert.throws(() => f.store.assertLeaseOwnership(), lost);
    await flush();
    assert.equal(notifications, 1);
    assert.equal(rollbackProved, true);
    f.store.onServiceLeaseLost(() => {
      late++;
    });
    await flush();
    assert.equal(late, 1);
    assert.throws(() => f.store.assertLeaseOwnership(), lost);
    await flush();
    assert.equal(notifications, 1);
    assert.equal(late, 1);
    const replacement = { owner_id: 'SYNTHETIC_SUCCESSOR', expires_at: Date.now() + 60_000 };
    f.db
      .prepare('UPDATE service_lease SET owner_id = ?, expires_at = ? WHERE id = 1')
      .run(replacement.owner_id, replacement.expires_at);
    f.store.close();
    assert.deepEqual(
      { ...f.db.prepare('SELECT owner_id,expires_at FROM service_lease').get() },
      replacement,
    );
  } finally {
    f.db.close();
    f.store.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test('ordinary Store.close does not invent a fatal signal', async () => {
  const f = fixture();
  let notices = 0;
  try {
    f.store.onServiceLeaseLost(() => {
      notices++;
    });
    f.store.close();
    assert.throws(
      () => f.store.assertLeaseOwnership(),
      (e: unknown) => e instanceof RuntimeError && e.code === 'store_closed',
    );
    await flush();
    assert.equal(notices, 0);
    assert.equal(f.store.hasLostServiceLease(), false);
  } finally {
    f.db.close();
    f.store.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test('loss fences context/completion/timer and queued callbacks before deferred notification, without SQL settlement', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(),
    start = deferred(),
    release = deferred();
  let context!: JobContext;
  let nextCalls = 0;
  const forbiddenCalls: string[] = [];
  const methods = [
    'requestCancellation',
    'completeReadJob',
    'completeWriteJob',
    'failJob',
    'markPlatformReadStarted',
    'markPlatformWriteStarted',
    'saveEvidence',
    'addJobMetadata',
    'recordTarget',
    'startJob',
  ] as const;
  for (const name of methods) {
    const original = f.store[name].bind(f.store) as (...args: unknown[]) => unknown;
    (f.store as unknown as Record<string, (...args: unknown[]) => unknown>)[name] = (...args) => {
      if (f.store.hasLostServiceLease()) forbiddenCalls.push(name);
      return original(...args);
    };
  }
  let notified = false;
  try {
    f.store.onServiceLeaseLost(() => {
      notified = true;
    });
    const active = f.queue.enqueueRead({
      accountId: 'synthetic',
      operation: 'active',
      datasets: ['works'],
      timeoutMs: 10,
      run: async (ctx) => {
        context = ctx;
        ctx.beforePlatformRead();
        start.resolve();
        await release.promise;
        // This continuation is queued BEFORE the fatal notification microtask below.
        assert.equal(notified, false);
        for (const action of [
          () => ctx.beforePlatformRead(),
          () => ctx.beforePlatformWrite(),
          () => ctx.saveEvidence('works', {}),
          () => ctx.addMetadata({}),
          () => ctx.recordTarget({ kind: 'short-story', id: '7691000000000000001' }),
        ])
          assert.throws(action, lost);
        return [];
      },
    });
    await start.promise;
    const queued = f.queue.enqueueRead({
      accountId: 'synthetic',
      operation: 'next',
      scope: 'next',
      datasets: ['works'],
      run: async () => {
        nextCalls++;
        return [];
      },
    });
    const before = f.db
      .prepare('SELECT id,status,cancellation_requested_at,ended_at FROM jobs ORDER BY id')
      .all();
    release.resolve();
    f.expire();
    assert.throws(() => f.store.assertLeaseOwnership(), lost);
    t.mock.timers.tick(10); // Timer executes in the same stack, before the deferred signal.
    assert.throws(() => f.queue.cancel(active.jobId), lost);
    await assert.rejects(active.completion, lost);
    await assert.rejects(queued.completion, lost);
    assert.equal(context.signal.aborted, true);
    assert.equal(nextCalls, 0);
    assert.deepEqual(forbiddenCalls, []);
    assert.deepEqual(
      f.db
        .prepare('SELECT id,status,cancellation_requested_at,ended_at FROM jobs ORDER BY id')
        .all(),
      before,
    );
    await f.queue.drainAndStop({ reason: 'lease_lost', timeoutMs: 20 });
  } finally {
    release.resolve();
    await f.queue.drainAndStop({ reason: 'lease_lost', timeoutMs: 100 });
    f.db.close();
    f.store.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test('normal cancellation that observes loss mid-loop immediately aborts other accounts without further SQL', async () => {
  const f = fixture(),
    first = deferred(),
    second = deferred(),
    release = deferred();
  let firstContext!: JobContext;
  let secondContext!: JobContext;
  let normalCancels = 0,
    lateCancels = 0;
  const cancel = f.store.requestCancellation.bind(f.store);
  f.store.requestCancellation = (...args) => {
    if (f.store.hasLostServiceLease()) lateCancels++;
    else normalCancels++;
    return cancel(...args);
  };
  try {
    const a = f.queue.enqueueWrite({
      accountId: 'synthetic-a',
      operation: 'effect',
      idempotencyKey: 'synthetic-effect',
      inputHash: '1'.repeat(64),
      run: async (ctx) => {
        firstContext = ctx;
        ctx.beforePlatformWrite();
        ctx.signal.addEventListener(
          'abort',
          () => {
            f.expire();
            assert.throws(() => f.store.assertLeaseOwnership(), lost);
          },
          { once: true },
        );
        first.resolve();
        await release.promise;
        return { done: true };
      },
    });
    const b = f.queue.enqueueRead({
      accountId: 'synthetic-b',
      operation: 'read',
      datasets: ['works'],
      run: async (ctx) => {
        secondContext = ctx;
        ctx.beforePlatformRead();
        second.resolve();
        await release.promise;
        return [];
      },
    });
    await Promise.all([first.promise, second.promise]);
    const closing = f.queue.drainAndStop({ timeoutMs: 100 });
    assert.equal(firstContext.signal.aborted, true);
    assert.equal(secondContext.signal.aborted, true);
    assert.equal(normalCancels, 1);
    assert.equal(lateCancels, 0);
    assert.equal(f.store.getJob(a.jobId)?.cancellationReason?.code, 'shutdown');
    assert.equal(f.store.getJob(b.jobId)?.cancellationRequestedAt, null);
    release.resolve();
    await closing;
    await assert.rejects(a.completion, lost);
    await assert.rejects(b.completion, lost);
    assert.equal(f.store.getJob(a.jobId)?.status, 'running');
    assert.equal(f.store.getJob(b.jobId)?.status, 'running');
    assert.equal(lateCancels, 0);
  } finally {
    release.resolve();
    await f.queue.drainAndStop({ reason: 'lease_lost', timeoutMs: 100 });
    f.db.close();
    f.store.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

for (const layer of ['application', 'http'] as const) {
  test(`normal ${layer} rejected close preserves its lease and can retry after real cleanup recovers`, async () => {
    const f = applicationFixture(),
      transport = layer === 'http' ? createHttpServer(f.config, f.application) : undefined;
    const close = () => (transport ? transport.close() : f.application.close());
    let storeCloseCalls = 0;
    const closeStore = f.store.close.bind(f.store);
    f.store.close = () => {
      storeCloseCalls++;
      closeStore();
    };
    try {
      f.browser.reject = true;
      f.browser.release.resolve();
      const owner = f.db.prepare('SELECT owner_id FROM service_lease').get()!.owner_id;
      const first = close();
      assert.equal(close(), first);
      await assert.rejects(first, /PRIVATE_SYNTHETIC_BROWSER_CLEANUP/);
      assert.equal(f.browser.closeCalls, 1);
      assert.equal(storeCloseCalls, 0);
      assert.equal(f.store.hasLostServiceLease(), false);
      f.application.assertReadiness!();
      assert.equal(f.db.prepare('SELECT owner_id FROM service_lease').get()!.owner_id, owner);
      assert.throws(
        () =>
          new Store({
            databasePath: path.join(f.config.dataDir, 'operations.sqlite'),
            evidenceDirectory: path.join(f.config.dataDir, 'evidence'),
          }),
        (error: unknown) =>
          error instanceof RuntimeError && error.code === 'service_already_running',
      );
      f.browser.reject = false;
      const retry = close();
      assert.notEqual(retry, first);
      assert.equal(close(), retry);
      await retry;
      assert.equal(f.browser.closeCalls, 2);
      assert.equal(storeCloseCalls, 1);
      assert.equal(f.db.prepare('SELECT owner_id FROM service_lease').get(), undefined);
      assert.equal(close(), retry);
      assert.equal(f.browser.closeCalls, 2);
    } finally {
      f.browser.release.resolve();
      f.db.close();
      closeStore();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
}
