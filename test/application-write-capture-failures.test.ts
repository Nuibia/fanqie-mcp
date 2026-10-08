import test from 'node:test';

import { resumeAppFixture } from './helpers/application-resume-app-fixture.js';

import {
  Store as CreationRecoveryStore,
  RuntimeError as R6AppRuntimeError,
} from '../src/runtime/store.js';

import assert from 'node:assert/strict';

import {
  r6AppRecords,
  r6AssertNoPrivateStatus,
  r6AssertActualPrefix,
} from './helpers/application-complete-diagnostic-privacy-fixture.js';

import { DatabaseSync } from 'node:sqlite';

import path from 'node:path';

import { repairAppFixture } from './helpers/application-a6-unclosed.js';

import { hashDraftContent as recoveryContentHash } from '../src/platform/writes.js';

for (const failure of ['capture_failed', 'persist_failed'] as const)
  test(`R6 App ${failure} before any ref remains sticky and creates no manifest`, async (t) => {
    const f = await resumeAppFixture();
    try {
      if (failure === 'capture_failed') f.state.displayStatus = Number.NaN;
      else {
        const save = CreationRecoveryStore.prototype.saveEvidence;
        t.mock.method(
          CreationRecoveryStore.prototype,
          'saveEvidence',
          function (this: CreationRecoveryStore, id: string, dataset: string, payload: unknown) {
            if (dataset === 'editable_snapshot')
              throw new R6AppRuntimeError(
                'capability_unavailable',
                'Synthetic R6 observation persistence fault.',
              );
            return save.call(this, id, dataset, payload);
          },
        );
      }
      await assert.rejects(
        f.invoke('get_editable_snapshot', {
          target: { kind: 'short', workId: '1234567890123456789' },
        }),
        { code: 'capability_unavailable' },
      );
      const records = r6AppRecords(f, 'editable_snapshot');
      assert.equal(records.length, 1);
      const failed = records[0]!;
      assert.equal(failed.row.status, 'failed');
      assert.equal(failed.manifestCount, 0);
      assert.deepEqual(failed.refs, []);
      assert.equal(failed.metadata.genericShortStatus.stage, failure);
      assert.equal(failed.metadata.genericShortStatus.failure.kind, failure);
      assert.deepEqual(failed.metadata.genericShortStatus.observations, []);
      t.mock.restoreAll();
      await assert.rejects(
        f.application.dispatch(
          'GET',
          '/api/v1/jobs/' + failed.row.id,
          new URLSearchParams(),
          undefined,
        ),
        { code: 'capability_unavailable' },
      );
      assert.equal(f.state.fills, 0);
      assert.equal(f.state.saves, 0);
    } finally {
      t.mock.restoreAll();
      await f.cleanup();
    }
  });

test('R6 App pure pre-read unavailable source keeps exact unknown null tuple without a manifest', async () => {
  const f = await resumeAppFixture(),
    push = f.state.gotos.push;
  try {
    f.state.gotos.push = (..._items: string[]): number => {
      throw new R6AppRuntimeError(
        'capability_unavailable',
        'Synthetic navigation source unavailable before GET.',
      );
    };
    const response = (await f.invoke('get_editable_snapshot', {
      target: { kind: 'short', workId: '1234567890123456789' },
    })) as Record<string, any>;
    assert.equal(response.job.status, 'failed');
    assert.equal(response.sourceMode, 'incomplete');
    for (const key of ['statusFacts', 'statusSource', 'statusEvidence'])
      assert.equal(response.job[key], null);
    assert.equal(response.job.state, 'unknown');
    assert.deepEqual(response.evidence, []);
    assert.deepEqual(response.data, []);
    const stored = r6AppRecords(f, 'editable_snapshot')[0]!;
    assert.equal(stored.manifestCount, 0);
    assert.deepEqual(stored.refs, []);
    assert.equal(stored.metadata.genericShortStatus.stage, 'source_unavailable');
    assert.equal(stored.metadata.genericShortStatus.failure.kind, 'source_unavailable');
    r6AssertNoPrivateStatus(response);
    assert.equal(f.state.fills, 0);
    assert.equal(f.state.saves, 0);
  } finally {
    f.state.gotos.push = push;
    await f.cleanup();
  }
});

