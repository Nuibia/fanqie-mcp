import test from 'node:test';

import { fixture, deferred, turn } from './helpers/short-native-submission-browser-deferred.js';

import { chromium, type BrowserContext } from 'playwright';

import assert from 'node:assert/strict';

import { SUBMISSION_FIXTURE_WORK } from './short-native-submission-fixture.js';

import { BrowserSessionError } from '../src/platform/browser.js';

test('cold preparation initializes inert persistent context under owned slot, without editor goto or shared request', async () => {
  const f = fixture({ mode: 'prepare' });
  f.state.context = null;
  f.state.page = null;
  const original = chromium.launchPersistentContext;
  let launches = 0;
  chromium.launchPersistentContext = async () => {
    launches++;
    assert(f.state.activeNativeShortSubmission);
    return f.context;
  };
  try {
    const r = await f.session.runNativeShortSubmissionFixture(
      SUBMISSION_FIXTURE_WORK,
      f.options,
      f.api.factory,
      f.api.contract,
    );
    assert.equal(r.status, 'success');
    assert.equal(r.mode, 'prepare');
    assert.equal(launches, 1);
    assert.equal(f.navigation, 0);
    assert.equal(f.pageCreates, 0);
    assert.equal(f.api.clientCreates, 1);
    await f.session.close();
    assert.equal(f.closes, 1);
  } finally {
    chromium.launchPersistentContext = original;
  }
});

test('cold launch timeout is bounded and owns late context until verified close; quarantine fences later work', async () => {
  const f = fixture({ mode: 'prepare' }),
    gate = deferred(),
    entered = deferred();
  f.state.context = null;
  f.state.page = null;
  const original = chromium.launchPersistentContext;
  chromium.launchPersistentContext = async () => {
    assert(f.state.activeNativeShortSubmission);
    entered.resolve();
    await gate.promise;
    return f.context;
  };
  try {
    const running = f.session.runNativeShortSubmissionFixture(
      SUBMISSION_FIXTURE_WORK,
      { ...f.options, timeoutMs: 20 },
      f.api.factory,
      f.api.contract,
    );
    await entered.promise;
    const r = await running;
    assert.equal(r.reason, 'timeout');
    assert.equal(r.cleanup.quarantined, true);
    assert.equal(r.cleanup.pendingAtEnd, 1);
    assert(f.state.activeNativeShortSubmission);
    assert.equal(f.api.clientCreates, 0);
    assert.equal(f.closes, 0);
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
    const cleanup = f.state.activeNativeShortSubmission.cleanupDone;
    gate.resolve();
    await cleanup;
    assert.equal(f.closes, 1);
    assert.equal(f.state.context, null);
    assert.equal(f.state.activeNativeShortSubmission, null);
    assert.equal(f.navigation, 0);
    await assert.rejects(
      f.session.close(),
      (e) => e instanceof BrowserSessionError && e.code === 'shutdown_incomplete',
    );
  } finally {
    gate.resolve();
    chromium.launchPersistentContext = original;
  }
});

test('close during cold initialization retains stop/done/drain slot and never starts transport after late launch', async () => {
  const f = fixture({ mode: 'prepare' }),
    gate = deferred(),
    entered = deferred();
  f.state.context = null;
  f.state.page = null;
  const original = chromium.launchPersistentContext;
  chromium.launchPersistentContext = async () => {
    assert(f.state.activeNativeShortSubmission);
    entered.resolve();
    await gate.promise;
    return f.context;
  };
  try {
    const running = f.session.runNativeShortSubmissionFixture(
      SUBMISSION_FIXTURE_WORK,
      f.options,
      f.api.factory,
      f.api.contract,
    );
    await entered.promise;
    const closing = f.session.close();
    await turn();
    assert.equal((await running).reason, 'cancelled');
    assert.equal(f.closes, 0);
    assert(f.state.activeNativeShortSubmission);
    gate.resolve();
    await assert.rejects(
      closing,
      (e) => e instanceof BrowserSessionError && e.code === 'shutdown_incomplete',
    );
    assert.equal(f.api.clientCreates, 0);
    assert.equal(f.closes, 1);
    assert.equal(f.state.context, null);
    assert.equal(f.navigation, 0);
  } finally {
    gate.resolve();
    chromium.launchPersistentContext = original;
  }
});

