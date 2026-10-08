import test from 'node:test';

import { nativeSaveFixture } from './helpers/short-native-metadata-integration-native-write-snapshot.js';

import path from 'node:path';

import { writeFileSync, readFileSync, rmSync } from 'node:fs';

import {
  ACCOUNT,
  noPrivate,
  fixture,
  WORK,
  result,
} from './helpers/short-native-metadata-integration-snapshot.js';

import { DatabaseSync } from 'node:sqlite';

import { canonicalJson, Store } from '../src/runtime/store.js';

import { createHash } from 'node:crypto';

import { createApplication } from '../src/application.js';

import assert from 'node:assert/strict';

import { JobQueue } from '../src/runtime/jobs.js';

import { syntheticCompensationFixture } from './helpers/short-native-metadata-integration-synthetic-compensation-fixture.js';

import {
  validateNativeShortCompensationContext,
  projectNativeShortCompensationEvidenceContext,
} from '../src/platform/short-native-metadata-proof.js';

import { loadConfig } from '../src/config.js';

import { BrowserSession } from '../src/platform/browser.js';

test('C3 native reconcile bad original or readiness fails before GET and never falls through to editor gate', async (t) => {
  for (const fault of [
    'missing-binding',
    'author-binding',
    'quarantine',
    'future-job-metadata',
    'future-intent-only',
    'wrong-target',
    'missing-intent',
    'invalid-original-error',
  ] as const)
    await t.test(fault, async () => {
      const f = await nativeSaveFixture('acklost');
      if (fault === 'missing-binding') {
        const { unlinkSync } = await import('node:fs');
        unlinkSync(path.join(f.config.dataDir, 'account-binding.json'));
      }
      if (fault === 'author-binding')
        writeFileSync(
          path.join(f.config.dataDir, 'account-binding.json'),
          JSON.stringify({ accountId: 'owner', platformId: ACCOUNT, platformIdType: 'author' }),
        );
      const db = new DatabaseSync(f.storage.databasePath);
      try {
        if (fault === 'future-job-metadata')
          db.prepare('UPDATE jobs SET metadata_json=? WHERE id=?').run(
            JSON.stringify({ nested: { schema: 'native-short-metadata-future/v1' } }),
            f.job.id,
          );
        if (fault === 'wrong-target')
          db.prepare('UPDATE jobs SET target_json=? WHERE id=?').run(
            JSON.stringify({ kind: 'short-story', id: '8000000001' }),
            f.job.id,
          );
        if (fault === 'missing-intent')
          db.prepare("DELETE FROM evidence WHERE job_id=? AND dataset='write-intent'").run(
            f.job.id,
          );
        if (fault === 'invalid-original-error')
          db.prepare('UPDATE jobs SET error_json=? WHERE id=?').run(
            JSON.stringify({ code: 'unknown', message: 'PRIVATE_HTML' }),
            f.job.id,
          );
        if (fault === 'future-intent-only') {
          const ref = f.refs[1]!,
            filename = path.join(f.config.dataDir, 'evidence', ref.path),
            doc = JSON.parse(readFileSync(filename, 'utf8'));
          doc.payload.schema = 'native-short-metadata-future/v1';
          const bytes = canonicalJson(doc) + '\n';
          writeFileSync(filename, bytes);
          db.prepare('UPDATE evidence SET sha256=? WHERE id=?').run(
            createHash('sha256').update(bytes).digest('hex'),
            ref.id,
          );
        }
      } finally {
        db.close();
      }
      const browser = f.createBrowser();
      if (fault === 'quarantine')
        Object.defineProperty(browser, 'hasUnsafeApiCleanup', { get: () => true });
      const app = createApplication(f.config, { browser });
      try {
        await assert.rejects(
          app.dispatch('POST', '/api/v1/tools/fanqie_reconcile_write', new URLSearchParams(), {
            jobId: f.job.id,
          }),
          (error: any) =>
            error.code === 'capability_unavailable' && !JSON.stringify(error).includes('PRIVATE'),
        );
        assert.equal(f.getCount, 5);
        assert.equal(f.postCount, 1);
        const viewed = await app.dispatch(
          'POST',
          '/api/v1/tools/fanqie_get_job',
          new URLSearchParams(),
          { jobId: f.job.id },
        );
        noPrivate(viewed);
      } finally {
        await app.close();
        await f.close();
      }
    });
});

