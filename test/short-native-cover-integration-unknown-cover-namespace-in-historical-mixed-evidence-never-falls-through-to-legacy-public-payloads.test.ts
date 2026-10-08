import test from 'node:test';

import { mkdtempSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { loadConfig } from '../src/config.js';

import { Store } from '../src/runtime/store.js';

import { JobQueue } from '../src/runtime/jobs.js';

import { createApplication } from '../src/application.js';

import { BrowserSession } from '../src/platform/browser.js';

import {
  noPrivate,
  ACCOUNT,
  WORK,
  privateAfter,
  edit,
  afterEdit,
} from './helpers/short-native-cover-integration-jpeg.js';

import { fixture } from './helpers/short-native-cover-integration-fixture.js';

import {
  validateNativeShortCoverBusinessInput,
  NATIVE_SHORT_COVER_OPERATION,
  nativeShortCoverScope,
  nativeShortCoverBusinessInputHash,
} from '../src/platform/short-native-cover-proof.js';

import assert from 'node:assert/strict';

import {
  nativeShortCoverEvidenceView,
  reconcileNativeShortCoverWrite,
  runNativeShortCoverJob,
} from '../src/platform/short-native-cover-runtime.js';

import { DatabaseSync } from 'node:sqlite';

test('unknown cover namespace in historical mixed evidence never falls through to legacy public payloads', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'native-cover-reserved-synthetic-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'synthetic-cover-reserved-token',
    FANQIE_ENABLE_WRITES: 'false',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  const seed = new Store({
    databasePath: path.join(config.dataDir, 'operations.sqlite'),
    evidenceDirectory: path.join(config.dataDir, 'evidence'),
    evidenceMode: 'fixture',
  });
  const queue = new JobQueue(seed);
  const handle = queue.enqueueRead({
    accountId: config.accountId,
    operation: 'legacy_read',
    scope: 'legacy_scope',
    datasets: ['legacy'],
    run: async (ctx) => {
      ctx.beforePlatformRead();
      return [
        ctx.saveEvidence('legacy', {
          body: 'PRIVATE_HTML',
          nested: {
            schema: 'native-short-cover-unknown/v99',
            picUri: 'PRIVATE_NEW_URI',
            uploadPath: 'PRIVATE_UPLOAD_PATH',
          },
        }),
      ];
    },
  });
  const job = await handle.completion;
  await queue.drainAndStop();
  seed.close();
  const app = createApplication(config, {
    browser: new BrowserSession({ profileDir: config.profileDir, headless: true }),
  });
  try {
    for (const name of ['get_job', 'cancel_job'])
      noPrivate(
        await app.dispatch('POST', '/api/v1/tools/fanqie_' + name, new URLSearchParams(), {
          jobId: job.id,
        }),
      );
    noPrivate(await app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined));
    noPrivate(
      await app.dispatch(
        'GET',
        '/api/v1/snapshot',
        new URLSearchParams({ scope: 'legacy_scope' }),
        undefined,
      ),
    );
    noPrivate(
      await app.dispatch(
        'GET',
        '/api/v1/history',
        new URLSearchParams({ scope: 'legacy_scope' }),
        undefined,
      ),
    );
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('synthetic live-labelled Store transactions replay two adjacent closures across restart and saved reconciliation performs zero reads', async () => {
  // This is a structural Store acceptance fixture. Its local synthetic client is
  // labelled live solely to exercise the settlement gate; it is not platform
  // evidence and does not change createApplication nativeProvenance or capability.
  const f = fixture(true, 'save-ack-lost');
  await f.app.close();
  const storeOptions = {
    databasePath: path.join(f.config.dataDir, 'operations.sqlite'),
    evidenceDirectory: path.join(f.config.dataDir, 'evidence'),
    evidenceMode: 'live' as const,
  };
  let store = new Store(storeOptions),
    queue = new JobQueue(store);
  const external = f.request(),
    { idempotencyKey: key, metadata, ...version } = external;
  const business = validateNativeShortCoverBusinessInput({ ...version, cover: metadata.cover });
  const provenance = { mode: 'live' as const, executor: 'application-default-browser/v1' as const };
  const completed = (job: ReturnType<Store['getJob']>) => {
    assert(job);
    const manifest = store.getManifestForJob(f.config.accountId, job.id),
      refs = store.listEvidence(job.id);
    const view = nativeShortCoverEvidenceView(
      store,
      f.config.accountId,
      job,
      manifest,
      refs,
      refs.map((ref) => store.readEvidence(ref)),
    );
    assert.equal(view.valid, true);
    return { job: view.safeJob, data: view.data, evidence: view.evidence } as any;
  };
  const reconcile = (jobId: string) =>
    reconcileNativeShortCoverWrite(
      store,
      queue,
      f.browser,
      f.config.accountId,
      store.getJob(jobId)!,
      {
        timeoutMs: f.config.timeoutMs,
        provenance,
        currentPlatformAccount: () => ACCOUNT,
        onVerifiedAccount() {},
        completed,
      },
    ) as Promise<any>;
  try {
    const handle = queue.enqueueWrite({
      accountId: f.config.accountId,
      operation: NATIVE_SHORT_COVER_OPERATION,
      scope: nativeShortCoverScope(WORK),
      idempotencyKey: key,
      inputHash: nativeShortCoverBusinessInputHash(business),
      run: (ctx) =>
        runNativeShortCoverJob(store, f.browser, ctx, business, {
          uploadDir: f.config.uploadDir,
          timeoutMs: f.config.timeoutMs,
          expectedPlatformAccount: ACCOUNT,
          provenance,
          currentPlatformAccount: () => ACCOUNT,
          onVerifiedAccount() {},
        }),
    });
    const original = await handle.completion;
    assert.equal(original.status, 'uncertain');
    assert.equal(f.writes, 2);
    noPrivate(completed(original));
    privateAfter(f.config, original.id);
    f.setCurrent(edit());
    const first = await reconcile(original.id);
    noPrivate(first);
    assert.equal(first.original.job.status, 'uncertain');
    assert.equal(first.original.data[0].reason, 'outcome_unknown');
    const firstReadId = first.reconciliation.job.id;
    f.setCurrent(afterEdit());
    const second = await reconcile(original.id);
    noPrivate(second);
    assert.equal(second.original.job.status, 'succeeded');
    assert.equal(second.original.data[0].reason, 'saved_by_later_read');
    assert.equal(second.original.data[0].originalSaveAcknowledged, false);
    assert.equal(second.original.data[0].originalSaveDurableAcknowledged, false);
    assert.equal(second.original.data[0].assetOutcome, 'bound_verified');
    assert.equal(f.writes, 2);
    assert.notEqual(firstReadId, second.reconciliation.job.id);
    const db = new DatabaseSync(storeOptions.databasePath);
    try {
      assert.equal(
        db
          .prepare('SELECT COUNT(*) n FROM write_reconciliations WHERE original_job_id=?')
          .get(original.id)!.n,
        2,
      );
    } finally {
      db.close();
    }
    const historical = completed(store.getJob(firstReadId));
    noPrivate(historical);
    assert.equal(historical.data[0].reason, 'outcome_unknown');
    await queue.drainAndStop();
    store.close();
    store = new Store(storeOptions);
    queue = new JobQueue(store);
    const restored = completed(store.getJob(original.id));
    noPrivate(restored);
    assert.deepEqual(restored, second.original);
    noPrivate(completed(store.getJob(firstReadId)));
    const before = [f.reads, f.writes, f.coverCalls, f.imagePreparations];
    for (let i = 0; i < 2; i++) {
      const saved = await reconcile(original.id);
      noPrivate(saved);
      assert.deepEqual(saved.original, restored);
      assert.equal(saved.settlement.status, 'saved');
    }
    assert.deepEqual([f.reads, f.writes, f.coverCalls, f.imagePreparations], before);
  } finally {
    await queue.drainAndStop();
    store.close();
    await f.close();
  }
});
