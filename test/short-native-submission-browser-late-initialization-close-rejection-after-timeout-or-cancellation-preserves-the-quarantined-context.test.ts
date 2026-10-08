import test from 'node:test';

import { fixture, deferred, turn } from './helpers/short-native-submission-browser-deferred.js';

import { chromium, type BrowserContext } from 'playwright';

import { SUBMISSION_FIXTURE_WORK } from './short-native-submission-fixture.js';

import assert from 'node:assert/strict';

import { BrowserSessionError } from '../src/platform/browser.js';

test('late initialization-close rejection after timeout or cancellation preserves the quarantined context', async (t) => {
  for (const stop of ['timeout', 'cancel'] as const)
    await t.test(stop, async () => {
      const f = fixture({ mode: 'prepare' }),
        entered = deferred(),
        controller = new AbortController();
      f.state.context = null;
      f.state.page = null;
      const original = chromium.launchPersistentContext;
      let closes = 0,
        rejectClose!: (error: Error) => void;
      const gate = new Promise<void>((_resolve, reject) => {
        rejectClose = reject;
      });
      const failing = {
        setDefaultTimeout() {
          throw Error('synthetic initialization error');
        },
        async close() {
          closes++;
          entered.resolve();
          await gate;
        },
      } as unknown as BrowserContext;
      chromium.launchPersistentContext = async () => failing;
      try {
        const running = f.session.runNativeShortSubmissionFixture(
          SUBMISSION_FIXTURE_WORK,
          { ...f.options, timeoutMs: stop === 'timeout' ? 20 : 5_000, signal: controller.signal },
          f.api.factory,
          f.api.contract,
        );
        await entered.promise;
        if (stop === 'cancel') controller.abort();
        const r = await running;
        assert.equal(r.reason, stop === 'timeout' ? 'timeout' : 'cancelled');
        assert.equal(r.cleanup.quarantined, true);
        assert(f.state.activeNativeShortSubmission);
        assert.equal(f.state.context, failing);
        const cleanup = f.state.activeNativeShortSubmission.cleanupDone;
        let settled = false;
        const closing = f.session.close().then(
          () => {
            settled = true;
            return null;
          },
          (error) => {
            settled = true;
            return error;
          },
        );
        await turn();
        assert.equal(settled, false);
        assert.equal(closes, 1);
        assert(f.state.activeNativeShortSubmission);
        rejectClose(Error('synthetic late close rejection'));
        await cleanup;
        const error = await closing;
        assert(error instanceof BrowserSessionError && error.code === 'shutdown_incomplete');
        assert.equal(f.state.context, failing);
        assert.equal(f.state.apiQuarantined, true);
        assert.equal(f.state.activeNativeShortSubmission, null);
        assert.equal(closes, 1);
        assert.equal(f.api.clientCreates, 0);
        assert.equal(r.cleanup.pendingAtEnd, 1);
        assert.equal(
          (
            await f.session.runNativeShortSubmissionFixture(
              SUBMISSION_FIXTURE_WORK,
              f.options,
              f.api.factory,
              f.api.contract,
            )
          ).reason,
          'cleanup_failed',
        );
        assert.equal(closes, 1);
      } finally {
        rejectClose(Error('synthetic test cleanup'));
        chromium.launchPersistentContext = original;
      }
    });
});

test('FIFO captures request, service prepared, owner and callbacks before waiting and shares page queue', async () => {
  const f = fixture(),
    gate = deferred();
  f.state.queue = gate.promise;
  const originalOwner = f.options.onVerifiedAccount;
  const mutable = f.options as any;
  const running = f.session.runNativeShortSubmissionFixture(
    SUBMISSION_FIXTURE_WORK,
    f.options,
    f.api.factory,
    f.api.contract,
  );
  mutable.expectedOwner.id = '9999';
  mutable.businessRequest = { ...f.api.businessRequest, useAi: 2 };
  mutable.servicePrepared = {
    ...f.api.servicePrepared,
    preparationJobId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  };
  mutable.onVerifiedAccount = () => {
    throw Error('mutated owner callback');
  };
  mutable.timeoutMs = 1;
  let pageEntered = false;
  const queuedPage = f.session.read(async () => {
    pageEntered = true;
    return 7;
  });
  await turn();
  assert.equal(pageEntered, false);
  gate.resolve();
  const r = await running;
  assert.equal(r.status, 'success');
  assert.equal(
    r.publish.held?.servicePrepared.preparationJobId,
    f.api.servicePrepared.preparationJobId,
  );
  assert.equal(r.publish.observation?.useAi, 1);
  assert.equal(f.api.ownerCallbacks, 1);
  assert.notEqual(mutable.onVerifiedAccount, originalOwner);
  assert.equal(await queuedPage, 7);
  await f.session.close();
  assert.equal(f.closes, 1);
  assert.equal(f.navigation, 0);
});

