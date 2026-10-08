import test from 'node:test';

import { syntheticCompensationFixture } from './helpers/short-native-metadata-integration-synthetic-compensation-fixture.js';

import { loadConfig } from '../src/config.js';

import path from 'node:path';

import { writeFileSync, rmSync } from 'node:fs';

import { ACCOUNT, noPrivate, WORK } from './helpers/short-native-metadata-integration-snapshot.js';

import { BrowserSession } from '../src/platform/browser.js';

import { createApplication } from '../src/application.js';

import assert from 'node:assert/strict';

import {
  validateNativeShortCompensationContext,
  validateNativeShortBaselineEvidence,
  validateNativeShortWriteIntent,
  validateNativeShortCleanAfterEvidence,
} from '../src/platform/short-native-metadata-proof.js';

import { createHash, randomUUID } from 'node:crypto';

import { nativeSaveFixture } from './helpers/short-native-metadata-integration-native-write-snapshot.js';

import { canonicalJson } from '../src/runtime/store.js';

import { NATIVE_SHORT_HASH_BASES } from '../src/platform/short-native-metadata.js';

test('injected collectors cannot start compensation or turn the administrative registration into ordinary public evidence', async () => {
  const f = await syntheticCompensationFixture(false);
  await f.queue.drainAndStop();
  f.store.close();
  const config = loadConfig({
    FANQIE_TOKEN: 'compensation-fixture-synthetic-token',
    FANQIE_ENABLE_WRITES: 'false',
    FANQIE_DATA_DIR: f.directory,
    FANQIE_PROFILE_DIR: path.join(f.directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(f.directory, 'runtime'),
  });
  writeFileSync(
    path.join(f.directory, 'account-binding.json'),
    JSON.stringify({ accountId: 'owner', platformId: ACCOUNT, platformIdType: 'account' }),
  );
  let calls = 0;
  class Injected extends BrowserSession {
    override async runNativeShortMetadata(): Promise<never> {
      calls++;
      throw Error('Forbidden fixture upgrade');
    }
  }
  const app = createApplication(config, {
    browser: new Injected({ profileDir: config.profileDir, headless: true }),
  });
  try {
    await assert.rejects(
      app.dispatch('POST', '/api/v1/tools/fanqie_reconcile_write', new URLSearchParams(), {
        jobId: f.originalId,
      }),
      { code: 'capability_unavailable' },
    );
    assert.equal(calls, 0);
    const registered = (await app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_get_job',
      new URLSearchParams(),
      { jobId: f.registration.id },
    )) as any;
    assert.equal(registered.data[0].status, 'capability_unavailable');
    noPrivate(registered);
  } finally {
    await app.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test('complete compensation context rejects additional reserved signals, bad lifecycle, corrupted raw and mixed carriers', async (t) => {
  const f = await syntheticCompensationFixture(true);
  try {
    const context = await f.fresh();
    assert.equal(context.source.operatorBefore.job.target, null);
    assert.deepEqual(context.readJob.target, { kind: 'short-story', id: WORK });
    assert.equal(validateNativeShortCompensationContext(context).status, 'failed');
    const mutations: [string, (c: any) => void][] = [
      [
        'outer-job-metadata',
        (c) => (c.readJob.metadata = { nested: { schema: 'native-short-metadata-future/v9' } }),
      ],
      [
        'original-extra',
        (c) => (c.source.original.job.extra = { schema: 'native-short-metadata-future/v9' }),
      ],
      [
        'operator-extra',
        (c) => (c.source.operator.job.extra = { schema: 'native-short-metadata-future/v9' }),
      ],
      [
        'before-metadata',
        (c) => (c.source.operatorBefore.job.metadata.schema = 'native-short-metadata-future/v9'),
      ],
      [
        'before-nonnull-target',
        (c) => (c.source.operatorBefore.job.target = { kind: 'short-story', id: WORK }),
      ],
      ['later-null-target', (c) => (c.readJob.target = null)],
      [
        'registration-extra',
        (c) => (c.source.registration.job.extra = { schema: 'native-short-metadata-future/v9' }),
      ],
      [
        'receipt-pass-oracle',
        (c) => {
          const actor = JSON.parse(c.source.authority.receipts.actor.bytes);
          actor.events[7].markedAt = actor.events[0].checkedAt;
          c.source.authority.receipts.actor.bytes = JSON.stringify(actor);
          c.source.authority.receipts.actor.sha256 = createHash('sha256')
            .update(c.source.authority.receipts.actor.bytes)
            .digest('hex');
        },
      ],
      [
        'fresh-raw',
        (c) => (c.document.payload.result.snapshot.editData.PRIVATE_UNKNOWN_KEY = 'tampered'),
      ],
      [
        'effect-cutoff',
        (c) =>
          (c.source.registration.document.payload.effectsEndedAt =
            c.document.payload.result.proof.readStartedAt),
      ],
      [
        'mixed-held-v2',
        (c) =>
          (c.source.operator.documents[0].payload.held.schema =
            'native-short-metadata-held-before/v2'),
      ],
      [
        'first-audit-pointer',
        (c) => (c.source.history.first.row.readJobId = c.source.operatorBefore.job.id),
      ],
    ];
    for (const [name, mutate] of mutations)
      await t.test(name, () => {
        const copy = structuredClone(context);
        mutate(copy);
        assert.throws(() => validateNativeShortCompensationContext(copy));
      });
    let invoked = 0;
    const copy = structuredClone(context);
    Object.defineProperty(copy.source.operator.job.metadata, 'runId', {
      enumerable: true,
      get() {
        invoked++;
        return randomUUID();
      },
    });
    assert.throws(() => validateNativeShortCompensationContext(copy));
    assert.equal(invoked, 0);
  } finally {
    await f.close();
  }
});

test('new write proof explicitly dispatches v2 and refuses mixed or unknown persisted carriers without changing C2 hash bases', async () => {
  const f = await nativeSaveFixture();
  try {
    const baseline = validateNativeShortBaselineEvidence(f.documents[0]!.payload);
    assert.equal(baseline.schema, 'native-short-metadata-held-before/v2');
    assert.equal(
      canonicalJson(baseline.held.snapshot.hashBases),
      canonicalJson(NATIVE_SHORT_HASH_BASES),
    );
    assert.equal('version' in baseline.held.expectation && baseline.held.expectation.version, 2);
    for (const carrier of ['v1', 'v3']) {
      const before = structuredClone(baseline) as any;
      before.schema = `native-short-metadata-held-before/${carrier}`;
      before.held.schema = before.schema;
      assert.throws(() => validateNativeShortBaselineEvidence(before));
      const intent = structuredClone(f.documents[1]!.payload) as any;
      intent.schema = `native-short-metadata-intent/${carrier}`;
      assert.throws(() => validateNativeShortWriteIntent(intent, baseline, f.refs[0]!));
      const after = structuredClone(f.documents[2]!.payload) as any;
      after.result.receipt.schema = `native-short-metadata-durable-receipt/${carrier}`;
      assert.throws(() =>
        validateNativeShortCleanAfterEvidence(after, baseline, f.refs[0]!, f.refs[1]!),
      );
    }
    const after = structuredClone(f.documents[2]!.payload) as any;
    after.result.comparison.actual.serverRevisionBefore.latestVersion++;
    assert.throws(() =>
      validateNativeShortCleanAfterEvidence(after, baseline, f.refs[0]!, f.refs[1]!),
    );
  } finally {
    await f.close();
  }
});
