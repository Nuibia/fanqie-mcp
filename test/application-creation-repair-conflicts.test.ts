import test from 'node:test';

import { unknownRepairAppChain, a6Unclosed } from './helpers/application-a6-unclosed.js';

import { a6Observe, a6OpenRepairArgs, a6Closed } from './helpers/application-a6-observe.js';

import {
  recoveryAppHash,
  a6NativeDb,
  a6RawRows,
} from './helpers/application-long-book-metadata-application-fixture.js';

import { type Job } from '../src/runtime/store.js';

import assert from 'node:assert/strict';

import { r6AssertActualPrefix } from './helpers/application-complete-diagnostic-privacy-fixture.js';

import { hashDraftContent as recoveryContentHash } from '../src/platform/writes.js';

test('created draft repair successor readonly conflicts leave no claim and unrelated unknown writes remain blocked', async (t) => {
  for (const unrelated of [false, true]) {
    const { f, first } = await unknownRepairAppChain(1, unrelated),
      o = a6Observe(t, f);
    try {
      f.state.lostAck = false;
      const args = a6OpenRepairArgs(f, 'stale-successor', first.job);
      args.expectedContentHash = recoveryAppHash('stale full version');
      const before = { fills: f.state.fills, saves: f.state.saves, checks: f.state.checks };
      const failed = (await o.run(() => f.invoke('repair_created_draft', args), false)) as {
        job: Job;
      };
      assert.equal(failed.job.status, 'failed');
      assert.equal(failed.job.error?.code, unrelated ? 'unresolved_write' : 'version_conflict');
      assert.equal(
        a6NativeDb(o.store)
          .prepare('SELECT COUNT(*) AS count FROM creation_repair_successors')
          .get()!.count,
        0,
      );
      assert.equal(f.state.fills, before.fills);
      assert.equal(f.state.saves, before.saves);
      assert.equal(f.state.newEntries, 0);
      assert.deepEqual(o.store.getJob(first.job.id), first.job);
      if (unrelated) assert.equal(f.state.checks, before.checks);
      else {
        const rejected = o.records('repair_created_draft').at(-1)!;
        r6AssertActualPrefix(rejected, [['creation-repair-baseline', 'baseline']]);
        assert.equal(rejected.row.target_json, null);
        assert.equal(rejected.row.write_started_at, null);
        await assert.rejects(
          o.run(
            () =>
              f.invoke('repair_created_draft', {
                ...args,
                idempotencyKey: 'fresh-successor-after-readonly-conflict',
                expectedContentHash: recoveryContentHash({
                  title: f.state.title,
                  body: f.state.body,
                }),
              }),
            false,
          ),
          { code: 'creation_repair_incomplete' },
        );
        const fresh = o.records('repair_created_draft').at(-1)!;
        assert.equal(fresh.row.status, 'succeeded');
        r6AssertActualPrefix(fresh, [
          ['creation-repair-baseline', 'baseline'],
          ['editable_snapshot', 'baseline'],
          ['editable_snapshot', 'after'],
          ['creation-repair-verification', 'after'],
        ]);
        assert.equal(f.state.saves, before.saves + 1);
        a6Unclosed(f, o);
      }
    } finally {
      t.mock.restoreAll();
      await f.cleanup();
    }
  }
  await a6Closed(
    t,
    {
      recovery: 'unknown',
      repairCount: 2,
      final: 'write',
      key: 'fresh-successor-after-readonly-conflict',
    },
    'Synthetic recovery body\n\n\nSecond paragraph\n',
  );
});

test('created draft repair successor unknown leaf reconciles normally and same key closes without any new save', async (t) => {
  const { f, first, firstArgs } = await unknownRepairAppChain(),
    o = a6Observe(t, f);
  try {
    const args = a6OpenRepairArgs(f, 'lost-successor-ack', first.job),
      second = (await o.run(() => f.invoke('repair_created_draft', args), false)) as typeof first;
    assert.equal(second.job.status, 'uncertain');
    assert.equal(f.state.saves, 1);
    assert.equal(f.state.newEntries, 0);
    r6AssertActualPrefix(o.records('repair_created_draft').at(-1)!, [
      ['creation-repair-baseline', 'baseline'],
      ['editable_snapshot', 'baseline'],
    ]);
    const oldJobs = [
        o.store.getJob(f.original.id),
        o.store.getJob(f.family!.recoveryBefore.id),
        o.store.getJob(first.job.id),
        o.store.getJob(second.job.id),
      ],
      ledger = a6RawRows(o.store)[7];
    await new Promise((resolve) => setTimeout(resolve, 2));
    await assert.rejects(
      o.run(() => f.invoke('reconcile_write', { jobId: second.job.id }), false),
      { code: 'reconciliation_not_live' },
    );
    assert.deepEqual(
      [
        o.store.getJob(f.original.id),
        o.store.getJob(f.family!.recoveryBefore.id),
        o.store.getJob(first.job.id),
        o.store.getJob(second.job.id),
      ],
      oldJobs,
    );
    assert.deepEqual(a6RawRows(o.store)[7], ledger);
    const read = o.records('reconcile_write').at(-1)!;
    assert.equal(read.manifestCount, 1);
    assert.equal(read.refs.length, 1);
    assert(read.refs[0]!.document.payload.repairVerification);
    assert.equal(read.refs[0]!.document.collectionMode, 'fixture');
    const saved = (await o.run(() => f.invoke('repair_created_draft', args))) as typeof first;
    assert.equal(saved.job.id, second.job.id);
    assert.equal(saved.original.job.status, 'uncertain');
    assert.equal(saved.recovered.job.status, 'uncertain');
    assert.equal(f.state.saves, 1);
    const old = (await o.run(() => f.invoke('repair_created_draft', firstArgs))) as typeof first;
    assert.equal(old.job.id, first.job.id);
    assert.equal(old.job.status, 'uncertain');
    assert.equal(old.job.endedAt, first.job.endedAt);
    a6Unclosed(f, o);
  } finally {
    t.mock.restoreAll();
    await f.cleanup();
  }
  await a6Closed(
    t,
    { recovery: 'unknown', repairCount: 2, final: 'reconciled', key: 'lost-successor-ack' },
    'Synthetic recovery body\n\n\nSecond paragraph\n',
  );
});