test('close during late owned POST waits actual disposal and preserves quarantined borrowed context', async () => {
  const f = fixture({ hold: 'post' }),
    running = f.session.runNativeShortSubmissionFixture(
      SUBMISSION_FIXTURE_WORK,
      f.options,
      f.api.factory,
      f.api.contract,
    );
  await f.api.entered;
  const closing = f.session.close();
  await turn();
  const r = await running;
  assert.equal(r.publish.post.attempts, 1);
  assert.equal(r.publish.outcome, 'unknown');
  assert.equal(f.closes, 0);
  assert(f.state.activeNativeShortSubmission);
  f.api.release();
  await assert.rejects(
    closing,
    (e) => e instanceof BrowserSessionError && e.code === 'shutdown_incomplete',
  );
  assert.equal(f.api.clientDisposes, 1);
  assert.equal(f.closes, 0);
  assert.equal(f.state.context, f.context);
  assert.equal(f.api.calls.filter((c) => c.method === 'POST').length, 1);
});

test('epoch, connection and lease drift stop before POST without navigation', async (t) => {
  for (const changed of ['epoch', 'connection', 'lease'] as const)
    await t.test(changed, async () => {
      let leaseAllowed = true;
      const f = fixture({
          hold: 'creation',
          lease: () => {
            if (!leaseAllowed) throw Error('synthetic lease lost');
          },
        }),
        running = f.session.runNativeShortSubmissionFixture(
          SUBMISSION_FIXTURE_WORK,
          f.options,
          f.api.factory,
          f.api.contract,
        );
      await f.api.entered;
      if (changed === 'epoch') f.state.identityEpoch++;
      if (changed === 'connection') f.connected.value = false;
      if (changed === 'lease') leaseAllowed = false;
      f.api.release();
      const r = await running;
      assert.equal(r.reason, changed === 'lease' ? 'lease_unavailable' : 'source_changed');
      assert.equal(r.publish.post.attempts, 0);
      assert.equal(f.navigation, 0);
      await f.session.close();
      assert.equal(f.closes, 1);
    });
});

test('pre-cancelled, quarantined, disconnected and malformed calls never initialize an owned client', async () => {
  const cancelled = fixture(),
    controller = new AbortController();
  controller.abort();
  assert.equal(
    (
      await cancelled.session.runNativeShortSubmission(SUBMISSION_FIXTURE_WORK, {
        ...cancelled.options,
        signal: controller.signal,
      })
    ).reason,
    'cancelled',
  );
  const fenced = fixture();
  fenced.state.apiQuarantined = true;
  assert.equal(
    (await fenced.session.runNativeShortSubmission(SUBMISSION_FIXTURE_WORK, fenced.options)).reason,
    'cleanup_failed',
  );
  const disconnected = fixture();
  disconnected.connected.value = false;
  assert.equal(
    (
      await disconnected.session.runNativeShortSubmission(
        SUBMISSION_FIXTURE_WORK,
        disconnected.options,
      )
    ).reason,
    'context_unavailable',
  );
  const invalid = fixture();
  const originalQueue = invalid.state.queue;
  assert.equal(
    (
      await invalid.session.runNativeShortSubmission(SUBMISSION_FIXTURE_WORK, {
        ...invalid.options,
        url: 'https://example.invalid',
      } as never)
    ).reason,
    'invalid_input',
  );
  assert.equal(invalid.state.queue, originalQueue);
  assert.equal(
    (await invalid.session.runNativeShortSubmission(SUBMISSION_FIXTURE_WORK, null as never)).reason,
    'invalid_input',
  );
  for (const f of [cancelled, fenced, disconnected, invalid]) assert.equal(f.api.clientCreates, 0);
});
