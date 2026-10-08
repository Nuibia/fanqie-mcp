import test from 'node:test';

import {
  fixture,
  OWNER,
  assertSafe,
  edit,
  ACCOUNT,
  business,
} from './helpers/short-native-body-integration-business.js';

import assert from 'node:assert/strict';

import {
  NATIVE_SHORT_BODY_DATASETS,
  type NativeShortBodyClosure,
  nativeShortBodyReconciliationScope,
} from '../src/platform/short-native-body-proof.js';

import { nativeShortBodyEvidenceView } from '../src/platform/short-native-body-runtime.js';

import { DatabaseSync } from 'node:sqlite';

import { createApplication } from '../src/application.js';

import { loadConfig } from '../src/config.js';

import path from 'node:path';

import { writeFileSync } from 'node:fs';

test('body integration inherited owned Browser and real Queue persist seven-stage fixture graph once', async () => {
  const f = fixture();
  try {
    const job = await f.write();
    assert.equal(job.status, 'succeeded');
    assert.equal(f.posts, 1);
    assert.equal(f.gets, 15);
    assert.equal(f.contexts, 1);
    const refs = f.store.listEvidence(job.id);
    assert.deepEqual(
      refs.map((ref) => ref.dataset),
      [
        NATIVE_SHORT_BODY_DATASETS.baseline,
        NATIVE_SHORT_BODY_DATASETS.preSave,
        'write-intent',
        NATIVE_SHORT_BODY_DATASETS.attempt,
        NATIVE_SHORT_BODY_DATASETS.acknowledgement,
        NATIVE_SHORT_BODY_DATASETS.after,
        'write-result',
      ],
    );
    assert.equal(f.store.listNativeShortBodyAttempts(job.id, OWNER).length, 1);
    const view = nativeShortBodyEvidenceView(
      f.store,
      OWNER,
      job,
      null,
      refs,
      refs.map((ref) => f.store.readEvidence(ref)),
    );
    assert.equal(view.valid, true);
    assert.equal(view.verifiedLive, false);
    assert.equal(view.data[0]!.schema, 'native-short-body-summary/v1');
    assertSafe(view);
    assert.deepEqual((await f.write()).id, job.id);
    assert.equal(f.posts, 1);
  } finally {
    await f.close();
  }
});

test('body integration exact no change observes baseline without form intent attempt or POST', async () => {
  const f = fixture();
  try {
    const job = await f.write(true);
    assert.equal(job.status, 'succeeded');
    assert.equal(f.posts, 0);
    assert.equal(f.gets, 5);
    assert.equal(job.platformWriteStartedAt, null);
    assert.equal(f.store.listNativeShortBodyAttempts(job.id, OWNER).length, 0);
    const refs = f.store.listEvidence(job.id);
    assert.deepEqual(
      refs.map((ref) => ref.dataset),
      [NATIVE_SHORT_BODY_DATASETS.baseline, 'write-result'],
    );
    const payload = f.store.readEvidence(refs[1]!).payload as {
      payload: { reason: string; desiredContentHash: unknown };
    };
    assert.equal(payload.payload.reason, 'no_change');
    assert.equal(payload.payload.desiredContentHash, null);
  } finally {
    await f.close();
  }
});

