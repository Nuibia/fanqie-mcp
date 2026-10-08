import test from 'node:test';

import { fixture, digest } from './helpers/runtime-deferred.js';

import { nativeStoreDb } from './helpers/runtime-recovery-baseline.js';

import {
  insertSummaryTestRow,
  summaryTestId,
  r6RuntimeFixture,
  r6Begin,
  r6Target,
  r6Db,
  r6StatusSnapshot,
} from './helpers/runtime-native-compensation-later.js';

import assert from 'node:assert/strict';

import { type GenericShortTrustedContext } from '../src/runtime/store.js';

import { randomUUID } from 'node:crypto';

import { r6Unavailable, r6Advance } from './helpers/runtime-r6-advance.js';

test('task summary filters before its 256 row cap and reports exact truncation', async () => {
  const f = fixture(),
    db = nativeStoreDb(f);
  try {
    for (let n = 1; n <= 256; n++) insertSummaryTestRow(db, n);
    for (let n = 1000; n < 1300; n++)
      insertSummaryTestRow(
        db,
        n,
        'author',
        n % 2 ? 'read' : 'write',
        n % 2 ? 'update_short_body' : 'future_private_operation',
        'PRIVATE_UNKNOWN_STATUS',
        '2099-02-01T00:00:00.000Z',
      );
    let value = f.store.listKnownWriteTaskSummaries('author');
    assert.equal(value.tasks.length, 256);
    assert.equal(value.truncated, false);
    assert.equal(value.tasks[0]!.id, summaryTestId(256));
    assert.equal(value.tasks.at(-1)!.id, summaryTestId(1));
    insertSummaryTestRow(db, 257);
    value = f.store.listKnownWriteTaskSummaries('author');
    assert.equal(value.tasks.length, 256);
    assert.equal(value.truncated, true);
    assert.equal(value.tasks[0]!.id, summaryTestId(257));
    assert.equal(value.tasks.at(-1)!.id, summaryTestId(2));
    assert.deepEqual(f.store.listKnownWriteTaskSummaries('empty').tasks, []);
    assert.equal(f.store.listKnownWriteTaskSummaries('empty').truncated, false);
  } finally {
    await f.cleanup();
  }
});

test('task summary rejects malformed selected scalars and mandatory account without an empty success', async () => {
  const f = fixture(),
    db = nativeStoreDb(f);
  try {
    for (const [column, value] of [
      ['status', 'PRIVATE_UNKNOWN_STATUS'],
      ['id', 'synthetic-invalid-id'],
      ['requested_at', '2099-01-01T00:00:00Z'],
      ['ended_at', '2098-01-01T00:00:00.000Z'],
    ] as const) {
      db.exec('DELETE FROM jobs');
      insertSummaryTestRow(db, 1);
      db.prepare(`UPDATE jobs SET ${column}=?`).run(value);
      assert.throws(() => f.store.listKnownWriteTaskSummaries('author'), {
        code: 'capability_unavailable',
        message: 'Saved task records are unavailable.',
      });
    }
    for (const account of ['', '../private', undefined, null] as const)
      assert.throws(() => f.store.listKnownWriteTaskSummaries(account as unknown as string), {
        code: 'invalid_request',
      });
  } finally {
    await f.cleanup();
  }
});

test('R6 metadata keeps original scalar limits and bans every other nested namespace', async () => {
  const f = r6RuntimeFixture();
  try {
    const run = r6Begin(f);
    assert.equal(
      f.store.addJobMetadata(run.job.id, {
        permitted: 'x'.repeat(512),
        flag: false,
        empty: null,
        number: 0,
      }).metadata.permitted,
      'x'.repeat(512),
    );
    const before = f.store.getJob(run.job.id)!.metadata;
    for (const values of [
      { permitted: 'x'.repeat(513) },
      { nested: {} },
      { nested: [] },
      { finite: Number.NaN },
      {
        ...Object.fromEntries(
          Array.from({ length: 17 }, (_, i) => ['bounded' + i, 'x'.repeat(512)]),
        ),
      },
    ]) {
      assert.throws(() => f.store.addJobMetadata(run.job.id, values), { code: 'invalid_metadata' });
      assert.deepEqual(f.store.getJob(run.job.id)!.metadata, before);
    }
    for (const key of [
      'body',
      'content',
      'text',
      'html',
      'markdown',
      'args',
      'arguments',
      'payload',
      'cookie',
      'cookies',
      'authorization',
      'token',
      'access_token',
      'refresh-token',
      'password',
      'secret',
      'credentials',
      'headers',
      'storage_state',
      'target',
    ])
      assert.throws(() => f.store.addJobMetadata(run.job.id, { [key]: 'synthetic' }), {
        code: 'invalid_metadata',
      });
    assert.throws(
      () =>
        f.store.addJobMetadata(run.job.id, Object.assign(Object.create(null), { permitted: true })),
      { code: 'invalid_metadata' },
    );
  } finally {
    await f.cleanup();
  }
});

