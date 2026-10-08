import test from 'node:test';

import { fixture, collect, digest, deferred } from './helpers/runtime-deferred.js';

import assert from 'node:assert/strict';

import { RuntimeError, type Manifest, canonicalJson } from '../src/runtime/store.js';

import { readFileSync, writeFileSync } from 'node:fs';

import path from 'node:path';

import { randomUUID } from 'node:crypto';

import { nativeStoreDb } from './helpers/runtime-recovery-baseline.js';

import { type JobContext } from '../src/runtime/jobs.js';

test('profile recovery lease checks succeed only while this store is open and owns the service', async () => {
  const f = fixture();
  try {
    assert.doesNotThrow(() => f.store.assertLeaseOwnership());
    await f.queue.drainAndStop();
    f.store.close();
    assert.throws(
      () => f.store.assertLeaseOwnership(),
      (error: unknown) => error instanceof RuntimeError && error.code === 'store_closed',
    );
  } finally {
    await f.cleanup();
  }
});

test('fresh read records real runtime timestamps and atomically binds both evidence files', async () => {
  const f = fixture();
  try {
    const before = Date.now();
    const handle = f.queue.enqueueRead({
      accountId: 'author',
      operation: 'refresh',
      datasets: ['works', 'metrics'],
      run: async (context) => collect(context),
    });
    const job = await handle.completion;
    assert.equal(job.status, 'succeeded');
    assert.ok(Date.parse(job.requestedAt) >= before);
    assert.ok(Date.parse(job.platformReadStartedAt!) >= Date.parse(job.requestedAt));
    const current = f.store.getCurrent('author')!;
    assert.equal(current.jobId, handle.jobId);
    assert.deepEqual(current.datasets, ['metrics', 'works']);
    assert.equal(current.evidence.length, 2);
    for (const reference of current.evidence) {
      assert.equal(
        digest(readFileSync(path.join(f.options.evidenceDirectory, reference.path), 'utf8')),
        reference.sha256,
      );
      assert.equal(f.store.readEvidence(reference).jobId, job.id);
      assert.ok(reference.capturedAt >= job.platformReadStartedAt!);
    }
    assert.equal(f.store.history('author').length, 1);
  } finally {
    await f.cleanup();
  }
});

test('targeted job manifest lookup keeps zero and duplicate semantics without scanning unrelated history', async () => {
  const f = fixture();
  try {
    const read = () =>
      f.queue.enqueueRead({
        accountId: 'author',
        operation: 'refresh',
        datasets: ['works', 'metrics'],
        run: async (ctx) => collect(ctx),
      }).completion;
    const first = await read(),
      other = await read();
    const expected = (first.result as { manifest: Manifest }).manifest;
    assert.deepEqual(f.store.getManifestForJob('author', first.id), expected);
    assert.equal(f.store.getManifestForJob('other-author', first.id), null);
    assert.equal(f.store.getManifestForJob('author', randomUUID()), null);
    const db = nativeStoreDb(f);
    db.prepare('UPDATE manifests SET manifest_json=? WHERE job_id=?').run(
      'SYNTHETIC_UNRELATED_INVALID_JSON',
      other.id,
    );
    assert.throws(() => f.store.history('author'), SyntaxError);
    assert.deepEqual(
      f.store.getManifestForJob('author', first.id),
      expected,
      'An unrelated malformed history item must not be loaded for this bound job.',
    );
    // The production table's UNIQUE(job_id) normally prevents duplicates.
    // A test-only SQLite shadow models corrupt durable rows without changing
    // the production schema or its main table.
    db.exec('CREATE TEMP TABLE manifests AS SELECT * FROM main.manifests');
    for (let index = 0; index < 2; index++) {
      const duplicate = { ...expected, id: randomUUID() };
      db.prepare(
        'INSERT INTO manifests(id,account_id,job_id,scope,committed_at,manifest_json) VALUES(?,?,?,?,?,?)',
      ).run(
        duplicate.id,
        duplicate.accountId,
        duplicate.jobId,
        duplicate.scope,
        duplicate.committedAt,
        canonicalJson(duplicate),
      );
    }
    assert.equal(
      f.store.getManifestForJob('author', first.id),
      null,
      'Multiple bound manifests cannot silently select the first.',
    );
    await f.queue.drainAndStop();
    f.store.close();
    assert.throws(
      () => f.store.getManifestForJob('author', first.id),
      (error: unknown) => error instanceof RuntimeError && error.code === 'store_closed',
    );
  } finally {
    await f.cleanup();
  }
});

test('targeted job manifest lookup rejects physical row and JSON binding disagreement', async (t) => {
  for (const field of ['id', 'accountId', 'jobId', 'scope', 'committedAt'] as const)
    await t.test(field, async () => {
      const f = fixture();
      try {
        const job = await f.queue.enqueueRead({
          accountId: 'author',
          operation: 'refresh',
          datasets: ['works', 'metrics'],
          run: async (ctx) => collect(ctx),
        }).completion;
        const manifest = structuredClone((job.result as { manifest: Manifest }).manifest);
        if (field === 'id' || field === 'jobId') manifest[field] = randomUUID();
        if (field === 'accountId') manifest.accountId = 'other-author';
        if (field === 'scope') manifest.scope = 'other-scope';
        if (field === 'committedAt')
          manifest.committedAt = new Date(Date.parse(manifest.committedAt) + 1).toISOString();
        nativeStoreDb(f)
          .prepare('UPDATE manifests SET manifest_json=? WHERE job_id=?')
          .run(canonicalJson(manifest), job.id);
        assert.throws(
          () => f.store.getManifestForJob('author', job.id),
          (error: unknown) =>
            error instanceof RuntimeError && error.code === 'evidence_binding_invalid',
        );
      } finally {
        await f.cleanup();
      }
    });
});

