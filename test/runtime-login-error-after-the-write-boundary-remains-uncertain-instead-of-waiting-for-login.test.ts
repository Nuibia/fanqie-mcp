import test from 'node:test';

import {
  fixture,
  digest,
  operatorEntryPair,
  operatorEntryAuditCount,
} from './helpers/runtime-deferred.js';

import { RuntimeError, Store, canonicalJson } from '../src/runtime/store.js';

import assert from 'node:assert/strict';

import { readFileSync, writeFileSync } from 'node:fs';

import path from 'node:path';

test('login error after the write boundary remains uncertain instead of waiting for login', async () => {
  const f = fixture();
  try {
    const job = await f.queue.enqueueWrite({
      accountId: 'author',
      operation: 'publish',
      idempotencyKey: 'login-after-effect',
      inputHash: digest('login-after-effect'),
      run: async (context) => {
        context.beforePlatformWrite();
        throw new RuntimeError('requires_login', 'Login expired during response.');
      },
    }).completion;
    assert.equal(job.status, 'uncertain');
    assert.equal(job.error?.code, 'outcome_unknown');
    assert.equal(
      (job.error?.details as { cause?: { code?: string } })?.cause?.code,
      'requires_login',
    );
  } finally {
    await f.cleanup();
  }
});

test('operator entry investigation closes only the targetless calibration with a durable non-create audit', async () => {
  const f = fixture(30_000, 'live');
  try {
    const p = await operatorEntryPair(f.store),
      prior = p.original;
    const evidenceBytes = f.store
      .listEvidence(prior.id)
      .map((ref) => readFileSync(path.join(f.options.evidenceDirectory, ref.path)));
    const current = f.store.getCurrent('operator-test', 'operator_short_entry_investigation');
    assert.throws(
      () => f.store.reconcileWriteJob(prior.id, p.read.id, { status: 'failed', result: {} }),
      (error: unknown) =>
        error instanceof RuntimeError && error.code === 'reconciliation_target_missing',
    );
    const closed = f.store.resolveOperatorEntryInvestigation(prior.id, p.read.id),
      result = closed.result as Record<string, unknown>;
    assert.equal(closed.status, 'failed');
    assert.equal(closed.error!.code, 'investigated_no_additional_draft');
    assert.equal(closed.target, null);
    assert.equal(result.calibrationOnly, true);
    assert.equal(result.mcpCreateVerified, false);
    assert.equal(result.mcpSaveVerified, false);
    assert.equal(result.historicalTransientSideEffectsVerifiedAbsent, false);
    assert.deepEqual(result.priorError, prior.error);
    assert.deepEqual(result.priorResult, prior.result);
    assert.equal(result.originalEndedAt, prior.endedAt);
    assert.deepEqual(result.writeIntent, p.intentRef);
    assert.deepEqual(result.baselineEvidence, p.baselineRef);
    assert.deepEqual(result.evidence, p.ref);
    assert.equal(operatorEntryAuditCount(p.db), 1);
    assert.deepEqual(
      f.store.getCurrent('operator-test', 'operator_short_entry_investigation'),
      current,
    );
    assert.deepEqual(
      f.store
        .listEvidence(prior.id)
        .map((ref) => readFileSync(path.join(f.options.evidenceDirectory, ref.path))),
      evidenceBytes,
    );
    assert.throws(() => f.store.resolveOperatorEntryInvestigation(prior.id, p.read.id));
    assert.equal(operatorEntryAuditCount(p.db), 1);
    const replay = f.store.createJob({
      accountId: prior.accountId,
      kind: 'write',
      operation: prior.operation,
      scope: prior.scope,
      idempotencyKey: prior.idempotencyKey!,
      inputHash: prior.inputHash,
    });
    assert.equal(replay.created, false);
    assert.equal(replay.job.id, prior.id);
    assert.equal(replay.job.status, 'failed');
    await f.queue.drainAndStop();
    f.store.close();
    const reopened = new Store(f.options);
    try {
      assert.deepEqual(reopened.getJob(prior.id), closed);
      assert.equal(
        operatorEntryAuditCount(
          (reopened as unknown as { db: import('node:sqlite').DatabaseSync }).db,
        ),
        1,
      );
    } finally {
      reopened.close();
    }
  } finally {
    await f.cleanup();
  }
});

