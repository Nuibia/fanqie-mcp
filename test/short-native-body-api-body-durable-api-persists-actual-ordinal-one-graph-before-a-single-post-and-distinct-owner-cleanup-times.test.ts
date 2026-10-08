import test from 'node:test';

import {
  durableFixture,
  durable,
  completeContext,
} from './helpers/short-native-body-api-durable-fixture.js';

import assert from 'node:assert/strict';

import { SET, type Faults, business, PLAIN, WORK } from './helpers/short-native-body-api-edit.js';

import { postCount } from './helpers/short-native-body-api-fixture.js';

import {
  validateNativeShortBodyEvidenceContext,
  NATIVE_SHORT_BODY_DATASETS,
} from '../src/platform/short-native-body-proof.js';

import { DatabaseSync } from 'node:sqlite';

import { readFileSync } from 'node:fs';

import path from 'node:path';

import {
  prepareNativeShortBodyProductionStart,
  createOwnedNativeShortBodyRun,
} from '../src/platform/short-native-body-api.js';

test('body durable API persists actual ordinal one graph before a single POST and distinct owner cleanup times', async () => {
  const f = durableFixture();
  try {
    const result = durable(await f.run.run());
    assert.equal(result.status, 'complete');
    assert.equal(result.reason, 'fixture_not_live');
    assert.equal(result.durable, true);
    assert.equal(result.verifiedLive, false);
    assert.equal(result.mode, 'write');
    assert.equal(result.save.outcome, 'matched');
    assert.equal(result.save.trace, null);
    assert.equal(result.save.post.attempts, 1);
    assert.equal(result.save.post.disposed, 1);
    assert.equal(result.save.observation?.schema, 'native-short-body-acknowledgement/v1');
    assert.equal(result.snapshot?.document.rawHtml, SET);
    assert.equal(result.plan?.form.content, SET);
    assert.equal(result.comparison?.matches, true);
    assert.equal(postCount(f.f), 1);
    assert.equal(f.callbackCount, 15);
    assert.equal(f.beforePostValidated, true);
    assert.ok(result.proof.ownerCheckedAt);
    assert.ok(result.cleanup.checkedAt);
    assert.notEqual(result.proof.ownerCheckedAt, result.cleanup.checkedAt);
    assert.equal(result.proof.proofCapturedAt, result.cleanup.checkedAt);
    const context = completeContext(f),
      checked = validateNativeShortBodyEvidenceContext(context, 'complete');
    assert.deepEqual(
      checked.refs.map((ref) => ref.dataset),
      [
        'short_native_body_baseline',
        'short_native_body_pre_save',
        'write-intent',
        'short_native_body_attempt',
        'short_native_body_acknowledgement',
        'short_native_body_after',
        'write-result',
      ],
    );
    const attempts = context.attempts;
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.ordinal, 1);
    assert.equal(attempts[0]?.eventAt, context.job.platformWriteStartedAt);
    assert.ok(result.save.post.startedAt);
    assert.ok(attempts[0]);
    assert.ok(result.save.post.startedAt >= attempts[0].eventAt);
    const db = new DatabaseSync(f.store.databasePath, { readOnly: true });
    try {
      const actual = db
        .prepare(
          'SELECT ordinal,evidence_id,event_at FROM native_short_body_attempts WHERE job_id=? AND account_id=?',
        )
        .all(f.job.id, 'owner');
      assert.equal(actual.length, 1);
      assert.equal(actual[0]?.evidence_id, attempts[0].evidence.id);
    } finally {
      db.close();
    }
    for (const ref of context.refs) {
      assert.ok(readFileSync(path.join(f.store.evidenceDirectory, ref.path)).length > 0);
      assert.equal(ref.accountId, 'owner');
    }
    const intent = context.documents.find((doc) => doc.dataset === 'write-intent');
    assert.ok(intent);
    assert.equal(JSON.stringify(intent.payload).includes('data-percentage'), false);
    assert.equal(JSON.stringify(intent.payload).includes('Synthetic title'), false);
    const second = await f.run.run();
    assert.equal(second.reason, 'durability_unverified');
    assert.equal(postCount(f.f), 1);
  } finally {
    f.close();
  }
  const committed = durableFixture({}, true);
  try {
    const result = durable(await committed.run.run());
    assert.equal(committed.store.committedReadFailureInjected, true);
    assert.equal(result.reason, 'durability_unverified');
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.save.outcome, 'unknown');
    assert.equal(result.durable, true);
    assert.equal(result.verifiedLive, false);
    assert.deepEqual(result.save.post, {
      attempts: 0,
      disposed: 0,
      startedAt: null,
      acknowledgedAt: null,
      acknowledged: false,
    });
    assert.equal(postCount(committed.f), 0);
    const actual = completeContext(committed);
    validateNativeShortBodyEvidenceContext(actual, 'complete');
    assert.equal(actual.attempts.length, 1);
    assert.equal(actual.attempts[0]?.ordinal, 1);
    assert.equal(actual.attempts[0]?.eventAt, actual.job.platformWriteStartedAt);
    assert.deepEqual(
      actual.refs.map((ref) => ref.dataset),
      [
        'short_native_body_baseline',
        'short_native_body_pre_save',
        'write-intent',
        'short_native_body_attempt',
        'write-result',
      ],
    );
    const reader = new DatabaseSync(committed.store.databasePath, { readOnly: true });
    try {
      const rows = reader
        .prepare(
          'SELECT ordinal,evidence_id,event_at FROM native_short_body_attempts WHERE job_id=? AND account_id=?',
        )
        .all(committed.job.id, 'owner');
      const marked = reader
        .prepare('SELECT write_started_at FROM jobs WHERE id=? AND account_id=?')
        .get(committed.job.id, 'owner');
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.ordinal, 1);
      assert.equal(rows[0]?.event_at, marked?.write_started_at);
      assert.equal(rows[0]?.evidence_id, actual.attempts[0]?.evidence.id);
    } finally {
      reader.close();
    }
    const attemptFile = actual.refs.find((ref) => ref.dataset === 'short_native_body_attempt');
    assert.ok(attemptFile);
    assert.ok(
      readFileSync(path.join(committed.store.evidenceDirectory, attemptFile.path)).length > 0,
    );
    const last = actual.documents.at(-1);
    assert.ok(last);
    const saved = last.payload as {
      payload: { outcome: string; reason: string; evidence: { attempt: unknown }; post: unknown };
    };
    assert.equal(saved.payload.outcome, 'unknown');
    assert.equal(saved.payload.reason, 'durability_unverified');
    assert.deepEqual(saved.payload.evidence.attempt, actual.attempts[0]?.evidence);
    assert.deepEqual(saved.payload.post, result.save.post);
    await committed.run.run();
    assert.equal(postCount(committed.f), 0);
    assert.equal(committed.store.listNativeShortBodyAttempts(committed.job.id, 'owner').length, 1);
  } finally {
    committed.close();
  }
});

