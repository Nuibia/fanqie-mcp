import test from 'node:test';

import {
  fixture,
  unknownDraft,
  reconciliationRead,
  digest,
  delay,
  desiredContentHash,
  deferred,
  collect,
} from './helpers/runtime-deferred.js';

import assert from 'node:assert/strict';

import { Store, RuntimeError } from '../src/runtime/store.js';

test('reconciliation binds later live read, target, operation input and desired content before durable success', async () => {
  // Unit simulation of the trusted live adapter, not a real platform acceptance test.
  const f = fixture(30_000, 'live');
  try {
    const original = await unknownDraft(f);
    const read = await reconciliationRead(f, original);
    const closed = f.store.reconcileWriteJob(original.id, read.id, {
      status: 'succeeded',
      result: { draftId: original.target!.id, verified: true },
    });
    assert.equal(closed.status, 'succeeded');
    assert.equal(closed.error, null);
    assert.deepEqual(closed.target, original.target);
    const replay = f.queue.enqueueWrite({
      accountId: 'author',
      operation: 'save-draft',
      idempotencyKey: 'unknown-draft',
      inputHash: digest('operation-args'),
      run: async () => {
        assert.fail('Reconciled writes must not execute again.');
      },
    });
    assert.equal((await replay.completion).status, 'succeeded');
    await f.queue.drainAndStop();
    f.store.close();
    const reopened = new Store(f.options);
    try {
      assert.equal(reopened.getJob(original.id)?.status, 'succeeded');
    } finally {
      reopened.close();
    }
  } finally {
    await f.cleanup();
  }
});

test('fixture data cannot pretend to be live and close an unknown write', async () => {
  const f = fixture();
  try {
    const original = await unknownDraft(f);
    const claimedLive = await reconciliationRead(f, original);
    assert.throws(
      () =>
        f.store.reconcileWriteJob(original.id, claimedLive.id, { status: 'succeeded', result: {} }),
      (error: unknown) => error instanceof RuntimeError && error.code === 'reconciliation_not_live',
    );
    assert.equal(f.store.getJob(original.id)?.status, 'uncertain');
  } finally {
    await f.cleanup();
  }
});

test('existing remote target alone cannot prove the desired write or close missing intent', async () => {
  const f = fixture(30_000, 'live');
  try {
    const original = await unknownDraft(f);
    const wrongBody = await reconciliationRead(f, original, {
      observedContentHash: digest('old remote body'),
    });
    assert.throws(
      () =>
        f.store.reconcileWriteJob(original.id, wrongBody.id, { status: 'succeeded', result: {} }),
      (error: unknown) =>
        error instanceof RuntimeError && error.code === 'reconciliation_status_conflict',
    );
    const wrongState = await reconciliationRead(f, original, { observedStatus: 'published' });
    assert.throws(
      () =>
        f.store.reconcileWriteJob(original.id, wrongState.id, { status: 'succeeded', result: {} }),
      (error: unknown) =>
        error instanceof RuntimeError && error.code === 'reconciliation_status_conflict',
    );
    assert.equal(f.store.getJob(original.id)?.status, 'uncertain');
  } finally {
    await f.cleanup();
  }
  const noIntent = fixture(30_000, 'live');
  try {
    const original = await unknownDraft(noIntent, false);
    const read = await reconciliationRead(noIntent, original);
    assert.throws(
      () =>
        noIntent.store.reconcileWriteJob(original.id, read.id, { status: 'succeeded', result: {} }),
      (error: unknown) =>
        error instanceof RuntimeError && error.code === 'reconciliation_intent_missing',
    );
    assert.equal(noIntent.store.getJob(original.id)?.status, 'uncertain');
  } finally {
    await noIntent.cleanup();
  }
});

test('reconciliation rejects another account, another target and another input hash', async () => {
  const f = fixture(30_000, 'live');
  try {
    const original = await unknownDraft(f);
    const otherAccount = await reconciliationRead(f, original, {}, 'other-author');
    assert.throws(
      () =>
        f.store.reconcileWriteJob(original.id, otherAccount.id, {
          status: 'succeeded',
          result: {},
        }),
      (error: unknown) => error instanceof RuntimeError && error.code === 'invalid_reconciliation',
    );
    for (const overrides of [
      { target: { kind: 'short-story', id: 'different-id' } },
      { inputHash: digest('different-input') },
    ]) {
      const read = await reconciliationRead(f, original, overrides);
      assert.throws(
        () => f.store.reconcileWriteJob(original.id, read.id, { status: 'succeeded', result: {} }),
        (error: unknown) =>
          error instanceof RuntimeError && error.code === 'reconciliation_binding_invalid',
      );
    }
    assert.equal(f.store.getJob(original.id)?.status, 'uncertain');
  } finally {
    await f.cleanup();
  }
});

test('known non-application can close failed; ambiguous later observations remain uncertain', async () => {
  const f = fixture(30_000, 'live');
  try {
    const original = await unknownDraft(f);
    const ambiguous = await reconciliationRead(f, original, {
      observedStatus: 'unknown',
      observedContentHash: null,
    });
    assert.equal(
      f.store.reconcileWriteJob(original.id, ambiguous.id, {
        status: 'uncertain',
        result: { needsHuman: true },
      }).status,
      'uncertain',
    );
    const later = await reconciliationRead(f, f.store.getJob(original.id)!, {
      observedStatus: 'not_applied',
      observedContentHash: digest('empty-body'),
    });
    const closed = f.store.reconcileWriteJob(original.id, later.id, {
      status: 'failed',
      result: { verifiedNotApplied: true },
    });
    assert.equal(closed.error?.code, 'reconciled_not_applied');
    const replay = f.queue.enqueueWrite({
      accountId: 'author',
      operation: 'save-draft',
      idempotencyKey: 'unknown-draft',
      inputHash: digest('operation-args'),
      run: async () => {
        assert.fail('Failed closed keys must not replay.');
      },
    });
    assert.equal((await replay.completion).status, 'failed');
  } finally {
    await f.cleanup();
  }
});