test('operator entry investigation rejects unrelated operations, targets, intent or unobserved actions', async () => {
  const cases: Parameters<typeof operatorEntryPair>[1][] = [
    { original: { operation: 'create_short_story_draft' } },
    { original: { scope: 'other' } },
    {
      original: { target_json: canonicalJson({ kind: 'short-story', id: '1234567890123456789' }) },
    },
    { original: { status: 'failed' } },
    { original: { input_hash: digest('different') } },
    { intent: { action: 'open_observed_existing_editor' } },
    { intent: { fillPermitted: true } },
    { intent: { publicationPermitted: true } },
    { intent: { selectedTitleHash: 'bad' } },
    { intent: { target: { kind: 'short-story', id: '1234567890123456789' } } },
    { baseline: { newEntryClickAttempts: 2 } },
    { baseline: { explicitFillCalls: 1 } },
    { baseline: { explicitAgreementCalls: 1 } },
    { baseline: { explicitSubmitCalls: 1 } },
    { baseline: { mcpCreatePassed: true } },
    { baseline: { target: { kind: 'short-story', id: '1234567890123456789' } } },
    { read: { operation: 'refresh' } },
    { read: { account_id: 'foreign' } },
    { read: { write_started_at: new Date().toISOString() } },
  ];
  for (const options of cases) {
    const f = fixture(30_000, 'live');
    try {
      const p = await operatorEntryPair(f.store, options),
        before = f.store.getJob(p.original.id);
      assert.throws(() => f.store.resolveOperatorEntryInvestigation(p.original.id, p.read.id));
      assert.deepEqual(f.store.getJob(p.original.id), before);
      assert.equal(operatorEntryAuditCount(p.db), 0);
    } finally {
      await f.cleanup();
    }
  }
});

test('operator entry investigation recomputes complete inventory, ownership, freshness and immutable bindings', async () => {
  const record = {
    itemId: '1234567890123456789',
    titles: [],
    wordNumber: 0,
    createTime: '',
    modifyTime: '',
  };
  const cases: Parameters<typeof operatorEntryPair>[1][] = [
    { observation: { records: [{ ...record, itemId: '9876543210987654321' }] } },
    { observation: { records: [], currentTotal: 0 } },
    { observation: { records: [record, record], currentTotal: 2 } },
    { observation: { currentTotal: 2 } },
    { observation: { pageIndex: 1 } },
    { observation: { pageCount: 0 } },
    { observation: { complete: false } },
    { observation: { originalBaselineRef: {} } },
    { observation: { originalInputHash: digest('wrong') } },
    { observation: { beforeObservedIds: ['9876543210987654321'] } },
    { observation: { ownAccountMatched: false } },
    { observation: { nativeGetOnly: false } },
    { observation: { explicitSaveCalls: 1 } },
    { observation: { editorEntryAttempts: 1 } },
    { observation: { code: 1 } },
    { observation: { source: { mode: 'fixture', origin: 'https://fanqienovel.com' } } },
    { observation: { ownerBefore: '2000-01-01T00:00:00.000Z' } },
    { observation: { ownerAfter: 'invalid' } },
    { observation: { observedAt: '2100-01-01T00:00:00.000Z' } },
    { read: { requested_at: '2000-01-01T00:00:00.000Z' } },
    { read: { result_json: canonicalJson({ evidence: [] }) } },
    {
      baseline: {
        getSamples: [
          {
            path: '/api/author/short_article/draft_list/v0/',
            status: 200,
            fields: [
              { path: '$.code', type: 'number', value: 0 },
              { path: '$.data.item_list[1].item_id', type: 'string', value: record.itemId },
            ],
          },
        ],
      },
    },
  ];
  for (const options of cases) {
    const f = fixture(30_000, 'live');
    try {
      const p = await operatorEntryPair(f.store, options),
        before = f.store.getJob(p.original.id);
      assert.throws(() => f.store.resolveOperatorEntryInvestigation(p.original.id, p.read.id));
      assert.deepEqual(f.store.getJob(p.original.id), before);
      assert.equal(operatorEntryAuditCount(p.db), 0);
    } finally {
      await f.cleanup();
    }
  }
  for (const corrupt of ['fixture', 'bytes'] as const) {
    const f = fixture(30_000, corrupt === 'fixture' ? 'fixture' : 'live');
    try {
      const p = await operatorEntryPair(f.store),
        before = f.store.getJob(p.original.id);
      if (corrupt === 'bytes')
        writeFileSync(path.join(f.options.evidenceDirectory, p.ref.path), 'tampered');
      assert.throws(() => f.store.resolveOperatorEntryInvestigation(p.original.id, p.read.id));
      assert.deepEqual(f.store.getJob(p.original.id), before);
      assert.equal(operatorEntryAuditCount(p.db), 0);
    } finally {
      await f.cleanup();
    }
  }
});

test('operator entry investigation rolls audit and job closure back together on database rejection', async () => {
  const f = fixture(30_000, 'live');
  try {
    const p = await operatorEntryPair(f.store),
      before = f.store.getJob(p.original.id);
    p.db.exec(
      "CREATE TEMP TRIGGER reject_operator_closure BEFORE UPDATE OF status ON jobs WHEN NEW.status = 'failed' BEGIN SELECT RAISE(ABORT, 'synthetic closure fault'); END",
    );
    assert.throws(() => f.store.resolveOperatorEntryInvestigation(p.original.id, p.read.id));
    assert.deepEqual(f.store.getJob(p.original.id), before);
    assert.equal(operatorEntryAuditCount(p.db), 0);
    assert.deepEqual(
      f.store.getCurrent('operator-test', 'operator_short_entry_investigation'),
      p.manifest,
    );
    p.db.exec('DROP TRIGGER reject_operator_closure');
    assert.equal(
      f.store.resolveOperatorEntryInvestigation(p.original.id, p.read.id).status,
      'failed',
    );
    assert.equal(operatorEntryAuditCount(p.db), 1);
  } finally {
    await f.cleanup();
  }
});
