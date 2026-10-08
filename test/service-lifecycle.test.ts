import assert from 'node:assert/strict';
import test from 'node:test';
import { createServiceLifecycle, SERVICE_FATAL_TIMEOUT_MS } from '../src/service-lifecycle.js';

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('production fatal deadline stays 120000; a successful normal stop closes and exits once', async () => {
  assert.equal(SERVICE_FATAL_TIMEOUT_MS, 120_000);
  const exits: number[] = [];
  let closes = 0;
  let aborts = 0;
  const lifecycle = createServiceLifecycle({
    close: async () => {
      closes++;
    },
    abortForLeaseLoss: () => {
      aborts++;
    },
    exit: (code) => {
      exits.push(code);
    },
    log: () => {},
  });
  lifecycle.stop();
  lifecycle.stop();
  await flush();
  lifecycle.stop('lease_lost');
  assert.equal(closes, 1);
  assert.equal(aborts, 0);
  assert.deepEqual(exits, [0]);
});

for (const mode of ['success', 'reject', 'never', 'throw'] as const) {
  test(`fatal ${mode} cleanup has one close and can never exit zero`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const exits: number[] = [],
      logs: string[] = [];
    let closes = 0;
    let aborts = 0;
    const lifecycle = createServiceLifecycle({
      fatalTimeoutMs: 40,
      close: () => {
        closes++;
        if (mode === 'reject') return Promise.reject(new Error('token=PRIVATE_SYNTHETIC_ERROR'));
        if (mode === 'throw') throw new Error('PRIVATE_SYNTHETIC_THROW');
        return mode === 'never' ? new Promise(() => {}) : Promise.resolve();
      },
      abortForLeaseLoss: () => {
        aborts++;
      },
      exit: (code) => {
        exits.push(code);
      },
      log: (text) => {
        logs.push(text);
      },
    });
    lifecycle.stop('lease_lost');
    lifecycle.stop();
    lifecycle.stop('lease_lost');
    assert.equal(aborts, 1);
    await flush();
    assert.equal(closes, 1);
    assert.deepEqual(exits, mode === 'success' ? [1] : []);
    t.mock.timers.tick(39);
    assert.deepEqual(exits, mode === 'success' ? [1] : []);
    t.mock.timers.tick(1);
    assert.deepEqual(exits, [1]);
    assert(
      logs.every((text) =>
        ['service_lease_lost', 'service_cleanup_incomplete', 'service_fatal_deadline'].includes(
          text,
        ),
      ),
    );
  });
}

test('normal pending stop upgrades immediately on fatal before its once-close guard', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const release = deferred(),
    exits: number[] = [],
    events: string[] = [];
  let closes = 0;
  const lifecycle = createServiceLifecycle({
    fatalTimeoutMs: 50,
    close: async () => {
      closes++;
      events.push('close');
      await release.promise;
    },
    abortForLeaseLoss: () => {
      events.push('abort');
    },
    exit: (code) => {
      exits.push(code);
    },
    log: () => {},
  });
  lifecycle.stop();
  await flush();
  assert.deepEqual(events, ['close']);
  lifecycle.stop('lease_lost');
  assert.deepEqual(events, ['close', 'abort']);
  lifecycle.stop('lease_lost');
  lifecycle.stop();
  assert.equal(closes, 1);
  release.resolve();
  await flush();
  assert.deepEqual(exits, [1]);
  t.mock.timers.tick(100);
  assert.deepEqual(exits, [1]);
});

test('fatal following pending normal cleanup rejection waits its own deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_yes, no) => {
    reject = no;
  });
  const exits: number[] = [];
  let closes = 0;
  let aborts = 0;
  const lifecycle = createServiceLifecycle({
    fatalTimeoutMs: 30,
    close: () => {
      closes++;
      return pending;
    },
    abortForLeaseLoss: () => {
      aborts++;
    },
    exit: (code) => {
      exits.push(code);
    },
    log: () => {},
  });
  lifecycle.stop();
  await flush();
  lifecycle.stop('lease_lost');
  reject(new Error('PRIVATE_SYNTHETIC_FAILURE'));
  await flush();
  assert.equal(aborts, 1);
  assert.equal(closes, 1);
  assert.deepEqual(exits, []);
  t.mock.timers.tick(30);
  assert.deepEqual(exits, [1]);
});

test('ordinary rejected shutdown still exits nonzero without fatal deadline', async () => {
  const exits: number[] = [];
  createServiceLifecycle({
    close: async () => {
      throw new Error('synthetic');
    },
    abortForLeaseLoss: () => assert.fail('Normal failure must not invent lease loss'),
    exit: (code) => {
      exits.push(code);
    },
    log: () => {},
  }).stop();
  await flush();
  assert.deepEqual(exits, [1]);
});

test('abort or logger exceptions cannot disarm fatal process deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const exits: number[] = [];
  const lifecycle = createServiceLifecycle({
    fatalTimeoutMs: 20,
    close: () => new Promise(() => {}),
    abortForLeaseLoss: () => {
      throw new Error('synthetic abort');
    },
    log: () => {
      throw new Error('synthetic logger');
    },
    exit: (code) => {
      exits.push(code);
    },
  });
  assert.doesNotThrow(() => lifecycle.stop('lease_lost'));
  await flush();
  t.mock.timers.tick(20);
  assert.deepEqual(exits, [1]);
});
