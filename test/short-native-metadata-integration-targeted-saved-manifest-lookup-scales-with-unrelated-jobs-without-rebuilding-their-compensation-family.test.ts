import test from 'node:test';

import { syntheticCompensationFixture } from './helpers/short-native-metadata-integration-synthetic-compensation-fixture.js';

import { validateNativeShortCompensationContext } from '../src/platform/short-native-metadata-proof.js';

import { JobQueue } from '../src/runtime/jobs.js';

import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.js';

import path from 'node:path';

import { writeFileSync, rmSync, readFileSync } from 'node:fs';

import { ACCOUNT, noPrivate } from './helpers/short-native-metadata-integration-snapshot.js';

import { Store, RuntimeError, canonicalJson } from '../src/runtime/store.js';

import { createApplication } from '../src/application.js';

import { DatabaseSync } from 'node:sqlite';

// Count real production selectors rather than timing the machine or replacing
// validation. Every wrapper delegates to the original Store method.
test('targeted saved manifest lookup scales with unrelated jobs without rebuilding their compensation family', async () => {
  const f = await syntheticCompensationFixture(true);
  const context = await f.fresh(),
    checked = validateNativeShortCompensationContext(context);
  f.store.reconcileWriteJob(f.originalId, context.readJob.id, {
    status: checked.status,
    result: checked.result,
  });
  const seed = async (queue: JobQueue, count: number, offset = 0) => {
    const ids: string[] = [];
    for (let index = 0; index < count; index++) {
      const handle = queue.enqueueRead({
        accountId: 'owner',
        operation: 'get_chapter_body',
        scope: `unrelated_legacy.${offset + index}`,
        datasets: ['chapter_body'],
        run: async (ctx) => {
          ctx.beforePlatformRead();
          return [
            ctx.saveEvidence('chapter_body', { body: 'Authorized legacy body', status: 'success' }),
          ];
        },
      });
      assert.equal((await handle.completion).status, 'succeeded');
      ids.push(handle.jobId);
    }
    return ids;
  };
  const [legacyId] = await seed(f.queue, 1);
  await f.queue.drainAndStop();
  f.store.close();
  const config = loadConfig({
    FANQIE_TOKEN: 'targeted-manifest-count-synthetic-token',
    FANQIE_ENABLE_WRITES: 'false',
    FANQIE_DATA_DIR: f.directory,
    FANQIE_PROFILE_DIR: path.join(f.directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(f.directory, 'runtime'),
  });
  writeFileSync(
    path.join(f.directory, 'account-binding.json'),
    JSON.stringify({ accountId: 'owner', platformId: ACCOUNT, platformIdType: 'account' }),
  );
  const original = {
    history: Store.prototype.history,
    manifest: Store.prototype.getManifestForJob,
    compensation: Store.prototype.getNativeCompensationContext,
    job: Store.prototype.getJob,
  };
  let counts = { history: 0, manifests: 0, compensation: 0, admin: 0 },
    lookups: [string, string][] = [];
  Store.prototype.history = function (...args) {
    counts.history++;
    return original.history.apply(this, args);
  };
  Store.prototype.getManifestForJob = function (...args) {
    counts.manifests++;
    lookups.push(args);
    return original.manifest.apply(this, args);
  };
  Store.prototype.getNativeCompensationContext = function (...args) {
    counts.compensation++;
    return original.compensation.apply(this, args);
  };
  Store.prototype.getJob = function (...args) {
    if (args[0] === f.registration.id) counts.admin++;
    return original.job.apply(this, args);
  };
  let app: ReturnType<typeof createApplication> | null = null;
  const reset = () => {
    counts = { history: 0, manifests: 0, compensation: 0, admin: 0 };
    lookups = [];
  };
  try {
    app = createApplication(config);
    reset();
    const legacy = (await app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_get_job',
      new URLSearchParams(),
      { jobId: legacyId },
    )) as any;
    assert.equal(legacy.data[0].body, 'Authorized legacy body');
    assert.deepEqual(counts, { history: 0, manifests: 1, compensation: 0, admin: 0 });
    assert.deepEqual(lookups, [['owner', legacyId]]);
    noPrivate(legacy);
    reset();
    const baseline = (await app.dispatch(
        'GET',
        '/api/v1/jobs',
        new URLSearchParams(),
        undefined,
      )) as any,
      before = { ...counts };
    assert.equal(before.history, 0);
    assert.equal(before.manifests, baseline.jobs.length);
    assert(before.compensation > 0);
    assert(before.admin > 0);
    noPrivate(baseline);
    for (const id of [
      f.originalId,
      context.readJob.id,
      (f.source.original.job.result as any).reconciliationJobId,
    ]) {
      const saved = (await app.dispatch(
        'POST',
        '/api/v1/tools/fanqie_get_job',
        new URLSearchParams(),
        { jobId: id },
      )) as any;
      assert.equal(saved.job.projectionStatus, 'validated');
      noPrivate(saved);
    }
    const admin = (await app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_get_job',
      new URLSearchParams(),
      { jobId: f.registration.id },
    )) as any;
    assert.equal(admin.data[0].status, 'capability_unavailable');
    noPrivate(admin);
    for (const [route, params] of [
      ['/api/v1/snapshot', { scope: 'reconciliation' }],
      ['/api/v1/history', { scope: 'reconciliation' }],
      ['/api/v1/history', {}],
    ] as const)
      noPrivate(await app.dispatch('GET', route, new URLSearchParams(params), undefined));
    await app.close();
    app = null;
    const moreStore = new Store(f.storage),
      moreQueue = new JobQueue(moreStore);
    try {
      await seed(moreQueue, 12, 1);
    } finally {
      await moreQueue.drainAndStop();
      moreStore.close();
    }
    app = createApplication(config);
    reset();
    const extended = (await app.dispatch(
      'GET',
      '/api/v1/jobs',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(extended.jobs.length, baseline.jobs.length + 12);
    assert.equal(counts.history, 0);
    assert.equal(counts.manifests, before.manifests + 12);
    assert.equal(counts.compensation, before.compensation);
    assert.equal(counts.admin, before.admin);
    for (const job of baseline.jobs)
      assert.deepEqual(
        extended.jobs.find((item: any) => item.id === job.id),
        job,
      );
    assert(lookups.every(([account]) => account === 'owner'));
    noPrivate(extended);
  } finally {
    if (app) await app.close();
    Store.prototype.history = original.history;
    Store.prototype.getManifestForJob = original.manifest;
    Store.prototype.getNativeCompensationContext = original.compensation;
    Store.prototype.getJob = original.job;
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test('targeted public saved lookups still reject selected administrative and first current ref tampering on the next request', async (t) => {
  const f = await syntheticCompensationFixture(true),
    context = await f.fresh(),
    checked = validateNativeShortCompensationContext(context);
  f.store.reconcileWriteJob(f.originalId, context.readJob.id, {
    status: checked.status,
    result: checked.result,
  });
  await f.queue.drainAndStop();
  f.store.close();
  const config = loadConfig({
    FANQIE_TOKEN: 'targeted-manifest-tamper-synthetic-token',
    FANQIE_ENABLE_WRITES: 'false',
    FANQIE_DATA_DIR: f.directory,
    FANQIE_PROFILE_DIR: path.join(f.directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(f.directory, 'runtime'),
  });
  writeFileSync(
    path.join(f.directory, 'account-binding.json'),
    JSON.stringify({ accountId: 'owner', platformId: ACCOUNT, platformIdType: 'account' }),
  );
  const app = createApplication(config),
    db = new DatabaseSync(f.storage.databasePath);
  const manifestRow = db
    .prepare('SELECT id, manifest_json FROM manifests WHERE job_id=?')
    .get(f.registration.id)!;
  const rows = db
    .prepare(
      'SELECT id, result_json FROM write_reconciliations WHERE original_job_id=? ORDER BY rowid',
    )
    .all(f.originalId);
  const file = path.join(f.storage.evidenceDirectory, context.source.original.refs[0]!.path),
    bytes = readFileSync(file);
  const saved = async () => {
    const output = (await app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_get_job',
      new URLSearchParams(),
      { jobId: f.originalId },
    )) as any;
    assert.equal(output.job.projectionStatus, 'validated');
    noPrivate(output);
  };
  const unavailable = (error: unknown) => {
    assert(error instanceof RuntimeError);
    assert.equal(error.code, 'capability_unavailable');
    noPrivate({ code: error.code, message: error.message, details: error.details });
    return true;
  };
  try {
    await saved();
    for (const mutation of ['administrative manifest', 'first row', 'current row', 'evidence file'])
      await t.test(mutation, async () => {
        if (mutation === 'administrative manifest') {
          const wire = JSON.parse(String(manifestRow.manifest_json));
          wire.committedAt = '2000-01-01T00:00:00.000Z';
          db.prepare('UPDATE manifests SET manifest_json=? WHERE id=?').run(
            canonicalJson(wire),
            String(manifestRow.id),
          );
        }
        if (mutation === 'first row' || mutation === 'current row')
          db.prepare('UPDATE write_reconciliations SET result_json=? WHERE id=?').run(
            '{}',
            String((mutation === 'first row' ? rows[0] : rows.at(-1))!.id),
          );
        if (mutation === 'evidence file') writeFileSync(file, 'PRIVATE_HTML');
        try {
          for (const id of [f.originalId, f.registration.id])
            await assert.rejects(
              app.dispatch('POST', '/api/v1/tools/fanqie_get_job', new URLSearchParams(), {
                jobId: id,
              }),
              unavailable,
            );
          const read = (await app.dispatch(
            'POST',
            '/api/v1/tools/fanqie_get_job',
            new URLSearchParams(),
            { jobId: context.readJob.id },
          )) as any;
          assert.equal(read.job.projectionStatus, 'capability_unavailable');
          assert.equal(read.data[0].status, 'capability_unavailable');
          assert.deepEqual(read.evidence, []);
          noPrivate(read);
          await assert.rejects(
            app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined),
            unavailable,
          );
          await assert.rejects(
            app.dispatch('GET', '/api/v1/history', new URLSearchParams(), undefined),
            unavailable,
          );
        } finally {
          db.prepare('UPDATE manifests SET manifest_json=? WHERE id=?').run(
            String(manifestRow.manifest_json),
            String(manifestRow.id),
          );
          for (const row of rows)
            db.prepare('UPDATE write_reconciliations SET result_json=? WHERE id=?').run(
              String(row.result_json),
              String(row.id),
            );
          writeFileSync(file, bytes);
        }
        await saved();
      });
  } finally {
    db.close();
    await app.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
