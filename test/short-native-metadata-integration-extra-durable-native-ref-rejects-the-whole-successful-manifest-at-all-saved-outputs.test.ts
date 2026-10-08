import test from 'node:test';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { loadConfig } from '../src/config.js';

import { Store } from '../src/runtime/store.js';

import { JobQueue } from '../src/runtime/jobs.js';

import {
  NATIVE_SHORT_READ_OPERATION,
  NATIVE_SHORT_READ_DATASET,
  nativeShortInputHash,
  createNativeShortReadEvidence,
} from '../src/platform/short-native-metadata-proof.js';

import {
  SCOPE,
  WORK,
  result,
  fixtureProvenance,
  noPrivate,
  fixture,
  rewriteSyntheticNativeRecord,
} from './helpers/short-native-metadata-integration-snapshot.js';

import assert from 'node:assert/strict';

import { createApplication } from '../src/application.js';

import { BrowserSession } from '../src/platform/browser.js';

import { createHash } from 'node:crypto';

import { DatabaseSync } from 'node:sqlite';

import { createNativeShortMetadataSnapshot } from '../src/platform/short-native-metadata.js';

test('extra durable native ref rejects the whole successful manifest at all saved outputs', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'native-extra-ref-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'native-extra-ref-synthetic-contract-token',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  const seed = new Store({
      databasePath: path.join(config.dataDir, 'operations.sqlite'),
      evidenceDirectory: path.join(config.dataDir, 'evidence'),
      evidenceMode: 'fixture',
    }),
    queue = new JobQueue(seed);
  const handle = queue.enqueueRead({
    accountId: 'owner',
    operation: NATIVE_SHORT_READ_OPERATION,
    scope: SCOPE,
    datasets: [NATIVE_SHORT_READ_DATASET],
    inputHash: nativeShortInputHash(WORK),
    run: async (ctx) => {
      ctx.beforePlatformRead();
      ctx.recordTarget({ kind: 'short-story', id: WORK });
      const payload = createNativeShortReadEvidence(result(), fixtureProvenance),
        first = ctx.saveEvidence(NATIVE_SHORT_READ_DATASET, payload);
      ctx.saveEvidence(NATIVE_SHORT_READ_DATASET, payload);
      return [first];
    },
  });
  const job = await handle.completion;
  assert.equal(job.status, 'succeeded');
  assert.equal(seed.listEvidence(job.id).length, 2);
  await queue.drainAndStop();
  seed.close();
  const app = createApplication(config, {
    browser: new BrowserSession({ profileDir: config.profileDir, headless: true }),
  });
  try {
    const output = (await app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_get_job',
      new URLSearchParams(),
      { jobId: job.id },
    )) as any;
    assert.equal(output.sourceMode, 'incomplete');
    assert.equal(output.data[0].status, 'capability_unavailable');
    assert.equal(output.job.result, null);
    noPrivate(output);
    const saved = (await app.dispatch(
      'GET',
      '/api/v1/snapshot',
      new URLSearchParams({ scope: SCOPE }),
      undefined,
    )) as any;
    assert.equal(saved.manifest, null);
    noPrivate(saved);
    noPrivate(
      await app.dispatch(
        'GET',
        '/api/v1/history',
        new URLSearchParams({ scope: SCOPE }),
        undefined,
      ),
    );
    const cap = (await app.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(cap.reads[0].verificationStatus, 'not-verified-live');
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('failed evidence persistence returns a fixed safe error and retains prior complete current', async () => {
  const { renameSync } = await import('node:fs');
  const f = fixture();
  try {
    const baseline = await f.call();
    const nativeDirectory = path.join(
      f.config.dataDir,
      'evidence',
      createHash('sha256').update(f.config.accountId).digest('hex').slice(0, 24),
      NATIVE_SHORT_READ_DATASET,
    );
    const backupDirectory = `${nativeDirectory}.backup`;
    renameSync(nativeDirectory, backupDirectory);
    const output = await (async () => {
      try {
        writeFileSync(nativeDirectory, 'synthetic persistence obstruction', { flag: 'wx' });
        return await f.call();
      } finally {
        rmSync(nativeDirectory, { force: true });
        renameSync(backupDirectory, nativeDirectory);
      }
    })();
    assert.equal(output.job.status, 'failed');
    assert.deepEqual(output.evidence, []);
    assert.equal(output.job.error.message, 'Native short metadata is unavailable');
    noPrivate(output);
    const saved = (await f.app.dispatch(
      'GET',
      '/api/v1/snapshot',
      new URLSearchParams({ scope: SCOPE }),
      undefined,
    )) as any;
    assert.equal(saved.manifest.id, baseline.job.result.manifest.id);
    assert.deepEqual(saved.data, baseline.data);
  } finally {
    await f.close();
  }
});

test('historical unknown native restart/uncertain job result/error/metadata are never expanded', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'native-uncertain-historical-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'native-uncertain-synthetic-contract-token',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  const seed = new Store({
    databasePath: path.join(config.dataDir, 'operations.sqlite'),
    evidenceDirectory: path.join(config.dataDir, 'evidence'),
    evidenceMode: 'fixture',
  });
  const queued = seed.createJob({
    accountId: 'owner',
    kind: 'write',
    operation: 'future_native_write',
    scope: 'reconciliation',
    idempotencyKey: 'unknown-native-synthetic-key',
    inputHash: 'a'.repeat(64),
  }).job;
  const db = new DatabaseSync(path.join(config.dataDir, 'operations.sqlite'));
  db.prepare('UPDATE jobs SET status=?,result_json=?,metadata_json=?,error_json=? WHERE id=?').run(
    'uncertain',
    JSON.stringify({
      schema: 'fanqie-short-native-metadata-reconciliation/v99',
      content: 'PRIVATE_HTML',
    }),
    JSON.stringify({ body: 'PRIVATE_TAIL' }),
    JSON.stringify({
      code: 'unknown_raw',
      message: 'PRIVATE_URI_ONE',
      details: { raw: 'PRIVATE_COOKIE' },
    }),
    queued.id,
  );
  db.close();
  seed.close();
  const app = createApplication(config, {
    browser: new BrowserSession({ profileDir: config.profileDir, headless: true }),
  });
  try {
    for (const name of ['get_job', 'cancel_job']) {
      const output = (await app.dispatch(
        'POST',
        '/api/v1/tools/fanqie_' + name,
        new URLSearchParams(),
        { jobId: queued.id },
      )) as any;
      noPrivate(output);
      assert.equal(output.job.status, 'uncertain');
      assert.equal(output.job.operation, null);
      assert.equal(output.job.result, null);
      assert.deepEqual(output.job.metadata, {});
    }
    noPrivate(await app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined));
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('complete native context rejects additional reserved signals before every safe projection', async (t) => {
  const future = 'native-short-metadata-reconciliation/v2';
  const cases: [string, (envelope: any) => void][] = [
    ['metadata-schema', (e) => (e.metadata.schema = future)],
    ['metadata-scope', (e) => (e.metadata.scope = 'short_native_metadata.future')],
    ['metadata-dataset', (e) => (e.metadata.dataset = 'short_native_metadata_future')],
    ['metadata-operation', (e) => (e.metadata.operation = NATIVE_SHORT_READ_OPERATION)],
    ['metadata-fake-raw-exemption', (e) => (e.metadata.editData = { schema: future })],
    ['result-schema', (e) => (e.result.schema = future)],
    [
      'error-schema',
      (e) =>
        (e.error = { code: 'unsafe', message: 'PRIVATE_URI_ONE', details: { schema: future } }),
    ],
    [
      'cancellation-schema',
      (e) =>
        (e.cancellationReason = {
          code: 'unsafe',
          message: 'PRIVATE_URI_ONE',
          details: { schema: future },
        }),
    ],
    ['manifest-schema', (e) => (e.manifest.extra = { schema: future })],
    ['ref-schema', (e) => (e.ref.extra = { schema: future })],
    ['document-schema', (e) => (e.document.schema = future)],
    ['payload-schema', (e) => (e.document.payload.extra = { schema: future })],
  ];
  for (const [name, mutate] of cases)
    await t.test(name, async () => {
      const f = fixture();
      try {
        const positive = await f.call();
        assert.equal(positive.data[0].status, 'success');
        assert.equal(positive.job.projectionStatus, 'validated');
        rewriteSyntheticNativeRecord(f, positive.job.id, mutate);
        for (const tool of ['get_job', 'cancel_job']) {
          const output = (await f.app.dispatch(
            'POST',
            '/api/v1/tools/fanqie_' + tool,
            new URLSearchParams(),
            { jobId: positive.job.id },
          )) as any;
          assert.equal(output.data[0].status, 'capability_unavailable');
          assert.equal(output.job.projectionStatus, 'capability_unavailable');
          assert.equal(output.job.result, null);
          noPrivate(output);
        }
        const listed = (await f.app.dispatch(
          'GET',
          '/api/v1/jobs',
          new URLSearchParams(),
          undefined,
        )) as any;
        assert.equal(listed.jobs[0].projectionStatus, 'capability_unavailable');
        assert.equal(listed.jobs[0].result, null);
        noPrivate(listed);
        const current = (await f.app.dispatch(
          'GET',
          '/api/v1/snapshot',
          new URLSearchParams({ scope: SCOPE }),
          undefined,
        )) as any;
        assert.equal(current.manifest, null);
        assert.equal(current.data[0].status, 'capability_unavailable');
        noPrivate(current);
        const history = (await f.app.dispatch(
          'GET',
          '/api/v1/history',
          new URLSearchParams({ scope: SCOPE }),
          undefined,
        )) as any;
        assert.equal(history.manifests[0].manifest, null);
        assert.equal(history.manifests[0].data[0].status, 'capability_unavailable');
        noPrivate(history);
        const caps = (await f.app.dispatch(
          'GET',
          '/api/v1/capabilities',
          new URLSearchParams(),
          undefined,
        )) as any;
        assert.equal(caps.reads[0].verificationStatus, 'not-verified-live');
        assert.equal(f.calls, 1);
      } finally {
        await f.close();
      }
    });
});

