import test from 'node:test';

import { fixture, deferred, digest, collect, delay } from './helpers/runtime-deferred.js';

import assert from 'node:assert/strict';

import { RuntimeError, Store } from '../src/runtime/store.js';

import { type JobContext, JobQueue } from '../src/runtime/jobs.js';

test('running write cancellation after the effect boundary is uncertain even if a late callback returns success', async () => {
  const f = fixture();
  const started = deferred();
  const release = deferred();
  let signal: AbortSignal | undefined;
  try {
    const handle = f.queue.enqueueWrite({
      accountId: 'author',
      operation: 'save-draft',
      idempotencyKey: 'cancel-write',
      inputHash: digest('cancel-write'),
      run: async (context) => {
        context.beforePlatformWrite();
        signal = context.signal;
        started.resolve();
        await release.promise;
        // Discovery arriving during cleanup must still durably preserve the target ID.
        context.recordTarget('7691713595993768510');
        return { status: 'saved' };
      },
    });
    await started.promise;
    f.queue.cancel(handle.jobId);
    assert.equal(signal?.aborted, true);
    assert.equal(f.store.getJob(handle.jobId)?.status, 'running');
    release.resolve();
    const ended = await handle.completion;
    assert.equal(ended.status, 'uncertain');
    assert.equal(ended.error?.code, 'outcome_unknown');
    assert.equal(ended.target?.id, '7691713595993768510');
    assert.equal(
      (
        await f.queue.enqueueWrite({
          accountId: 'author',
          operation: 'save-draft',
          idempotencyKey: 'cancel-write',
          inputHash: digest('cancel-write'),
          run: async () => {
            assert.fail('Cancelled unknown writes must not replay.');
          },
        }).completion
      ).id,
      handle.jobId,
    );
  } finally {
    release.resolve();
    await f.cleanup();
  }
});

test('cancellation before the write boundary forbids starting the platform side effect', async () => {
  const f = fixture();
  const started = deferred();
  const release = deferred();
  let effects = 0;
  try {
    const handle = f.queue.enqueueWrite({
      accountId: 'author',
      operation: 'save-draft',
      idempotencyKey: 'cancel-before-effect',
      inputHash: digest('before-effect'),
      run: async (context) => {
        context.beforePlatformRead();
        started.resolve();
        await release.promise;
        context.beforePlatformWrite();
        effects += 1;
        return { saved: true };
      },
    });
    await started.promise;
    f.queue.cancel(handle.jobId);
    release.resolve();
    assert.equal((await handle.completion).status, 'cancelled');
    assert.equal(effects, 0);
    assert.equal(f.store.getJob(handle.jobId)?.platformWriteStartedAt, null);
  } finally {
    release.resolve();
    await f.cleanup();
  }
});

test('bounded shutdown aborts work but does not release an account or store while cleanup is unfinished', async () => {
  const f = fixture();
  const started = deferred();
  const release = deferred();
  try {
    const handle = f.queue.enqueueRead({
      accountId: 'author',
      operation: 'ignores-abort',
      datasets: ['works'],
      run: async (context) => {
        context.beforePlatformRead();
        started.resolve();
        await release.promise;
        return [context.saveEvidence('works', { works: [] })];
      },
    });
    await started.promise;
    const before = Date.now();
    await assert.rejects(
      f.queue.drainAndStop({ timeoutMs: 25 }),
      (error: unknown) => error instanceof RuntimeError && error.code === 'shutdown_incomplete',
    );
    assert.ok(Date.now() - before < 500);
    assert.equal(f.store.getJob(handle.jobId)?.status, 'running');
    assert.equal(f.store.getJob(handle.jobId)?.cancellationReason?.code, 'shutdown');
    assert.throws(
      () => new Store(f.options),
      (error: unknown) => error instanceof RuntimeError && error.code === 'service_already_running',
    );
    assert.throws(
      () =>
        f.queue.enqueueRead({
          accountId: 'author',
          operation: 'new',
          datasets: ['works'],
          run: async (context) => collect(context),
        }),
      (error: unknown) => error instanceof RuntimeError && error.code === 'service_stopping',
    );
    release.resolve();
    assert.equal((await handle.completion).status, 'cancelled');
    await f.queue.drainAndStop({ timeoutMs: 100 });
    assert.equal(f.store.getCurrent('author'), null);
  } finally {
    release.resolve();
    await f.cleanup();
  }
});

