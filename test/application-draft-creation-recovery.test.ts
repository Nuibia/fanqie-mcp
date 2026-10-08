import test from 'node:test';

import { resumeAppFixture } from './helpers/application-resume-app-fixture.js';

import {
  a6Observe,
  a6Closed,
  a6OpenRepairArgs,
  a6OwnJob,
  a6Details,
} from './helpers/application-a6-observe.js';

import { type Job } from '../src/runtime/store.js';

import assert from 'node:assert/strict';

import {
  a6RawRows,
  recoveryAppHash,
  a6NativeDb,
} from './helpers/application-long-book-metadata-application-fixture.js';

import { a6Unclosed, unknownRepairAppChain } from './helpers/application-a6-unclosed.js';

import { r6AssertActualPrefix } from './helpers/application-complete-diagnostic-privacy-fixture.js';

import { hashDraftContent as recoveryContentHash } from '../src/platform/writes.js';

test('normal creation recovery lost ACK reconciles its desired version and same-key call closes parent without another save', async (t) => {
  const f = await resumeAppFixture(),
    o = a6Observe(t, f);
  try {
    f.state.lostAck = true;
    const response = (await o.run(() => f.invoke('resume_create_draft', f.args), false)) as {
      job: Job;
      original: { job: Job };
    };
    assert.equal(response.job.status, 'uncertain');
    assert.equal(response.original.job.status, 'uncertain');
    assert.equal(f.state.saves, 1);
    assert.equal(f.state.newEntries, 0);
    const replay = (await o.run(() => f.invoke('resume_create_draft', f.args))) as typeof response;
    assert.equal(replay.job.id, response.job.id);
    assert.equal(f.state.saves, 1);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const jobs = [o.store.getJob(f.original.id), o.store.getJob(response.job.id)],
      ledger = a6RawRows(o.store)[7];
    await assert.rejects(
      o.run(() => f.invoke('reconcile_write', { jobId: response.job.id }), false),
      { code: 'reconciliation_not_live' },
    );
    assert.deepEqual([o.store.getJob(f.original.id), o.store.getJob(response.job.id)], jobs);
    assert.deepEqual(a6RawRows(o.store)[7], ledger);
    const read = o.records('reconcile_write').at(-1)!;
    assert.equal(read.manifestCount, 1);
    assert.equal(read.refs.length, 1);
    assert.equal(read.refs[0]!.document.collectionMode, 'fixture');
    assert.equal(read.metadata.genericShortStatus.observations[0].ordinal, 1);
    a6Unclosed(f, o);
    const closed = (await o.run(() => f.invoke('resume_create_draft', f.args))) as typeof response;
    assert.equal(closed.job.id, response.job.id);
    assert.equal(closed.original.job.status, 'uncertain');
    assert.equal(f.state.saves, 1);
    assert.equal(f.state.newEntries, 0);
  } finally {
    t.mock.restoreAll();
    await f.cleanup();
  }
  await a6Closed(t, { recovery: 'reconciled' });
});

test('created draft repair updates only the allocated version and preserves superseded recovery on every saved replay', async (t) => {
  const f = await resumeAppFixture(undefined, { recovery: 'unknown' }),
    o = a6Observe(t, f);
  try {
    const args = a6OpenRepairArgs(f, 'synthetic-repair-key');
    await assert.rejects(
      o.run(() => f.invoke('repair_created_draft', args), false),
      { code: 'creation_repair_incomplete' },
    );
    const repair = o.records('repair_created_draft')[0]!;
    assert.equal(repair.row.status, 'succeeded');
    r6AssertActualPrefix(repair, [
      ['creation-repair-baseline', 'baseline'],
      ['editable_snapshot', 'baseline'],
      ['editable_snapshot', 'after'],
      ['creation-repair-verification', 'after'],
    ]);
    assert.equal(f.state.gotos.length, 4);
    assert.equal(f.state.fills, 2);
    assert.equal(f.state.saves, 1);
    assert.equal(f.state.newEntries, 0);
    assert.equal(f.state.body, f.input.content.body);
    assert.deepEqual(o.store.getJob(f.family!.recoveryBefore.id), f.family!.recoveryBefore);
    a6Unclosed(f, o);
  } finally {
    t.mock.restoreAll();
    await f.cleanup();
  }
  await a6Closed(t, {
    recovery: 'unknown',
    repairCount: 1,
    final: 'write',
    key: 'synthetic-repair-key',
  });
});