test('raw response unknown JSON is opaque only at the two exact factory-validated paths', async () => {
  const f = fixture();
  try {
    const positive = await f.call();
    rewriteSyntheticNativeRecord(f, positive.job.id, (envelope) => {
      const snapshot = envelope.document.payload.result.snapshot;
      snapshot.editData.opaque = {
        schema: 'native-short-metadata-source-unknown/v99',
        scope: 'short_native_metadata.source',
        dataset: 'short_native_metadata_unknown',
        operation: NATIVE_SHORT_READ_OPERATION,
      };
      snapshot.categoryData.opaque = { schema: 'fanqie-short-native-metadata-source-unknown/v99' };
      envelope.document.payload.result.snapshot = createNativeShortMetadataSnapshot({
        binding: snapshot.binding,
        editData: snapshot.editData,
        categoryData: snapshot.categoryData,
      });
    });
    const saved = (await f.app.dispatch(
      'GET',
      '/api/v1/snapshot',
      new URLSearchParams({ scope: SCOPE }),
      undefined,
    )) as any;
    assert.equal(saved.data[0].status, 'success');
    assert(saved.manifest);
    assert.notEqual(saved.data[0].snapshotVersionHash, positive.data[0].snapshotVersionHash);
    noPrivate(saved);
    assert.equal(JSON.stringify(saved).includes('source-unknown'), false);
  } finally {
    await f.close();
  }
});