test('failed cold launch cleanup preserves quarantined context and cannot report a clean drain', async () => {
  const f = fixture({ mode: 'prepare' });
  f.state.context = null;
  f.state.page = null;
  const original = chromium.launchPersistentContext;
  let closeAttempts = 0;
  const failing = {
    setDefaultTimeout() {
      throw Error('synthetic initialization error');
    },
    async close() {
      closeAttempts++;
      throw Error('synthetic close error');
    },
  } as unknown as BrowserContext;
  chromium.launchPersistentContext = async () => failing;
  try {
    const r = await f.session.runNativeShortSubmissionFixture(
      SUBMISSION_FIXTURE_WORK,
      f.options,
      f.api.factory,
      f.api.contract,
    );
    assert.equal(r.reason, 'cleanup_failed');
    assert.equal(r.cleanup.quarantined, true);
    assert.equal(f.state.context, failing);
    assert.equal(closeAttempts, 1);
    assert.equal(f.api.clientCreates, 0);
    await assert.rejects(
      f.session.close(),
      (e) => e instanceof BrowserSessionError && e.code === 'shutdown_incomplete',
    );
  } finally {
    chromium.launchPersistentContext = original;
  }
});

test('initialization failure with hung close returns by deadline and keeps the single late close owned and quarantined', async () => {
  const f = fixture({ mode: 'prepare' }),
    gate = deferred(),
    entered = deferred();
  f.state.context = null;
  f.state.page = null;
  const original = chromium.launchPersistentContext;
  let closes = 0,
    settled = false;
  const failing = {
    setDefaultTimeout() {
      throw Error('synthetic initialization error');
    },
    async close() {
      closes++;
      entered.resolve();
      await gate.promise;
    },
  } as unknown as BrowserContext;
  chromium.launchPersistentContext = async () => failing;
  try {
    const running = f.session
      .runNativeShortSubmissionFixture(
        SUBMISSION_FIXTURE_WORK,
        { ...f.options, timeoutMs: 20 },
        f.api.factory,
        f.api.contract,
      )
      .then((value) => {
        settled = true;
        return value;
      });
    await entered.promise;
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    assert.equal(settled, true);
    const r = await running;
    assert.equal(r.reason, 'timeout');
    assert.equal(r.cleanup.quarantined, true);
    assert.equal(r.cleanup.pendingAtEnd, 1);
    assert.equal(f.state.apiQuarantined, true);
    assert(f.state.activeNativeShortSubmission);
    assert.equal(f.state.context, failing);
    assert.equal(closes, 1);
    assert.equal(f.api.clientCreates, 0);
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
    await assert.rejects(
      f.session.read(async () => 1),
      (e) => e instanceof BrowserSessionError && e.code === 'shutdown_incomplete',
    );
    const cleanup = f.state.activeNativeShortSubmission.cleanupDone;
    let drained = false;
    void cleanup.then(() => {
      drained = true;
    });
    await turn();
    assert.equal(drained, false);
    gate.resolve();
    await cleanup;
    assert.equal(closes, 1);
    assert.equal(f.state.context, null);
    assert.equal(f.state.activeNativeShortSubmission, null);
    assert.equal(r.cleanup.pendingAtEnd, 1);
    await assert.rejects(
      f.session.close(),
      (e) => e instanceof BrowserSessionError && e.code === 'shutdown_incomplete',
    );
    assert.equal(closes, 1);
  } finally {
    gate.resolve();
    chromium.launchPersistentContext = original;
  }
});

test('cancel during failed initialization close returns promptly and Browser.close waits its single actual drain', async () => {
  const f = fixture({ mode: 'prepare' }),
    gate = deferred(),
    entered = deferred(),
    controller = new AbortController();
  f.state.context = null;
  f.state.page = null;
  const original = chromium.launchPersistentContext;
  let closes = 0,
    settled = false;
  const failing = {
    setDefaultTimeout() {
      throw Error('synthetic initialization error');
    },
    async close() {
      closes++;
      entered.resolve();
      await gate.promise;
    },
  } as unknown as BrowserContext;
  chromium.launchPersistentContext = async () => failing;
  try {
    const running = f.session.runNativeShortSubmissionFixture(
      SUBMISSION_FIXTURE_WORK,
      { ...f.options, signal: controller.signal },
      f.api.factory,
      f.api.contract,
    );
    await entered.promise;
    controller.abort();
    const r = await running;
    assert.equal(r.reason, 'cancelled');
    assert.equal(r.cleanup.quarantined, true);
    assert(f.state.activeNativeShortSubmission);
    assert.equal(closes, 1);
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
    gate.resolve();
    const error = await closing;
    assert(error instanceof BrowserSessionError && error.code === 'shutdown_incomplete');
    assert.equal(closes, 1);
    assert.equal(f.api.clientCreates, 0);
    assert.equal(f.state.context, null);
    assert.equal(f.state.activeNativeShortSubmission, null);
  } finally {
    gate.resolve();
    chromium.launchPersistentContext = original;
  }
});
