import test from 'node:test';

import {
  applicationFixture,
  flush,
  lost,
  fixture,
} from './helpers/service-lease-fatal-deferred.js';

import { createHttpServer } from '../src/transport/http.js';

import assert from 'node:assert/strict';

import { rmSync } from 'node:fs';

import { JobQueue } from '../src/runtime/jobs.js';

import { RuntimeError } from '../src/runtime/store.js';

test('normal HTTP close upgraded to lost before rejection never retries cleanup after resources recover', async () => {
  const f = applicationFixture(),
    transport = createHttpServer(f.config, f.application);
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_yes, no) => {
    reject = no;
  });
  f.browser.close = async () => {
    f.browser.closeCalls++;
    await pending;
  };
  let storeCloseCalls = 0;
  const closeStore = f.store.close.bind(f.store);
  f.store.close = () => {
    storeCloseCalls++;
    closeStore();
  };
  try {
    const closing = transport.close();
    await flush();
    assert.equal(f.browser.closeCalls, 1);
    f.db.prepare('UPDATE service_lease SET expires_at = ?').run(Date.now() - 1);
    assert.throws(() => f.application.assertReadiness!(), lost);
    assert.equal(transport.close('lease_lost'), closing);
    reject(Error('PRIVATE_SYNTHETIC_PENDING_CLEANUP'));
    await assert.rejects(closing);
    f.browser.close = async () => {
      f.browser.closeCalls++;
    };
    assert.equal(transport.close(), closing);
    assert.equal(transport.close('lease_lost'), closing);
    await assert.rejects(closing);
    assert.equal(f.browser.closeCalls, 1);
    assert.equal(storeCloseCalls, 0);
    assert(f.db.prepare('SELECT owner_id FROM service_lease').get());
  } finally {
    reject(Error('PRIVATE_SYNTHETIC_TEST_FINALLY'));
    f.db.close();
    closeStore();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test('Application pending normal close upgrades once, waits real Browser cleanup, and preserves successor lease', async () => {
  const f = applicationFixture();
  try {
    const closing = f.application.close();
    await flush();
    assert.equal(f.browser.closeCalls, 1);
    f.db
      .prepare('UPDATE service_lease SET owner_id = ?, expires_at = ?')
      .run('SYNTHETIC_SUCCESSOR', Date.now() + 60_000);
    assert.throws(() => f.application.assertReadiness!(), lost);
    assert.equal(f.application.close('lease_lost'), closing);
    await flush();
    assert.equal(f.browser.closeCalls, 1);
    assert.equal(
      f.db.prepare('SELECT owner_id FROM service_lease').get()!.owner_id,
      'SYNTHETIC_SUCCESSOR',
    );
    f.browser.release.resolve();
    await closing;
    assert.equal(
      f.db.prepare('SELECT owner_id FROM service_lease').get()!.owner_id,
      'SYNTHETIC_SUCCESSOR',
    );
  } finally {
    f.browser.release.resolve();
    f.db.close();
    f.store.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

for (const failure of ['queue', 'browser'] as const) {
  test(`fatal ${failure} cleanup rejection still tries Browser, never releases Store, and stops HTTP admission`, async () => {
    const f = applicationFixture(),
      transport = createHttpServer(f.config, f.application);
    let storeCloseCalls = 0;
    const closeStore = f.store.close.bind(f.store);
    f.store.close = () => {
      storeCloseCalls++;
      closeStore();
    };
    const drain = JobQueue.prototype.drainAndStop;
    try {
      if (failure === 'queue')
        JobQueue.prototype.drainAndStop = async () => {
          throw new RuntimeError('shutdown_incomplete', 'Synthetic queue still owns cleanup');
        };
      else f.browser.reject = true;
      f.browser.release.resolve();
      f.db.prepare('UPDATE service_lease SET expires_at = ?').run(Date.now() - 1);
      assert.throws(() => f.application.assertReadiness!(), lost);
      const closing = transport.close('lease_lost');
      assert.equal(transport.close('lease_lost'), closing);
      await assert.rejects(closing);
      assert.equal(f.browser.closeCalls, 1);
      assert.equal(storeCloseCalls, 0);
      assert(f.db.prepare('SELECT owner_id FROM service_lease').get());
      f.browser.reject = false;
      JobQueue.prototype.drainAndStop = drain;
      assert.equal(transport.close(), closing);
      assert.equal(transport.close('lease_lost'), closing);
      await assert.rejects(closing);
      assert.equal(f.browser.closeCalls, 1);
      assert.equal(storeCloseCalls, 0);
      let responseCode = 0;
      const listener = transport.server.listeners('request')[0]!;
      await Reflect.apply(listener, transport.server, [
        { method: 'GET', url: '/health', headers: {} },
        {
          headersSent: false,
          writeHead(code: number) {
            responseCode = code;
          },
          end() {},
        },
      ]);
      assert.equal(responseCode, 503);
    } finally {
      JobQueue.prototype.drainAndStop = drain;
      f.browser.release.resolve();
      f.db.close();
      closeStore();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
}

test('heartbeat permanent loss is once-only and does not renew a displaced owner', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: Date.parse('2026-10-06T00:00:00Z') });
  const f = fixture();
  let notices = 0;
  try {
    f.store.onServiceLeaseLost(() => {
      notices++;
    });
    const replacement = {
      owner_id: 'SYNTHETIC_HEARTBEAT_SUCCESSOR',
      expires_at: Date.now() + 120_000,
    };
    f.db
      .prepare('UPDATE service_lease SET owner_id=?,expires_at=?')
      .run(replacement.owner_id, replacement.expires_at);
    t.mock.timers.tick(10_001);
    await flush();
    assert.equal(f.store.hasLostServiceLease(), true);
    assert.equal(notices, 1);
    t.mock.timers.tick(30_000);
    await flush();
    assert.equal(notices, 1);
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
