import test from 'node:test';

import {
  result,
  snapshot,
  context,
  noPrivate,
  WORK,
  SCOPE,
  fixture,
} from './helpers/short-native-metadata-integration-snapshot.js';

import assert from 'node:assert/strict';

import {
  validateNativeShortApiResult,
  copyNativeShortJson,
  projectNativeShortEvidence,
  validateNativeShortEvidenceContext,
  NATIVE_SHORT_READ_OPERATION,
  hasReservedNativeShortSignal,
} from '../src/platform/short-native-metadata-proof.js';

import { createNativeShortMetadataSnapshot } from '../src/platform/short-native-metadata.js';

import { mkdtempSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { loadConfig } from '../src/config.js';

import { Store } from '../src/runtime/store.js';

import { JobQueue } from '../src/runtime/jobs.js';

import { DatabaseSync } from 'node:sqlite';

import { BrowserSession } from '../src/platform/browser.js';

import { createApplication } from '../src/application.js';

test('ordinary JSON whole-result gate rejects accessors/symbols/prototypes/cycles/resources before touching getters', async (t) => {
  let reads = 0;
  const accessor = result() as any;
  Object.defineProperty(accessor, 'snapshot', {
    enumerable: true,
    get() {
      reads++;
      return snapshot();
    },
  });
  assert.throws(() => validateNativeShortApiResult(accessor));
  assert.equal(reads, 0);
  for (const [name, mutate] of [
    ['symbol', (r: any) => (r[Symbol('private')] = 'value')],
    ['cycle', (r: any) => (r.self = r)],
    ['NaN', (r: any) => (r.cleanup.pendingAtEnd = NaN)],
    ['prototype', (r: any) => Object.setPrototypeOf(r, Date.prototype)],
    ['hole', (r: any) => (r.snapshot.savedFields.multi_title = new Array(2))],
    ['extra-array', (r: any) => (r.snapshot.catalog.private = true)],
    ['undefined', (r: any) => (r.reason = undefined)],
    ['huge', (r: any) => (r.extra = 'x'.repeat(4 * 3 * 1024 * 1024 + 64 * 1024 + 1))],
  ] as const)
    await t.test(name, () => {
      const raw = JSON.parse(JSON.stringify(result()));
      mutate(raw);
      assert.throws(() => validateNativeShortApiResult(raw));
    });
  const large = JSON.parse(JSON.stringify(result()));
  large.snapshot.editData.content = '<p>' + 'a'.repeat(2 * 1024 * 1024) + '</p>';
  large.snapshot = createNativeShortMetadataSnapshot({
    binding: large.snapshot.binding,
    editData: large.snapshot.editData,
    categoryData: large.snapshot.categoryData,
  });
  assert(Buffer.byteLength(JSON.stringify(large)) > 3 * 1024 * 1024);
  assert.equal(validateNativeShortApiResult(large).status, 'success');
  assert.throws(() => copyNativeShortJson({ value: '\ud800' }));
});

test('pure context validates all bindings/ref fields/full snapshot; fixture cannot claim default live provenance', async (t) => {
  const f = await context();
  try {
    const dto = projectNativeShortEvidence(f.payload, f.ctx);
    noPrivate(dto);
    const changes: [string, (c: any, payload: any) => void][] = [
      ['job-kind', (c) => (c.job.kind = 'write')],
      ['operation', (c) => (c.job.operation = 'refresh')],
      ['scope', (c) => (c.job.scope = 'account')],
      ['datasets', (c) => (c.job.datasets = ['other'])],
      ['inputHash', (c) => (c.job.inputHash = '0'.repeat(64))],
      ['parent', (c) => (c.job.target.parentId = WORK)],
      ['account', (c) => (c.ref.accountId = 'other')],
      ['job', (c) => (c.document.jobId = 'other')],
      ['dataset', (c) => (c.document.dataset = 'other')],
      ['ref-sha', (c) => (c.ref.sha256 = '1'.repeat(64))],
      ['ref-path', (c) => (c.ref.path = 'other')],
      ['ref-time', (c) => (c.ref.capturedAt = '2000-01-01T00:00:00.000Z')],
      ['document-time', (c) => (c.document.capturedAt = '2000-01-01T00:00:00.000Z')],
      ['manifest-operation', (c) => (c.manifest.operation = 'refresh')],
      ['multiple-ref', (c) => c.manifest.evidence.push(c.ref)],
      ['manifest-time', (c) => (c.manifest.committedAt = '2000-01-01T00:00:00.000Z')],
      ['ended-at', (c) => (c.job.endedAt = '2000-01-01T00:00:00.000Z')],
      ['local-intent', (c) => (c.document.evidenceKind = 'local-intent')],
      ['write-started', (c) => (c.job.platformWriteStartedAt = c.job.requestedAt)],
      ['source-origin', (_c, p) => (p.source.origin = 'https://other.invalid')],
      ['fixture-as-live', (_c, p) => (p.source.mode = 'live')],
      ['wrong-executor', (_c, p) => (p.provenance.executor = 'application-default-browser/v1')],
      ['category-selection', (_c, p) => (p.result.snapshot.categorySelectionHash = '0'.repeat(64))],
      ['raw-catalog', (_c, p) => (p.result.snapshot.categoryData.unknown_catalog = 'changed')],
    ];
    for (const [name, mutate] of changes)
      await t.test(name, () => {
        const ctx = structuredClone(f.ctx),
          payload = structuredClone(f.payload);
        mutate(ctx, payload);
        assert.throws(() => validateNativeShortEvidenceContext(payload, ctx));
      });
    for (const signal of [
      { operation: NATIVE_SHORT_READ_OPERATION },
      { scope: SCOPE },
      { dataset: 'short_native_metadata_future' },
      { datasets: ['short_native_metadata_baseline'] },
      { schema: 'native-short-metadata-api-read/v1' },
      { schema: 'fanqie-short-native-metadata-reconciliation/v99' },
      { result: { reconciliation: { schema: 'native-short-metadata-future/v1' } } },
    ])
      assert.equal(hasReservedNativeShortSignal(signal), true);
  } finally {
    await f.close();
  }
});

// Historical fixture records are created through the real Store/Queue before
// application acquires the lease. They never access a platform or real profile.
test('every reserved signal fails closed through historical direct/job/REST/snapshot/history; legacy body stays authorized', async (t) => {
  for (const signal of ['operation', 'scope', 'dataset', 'schema-wrapper', 'schema-c1', 'nested'])
    await t.test(signal, async () => {
      const directory = mkdtempSync(path.join(os.tmpdir(), 'native-reserved-history-'));
      const config = loadConfig({
        FANQIE_TOKEN: 'reserved-synthetic-contract-token',
        FANQIE_DATA_DIR: path.join(directory, 'data'),
        FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
        FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
      });
      const storage = {
        databasePath: path.join(config.dataDir, 'operations.sqlite'),
        evidenceDirectory: path.join(config.dataDir, 'evidence'),
        evidenceMode: 'fixture' as const,
      };
      const seed = new Store(storage),
        queue = new JobQueue(seed),
        dataset = signal === 'dataset' ? 'short_native_metadata_future' : 'chapter_body',
        scope = signal === 'scope' ? SCOPE : 'legacy_scope';
      const handle = queue.enqueueRead({
        accountId: 'owner',
        operation: signal === 'operation' ? NATIVE_SHORT_READ_OPERATION : 'legacy_operation',
        scope,
        datasets: [dataset],
        run: async (ctx) => {
          ctx.beforePlatformRead();
          return [
            ctx.saveEvidence(dataset, {
              schema:
                signal === 'schema-wrapper'
                  ? 'fanqie-short-native-metadata-future/v99'
                  : signal === 'schema-c1'
                    ? 'native-short-metadata-api-read/v1'
                    : 'legacy/v1',
              body: 'PRIVATE_HTML',
              ...(signal === 'nested'
                ? {
                    result: {
                      schema: 'native-short-metadata-reconciliation/v2',
                      raw: 'PRIVATE_URI_ONE',
                    },
                  }
                : {}),
            }),
          ];
        },
      });
      const job = await handle.completion;
      // Add raw errors/metadata in this isolated synthetic SQLite to cover unsafe
      // historical rows; production writes remain untouched.
      const db = new DatabaseSync(storage.databasePath);
      db.prepare('UPDATE jobs SET metadata_json=?,error_json=? WHERE id=?').run(
        JSON.stringify({ html: 'PRIVATE_HTML' }),
        JSON.stringify({
          code: 'unsafe_code',
          message: 'PRIVATE_URI_ONE',
          details: { content: 'PRIVATE_HTML' },
        }),
        job.id,
      );
      db.close();
      await queue.drainAndStop();
      seed.close();
      const browser = new BrowserSession({ profileDir: config.profileDir, headless: true }),
        app = createApplication(config, { browser });
      try {
        for (const name of ['get_job', 'cancel_job'])
          noPrivate(
            await app.dispatch('POST', '/api/v1/tools/fanqie_' + name, new URLSearchParams(), {
              jobId: job.id,
            }),
          );
        noPrivate(await app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined));
        noPrivate(
          await app.dispatch('GET', '/api/v1/snapshot', new URLSearchParams({ scope }), undefined),
        );
        noPrivate(
          await app.dispatch('GET', '/api/v1/history', new URLSearchParams({ scope }), undefined),
        );
      } finally {
        await app.close();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  const directory = mkdtempSync(path.join(os.tmpdir(), 'native-legacy-body-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'legacy-body-synthetic-contract-token',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  const seed = new Store({
      databasePath: path.join(config.dataDir, 'operations.sqlite'),
      evidenceDirectory: path.join(config.dataDir, 'evidence'),
    }),
    queue = new JobQueue(seed);
  const handle = queue.enqueueRead({
    accountId: 'owner',
    operation: 'get_chapter_body',
    scope: 'chapter_body.' + WORK,
    datasets: ['chapter_body'],
    run: async (ctx) => {
      ctx.beforePlatformRead();
      return [
        ctx.saveEvidence('chapter_body', { body: 'Authorized legacy body', status: 'success' }),
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
    const output = (await app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_get_job',
      new URLSearchParams(),
      { jobId: job.id },
    )) as any;
    assert.equal(output.data[0].body, 'Authorized legacy body');
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('quarantine denies new native collection and current availability without navigation', async () => {
  const f = fixture();
  try {
    f.quarantine();
    const cap = (await f.app.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(cap.reads[0].available, false);
    assert.equal(cap.reads[0].availabilityStatus, 'unavailable');
    const output = await f.call();
    assert.equal(output.job.status, 'failed');
    assert.equal(f.calls, 0);
    noPrivate(output);
  } finally {
    await f.close();
  }
});

test('intent-only native reserved schema suppresses mixed legacy result/body without ever expanding intent', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'native-intent-only-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'native-intent-synthetic-contract-token',
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
  const handle = queue.enqueueWrite({
    accountId: 'owner',
    operation: 'legacy_write',
    scope: 'reconciliation',
    idempotencyKey: 'intent-only-synthetic-key',
    inputHash: 'a'.repeat(64),
    run: async (ctx) => {
      ctx.saveEvidence('write-intent', {
        schema: 'native-short-metadata-intent/v1',
        version: 'a'.repeat(64),
      });
      ctx.beforePlatformRead();
      ctx.saveEvidence('write-result', { body: 'PRIVATE_HTML', unknown: 'PRIVATE_URI_ONE' });
      return { body: 'PRIVATE_HTML' };
    },
  });
  const job = await handle.completion;
  assert.equal(job.status, 'succeeded');
  await queue.drainAndStop();
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
        { jobId: job.id },
      )) as any;
      noPrivate(output);
      assert.equal(output.job.operation, null);
      assert.equal(output.job.projectionStatus, 'capability_unavailable');
      assert.deepEqual(output.job.datasets, []);
      assert.equal(output.job.result, null);
    }
    noPrivate(await app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined));
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