test('a successful platform read from before the uncertain effect is too old to reconcile it', async () => {
  const f = fixture(30_000, 'live');
  try {
    const original = f.store.createJob({
      accountId: 'author',
      kind: 'write',
      operation: 'save-draft',
      idempotencyKey: 'stale-reconcile',
      inputHash: digest('operation-args'),
    }).job;
    const target = { kind: 'short-story' as const, id: '7691713595993768510' };
    const earlier = await reconciliationRead(f, { ...original, target });
    await delay(3);
    f.store.startJob(original.id);
    f.store.saveEvidence(original.id, 'write-intent', {
      desiredContentHash,
      expectedStates: ['draft_saved'],
    });
    f.store.markPlatformWriteStarted(original.id);
    f.store.recordTarget(original.id, target);
    f.store.failJob(original.id, { code: 'response_lost', message: 'Effect might have happened.' });
    assert.throws(
      () => f.store.reconcileWriteJob(original.id, earlier.id, { status: 'succeeded', result: {} }),
      (error: unknown) => error instanceof RuntimeError && error.code === 'reconciliation_stale',
    );
    assert.equal(f.store.getJob(original.id)?.status, 'uncertain');
  } finally {
    await f.cleanup();
  }
});

test('queued cancellation is durable and never invokes its platform callback', async () => {
  const f = fixture();
  const started = deferred();
  const release = deferred();
  let calls = 0;
  try {
    const active = f.queue.enqueueRead({
      accountId: 'author',
      operation: 'active',
      datasets: ['works'],
      run: async (context) => {
        context.beforePlatformRead();
        started.resolve();
        await release.promise;
        return [context.saveEvidence('works', { works: [] })];
      },
    });
    await started.promise;
    const queued = f.queue.enqueueRead({
      accountId: 'author',
      operation: 'cancel-before-start',
      datasets: ['works'],
      run: async (context) => {
        calls += 1;
        context.beforePlatformRead();
        return [context.saveEvidence('works', { works: [] })];
      },
    });
    assert.equal(f.queue.cancel(queued.jobId).status, 'cancelled');
    assert.equal((await queued.completion).error?.code, 'cancelled');
    assert.ok(f.store.getJob(queued.jobId)?.cancellationRequestedAt);
    assert.equal(f.store.getJob(queued.jobId)?.platformReadStartedAt, null);
    release.resolve();
    await active.completion;
    assert.equal(calls, 0);
    assert.equal(f.store.getCurrent('author')?.jobId, active.jobId);
    await f.queue.drainAndStop();
    f.store.close();
    const reopened = new Store(f.options);
    try {
      assert.equal(reopened.getJob(queued.jobId)?.status, 'cancelled');
    } finally {
      reopened.close();
    }
  } finally {
    release.resolve();
    await f.cleanup();
  }
});

test('running read timeout aborts but retains account ownership until the actual callback finishes', async () => {
  const f = fixture();
  const started = deferred();
  const release = deferred();
  let signal: AbortSignal | undefined;
  let nextCalls = 0;
  try {
    await f.queue.enqueueRead({
      accountId: 'author',
      operation: 'baseline',
      datasets: ['works', 'metrics'],
      run: async (context) => collect(context),
    }).completion;
    const previous = f.store.getCurrent('author')!;
    const timed = f.queue.enqueueRead({
      accountId: 'author',
      operation: 'slow',
      datasets: ['works', 'metrics'],
      timeoutMs: 25,
      run: async (context) => {
        signal = context.signal;
        const references = collect(context);
        started.resolve();
        // Deliberately ignores abort, to prove the queue does not race past underlying work.
        await release.promise;
        return references;
      },
    });
    await started.promise;
    const next = f.queue.enqueueRead({
      accountId: 'author',
      operation: 'next',
      scope: 'next',
      datasets: ['works'],
      run: async (context) => {
        nextCalls += 1;
        context.beforePlatformRead();
        return [context.saveEvidence('works', { works: [] })];
      },
    });
    await delay(45);
    assert.equal(signal?.aborted, true);
    assert.equal(f.store.getJob(timed.jobId)?.status, 'running');
    assert.equal(f.store.getJob(timed.jobId)?.cancellationReason?.code, 'timeout');
    assert.equal(f.store.getJob(next.jobId)?.status, 'queued');
    assert.equal(nextCalls, 0);
    assert.equal(f.store.getCurrent('author')?.id, previous.id);
    release.resolve();
    const ended = await timed.completion;
    assert.equal(ended.status, 'failed');
    assert.equal(ended.error?.code, 'timeout');
    assert.equal((await next.completion).status, 'succeeded');
    assert.equal(f.store.getCurrent('author')?.id, previous.id);
    assert.equal(nextCalls, 1);
  } finally {
    release.resolve();
    await f.cleanup();
  }
});
