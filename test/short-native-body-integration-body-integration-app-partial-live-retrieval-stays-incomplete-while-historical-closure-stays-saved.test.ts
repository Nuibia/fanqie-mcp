import test from 'node:test';

import {
  fixture,
  OWNER,
  ACCOUNT,
  assertSafe,
} from './helpers/short-native-body-integration-business.js';

import { createApplication } from '../src/application.js';

import { loadConfig } from '../src/config.js';

import path from 'node:path';

import { writeFileSync } from 'node:fs';

import assert from 'node:assert/strict';

test('body integration App partial live retrieval stays incomplete while historical closure stays saved', async () => {
  const f = fixture('ack-lost');
  let app: ReturnType<typeof createApplication> | undefined;
  try {
    const original = await f.write();
    f.nextPartial();
    f.store.close();
    const config = loadConfig({
      FANQIE_TOKEN: 'synthetic-partial-app-token',
      FANQIE_ENABLE_WRITES: 'false',
      FANQIE_ACCOUNT_ID: OWNER,
      FANQIE_DATA_DIR: f.dir,
      FANQIE_PROFILE_DIR: path.join(f.dir, 'unused-profile'),
      FANQIE_RUNTIME_DIR: path.join(f.dir, 'runtime'),
    });
    writeFileSync(
      path.join(f.dir, 'account-binding.json'),
      JSON.stringify({ accountId: OWNER, platformId: ACCOUNT, platformIdType: 'account' }),
    );
    app = createApplication(config, {
      browser: f.browser,
      nativeShortBodyFixtureFactory: f.factory,
    });
    const partial = (await app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_reconcile_write',
      new URLSearchParams(),
      { jobId: original.id },
    )) as {
      original: { sourceMode: string; data: Array<{ reason: string }> };
      reconciliation: {
        retrievalMode: string;
        sourceMode: string;
        job: { status: string };
        data: Array<{ reason: string; verifiedLive: boolean; durable: boolean }>;
      };
      settlement: { status: string };
    };
    assert.equal(partial.settlement.status, 'uncertain');
    assert.equal(partial.reconciliation.job.status, 'succeeded');
    assert.equal(partial.reconciliation.retrievalMode, 'live');
    assert.equal(partial.reconciliation.sourceMode, 'incomplete');
    assert.equal(partial.reconciliation.data[0]!.reason, 'partial_read');
    assert.equal(partial.reconciliation.data[0]!.verifiedLive, false);
    assert.equal(partial.reconciliation.data[0]!.durable, true);
    assert.equal(partial.original.sourceMode, 'saved');
    assert.equal(partial.original.data[0]!.reason, 'partial_read');
    assertSafe(partial);
    const counters = [f.gets, f.posts, f.contexts],
      saved = (await app.dispatch('POST', '/api/v1/tools/fanqie_get_job', new URLSearchParams(), {
        jobId: original.id,
      })) as { sourceMode: string; data: Array<{ reason: string }> };
    assert.equal(saved.sourceMode, 'saved');
    assert.equal(saved.data[0]!.reason, 'partial_read');
    assert.deepEqual([f.gets, f.posts, f.contexts], counters);
  } finally {
    if (app) await app.close();
    await f.close();
  }
});
