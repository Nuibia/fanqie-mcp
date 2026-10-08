import test from 'node:test';

import {
  fixture,
  safeFailure,
  postCount,
  deniedProduction,
} from './helpers/short-native-body-api-fixture.js';

import assert from 'node:assert/strict';

import { business, WORK, PLAIN } from './helpers/short-native-body-api-edit.js';

import {
  createOwnedNativeShortBodyFixtureRun,
  createOwnedNativeShortBodyRun,
  prepareNativeShortBodyProductionStart,
} from '../src/platform/short-native-body-api.js';

import {
  durableFixture,
  durable,
  completeContext,
} from './helpers/short-native-body-api-durable-fixture.js';

import {
  validateNativeShortBodyEvidenceContext,
  NATIVE_SHORT_BODY_DATASETS,
} from '../src/platform/short-native-body-proof.js';

import { Store } from '../src/runtime/store.js';

import { readFileSync } from 'node:fs';

import path from 'node:path';

test('body fixture lease abort deadline and late context keep cleanup ownership', async () => {
  const lease = fixture({
      lease() {
        throw Error('private-lease');
      },
    }),
    denied = await lease.run.run();
  safeFailure(denied, 'lease_unavailable');
  assert.equal(lease.creates, 0);
  assert.equal(lease.calls.length, 0);
  for (const hold of ['cookies', 'creation', 'post'] as const) {
    const f = fixture({ hold }),
      running = f.run.run();
    await f.entered;
    f.controller.abort();
    const result = await running;
    safeFailure(result, 'cancelled');
    assert.equal(result.cleanup.pendingAtEnd > 0, true);
    assert.equal(result.cleanup.quarantined, true);
    const count = postCount(f);
    f.release();
    await f.run.cleanupDone;
    assert.equal(postCount(f), count);
    assert.equal(f.disposes, hold === 'cookies' ? 0 : 1);
    assert.equal(result.cleanup.pendingAtEnd > 0, true); // frozen result cannot be silently rewritten by late drain
  }
  const timed = fixture({ hold: 'creation', deadlineMs: 5000 }),
    running = timed.run.run();
  await timed.entered;
  const result = await running;
  safeFailure(result, 'timeout');
  timed.release();
  await timed.run.cleanupDone;
  assert.equal(postCount(timed), 0);
});

test('body fixture one-shot run never performs a second POST', async () => {
  const f = fixture(),
    first = await f.run.run(),
    second = await f.run.run();
  assert.equal(first.save.post.attempts, 1);
  safeFailure(second, 'durability_unverified');
  assert.equal(postCount(f), 1);
  assert.equal(f.creates, 1);
  let access = 0;
  const badOptions = Object.defineProperty({ ...f.options }, 'businessRequest', {
    enumerable: true,
    get() {
      access++;
      return business();
    },
  });
  const rejected = createOwnedNativeShortBodyFixtureRun(f.borrowed, WORK, badOptions, f.factory);
  safeFailure(await rejected.run(), 'invalid_input');
  assert.equal(access, 0);
  assert.equal(f.creates, 1);
  const stages = fixture({
      onStage(stage) {
        if (stage.kind === 'intent') throw Error('private-stage-failure');
      },
    }),
    failed = await stages.run.run();
  safeFailure(failed, 'callback_failed');
  assert.equal(postCount(stages), 0);
  assert.equal(failed.save.trace?.stages.at(-1)?.kind, 'result');
});

test('body durable API mismatch waits for real disposal while keeping its unknown outcome', async () => {
  const f = durableFixture({ afterContent: PLAIN, hold: 'dispose' });
  try {
    let returned = false;
    const running = f.run.run().then((value) => {
      returned = true;
      return value;
    });
    await f.f.entered;
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(returned, false);
    assert.equal(postCount(f.f), 1);
    assert.equal(f.f.disposes, 1);
    f.f.release();
    const result = durable(await running);
    assert.equal(result.reason, 'readback_mismatch');
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.save.outcome, 'unknown');
    assert.equal(result.comparison?.matches, false);
    assert.equal(result.verifiedLive, false);
    assert.equal(result.durable, true);
    assert.equal(result.save.post.attempts, 1);
    assert.equal(result.save.post.disposed, 1);
    assert.equal(result.save.post.acknowledged, true);
    assert.equal(result.cleanup.sessionDisposed, true);
    assert.equal(result.cleanup.pendingAtEnd, 0);
    assert.equal(result.cleanup.disposalFailures, 0);
    assert.equal(result.cleanup.quarantined, false);
    assert.equal(result.proof.ownerCheckedAt, null);
    assert.equal(f.f.callbacks, 0);
    assert.equal(f.f.quarantines, 0);
    const context = completeContext(f);
    validateNativeShortBodyEvidenceContext(context, 'complete');
    assert.equal(context.attempts.length, 1);
    assert.equal(context.attempts[0]!.ordinal, 1);
    const resultStage = context.documents.find(
      (doc) => doc.dataset === NATIVE_SHORT_BODY_DATASETS.result,
    )!;
    const persisted = (
      resultStage.payload as { payload: { outcome: string; reason: string; cleanup: unknown } }
    ).payload;
    assert.equal(persisted.outcome, 'unknown');
    assert.equal(persisted.reason, 'readback_mismatch');
    assert.deepEqual(persisted.cleanup, result.cleanup);
  } finally {
    f.f.release();
    await f.run.cleanupDone;
    f.close();
  }
});