test('created draft repair rejects changed request or current version before another fill or save', async (t) => {
  for (const variant of ['request', 'reference', 'hash', 'published'] as const) {
    const f = await resumeAppFixture(undefined, { recovery: 'unknown' }),
      o = a6Observe(t, f);
    try {
      const args = a6OpenRepairArgs(f, 'repair-refusal'),
        before = { fills: f.state.fills, saves: f.state.saves };
      if (variant === 'request')
        await assert.rejects(
          o.run(() =>
            f.invoke('repair_created_draft', {
              ...args,
              content: { ...f.input.content, body: 'Changed body\n' },
            }),
          ),
          { code: 'invalid_creation_repair' },
        );
      else if (variant === 'reference')
        await assert.rejects(
          o.run(() =>
            f.invoke('repair_created_draft', { ...args, clientReference: 'changed-reference' }),
          ),
          { code: 'invalid_creation_repair' },
        );
      else {
        if (variant === 'hash') args.expectedContentHash = recoveryAppHash('wrong baseline');
        else {
          f.state.published = true;
          f.state.displayStatus = 1;
        }
        const response = (await o.run(() => f.invoke('repair_created_draft', args), false)) as {
          job: Job;
        };
        assert.equal(response.job.status, 'failed');
        assert.equal(response.job.error?.code, 'version_conflict');
        const refused = o.records('repair_created_draft')[0]!;
        r6AssertActualPrefix(refused, [['creation-repair-baseline', 'baseline']]);
        assert.equal(refused.row.target_json, null);
        assert.equal(refused.row.write_started_at, null);
        assert.equal(a6RawRows(o.store)[5]!.length, 0);
        assert.equal(f.state.gotos.length, 1);
      }
      assert.deepEqual({ fills: f.state.fills, saves: f.state.saves }, before);
      assert.equal(f.state.newEntries, 0);
      assert.deepEqual(o.store.getJob(f.original.id), f.family!.originalBefore);
      assert.deepEqual(o.store.getJob(f.family!.recoveryBefore.id), f.family!.recoveryBefore);
      if (variant === 'hash') {
        assert.equal(
          a6NativeDb(o.store).prepare('SELECT COUNT(*) AS count FROM creation_repairs').get()!
            .count,
          0,
        );
        await assert.rejects(
          o.run(
            () =>
              f.invoke('repair_created_draft', {
                ...args,
                idempotencyKey: 'fresh-version-after-readonly-failure',
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
        assert.equal(f.state.newEntries, 0);
        a6Unclosed(f, o);
      }
    } finally {
      t.mock.restoreAll();
      await f.cleanup();
    }
  }
  await a6Closed(t, {
    recovery: 'unknown',
    repairCount: 1,
    final: 'write',
    key: 'fresh-version-after-readonly-failure',
  });
});

test('created draft repair lost ACK reconciles full snapshot and same key closes ancestors without repeating save', async (t) => {
  const f = await resumeAppFixture(undefined, { recovery: 'unknown' }),
    o = a6Observe(t, f);
  try {
    f.state.lostAck = true;
    const args = a6OpenRepairArgs(f, 'lost-repair-key'),
      repair = (await o.run(() => f.invoke('repair_created_draft', args), false)) as {
        job: Job;
        original: { job: Job };
        recovered: { job: Job };
      };
    assert.equal(repair.job.status, 'uncertain');
    assert.equal(repair.original.job.status, 'uncertain');
    assert.equal(repair.recovered.job.status, 'uncertain');
    assert.equal(f.state.saves, 1);
    assert.equal(f.state.newEntries, 0);
    r6AssertActualPrefix(o.records('repair_created_draft')[0]!, [
      ['creation-repair-baseline', 'baseline'],
      ['editable_snapshot', 'baseline'],
    ]);
    const replay = (await o.run(() => f.invoke('repair_created_draft', args))) as typeof repair;
    assert.equal(replay.job.id, repair.job.id);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const jobs = [
        o.store.getJob(f.original.id),
        o.store.getJob(f.family!.recoveryBefore.id),
        o.store.getJob(repair.job.id),
      ],
      ledger = a6RawRows(o.store)[7];
    await assert.rejects(
      o.run(() => f.invoke('reconcile_write', { jobId: repair.job.id }), false),
      { code: 'reconciliation_not_live' },
    );
    assert.deepEqual(
      [
        o.store.getJob(f.original.id),
        o.store.getJob(f.family!.recoveryBefore.id),
        o.store.getJob(repair.job.id),
      ],
      jobs,
    );
    assert.deepEqual(a6RawRows(o.store)[7], ledger);
    const read = o.records('reconcile_write').at(-1)!;
    assert.equal(read.manifestCount, 1);
    assert.equal(read.refs.length, 1);
    assert(read.refs[0]!.document.payload.repairVerification);
    assert.equal(read.refs[0]!.document.collectionMode, 'fixture');
    const closed = (await o.run(() => f.invoke('repair_created_draft', args))) as typeof repair;
    assert.equal(closed.job.id, repair.job.id);
    assert.equal(closed.original.job.status, 'uncertain');
    assert.equal(closed.recovered.job.status, 'uncertain');
    assert.equal(f.state.saves, 1);
    a6Unclosed(f, o);
  } finally {
    t.mock.restoreAll();
    await f.cleanup();
  }
  await a6Closed(t, {
    recovery: 'unknown',
    repairCount: 1,
    final: 'reconciled',
    key: 'lost-repair-key',
  });
});

test('created draft repair successor follows only the latest unknown leaf and preserves every earlier attempt on closure', async (t) => {
  const { f, recovery, first, firstArgs } = await unknownRepairAppChain(2),
    o = a6Observe(t, f);
  assert(f.family);
  const second = f.family.repairsBefore[1]!,
    secondArgs = f.family.repairArgs[1]!;
  try {
    const beforeJobs = (await o.run(() =>
      f.application.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), {}),
    )) as { jobs: Record<string, any>[] };
    assert.equal(beforeJobs.jobs.length, f.family.jobs.length);
    for (const job of beforeJobs.jobs)
      a6OwnJob(
        job,
        f.family.jobs.find((value) => value.id === job.id)!,
      );
    await assert.rejects(
      o.run(() => f.invoke('reconcile_write', { jobId: recovery.job.id })),
      { code: 'creation_repair_conflict' },
    );
    assert.equal(
      (
        (await o.run(() =>
          f.application.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), {}),
        )) as typeof beforeJobs
      ).jobs.length,
      beforeJobs.jobs.length,
    );
    await assert.rejects(
      o.run(() => f.invoke('reconcile_write', { jobId: first.job.id })),
      { code: 'creation_repair_conflict' },
    );
    await assert.rejects(
      o.run(() =>
        f.invoke('repair_created_draft', { ...secondArgs, idempotencyKey: 'sibling-key' }),
      ),
      { code: 'creation_repair_conflict' },
    );
    const replay = (await o.run(() => f.invoke('repair_created_draft', firstArgs))) as typeof first;
    assert.equal(replay.job.id, first.job.id);
    assert.equal(replay.job.status, 'uncertain');
    await a6Details(f, o, [first.job]);
    f.state.lostAck = false;
    const thirdArgs = a6OpenRepairArgs(f, 'successor-third-repair', second);
    await assert.rejects(
      o.run(() => f.invoke('repair_created_draft', thirdArgs), false),
      { code: 'creation_repair_incomplete' },
    );
    const latest = o.records('repair_created_draft').at(-1)!;
    assert.equal(latest.row.status, 'succeeded');
    r6AssertActualPrefix(latest, [
      ['creation-repair-baseline', 'baseline'],
      ['editable_snapshot', 'baseline'],
      ['editable_snapshot', 'after'],
      ['creation-repair-verification', 'after'],
    ]);
    assert.equal(f.state.saves, 1);
    assert.equal(f.state.newEntries, 0);
    assert.equal(f.state.body, f.input.content.body);
    assert.deepEqual(o.store.getJob(first.job.id), first.job);
    assert.deepEqual(o.store.getJob(second.id), second);
    a6Unclosed(f, o);
  } finally {
    t.mock.restoreAll();
    await f.cleanup();
  }
  await a6Closed(
    t,
    { recovery: 'unknown', repairCount: 3, final: 'write', key: 'successor-third-repair' },
    'Synthetic recovery body\n\n\nSecond paragraph\n',
  );
});