test('body integration ACK loss matching after remains unknown then partial closure later matching and reopen saved', async () => {
  const f = fixture('ack-lost');
  try {
    const original = await f.write();
    assert.equal(original.status, 'uncertain');
    assert.equal(f.posts, 1);
    const initialError = structuredClone(original.error),
      initialRefs = f.store.listEvidence(original.id),
      attempts = f.store.listNativeShortBodyAttempts(original.id, OWNER);
    f.nextPartial();
    const before = f.gets,
      partial = await f.reconcile(original.id);
    assert.equal(partial.settlement!.status, 'uncertain');
    assert.equal(partial.settlement!.reason, 'partial_read');
    assert(f.gets - before <= 14);
    assert.equal(f.posts, 1);
    const partialJob = f.store.getJob(partial.reconciliationJobId!, OWNER)!;
    assert.equal(partialJob.status, 'succeeded');
    const partialRefs = f.store.listEvidence(partialJob.id),
      partialView = nativeShortBodyEvidenceView(
        f.store,
        OWNER,
        partialJob,
        f.store.getManifestForJob(OWNER, partialJob.id),
        partialRefs,
        partialRefs.map((ref) => f.store.readEvidence(ref)),
      );
    assert.equal(partialView.valid, true);
    assert.equal(partialView.verifiedLive, false);
    assert.equal(partialView.data[0]!.reason, 'partial_read');
    assertSafe(partialView);
    const closure = f.store.getJob(original.id)!.result as NativeShortBodyClosure;
    assert.equal(closure.originalAudit.originalErrorHash.length, 64);
    assert.deepEqual(closure.originalAudit.originalError, initialError);
    f.reopen();
    const matching = await f.reconcile(original.id);
    assert.equal(matching.settlement!.status, 'succeeded');
    assert.equal(matching.settlement!.result.verifiedLive, false);
    assert.equal(f.posts, 1);
    const terminal = f.store.getJob(original.id)!;
    assert.equal(terminal.status, 'succeeded');
    assert.deepEqual(f.store.listEvidence(original.id), initialRefs);
    assert.deepEqual(f.store.listNativeShortBodyAttempts(original.id, OWNER), attempts);
    const db = new DatabaseSync(f.databasePath);
    assert.equal(
      db
        .prepare('SELECT count(*) AS n FROM write_reconciliations WHERE original_job_id=?')
        .get(original.id)!.n,
      2,
    );
    db.close();
    f.reopen();
    const counters = [f.gets, f.posts, f.contexts],
      saved = await f.reconcile(original.id);
    assert.equal(saved.retrievalMode, 'saved');
    assert.equal(saved.settlement!.status, 'succeeded');
    assert.deepEqual([f.gets, f.posts, f.contexts], counters);
  } finally {
    await f.close();
  }
});

test('body integration later unchanged original is not applied and cannot replay old key', async () => {
  const f = fixture('ack-lost');
  try {
    const original = await f.write();
    assert.equal(original.status, 'uncertain');
    f.setCurrent(edit());
    const response = await f.reconcile(original.id);
    assert.equal(response.settlement!.status, 'failed');
    assert.equal(response.settlement!.reason, 'not_applied');
    assert.equal(f.posts, 1);
    const same = await f.write();
    assert.equal(same.id, original.id);
    assert.equal(same.status, 'failed');
    assert.equal(f.posts, 1);
    const counters = [f.gets, f.posts];
    assert.equal((await f.reconcile(original.id)).retrievalMode, 'saved');
    assert.deepEqual([f.gets, f.posts], counters);
  } finally {
    await f.close();
  }
});

test('body integration pre-save drift and foreign owner preserve zero attempt boundary', async () => {
  const f = fixture('pre-save-drift');
  try {
    const job = await f.write();
    assert.equal(job.status, 'failed');
    assert.equal(f.posts, 0);
    assert.equal(f.store.listNativeShortBodyAttempts(job.id, OWNER).length, 0);
    assert.equal(job.platformWriteStartedAt, null);
  } finally {
    await f.close();
  }
  const g = fixture();
  try {
    g.foreignOwner();
    const job = await g.write();
    assert.equal(job.status, 'failed');
    assert.equal(g.posts, 0);
    assert.equal(g.store.listEvidence(job.id).length, 0);
    assert.equal(g.store.listNativeShortBodyAttempts(job.id, OWNER).length, 0);
    assert.equal(job.platformWriteStartedAt, null);
  } finally {
    await g.close();
  }
});