test('known platform error codes survive the runtime without arbitrary sensitive details', async () => {
  const f = fixture();
  try {
    const error = Object.assign(new Error('Account needs login; token=private'), {
      name: 'PlatformReadError',
      code: 'unverified_profile',
      details: { cookie: 'private' },
    });
    const job = await f.queue.enqueueRead({
      accountId: 'author',
      operation: 'structured-error',
      datasets: ['works'],
      run: async () => {
        throw error;
      },
    }).completion;
    assert.equal(job.error?.code, 'unverified_profile');
    assert.doesNotMatch(job.error!.message, /private/);
    assert.equal(job.error?.details, undefined);
  } finally {
    await f.cleanup();
  }
});

test('write timeout after the side effect boundary persists uncertain outcome with timeout cause', async () => {
  const f = fixture();
  try {
    const handle = f.queue.enqueueWrite({
      accountId: 'author',
      operation: 'save-draft',
      idempotencyKey: 'write-timeout',
      inputHash: digest('write-timeout'),
      timeoutMs: 20,
      run: async (context) => {
        context.beforePlatformWrite();
        context.recordTarget('7691713595993768510');
        await new Promise<never>((_resolve, reject) => {
          context.signal.addEventListener('abort', () => reject(context.signal.reason), {
            once: true,
          });
        });
      },
    });
    const job = await handle.completion;
    assert.equal(job.status, 'uncertain');
    assert.equal(job.error?.code, 'outcome_unknown');
    assert.equal(job.cancellationReason?.code, 'timeout');
    assert.equal((job.error?.details as { cause?: { code?: string } })?.cause?.code, 'timeout');
    assert.ok(job.deadlineAt);
  } finally {
    await f.cleanup();
  }
});

test('cancelling all queued callbacks before their drain microtasks leaves no phantom account runner', async () => {
  const f = fixture();
  let calls = 0;
  try {
    const run = async (context: JobContext) => {
      calls += 1;
      context.beforePlatformRead();
      return [context.saveEvidence('works', { works: [] })];
    };
    const first = f.queue.enqueueRead({
      accountId: 'author',
      operation: 'first',
      datasets: ['works'],
      run,
    });
    const second = f.queue.enqueueRead({
      accountId: 'author',
      operation: 'second',
      datasets: ['works'],
      run,
    });
    f.queue.cancel(first.jobId);
    f.queue.cancel(second.jobId);
    assert.equal((await first.completion).status, 'cancelled');
    assert.equal((await second.completion).status, 'cancelled');
    await delay(1);
    assert.equal(calls, 0);
    const later = f.queue.enqueueRead({
      accountId: 'author',
      operation: 'later',
      datasets: ['works'],
      run,
    });
    assert.equal((await later.completion).status, 'succeeded');
    assert.equal(calls, 1);
  } finally {
    await f.cleanup();
  }
});

test('login waiting is durable, never blindly replays its key, and can be cancelled after restart', async () => {
  const f = fixture();
  let calls = 0;
  try {
    const input = {
      accountId: 'author',
      operation: 'save-draft',
      idempotencyKey: 'login-blocked',
      inputHash: digest('login-blocked'),
    };
    const blocked = await f.queue.enqueueWrite({
      ...input,
      run: async (context) => {
        calls += 1;
        context.beforePlatformRead();
        throw Object.assign(new Error('Complete login challenge.'), { code: 'challenge_required' });
      },
    }).completion;
    assert.equal(blocked.status, 'waiting_for_login');
    assert.equal(blocked.error?.code, 'challenge_required');
    assert.equal(blocked.platformWriteStartedAt, null);
    assert.ok(blocked.endedAt);
    const repeated = await f.queue.enqueueWrite({
      ...input,
      run: async () => {
        calls += 1;
        return { saved: true };
      },
    }).completion;
    assert.equal(repeated.id, blocked.id);
    assert.equal(repeated.status, 'waiting_for_login');
    assert.equal(calls, 1);
    await f.queue.drainAndStop();
    f.store.close();
    const reopened = new Store(f.options);
    const resumed = new JobQueue(reopened);
    try {
      assert.equal(reopened.getJob(blocked.id)?.status, 'waiting_for_login');
      assert.equal(resumed.cancel(blocked.id).status, 'cancelled');
      const fresh = await resumed.enqueueWrite({
        ...input,
        idempotencyKey: 'after-user-login',
        run: async (context) => {
          context.beforePlatformWrite();
          calls += 1;
          return { saved: true };
        },
      }).completion;
      assert.equal(fresh.status, 'succeeded');
      assert.equal(calls, 2);
    } finally {
      await resumed.drainAndStop();
      reopened.close();
    }
  } finally {
    await f.cleanup();
  }
});
