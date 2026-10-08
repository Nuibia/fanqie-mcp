import test from 'node:test';

import {
  fixture,
  deferred,
  digest,
  delay,
  unknownDraft,
  desiredContentHash,
} from './helpers/runtime-deferred.js';

import assert from 'node:assert/strict';

import { type JobContext, JobQueue } from '../src/runtime/jobs.js';

import { RuntimeError, Store, canonicalJson } from '../src/runtime/store.js';

import { mkdtempSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { fileURLToPath, pathToFileURL } from 'node:url';

import { spawnSync } from 'node:child_process';

test('a whole account job is serialized while independent accounts can run together', async () => {
  const f = fixture();
  const release = deferred();
  const aStarted = deferred();
  const bStarted = deferred();
  const events: string[] = [];
  try {
    const first = f.queue.enqueueRead({
      accountId: 'a',
      operation: 'first',
      datasets: ['works'],
      run: async (context) => {
        context.beforePlatformRead();
        events.push('a:first');
        aStarted.resolve();
        await release.promise;
        return [context.saveEvidence('works', { works: [] })];
      },
    });
    const second = f.queue.enqueueRead({
      accountId: 'a',
      operation: 'second',
      datasets: ['works'],
      run: async (context) => {
        context.beforePlatformRead();
        events.push('a:second');
        return [context.saveEvidence('works', { works: [] })];
      },
    });
    const independent = f.queue.enqueueRead({
      accountId: 'b',
      operation: 'first',
      datasets: ['works'],
      run: async (context) => {
        context.beforePlatformRead();
        events.push('b:first');
        bStarted.resolve();
        await release.promise;
        return [context.saveEvidence('works', { works: [] })];
      },
    });
    await Promise.all([aStarted.promise, bStarted.promise]);
    assert.deepEqual(events, ['a:first', 'b:first']);
    release.resolve();
    await Promise.all([first.completion, second.completion, independent.completion]);
    assert.deepEqual(events, ['a:first', 'b:first', 'a:second']);
    assert.equal(f.store.getCurrent('a')?.jobId, second.jobId);
    assert.equal(f.store.getCurrent('b')?.jobId, independent.jobId);
  } finally {
    release.resolve();
    await f.cleanup();
  }
});

test('write idempotency survives restart and rejects a reused key with different input', async () => {
  const f = fixture();
  let calls = 0;
  try {
    const request = {
      accountId: 'author',
      operation: 'save-draft',
      idempotencyKey: 'draft-1',
      inputHash: digest('body-v1'),
      run: async (context: JobContext) => {
        calls += 1;
        context.beforePlatformWrite();
        return { draftId: 'confirmed-id', verified: true };
      },
    };
    const first = f.queue.enqueueWrite(request);
    const duplicate = f.queue.enqueueWrite(request);
    assert.equal(first.jobId, duplicate.jobId);
    assert.equal((await first.completion).status, 'succeeded');
    const replay = f.queue.enqueueWrite(request);
    assert.equal(replay.jobId, first.jobId);
    assert.equal((await replay.completion).status, 'succeeded');
    assert.equal(calls, 1);
    assert.throws(
      () => f.queue.enqueueWrite({ ...request, inputHash: digest('body-v2') }),
      (error: unknown) => error instanceof RuntimeError && error.code === 'idempotency_conflict',
    );
    await f.queue.drainAndStop();
    f.store.close();
    const reopened = new Store(f.options);
    try {
      const queue = new JobQueue(reopened);
      assert.equal((await queue.enqueueWrite(request).completion).id, first.jobId);
      assert.equal(calls, 1);
      await queue.drainAndStop();
    } finally {
      reopened.close();
    }
  } finally {
    await f.cleanup();
  }
});

test('a write response lost after the effect boundary is uncertain and never blindly retried', async () => {
  const f = fixture();
  let calls = 0;
  try {
    const request = {
      accountId: 'author',
      operation: 'submit-review',
      idempotencyKey: 'publish-1',
      inputHash: digest('draft-version'),
      run: async (context: JobContext) => {
        calls += 1;
        context.beforePlatformWrite();
        throw new Error('Response lost after submit.');
      },
    };
    const failed = await f.queue.enqueueWrite(request).completion;
    assert.equal(failed.status, 'uncertain');
    assert.equal(failed.error?.code, 'outcome_unknown');
    assert.equal((await f.queue.enqueueWrite(request).completion).id, failed.id);
    assert.equal(calls, 1);
    const beforeEffect = await f.queue.enqueueWrite({
      ...request,
      idempotencyKey: 'publish-2',
      run: async () => {
        throw new RuntimeError('requires_login', 'Login needed before submit.');
      },
    }).completion;
    assert.equal(beforeEffect.status, 'waiting_for_login');
    assert.equal(beforeEffect.error?.code, 'requires_login');
  } finally {
    await f.cleanup();
  }
});

test('a live SQLite service lease rejects a second instance and heartbeats keep it alive', async () => {
  const f = fixture(180);
  try {
    assert.throws(
      () => new Store(f.options),
      (error: unknown) => error instanceof RuntimeError && error.code === 'service_already_running',
    );
    await delay(400);
    assert.throws(
      () => new Store(f.options),
      (error: unknown) => error instanceof RuntimeError && error.code === 'service_already_running',
    );
    assert.equal(f.store.listJobs().length, 0);
  } finally {
    await f.cleanup();
  }
});

test('a crashed owner is recovered only after lease expiry; reads fail and writes become uncertain', async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-runtime-restart-'));
  const options = {
    databasePath: path.join(directory, 'runtime.sqlite'),
    evidenceDirectory: path.join(directory, 'evidence'),
    leaseDurationMs: 30_000,
  };
  const typedSource = new URL('./runtime.test.ts', import.meta.url).href.endsWith('.ts');
  const source = path.resolve(
    path.dirname(fileURLToPath(new URL('./runtime.test.ts', import.meta.url).href)),
    `../src/runtime/store.${typedSource ? 'ts' : 'js'}`,
  );
  const code = `import {Store} from ${JSON.stringify(pathToFileURL(source).href)}; const s=new Store(JSON.parse(process.argv[1])); const r=s.createJob({accountId:'author',kind:'read',operation:'refresh',datasets:['works']}).job; s.startJob(r.id); s.markPlatformReadStarted(r.id); s.saveEvidence(r.id,'works',{works:[]}); const w=s.createJob({accountId:'author',kind:'write',operation:'save-draft',idempotencyKey:'crashed-write',inputHash:'${digest('body')}'}).job; s.startJob(w.id); s.markPlatformWriteStarted(w.id); const {DatabaseSync}=await import('node:sqlite'); const probe=new DatabaseSync(JSON.parse(process.argv[1]).databasePath,{readOnly:true}); const lease=probe.prepare('SELECT expires_at FROM service_lease WHERE id=1').get(); probe.close(); console.log(JSON.stringify({readId:r.id,writeId:w.id,leaseExpiresAt:lease.expires_at})); process.exit(0);`;
  // tsx is the project's declared TS test runtime; this child deliberately skips cleanup.
  const result = spawnSync(
    process.execPath,
    [
      ...(typedSource ? ['--import', 'tsx'] : []),
      '--input-type=module',
      '-e',
      code,
      JSON.stringify(options),
    ],
    { encoding: 'utf8', cwd: process.cwd() },
  );
  assert.equal(result.status, 0, result.stderr);
  const ids = JSON.parse(result.stdout.trim()) as {
    readId: string;
    writeId: string;
    leaseExpiresAt: number;
  };
  try {
    assert(Number.isSafeInteger(ids.leaseExpiresAt) && ids.leaseExpiresAt > 0);
    // A real crashed child leaves its persisted lease; test the exact clock boundary
    // rather than assuming parent scheduling returns within a 180 ms window.
    t.mock.timers.enable({ apis: ['Date'], now: ids.leaseExpiresAt - 1 });
    assert.equal(Date.now(), ids.leaseExpiresAt - 1);
    assert.throws(
      () => new Store(options),
      (error: unknown) => error instanceof RuntimeError && error.code === 'service_already_running',
    );
    t.mock.timers.tick(1);
    assert.equal(Date.now(), ids.leaseExpiresAt);
    const recovered = new Store(options);
    try {
      assert.equal(recovered.getJob(ids.readId)?.status, 'failed');
      assert.equal(recovered.getJob(ids.readId)?.error?.code, 'interrupted');
      assert.equal(recovered.getJob(ids.writeId)?.status, 'uncertain');
      assert.equal(recovered.getJob(ids.writeId)?.error?.code, 'outcome_unknown');
      assert.equal(recovered.listEvidence(ids.readId).length, 1);
      assert.equal(recovered.getCurrent('author'), null);
      assert.equal(recovered.recoverInterrupted(), 0);
    } finally {
      recovered.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('canonical evidence rejects lossy JSON and caller supplied evidence timestamps', async () => {
  assert.throws(() => canonicalJson({ value: Number.NaN }), RuntimeError);
  assert.throws(() => canonicalJson({ value: undefined }), RuntimeError);
  const f = fixture();
  try {
    const result = await f.queue.enqueueRead({
      accountId: 'author',
      operation: 'clock',
      datasets: ['works'],
      run: async (context) => {
        context.beforePlatformRead();
        return [context.saveEvidence('works', { capturedAt: '1900-01-01T00:00:00Z', works: [] })];
      },
    }).completion;
    const reference = f.store.listEvidence(result.id)[0]!;
    assert.ok(Date.parse(reference.capturedAt) >= Date.parse(result.requestedAt));
    assert.notEqual(reference.capturedAt, '1900-01-01T00:00:00Z');
  } finally {
    await f.cleanup();
  }
});

test('target discovery is persisted immediately and metadata cannot archive request bodies or credentials', async () => {
  const f = fixture();
  try {
    const job = await unknownDraft(f);
    assert.equal(job.status, 'uncertain');
    assert.deepEqual(job.target, { kind: 'short-story', id: '7691713595993768510' });
    assert.deepEqual(job.metadata, { clientWorkId: 'local-work', version: 'v1' });
    assert.equal(f.store.listEvidence(job.id)[0]?.dataset, 'write-intent');
    const invalid = await f.queue.enqueueWrite({
      accountId: 'author',
      operation: 'invalid-metadata',
      idempotencyKey: 'unsafe',
      inputHash: digest('unsafe'),
      run: async (context) => {
        context.addMetadata({ body: 'Unpublished content must not be persisted as arguments.' });
        return {};
      },
    }).completion;
    assert.equal(invalid.error?.code, 'invalid_metadata');
    const credential = await f.queue.enqueueWrite({
      accountId: 'author',
      operation: 'invalid-intent',
      idempotencyKey: 'unsafe-intent',
      inputHash: digest('unsafe-intent'),
      run: async (context) => {
        context.saveEvidence('write-intent', {
          desiredContentHash,
          expectedStates: ['draft_saved'],
          token: 'private',
        });
        return {};
      },
    }).completion;
    assert.equal(credential.error?.code, 'invalid_write_intent');
  } finally {
    await f.cleanup();
  }
});
