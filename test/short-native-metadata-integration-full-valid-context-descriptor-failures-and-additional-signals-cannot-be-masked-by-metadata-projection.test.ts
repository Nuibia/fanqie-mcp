import test from 'node:test';

import {
  context,
  WORK,
  SCOPE,
  result,
  fixtureProvenance,
  noPrivate,
  PRIVATE,
  ACCOUNT,
} from './helpers/short-native-metadata-integration-snapshot.js';

import assert from 'node:assert/strict';

import {
  projectNativeShortEvidence,
  validateNativeShortEvidenceContext,
  NATIVE_SHORT_READ_OPERATION,
  NATIVE_SHORT_READ_DATASET,
  nativeShortInputHash,
  createNativeShortReadEvidence,
  NATIVE_SHORT_BASELINE_DATASET,
  NATIVE_SHORT_AFTER_DATASET,
  projectNativeShortWriteEvidence,
} from '../src/platform/short-native-metadata-proof.js';

import { mkdtempSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { loadConfig } from '../src/config.js';

import { Store, canonicalJson } from '../src/runtime/store.js';

import { JobQueue } from '../src/runtime/jobs.js';

import { createApplication } from '../src/application.js';

import { BrowserSession } from '../src/platform/browser.js';

import { nativeSaveFixture } from './helpers/short-native-metadata-integration-native-write-snapshot.js';

test('full valid context descriptor failures and additional signals cannot be masked by metadata projection', async (t) => {
  const f = await context();
  try {
    assert.equal(projectNativeShortEvidence(f.payload, f.ctx).status, 'success');
    const cases: [string, (ctx: any) => void][] = [
      ['job-extra', (c) => (c.job.extra = { schema: 'native-short-metadata-future/v2' })],
      [
        'result-manifest-extra',
        (c) => {
          c.manifest.extra = { schema: 'native-short-metadata-future/v2' };
          c.job.result.manifest.extra = c.manifest.extra;
        },
      ],
      [
        'ref-extra-consistent',
        (c) => {
          c.ref.extra = { schema: 'native-short-metadata-future/v2' };
          c.manifest.evidence[0].extra = c.ref.extra;
          c.job.result.manifest.evidence[0].extra = c.ref.extra;
        },
      ],
      [
        'job-error',
        (c) =>
          (c.job.error = {
            code: 'unknown',
            message: 'PRIVATE_HTML',
            details: { schema: 'native-short-metadata-future/v2' },
          }),
      ],
      ['document-extra', (c) => (c.document.extra = { schema: 'native-short-metadata-future/v2' })],
    ];
    for (const [name, mutate] of cases)
      await t.test(name, () => {
        const ctx = structuredClone(f.ctx);
        mutate(ctx);
        assert.throws(() => validateNativeShortEvidenceContext(ctx.document.payload, ctx));
      });
    let getterReads = 0;
    const ctx = structuredClone(f.ctx);
    Object.defineProperty(ctx.job!.metadata, 'schema', {
      enumerable: true,
      get() {
        getterReads++;
        return 'native-short-metadata-future/v2';
      },
    });
    assert.throws(() => validateNativeShortEvidenceContext(ctx.document.payload, ctx));
    assert.equal(getterReads, 0);
    const docCtx = structuredClone(f.ctx);
    Object.defineProperty(docCtx.document, 'payload', {
      enumerable: true,
      get() {
        getterReads++;
        return f.payload;
      },
    });
    assert.throws(() => validateNativeShortEvidenceContext(f.payload, docCtx));
    assert.equal(getterReads, 0);
    const outerCtx = structuredClone(f.ctx);
    Object.defineProperty(outerCtx, 'document', {
      enumerable: true,
      get() {
        getterReads++;
        return f.ctx.document;
      },
    });
    assert.throws(() => validateNativeShortEvidenceContext(f.payload, outerCtx));
    assert.equal(getterReads, 0);
  } finally {
    await f.close();
  }
});

test('legacy missing observation preserves per-job list availability; native missing stays safe and get_job remains strict', async () => {
  const { unlinkSync } = await import('node:fs');
  const directory = mkdtempSync(path.join(os.tmpdir(), 'native-missing-list-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'native-missing-list-synthetic-token',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  const storage = {
      databasePath: path.join(config.dataDir, 'operations.sqlite'),
      evidenceDirectory: path.join(config.dataDir, 'evidence'),
      evidenceMode: 'fixture' as const,
    },
    seed = new Store(storage),
    queue = new JobQueue(seed);
  const legacyHandle = queue.enqueueRead({
    accountId: 'owner',
    operation: 'get_chapter_body',
    scope: 'chapter_body.' + WORK,
    datasets: ['chapter_body'],
    run: async (ctx) => {
      ctx.beforePlatformRead();
      return [ctx.saveEvidence('chapter_body', { body: 'Authorized legacy body' })];
    },
  });
  const nativeHandle = queue.enqueueRead({
    accountId: 'owner',
    operation: NATIVE_SHORT_READ_OPERATION,
    scope: SCOPE,
    datasets: [NATIVE_SHORT_READ_DATASET],
    inputHash: nativeShortInputHash(WORK),
    run: async (ctx) => {
      ctx.beforePlatformRead();
      ctx.recordTarget({ kind: 'short-story', id: WORK });
      return [
        ctx.saveEvidence(
          NATIVE_SHORT_READ_DATASET,
          createNativeShortReadEvidence(result(), fixtureProvenance),
        ),
      ];
    },
  });
  const legacy = await legacyHandle.completion,
    native = await nativeHandle.completion,
    legacyRef = seed.listEvidence(legacy.id)[0]!,
    nativeRef = seed.listEvidence(native.id)[0]!;
  await queue.drainAndStop();
  seed.close();
  const app = createApplication(config, {
    browser: new BrowserSession({ profileDir: config.profileDir, headless: true }),
  });
  try {
    const healthy = (await app.dispatch(
      'GET',
      '/api/v1/jobs',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(healthy.jobs.length, 2);
    assert.equal(
      healthy.jobs.find((job: any) => job.id === native.id).projectionStatus,
      'validated',
    );
    unlinkSync(path.join(config.dataDir, 'evidence', legacyRef.path));
    const legacyMissing = (await app.dispatch(
      'GET',
      '/api/v1/jobs',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(legacyMissing.jobs.length, 2);
    assert.deepEqual(
      legacyMissing.jobs.find((job: any) => job.id === legacy.id),
      healthy.jobs.find((job: any) => job.id === legacy.id),
    );
    await assert.rejects(
      app.dispatch('POST', '/api/v1/tools/fanqie_get_job', new URLSearchParams(), {
        jobId: legacy.id,
      }),
      { code: 'evidence_missing' },
    );
    await assert.rejects(
      app.dispatch(
        'GET',
        '/api/v1/snapshot',
        new URLSearchParams({ scope: 'chapter_body.' + WORK }),
        undefined,
      ),
      { code: 'evidence_missing' },
    );
    unlinkSync(path.join(config.dataDir, 'evidence', nativeRef.path));
    const nativeMissing = (await app.dispatch(
      'GET',
      '/api/v1/jobs',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(nativeMissing.jobs.length, 2);
    const safelyMissing = nativeMissing.jobs.find((job: any) => job.id === native.id);
    assert.equal(safelyMissing.projectionStatus, 'capability_unavailable');
    assert.equal(safelyMissing.result, null);
    noPrivate(nativeMissing);
    const viewed = (await app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_get_job',
      new URLSearchParams(),
      { jobId: native.id },
    )) as any;
    assert.equal(viewed.data[0].status, 'capability_unavailable');
    noPrivate(viewed);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('C3 production save helper persists native before/intent/target/mark before one POST and clean after', async () => {
  const f = await nativeSaveFixture();
  try {
    assert.equal(
      f.job.status,
      'succeeded',
      JSON.stringify({
        post: f.postCount,
        get: f.getCount,
        owner: f.ownerCount,
        refs: f.refs.map((ref) => ref.dataset),
      }),
    );
    assert.equal(f.postCount, 1);
    assert.equal(f.getCount, 10);
    assert.equal(f.ownerCount, 1);
    assert.equal(f.postDurability, true);
    assert.deepEqual(
      f.refs.map((ref) => ref.dataset),
      [NATIVE_SHORT_BASELINE_DATASET, 'write-intent', NATIVE_SHORT_AFTER_DATASET, 'write-result'],
    );
    const intent = f.documents[1]!.payload as any;
    assert(Buffer.byteLength(canonicalJson(intent)) <= 16384);
    assert.equal('title' in intent, false);
    assert.equal('metadata' in intent, false);
    for (const marker of PRIVATE.filter((value) => value !== ACCOUNT))
      assert.equal(JSON.stringify(intent).includes(marker), false);
    const baseline = f.documents[0]!.payload as any,
      after = f.documents[2]!.payload as any;
    assert.equal(baseline.held.cleanup.sessionDisposed, false);
    assert.equal(after.result.cleanup.sessionDisposed, true);
    assert.equal('held' in after.result, false);
    for (const marker of PRIVATE) assert(JSON.stringify(baseline).includes(marker));
    const projection = projectNativeShortWriteEvidence(f.context);
    assert.equal(projection.validated, true);
    assert.equal(projection.data[0]!.firstTitle, 'Changed title');
    assert.equal(projection.evidence.length, 3);
    noPrivate(projection);
    const app = createApplication(f.config, {
      browser: new BrowserSession({ profileDir: f.config.profileDir, headless: true }),
    });
    try {
      for (const name of ['get_job', 'cancel_job']) {
        const output = (await app.dispatch(
          'POST',
          '/api/v1/tools/fanqie_' + name,
          new URLSearchParams(),
          { jobId: f.job.id },
        )) as any;
        assert.equal(output.job.operation, 'update_work_metadata');
        assert.equal(output.job.projectionStatus, 'validated');
        assert.deepEqual(output.data, projection.data);
        assert.equal(output.job.result.schema, 'native-short-metadata-write-result/v2');
        noPrivate(output);
      }
      noPrivate(await app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined));
      for (const scope of [SCOPE, 'account', 'short_works'])
        assert.equal(
          (
            (await app.dispatch(
              'GET',
              '/api/v1/snapshot',
              new URLSearchParams({ scope }),
              undefined,
            )) as any
          ).manifest,
          null,
        );
      assert.deepEqual(
        (
          (await app.dispatch(
            'GET',
            '/api/v1/history',
            new URLSearchParams({ scope: SCOPE }),
            undefined,
          )) as any
        ).manifests,
        [],
      );
      const cap = (await app.dispatch(
        'GET',
        '/api/v1/capabilities',
        new URLSearchParams(),
        undefined,
      )) as any;
      assert.equal(cap.reads[0].verificationStatus, 'not-verified-live');
      assert.equal(cap.reads[0].metadataWritesAvailable, false);
      assert.equal(cap.writes.nativeShortMetadata.available, false);
    } finally {
      await app.close();
    }
  } finally {
    await f.close();
  }
});