test('targeted job manifest lookup cannot relabel an ordinary job with a reserved administrative signal', async (t) => {
  for (const signal of ['schema', 'scope'])
    await t.test(signal, async () => {
      const f = fixture();
      try {
        const job = await f.queue.enqueueRead({
          accountId: 'author',
          operation: 'refresh',
          datasets: ['works', 'metrics'],
          run: async (ctx) => collect(ctx),
        }).completion;
        const manifest = structuredClone(
          (job.result as { manifest: Manifest }).manifest,
        ) as Manifest & { schema?: string };
        if (signal === 'schema')
          manifest.schema = 'native-short-metadata-compensation-registration-future/v999';
        else manifest.scope = 'native_compensation_attestation.synthetic';
        nativeStoreDb(f)
          .prepare('UPDATE manifests SET scope=?,manifest_json=? WHERE job_id=?')
          .run(manifest.scope, canonicalJson(manifest), job.id);
        assert.throws(
          () => f.store.getManifestForJob('author', job.id),
          (error: unknown) =>
            error instanceof RuntimeError && error.code === 'capability_unavailable',
        );
      } finally {
        await f.cleanup();
      }
    });
});

test('login interruption keeps partial immutable evidence but never advances the complete current manifest', async () => {
  const f = fixture();
  try {
    await f.queue.enqueueRead({
      accountId: 'author',
      operation: 'refresh',
      datasets: ['works', 'metrics'],
      run: async (context) => collect(context),
    }).completion;
    const previous = f.store.getCurrent('author')!;
    const failed = await f.queue.enqueueRead({
      accountId: 'author',
      operation: 'refresh',
      datasets: ['works', 'metrics'],
      run: async (context) => {
        context.beforePlatformRead();
        context.saveEvidence('works', { works: [{ id: 'real-fixture' }] });
        throw new RuntimeError('requires_login', 'Metrics page requires login.');
      },
    }).completion;
    assert.equal(failed.status, 'waiting_for_login');
    assert.equal(failed.error?.code, 'requires_login');
    assert.equal(f.store.listEvidence(failed.id).length, 1);
    assert.equal(f.store.getCurrent('author')!.id, previous.id);
    assert.equal(f.store.history('author').length, 1);
  } finally {
    await f.cleanup();
  }
});

test('incomplete or corrupted evidence cannot publish a manifest', async () => {
  const f = fixture();
  try {
    const incomplete = await f.queue.enqueueRead({
      accountId: 'author',
      operation: 'incomplete',
      datasets: ['works', 'metrics'],
      run: async (context) => {
        context.beforePlatformRead();
        return [context.saveEvidence('works', { works: [] })];
      },
    }).completion;
    assert.equal(incomplete.status, 'partial');
    assert.equal(incomplete.error?.code, 'incomplete_collection');
    const corrupt = await f.queue.enqueueRead({
      accountId: 'author',
      operation: 'corrupt',
      datasets: ['works'],
      run: async (context) => {
        context.beforePlatformRead();
        const reference = context.saveEvidence('works', { works: [] });
        writeFileSync(path.join(f.options.evidenceDirectory, reference.path), 'tampered\n');
        return [reference];
      },
    }).completion;
    assert.equal(corrupt.status, 'partial');
    assert.equal(corrupt.error?.code, 'evidence_hash_invalid');
    assert.equal(f.store.getCurrent('author'), null);
  } finally {
    await f.cleanup();
  }
});

test('cached evidence and missing platform access cannot be labelled a fresh success', async () => {
  const f = fixture();
  try {
    const missing = await f.queue.enqueueRead({
      accountId: 'author',
      operation: 'cached',
      datasets: ['works'],
      run: async (context) => [context.saveEvidence('works', { works: [] })],
    }).completion;
    assert.equal(missing.status, 'failed');
    assert.equal(missing.error?.code, 'platform_not_accessed');
    const first = await f.queue.enqueueRead({
      accountId: 'author',
      operation: 'refresh',
      datasets: ['works', 'metrics'],
      run: async (context) => collect(context),
    }).completion;
    const references = f.store.listEvidence(first.id);
    const reused = await f.queue.enqueueRead({
      accountId: 'author',
      operation: 'reused',
      datasets: ['works', 'metrics'],
      run: async (context) => {
        context.beforePlatformRead();
        return references;
      },
    }).completion;
    assert.equal(reused.status, 'failed');
    assert.equal(reused.error?.code, 'evidence_binding_invalid');
    assert.equal(f.store.getCurrent('author')!.jobId, first.id);
  } finally {
    await f.cleanup();
  }
});

test('identical live requests merge only before the real platform read starts', async () => {
  const f = fixture();
  const started = deferred();
  const release = deferred();
  let calls = 0;
  const run = async (context: JobContext) => {
    calls += 1;
    context.beforePlatformRead();
    started.resolve();
    await release.promise;
    return [context.saveEvidence('works', { works: [] })];
  };
  try {
    const request = { accountId: 'author', operation: 'refresh', datasets: ['works'], run };
    const first = f.queue.enqueueRead(request);
    const merged = f.queue.enqueueRead(request);
    assert.equal(first.jobId, merged.jobId);
    await started.promise;
    const later = f.queue.enqueueRead(request);
    assert.notEqual(later.jobId, first.jobId);
    assert.equal(f.store.getJob(later.jobId)?.status, 'queued');
    release.resolve();
    assert.equal((await first.completion).status, 'succeeded');
    assert.equal((await later.completion).status, 'succeeded');
    assert.equal(calls, 2);
  } finally {
    release.resolve();
    await f.cleanup();
  }
});