test('body integration saved App get list evidence snapshot history and reconciliation are fixed safe DTOs', async () => {
  const f = fixture('ack-lost');
  let app: ReturnType<typeof createApplication> | undefined;
  try {
    const original = await f.write();
    await f.reconcile(original.id);
    const counters = [f.gets, f.posts, f.contexts];
    await f.queue.drainAndStop();
    f.store.close();
    const config = loadConfig({
      FANQIE_TOKEN: 'synthetic-body-app-token',
      FANQIE_ENABLE_WRITES: 'false',
      FANQIE_ACCOUNT_ID: OWNER,
      FANQIE_DATA_DIR: f.dir,
      FANQIE_PROFILE_DIR: path.join(f.dir, 'unused-profile'),
      FANQIE_RUNTIME_DIR: path.join(f.dir, 'runtime'),
    });
    writeFileSync(
      path.join(f.dir, 'account-binding.json'),
      JSON.stringify({
        accountId: config.accountId,
        platformId: ACCOUNT,
        platformIdType: 'account',
      }),
    );
    app = createApplication(config, {
      browser: f.browser,
      nativeShortBodyFixtureFactory: f.factory,
    });
    assert.equal(
      app.tools.some((tool) => tool.name === 'fanqie_update_short_body'),
      true,
    );
    assert.equal(
      app.tools.some((tool) => tool.name === 'fanqie_get_short_body_snapshot'),
      true,
    );
    const disabledCounters = [f.gets, f.posts, f.contexts];
    await assert.rejects(
      () =>
        app!.dispatch('POST', '/api/v1/tools/fanqie_update_short_body', new URLSearchParams(), {
          idempotencyKey: 'disabled-body-key',
          ...business(),
        }),
      { code: 'writes_disabled' },
    );
    assert.deepEqual([f.gets, f.posts, f.contexts], disabledCounters);
    const call = (tool: string, input: unknown) =>
      app!.dispatch('POST', '/api/v1/tools/fanqie_' + tool, new URLSearchParams(), input);
    for (const value of [
      await call('get_job', { jobId: original.id }),
      await app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined),
      await app.dispatch('GET', '/api/v1/jobs/' + original.id, new URLSearchParams(), undefined),
      await app.dispatch(
        'GET',
        '/api/v1/snapshot',
        new URLSearchParams({ scope: nativeShortBodyReconciliationScope(original.id) }),
        undefined,
      ),
      await app.dispatch('GET', '/api/v1/history', new URLSearchParams(), undefined),
      await call('reconcile_write', { jobId: original.id }),
    ])
      assertSafe(value);
    assert.deepEqual([f.gets, f.posts, f.contexts], counters);
    const capabilities = (await app.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as { writes: { nativeShortBody: { available: boolean; verificationStatus: string } } };
    assert.equal(capabilities.writes.nativeShortBody.available, false);
    assert.equal(capabilities.writes.nativeShortBody.verificationStatus, 'not-verified-live');
  } finally {
    if (app) await app.close();
    await f.close();
  }
});

test('body integration linked closure tampering account isolation and malformed namespace fail closed', async () => {
  const f = fixture('ack-lost');
  try {
    const original = await f.write();
    f.nextPartial();
    const response = await f.reconcile(original.id);
    assert.equal(f.store.getJob(original.id, 'foreign'), null);
    const ref = f.store.listEvidence(response.reconciliationJobId!)[0]!;
    writeFileSync(path.join(f.evidenceDirectory, ref.path), '{}\n');
    assert.throws(() => f.store.getJob(original.id));
    const projected = f.store.getJobForPublicProjection(original.id, OWNER)!;
    const refs = f.store.listEvidence(original.id),
      view = nativeShortBodyEvidenceView(
        f.store,
        OWNER,
        projected,
        null,
        refs,
        refs.map((item) => f.store.readEvidence(item)),
      );
    assert.equal(view.valid, false);
    assertSafe(view);
  } finally {
    await f.close();
  }
});

test('body integration same idempotency key rejects different business hash before owned access', async () => {
  const f = fixture();
  try {
    const job = await f.write(),
      counters = [f.gets, f.posts, f.contexts];
    await assert.rejects(() => f.write(true), { code: 'idempotency_conflict' });
    assert.equal(f.store.listJobs(OWNER).length, 1);
    assert.equal((await f.write()).id, job.id);
    assert.deepEqual([f.gets, f.posts, f.contexts], counters);
  } finally {
    await f.close();
  }
});