test('R6 witness authority requires actual new INSERT and exact private trusted context', async () => {
  const f = r6RuntimeFixture();
  try {
    const run = r6Begin(f),
      context = f.contexts.get(run.job.id)!;
    const mutations: Partial<GenericShortTrustedContext>[] = [
      { jobId: randomUUID() },
      { accountId: 'other-author' },
      { kind: 'write' },
      { operation: 'update_draft' },
      { scope: 'account' },
      { datasets: ['reconciliation'] },
      { inputHash: digest('other-input') },
      { target: { ...r6Target, id: '2234567890123456789' } },
      {
        creationContext: {
          originalJobId: randomUUID(),
          recoveryJobId: null,
          previousRepairJobId: null,
        },
      },
      { requestBindings: { inputHash: digest('other-binding') } },
      { platformOwnerId: '1002' },
      { profileId: 'different-profile' },
      { profileVerifiedAt: '2026-10-04T00:00:00Z' },
      { identityType: 'author' },
      { provenance: { mode: 'fixture', executor: 'dependency-injected-browser/v1' } },
    ];
    for (const change of mutations) {
      f.contexts.set(run.job.id, { ...context, ...change });
      assert.throws(
        () => f.store.addJobMetadata(run.job.id, { genericShortStatus: run.witness }),
        r6Unavailable,
      );
    }
    f.contexts.delete(run.job.id);
    assert.throws(
      () => f.store.addJobMetadata(run.job.id, { genericShortStatus: run.witness }),
      r6Unavailable,
    );
    f.contexts.set(run.job.id, context);
    const row = r6Db(f).prepare('SELECT * FROM jobs WHERE id=?').get(run.job.id)!,
      id = randomUUID(),
      columns = Object.keys(row);
    r6Db(f)
      .prepare(`INSERT INTO jobs(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`)
      .run(
        ...columns.map((key) => (key === 'id' ? id : key === 'metadata_json' ? '{}' : row[key]!)),
      );
    f.contexts.set(id, { ...context, jobId: id });
    assert.throws(
      () => f.store.addJobMetadata(id, { genericShortStatus: run.witness }),
      r6Unavailable,
    );
    assert.deepEqual(f.store.getJob(id)!.metadata, {});
    assert.deepEqual(f.store.getJob(run.job.id)!.metadata.genericShortStatus, run.witness);
  } finally {
    await f.cleanup();
  }
});

test('R6 witness stages and observation prefix bind actual refs and cannot be rewritten', async () => {
  const f = r6RuntimeFixture();
  try {
    const run = r6Begin(f),
      initial = structuredClone(run.witness);
    assert.throws(
      () =>
        f.store.addJobMetadata(run.job.id, {
          genericShortStatus: { ...initial, stage: 'completed' },
        }),
      r6Unavailable,
    );
    assert.throws(
      () =>
        f.store.addJobMetadata(run.job.id, {
          genericShortStatus: {
            ...initial,
            observations: [
              {
                ordinal: 1,
                dataset: 'editable_snapshot',
                phase: 'snapshot_read',
                evidenceId: randomUUID(),
                evidenceHash: digest('invented'),
              },
            ],
          },
        }),
      r6Unavailable,
    );
    const at = f.store.markPlatformReadStarted(run.job.id),
      ref = f.store.saveEvidence(run.job.id, 'editable_snapshot', {
        schema: 'fanqie-generic-short-editor-observation/v1',
        phase: 'snapshot_read',
        snapshot: r6StatusSnapshot(at),
        source: { mode: 'live', origin: 'https://fanqienovel.com' },
      });
    r6Advance(f, run, 'read_saved', ref);
    for (const change of [
      { ordinal: 2 },
      { dataset: 'reconciliation' },
      { phase: 'later_read' },
      { evidenceId: randomUUID() },
      { evidenceHash: digest('different-evidence') },
    ])
      assert.throws(
        () =>
          f.store.addJobMetadata(run.job.id, {
            genericShortStatus: {
              ...run.witness,
              observations: [{ ...run.witness.observations[0], ...change }],
            },
          }),
        r6Unavailable,
      );
    assert.throws(
      () =>
        f.store.addJobMetadata(run.job.id, {
          genericShortStatus: { ...run.witness, observations: [] },
        }),
      r6Unavailable,
    );
    assert.throws(
      () =>
        f.store.addJobMetadata(run.job.id, {
          genericShortStatus: { ...run.witness, profileId: 'changed-profile' },
        }),
      r6Unavailable,
    );
    r6Advance(f, run, 'completed');
    assert.deepEqual(f.store.completeReadJob(run.job.id, [ref]).evidence, [ref]);
  } finally {
    await f.cleanup();
  }
});
