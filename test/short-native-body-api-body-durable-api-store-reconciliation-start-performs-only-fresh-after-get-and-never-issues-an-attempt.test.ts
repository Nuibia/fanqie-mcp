import test from 'node:test';

import { durableFixture, durable } from './helpers/short-native-body-api-durable-fixture.js';

import assert from 'node:assert/strict';

import {
  NATIVE_SHORT_BODY_RECONCILE_OPERATION,
  nativeShortBodyReconciliationScope,
  NATIVE_SHORT_BODY_DATASETS,
  nativeShortBodyReconciliationInputHash,
} from '../src/platform/short-native-body-proof.js';

import { ACCOUNT, WORK } from './helpers/short-native-body-api-edit.js';

import {
  prepareNativeShortBodyProductionStart,
  createOwnedNativeShortBodyRun,
} from '../src/platform/short-native-body-api.js';

import { postCount } from './helpers/short-native-body-api-fixture.js';

test('body durable API Store reconciliation Start performs only fresh after GET and never issues an attempt', async () => {
  const f = durableFixture({ lostAck: true });
  try {
    const written = durable(await f.run.run());
    assert.equal(written.save.outcome, 'unknown');
    assert.equal(written.durable, true);
    const original = f.store.failJob(f.job.id, {
      code: 'capability_unavailable',
      message: 'Native short body is unavailable.',
    });
    assert.equal(original.status, 'uncertain');
    const audit = f.store.getNativeShortBodyOriginalAudit(f.job.id, 'owner');
    // A later independent wall-clock observation is required, within the actual deadline.
    while (new Date().toISOString() <= audit.priorEndedAt)
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    const read = f.store.createJob({
      accountId: 'owner',
      kind: 'read',
      operation: NATIVE_SHORT_BODY_RECONCILE_OPERATION,
      scope: nativeShortBodyReconciliationScope(f.job.id),
      datasets: [NATIVE_SHORT_BODY_DATASETS.reconciliation],
      inputHash: nativeShortBodyReconciliationInputHash('owner', audit),
      timeoutMs: 30_000,
    });
    f.store.startJob(read.job.id);
    const authority = f.store.issueNativeShortBodyReconciliationAuthority(
      read.job.id,
      'owner',
      f.job.id,
      audit,
      ACCOUNT,
    );
    const decision = prepareNativeShortBodyProductionStart({
      accountId: 'owner',
      workId: WORK,
      businessRequest: f.options.businessRequest,
      authority,
    });
    assert.ok(decision.allowed);
    f.enableReconcile();
    const count = f.f.calls.length,
      posts = postCount(f.f);
    const run = createOwnedNativeShortBodyRun(decision.start, f.f.borrowed, WORK, {
      ...f.options,
      onBeforePlatformRead() {
        f.store.markPlatformReadStarted(read.job.id);
      },
    });
    const result = durable(await run.run());
    assert.equal(result.mode, 'reconcile');
    assert.equal(result.status, 'complete');
    assert.equal(result.durable, true);
    assert.equal(result.verifiedLive, false);
    assert.equal(result.plan, null);
    assert.equal(result.save.outcome, 'not_attempted');
    assert.equal(result.save.post.attempts, 0);
    assert.equal(postCount(f.f), posts);
    assert.equal(f.f.calls.length - count, 5);
    assert.equal(result.phases.before.proof.platformStarted, false);
    assert.equal(result.phases.preSave.proof.platformStarted, false);
    assert.equal(result.phases.after.proof.fixedSourceVerified, true);
    assert.equal(f.store.listNativeShortBodyAttempts(read.job.id, 'owner').length, 0);
    assert.deepEqual(
      f.store.listEvidence(read.job.id).map((ref) => ref.dataset),
      ['short_native_body_reconciliation'],
    );
    assert.equal(f.store.listNativeShortBodyAttempts(f.job.id, 'owner').length, 1);
  } finally {
    f.close();
  }
});