test('body durable API lost or contradicted ACK stays unknown with matching fresh after and immutable first cause', async () => {
  for (const faults of [
    { lostAck: true },
    { ack: { item_id: '7000000002' } },
    { ackData: { latest_version: 7 } },
    { ack: { modify_time: '1789449999' } },
  ] as readonly Faults[]) {
    const f = durableFixture(faults);
    try {
      const result = durable(await f.run.run());
      assert.equal(result.status, 'capability_unavailable');
      assert.equal(
        result.reason,
        faults.lostAck === true ? 'response_unavailable' : 'acknowledgement_unverified',
      );
      assert.equal(result.save.outcome, 'unknown');
      assert.equal(result.save.post.attempts, 1);
      assert.equal(result.save.post.acknowledged, false);
      assert.equal(result.comparison?.matches, true);
      assert.equal(result.durable, true);
      assert.equal(result.verifiedLive, false);
      assert.equal(postCount(f.f), 1);
      const context = completeContext(f);
      validateNativeShortBodyEvidenceContext(context, 'complete');
      assert.equal(context.attempts.length, 1);
      assert.equal(
        context.refs.some((ref) => ref.dataset === NATIVE_SHORT_BODY_DATASETS.acknowledgement),
        false,
      );
      assert(!JSON.stringify(result).includes('private-'));
    } finally {
      f.close();
    }
  }
});