test('body durable API cancelled mismatch retains dirty history and refuses same owner or fixture recovery', async () => {
  const f = durableFixture({ afterContent: PLAIN, hold: 'dispose' });
  let reopened: Store | undefined;
  try {
    const running = f.run.run();
    await f.f.entered;
    f.f.controller.abort();
    const result = durable(await running);
    assert.equal(result.reason, 'readback_mismatch');
    assert.equal(result.save.outcome, 'unknown');
    assert.equal(result.verifiedLive, false);
    assert.equal(result.cleanup.pendingAtEnd > 0, true);
    assert.equal(result.cleanup.sessionDisposed, false);
    assert.equal(result.cleanup.quarantined, true);
    assert.equal(result.save.post.attempts, 1);
    assert.equal(result.save.post.disposed, 1);
    assert.equal(result.save.post.acknowledged, true);
    const original = f.store.failJob(f.job.id, {
      code: 'capability_unavailable',
      message: 'Native short body is unavailable.',
    });
    assert.equal(original.status, 'uncertain');
    const refs = f.store.listEvidence(original.id),
      bytes = refs.map((ref) => readFileSync(path.join(f.store.evidenceDirectory, ref.path))),
      attempts = f.store.listNativeShortBodyAttempts(original.id, 'owner');
    assert.throws(() => f.store.prepareNativeShortBodyReconciliation(original.id, 'owner'), {
      code: 'capability_unavailable',
    });
    f.f.release();
    await f.run.cleanupDone;
    assert.equal(result.cleanup.pendingAtEnd > 0, true);
    assert.equal(result.cleanup.sessionDisposed, false);
    assert.equal(result.cleanup.quarantined, true);
    assert.throws(() => f.store.prepareNativeShortBodyReconciliation(original.id, 'owner'), {
      code: 'capability_unavailable',
    });
    f.store.close();
    reopened = new Store({
      databasePath: f.store.databasePath,
      evidenceDirectory: f.store.evidenceDirectory,
      evidenceMode: 'fixture',
      nativeShortBodyWriteEnabled: false,
      nativeShortBodyFixtureFactory: f.f.factory,
    });
    assert.notEqual(reopened.ownerId, original.ownerId);
    assert.throws(() => reopened!.prepareNativeShortBodyReconciliation(original.id, 'owner'), {
      code: 'capability_unavailable',
    });
    assert.deepEqual(reopened.listEvidence(original.id), refs);
    assert.deepEqual(reopened.listNativeShortBodyAttempts(original.id, 'owner'), attempts);
    for (let index = 0; index < refs.length; index++)
      assert.deepEqual(
        readFileSync(path.join(reopened.evidenceDirectory, refs[index]!.path)),
        bytes[index],
      );
    assert.equal(reopened.getJob(original.id, 'owner')!.status, 'uncertain');
    assert.equal(postCount(f.f), 1);
  } finally {
    f.f.release();
    await f.run.cleanupDone;
    reopened?.close();
    f.close();
  }
});

test('body durable API registered Store authority and private Start reject clones foreign slots and observers', async () => {
  const f = durableFixture();
  let getters = 0;
  try {
    for (const authority of [{}, { persist() {}, beginAttempt() {} }, { ...f.authority }]) {
      const denied = deniedProduction({
        accountId: 'owner',
        workId: WORK,
        businessRequest: f.options.businessRequest,
        authority,
      });
      assert.equal(denied.reason, 'production_disabled');
    }
    assert.equal(
      deniedProduction({
        accountId: 'foreign',
        workId: WORK,
        businessRequest: f.options.businessRequest,
        authority: f.authority,
      }).reason,
      'production_disabled',
    );
    const wrapper = Object.defineProperty(
      { accountId: 'owner', workId: WORK, authority: f.authority },
      'businessRequest',
      {
        enumerable: true,
        get() {
          getters++;
          return business();
        },
      },
    );
    assert.equal(deniedProduction(wrapper).reason, 'invalid_input');
    assert.equal(getters, 0);
    const cloned = createOwnedNativeShortBodyRun({ ...f.start }, f.f.borrowed, WORK, f.options);
    assert.equal((await cloned.run()).reason, 'production_disabled');
    const reused = createOwnedNativeShortBodyRun(f.start, f.f.borrowed, WORK, f.options);
    assert.equal((await reused.run()).reason, 'production_disabled');
    assert.equal(f.f.creates, 0);
    assert.equal(f.f.calls.length, 0);
    const other = prepareNativeShortBodyProductionStart({
      accountId: 'owner',
      workId: WORK,
      businessRequest: f.options.businessRequest,
      authority: f.authority,
    });
    assert.ok(other.allowed);
    const deniedObserver = createOwnedNativeShortBodyRun(other.start, f.f.borrowed, WORK, {
      ...f.options,
      onStage() {},
    });
    assert.equal((await deniedObserver.run()).reason, 'invalid_input');
    assert.equal(f.f.creates, 0);
    assert.equal(f.store.listEvidence(f.job.id).length, 0);
    assert.equal(f.store.listNativeShortBodyAttempts(f.job.id, 'owner').length, 0);
  } finally {
    f.close();
  }
});