test('C3 legacy reconcile still needs editor writes while native late read works without enabling writes', async () => {
  const f = fixture(),
    storage = {
      databasePath: path.join(f.config.dataDir, 'operations.sqlite'),
      evidenceDirectory: path.join(f.config.dataDir, 'evidence'),
      evidenceMode: 'fixture' as const,
    };
  await f.app.close();
  const store = new Store(storage),
    queue = new JobQueue(store);
  const handle = queue.enqueueWrite({
    accountId: 'owner',
    operation: 'update_draft',
    idempotencyKey: 'legacy-unknown-reconcile-gate',
    inputHash: 'a'.repeat(64),
    run: async (ctx) => {
      ctx.beforePlatformRead();
      ctx.saveEvidence('write-intent', {
        desiredContentHash: 'b'.repeat(64),
        expectedStates: ['draft_saved'],
      });
      ctx.recordTarget({ kind: 'short-story', id: WORK });
      ctx.beforePlatformWrite();
      throw Error('Synthetic legacy lost ACK');
    },
  });
  const unknown = await handle.completion;
  await queue.drainAndStop();
  store.close();
  const app = createApplication(f.config, { browser: f.browser });
  try {
    await assert.rejects(
      app.dispatch('POST', '/api/v1/tools/fanqie_reconcile_write', new URLSearchParams(), {
        jobId: unknown.id,
      }),
      { code: 'writes_disabled' },
    );
    assert.equal(f.calls, 0);
  } finally {
    await app.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test('server revision compensation real Store registration and fresh read settle terminal without changing the original v1 acceptance', async (t) => {
  for (const history of [true, false])
    await t.test(`history=${history}`, async () => {
      const f = await syntheticCompensationFixture(history);
      try {
        const context = await f.fresh(),
          checked = validateNativeShortCompensationContext(context);
        assert.equal(checked.status, 'failed');
        assert.equal(checked.result.originalAcceptance, 'not_verified');
        const settled = f.store.reconcileWriteJob(f.originalId, context.readJob.id, {
          status: checked.status,
          result: checked.result,
        });
        assert.equal(settled.status, 'failed');
        assert.equal(settled.error?.code, 'native_write_compensated');
        const source = f.store.getNativeCompensationContext(f.originalId)!;
        const projection = projectNativeShortCompensationEvidenceContext(
          source,
          source.history.current!.read,
        );
        assert.equal(projection.validated, true);
        noPrivate(projection);
        assert.equal(f.store.getJob(f.originalId)?.status, 'failed');
      } finally {
        await f.close();
      }
    });
});

test('compensation uses a new default-browser API read with writes disabled and all saved outlets remain strict', async () => {
  const f = await syntheticCompensationFixture(true);
  await f.queue.drainAndStop();
  f.store.close();
  const config = loadConfig({
    FANQIE_TOKEN: 'compensation-public-synthetic-token',
    FANQIE_ENABLE_WRITES: 'false',
    FANQIE_DATA_DIR: f.directory,
    FANQIE_PROFILE_DIR: path.join(f.directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(f.directory, 'runtime'),
  });
  writeFileSync(
    path.join(f.directory, 'account-binding.json'),
    JSON.stringify({ accountId: 'owner', platformId: ACCOUNT, platformIdType: 'account' }),
  );
  const original = BrowserSession.prototype.runNativeShortMetadata;
  let calls = 0;
  BrowserSession.prototype.runNativeShortMetadata = async function (workId, options) {
    calls++;
    assert.equal(workId, WORK);
    options.assertLease();
    options.onBeforePlatformRead();
    const raw = { ...result(), snapshot: f.restored };
    options.onVerifiedAccount(ACCOUNT, raw.proof.proofCapturedAt!);
    options.assertLease();
    return raw;
  };
  let app = createApplication(config);
  try {
    const read = (await app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_reconcile_write',
      new URLSearchParams(),
      { jobId: f.originalId },
    )) as any;
    assert.equal(calls, 1);
    assert.equal(read.original.job.status, 'failed');
    assert.equal(read.original.job.projectionStatus, 'validated');
    assert.equal(read.original.data[0].terminalState, 'compensated');
    noPrivate(read);
    const before = calls;
    const repeat = (await app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_reconcile_write',
      new URLSearchParams(),
      { jobId: f.originalId },
    )) as any;
    assert.equal(repeat.settlement.status, 'saved');
    assert.equal(calls, before);
    noPrivate(repeat);
    const priorId = (f.source.original.job.result as any).reconciliationJobId;
    const jobIds = [f.originalId, read.reconciliation.job.id, priorId];
    for (const id of jobIds) {
      const saved = (await app.dispatch(
        'POST',
        '/api/v1/tools/fanqie_get_job',
        new URLSearchParams(),
        { jobId: id },
      )) as any;
      assert.equal(saved.job.projectionStatus, 'validated');
      noPrivate(saved);
    }
    for (const [route, params] of [
      ['/api/v1/jobs', {}],
      ['/api/v1/snapshot', { scope: 'reconciliation' }],
      ['/api/v1/history', { scope: 'reconciliation' }],
      ['/api/v1/history', {}],
      ['/api/v1/status', {}],
    ] as const)
      noPrivate(await app.dispatch('GET', route, new URLSearchParams(params), undefined));
    const cap = (await app.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(cap.writesEnabled, false);
    assert.notEqual(cap.writes.nativeShortMetadata.verificationStatus, 'verified-live');
    await app.close();
    app = createApplication(config);
    const restart = (await app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_get_job',
      new URLSearchParams(),
      { jobId: f.originalId },
    )) as any;
    assert.equal(restart.job.projectionStatus, 'validated');
    assert.equal(calls, before);
    noPrivate(restart);
  } finally {
    await app.close();
    BrowserSession.prototype.runNativeShortMetadata = original;
    rmSync(f.directory, { recursive: true, force: true });
  }
});