test('body durable API no_change and preSave drift preserve no form no permit and zero POST', async () => {
  const noChange = durableFixture({
    request: business(PLAIN, { action: 'preserve' }),
    desired: PLAIN,
  });
  try {
    const result = durable(await noChange.run.run());
    assert.equal(result.status, 'no_change');
    assert.equal(result.reason, 'no_change');
    assert.equal(result.durable, true);
    assert.equal(result.verifiedLive, false);
    assert.equal(result.plan, null);
    assert.equal(result.expectation, null);
    assert.equal(result.desiredContentHash, null);
    assert.equal(result.save.outcome, 'not_attempted');
    assert.equal(result.save.post.attempts, 0);
    assert.equal(postCount(noChange.f), 0);
    assert.deepEqual(
      noChange.store.listEvidence(noChange.job.id).map((ref) => ref.dataset),
      ['short_native_body_baseline', 'write-result'],
    );
    assert.equal(noChange.store.listNativeShortBodyAttempts(noChange.job.id, 'owner').length, 0);
    validateNativeShortBodyEvidenceContext(completeContext(noChange), 'complete');
  } finally {
    noChange.close();
  }
  for (const drift of ['unknown', 'cover', 'revision', 'title', 'catalog'] as const) {
    const f = durableFixture({ drift });
    try {
      const result = durable(await f.run.run());
      assert.equal(result.reason, 'version_conflict');
      assert.equal(result.status, 'capability_unavailable');
      assert.equal(postCount(f.f), 0);
      assert.equal(f.store.listNativeShortBodyAttempts(f.job.id, 'owner').length, 0);
      assert.equal(
        f.store.listEvidence(f.job.id).some((ref) => ref.dataset === 'write-intent'),
        false,
      );
    } finally {
      f.close();
    }
  }
});

test('body durable API every GET fences callbacks and cancellation retains late owned context without replay', async () => {
  const fenced = durableFixture();
  let callbacks = 0;
  try {
    const decision = prepareNativeShortBodyProductionStart({
      accountId: 'owner',
      workId: WORK,
      businessRequest: fenced.options.businessRequest,
      authority: fenced.authority,
    });
    assert.ok(decision.allowed);
    const run = createOwnedNativeShortBodyRun(decision.start, fenced.f.borrowed, WORK, {
      ...fenced.options,
      onBeforePlatformRead() {
        callbacks++;
        fenced.store.markPlatformReadStarted(fenced.job.id);
        if (callbacks === 6) throw Error('private-callback');
      },
    });
    const result = durable(await run.run());
    assert.equal(result.reason, 'callback_failed');
    assert.equal(callbacks, 6);
    assert.equal(postCount(fenced.f), 0);
    assert.equal(fenced.store.listNativeShortBodyAttempts(fenced.job.id, 'owner').length, 0);
  } finally {
    fenced.close();
  }
  const late = durableFixture({ hold: 'creation' });
  try {
    const running = late.run.run();
    await late.f.entered;
    late.f.controller.abort();
    const result = durable(await running);
    assert.equal(result.reason, 'cancelled');
    assert.equal(result.cleanup.pendingAtEnd > 0, true);
    assert.equal(result.cleanup.quarantined, true);
    assert.equal(result.durable, false);
    assert.equal(postCount(late.f), 0);
    late.f.release();
    await late.run.cleanupDone;
    assert.equal(late.f.disposes, 1);
    assert.equal(result.cleanup.pendingAtEnd > 0, true);
    assert.equal(postCount(late.f), 0);
  } finally {
    late.close();
  }
});