test('R6 App injected resume retains three actual observations but cannot close the original live effect', async () => {
  const f = await resumeAppFixture();
  try {
    await assert.rejects(f.invoke('resume_create_draft', f.args), {
      code: 'creation_recovery_incomplete',
    });
    const records = r6AppRecords(f, 'resume_create_draft');
    assert.equal(records.length, 1);
    const resume = records[0]!;
    assert.equal(resume.row.status, 'succeeded');
    assert.equal(resume.metadata.genericShortStatus.stage, 'completed');
    assert.equal(resume.metadata.genericShortStatus.failure, null);
    r6AssertActualPrefix(resume, [
      ['creation-resume-baseline', 'baseline'],
      ['editable_snapshot', 'baseline'],
      ['editable_snapshot', 'after'],
    ]);
    assert.deepEqual(
      resume.refs.map(({ ref }) => ref.dataset),
      [
        'creation-resume-baseline',
        'editable_snapshot',
        'write-intent',
        'editable_snapshot',
        'write-result',
      ],
    );
    const result = resume.refs.find(({ ref }) => ref.dataset === 'write-result')!.document.payload;
    assert.deepEqual(
      Object.keys(result).sort(),
      [
        'status',
        'capability',
        'target',
        'contentHash',
        'platformState',
        'verifiedAt',
        'sourceUrl',
      ].sort(),
    );
    assert.equal(f.state.gotos.length, 3);
    assert.equal(f.state.fills, 2);
    assert.equal(f.state.saves, 1);
    assert.equal(f.state.newEntries, 0);
    const db = new DatabaseSync(path.join(f.config.dataDir, 'operations.sqlite'));
    try {
      assert.equal(
        db.prepare('SELECT status FROM jobs WHERE id=?').get(f.original.id)!.status,
        'uncertain',
      );
      assert.equal(
        db
          .prepare('SELECT closed_at FROM creation_recoveries WHERE original_job_id=?')
          .get(f.original.id)!.closed_at,
        null,
      );
      assert.equal(
        Number(
          db
            .prepare('SELECT COUNT(*) AS n FROM write_reconciliations WHERE original_job_id=?')
            .get(f.original.id)!.n,
        ),
        0,
      );
    } finally {
      db.close();
    }
    const publicResume = (await f.application.dispatch(
      'GET',
      '/api/v1/jobs/' + resume.row.id,
      new URLSearchParams(),
      undefined,
    )) as Record<string, any>;
    r6AssertNoPrivateStatus(publicResume);
    for (const row of publicResume.data.filter(
      (item: Record<string, unknown>) => item.dataset === 'editable_snapshot',
    ))
      assert.deepEqual(
        Object.keys(row).sort(),
        [
          'sourceRef',
          'evidenceHash',
          'evidenceCapturedAt',
          'dataset',
          'phase',
          'contentHash',
          'platformReadAt',
          'state',
          'statusFacts',
          'statusSource',
        ].sort(),
      );
  } finally {
    await f.cleanup();
  }
});

test('R6 App resume failed blank guard retains the actual first-read prefix before zero save', async () => {
  const f = await resumeAppFixture();
  try {
    f.state.title = 'Synthetic pre-existing title';
    const response = (await f.invoke('resume_create_draft', f.args)) as Record<string, any>;
    assert.equal(response.job.status, 'failed');
    assert.equal(response.job.error.code, 'creation_recovery_not_blank');
    const stored = r6AppRecords(f, 'resume_create_draft')[0]!;
    r6AssertActualPrefix(stored, [['creation-resume-baseline', 'baseline']]);
    assert.equal(stored.metadata.genericShortStatus.stage, 'precondition_blocked');
    assert.equal(stored.metadata.genericShortStatus.failure.kind, 'precondition_blocked');
    assert.equal(f.state.gotos.length, 1);
    assert.equal(f.state.fills, 0);
    assert.equal(f.state.saves, 0);
    assert.equal(response.job.state, 'draft');
    r6AssertNoPrivateStatus(response);
  } finally {
    await f.cleanup();
  }
});

test('R6 injected App repair retains both baseline reads before refusing fixture ancestors at claim', async () => {
  const f = await repairAppFixture();
  try {
    f.state.lostAck = true;
    const recovery = (await f.invoke('resume_create_draft', f.args)) as Record<string, any>;
    assert.equal(recovery.job.status, 'uncertain');
    f.state.lostAck = false;
    f.state.body = 'Synthetic recovery body\n';
    const before = { fills: f.state.fills, saves: f.state.saves, reads: f.state.gotos.length };
    const args = {
      ...f.args,
      recoveryJobId: recovery.job.id,
      idempotencyKey: 'r6-fixture-repair-refusal',
      expectedState: 'draft',
      expectedContentHash: recoveryContentHash({ title: f.state.title, body: f.state.body }),
    };
    const response = (await f.invoke('repair_created_draft', args)) as Record<string, any>;
    assert.equal(response.job.status, 'failed');
    const record = r6AppRecords(f, 'repair_created_draft')[0]!;
    r6AssertActualPrefix(record, [
      ['creation-repair-baseline', 'baseline'],
      ['editable_snapshot', 'baseline'],
    ]);
    assert.equal(record.metadata.genericShortStatus.stage, 'precondition_blocked');
    assert.equal(record.row.target_json, null);
    assert.equal(record.row.write_started_at, null);
    assert.equal(record.manifestCount, 0);
    assert.equal(f.state.gotos.length, before.reads + 2);
    assert.equal(f.state.fills, before.fills);
    assert.equal(f.state.saves, before.saves);
    const db = new DatabaseSync(path.join(f.config.dataDir, 'operations.sqlite'));
    try {
      assert.equal(
        Number(
          db
            .prepare('SELECT COUNT(*) AS n FROM creation_repairs WHERE recovery_job_id=?')
            .get(recovery.job.id)!.n,
        ),
        0,
      );
      assert.equal(
        db.prepare('SELECT status FROM jobs WHERE id=?').get(f.original.id)!.status,
        'uncertain',
      );
      assert.equal(
        db.prepare('SELECT status FROM jobs WHERE id=?').get(recovery.job.id)!.status,
        'uncertain',
      );
    } finally {
      db.close();
    }
    r6AssertNoPrivateStatus(response);
  } finally {
    await f.cleanup();
  }
});
