import test from 'node:test';

import { nativeCompensationFixture } from './helpers/runtime-native-compensation-fixture.js';

import {
  nativeCompensationLater,
  SUMMARY_TEST_OPERATIONS,
  insertSummaryTestRow,
  summaryTestAt,
  summaryTestId,
} from './helpers/runtime-native-compensation-later.js';

import { nativeStoreDb } from './helpers/runtime-recovery-baseline.js';

import { randomUUID } from 'node:crypto';

import { canonicalJson, RuntimeError, Store } from '../src/runtime/store.js';

import { rmSync, writeFileSync } from 'node:fs';

import path from 'node:path';

import assert from 'node:assert/strict';

import { fixture } from './helpers/runtime-deferred.js';

test('server compensation saved terminal rejects missing, aliased or forked SQL and registration contexts across every durable exit', async (t) => {
  for (const mutation of [
    'remove current row',
    'remove first row',
    'first pointer alias',
    'first pointer fake',
    'extra reserved schema',
    'wrong error',
    'missing registration manifest',
    'registration current promotion',
    'missing operator evidence',
    'registration bytes',
  ])
    await t.test(mutation, async () => {
      const f = await nativeCompensationFixture();
      try {
        const registry = f.store.registerNativeCompensationAttestation(f.input),
          later = await nativeCompensationLater(f),
          closed = f.store.reconcileWriteJob(f.original.id, later.read.id, later.resolution);
        const db = nativeStoreDb(f);
        if (mutation === 'remove current row')
          db.prepare(
            'DELETE FROM write_reconciliations WHERE original_job_id=? AND read_job_id=?',
          ).run(closed.id, later.read.id);
        if (mutation === 'remove first row')
          db.prepare(
            'DELETE FROM write_reconciliations WHERE rowid=(SELECT min(rowid) FROM write_reconciliations WHERE original_job_id=?)',
          ).run(closed.id);
        if (
          mutation === 'first pointer alias' ||
          mutation === 'first pointer fake' ||
          mutation === 'extra reserved schema'
        ) {
          const result = structuredClone(closed.result) as any;
          if (mutation === 'first pointer alias')
            result.originalAttemptEvidence = {
              readJobId: later.read.id,
              evidenceId: later.ref.id,
              evidenceHash: later.ref.sha256,
            };
          if (mutation === 'first pointer fake')
            result.originalAttemptEvidence.readJobId = randomUUID();
          if (mutation === 'extra reserved schema')
            result.extra = { schema: 'native-short-metadata-compensation-future/v999' };
          const bytes = canonicalJson(result);
          db.prepare('UPDATE jobs SET result_json=? WHERE id=?').run(bytes, closed.id);
          db.prepare(
            'UPDATE write_reconciliations SET result_json=? WHERE original_job_id=? AND read_job_id=?',
          ).run(bytes, closed.id, later.read.id);
        }
        if (mutation === 'wrong error')
          db.prepare('UPDATE jobs SET error_json=? WHERE id=?').run(
            canonicalJson({ code: 'not_applied', message: 'Fake old acceptance.' }),
            closed.id,
          );
        if (mutation === 'missing registration manifest')
          db.prepare('DELETE FROM manifests WHERE job_id=?').run(registry.id);
        if (mutation === 'registration current promotion') {
          const m = (registry.result as any).manifest;
          db.prepare(
            'INSERT INTO current_manifests(account_id,scope,manifest_id) VALUES(?,?,?)',
          ).run(registry.accountId, registry.scope, m.id);
        }
        if (mutation === 'missing operator evidence')
          rmSync(
            path.join(f.options.evidenceDirectory, f.store.listEvidence(f.operator.id)[2]!.path),
          );
        if (mutation === 'registration bytes')
          writeFileSync(
            path.join(f.options.evidenceDirectory, f.store.listEvidence(registry.id)[0]!.path),
            'SYNTHETIC_CORRUPT_ADMIN_BYTES',
          );
        const unavailable = (e: unknown) =>
          e instanceof RuntimeError && e.code === 'capability_unavailable';
        if (mutation === 'missing registration manifest')
          assert.equal(f.store.getManifestForJob('author', registry.id), null);
        else
          assert.throws(
            () => f.store.getManifestForJob('author', registry.id),
            unavailable,
            'A targeted administrative lookup still verifies every related private graph binding.',
          );
        assert.throws(() => f.store.getJob(closed.id), unavailable);
        assert.throws(() => f.store.listJobs('author'), unavailable);
        assert.throws(
          () => f.store.findIdempotent('author', 'write', closed.operation, closed.idempotencyKey!),
          unavailable,
        );
        assert.throws(() => f.store.getNativeCompensationContext(closed.id), unavailable);
        await f.queue.drainAndStop();
        f.store.close();
        const reopened = new Store(f.options);
        try {
          assert.throws(() => reopened.getJob(closed.id), unavailable);
          assert.throws(() => reopened.listJobs('author'), unavailable);
          assert.throws(
            () =>
              reopened.findIdempotent('author', 'write', closed.operation, closed.idempotencyKey!),
            unavailable,
          );
        } finally {
          reopened.close();
        }
      } finally {
        await f.cleanup();
      }
    });
});

test('server compensation historical sealed source is revalidated without consuming current package admission', async () => {
  const f = await nativeCompensationFixture();
  try {
    f.store.registerNativeCompensationAttestation(f.input);
    const later = await nativeCompensationLater(f),
      closed = f.store.reconcileWriteJob(f.original.id, later.read.id, later.resolution);
    await f.queue.drainAndStop();
    f.store.close();
    const reopened = new Store(f.options);
    try {
      let admissionReads = 0;
      (
        reopened as unknown as { validateNativeCompensationInstalledSource: () => never }
      ).validateNativeCompensationInstalledSource = () => {
        admissionReads++;
        throw new Error('A future package has different public file bytes.');
      };
      assert.deepEqual(reopened.getJob(closed.id), closed);
      assert.deepEqual(
        reopened.findIdempotent('author', 'write', closed.operation, closed.idempotencyKey!),
        closed,
      );
      assert.equal(
        reopened.getNativeCompensationContext(closed.id)!.authority.source.registrationInventory[
          'src/runtime/store.ts'
        ],
        f.authority.source.registrationInventory['src/runtime/store.ts'],
      );
      assert.equal(admissionReads, 0);
    } finally {
      reopened.close();
    }
  } finally {
    await f.cleanup();
  }
});

test('task summary reads six SQL scalars only with account/known-write filtering and no client clock or deep reads', async (t) => {
  const f = fixture(),
    db = nativeStoreDb(f),
    statuses = [
      'queued',
      'running',
      'waiting_for_login',
      'succeeded',
      'partial',
      'failed',
      'uncertain',
      'cancelled',
    ];
  try {
    SUMMARY_TEST_OPERATIONS.forEach((operation, i) =>
      insertSummaryTestRow(
        db,
        i + 1,
        'author',
        'write',
        operation,
        statuses[i % statuses.length]!,
        summaryTestAt,
        i < 2 ? null : summaryTestAt,
      ),
    );
    insertSummaryTestRow(
      db,
      100,
      'foreign',
      'write',
      'update_short_body',
      'PRIVATE_UNKNOWN_STATUS',
    );
    insertSummaryTestRow(db, 101, 'author', 'read', 'update_short_body');
    insertSummaryTestRow(db, 102, 'author', 'write', 'update_short_body_future');
    insertSummaryTestRow(db, 103, 'author', 'write', 'update_short_trial');
    insertSummaryTestRow(
      db,
      104,
      'author',
      'write',
      'create_draft',
      'succeeded',
      '2098-01-01T00:00:00.000Z',
    );
    const calls: string[] = [],
      sql: string[] = [],
      originalPrepare = db.prepare;
    for (const name of [
      'getJob',
      'getJobForPublicProjection',
      'readEvidence',
      'listJobs',
      'listJobsForPublicProjection',
    ] as const)
      t.mock.method(f.store, name, () => {
        calls.push(name);
        throw Error('Synthetic task summaries forbid deep reads');
      });
    t.mock.method(db, 'prepare', function (statement: string) {
      sql.push(statement);
      return originalPrepare.call(db, statement);
    });
    t.mock.method(Date, 'now', () => {
      throw Error('Synthetic saved task record forbids client freshness');
    });
    const value = f.store.listKnownWriteTaskSummaries('author');
    assert.deepEqual(
      Object.keys(value).sort(),
      [
        'schema',
        'sourceMode',
        'purpose',
        'authoritative',
        'bodyIncluded',
        'scope',
        'tasks',
        'truncated',
      ].sort(),
    );
    assert.equal(value.schema, 'fanqie-job-summaries/v1');
    assert.equal(value.sourceMode, 'saved');
    assert.equal(value.purpose, 'task-state-only');
    assert.equal(value.authoritative, false);
    assert.equal(value.bodyIncluded, false);
    assert.equal(value.scope, 'known_write_tasks/v1');
    assert.equal(value.truncated, false);
    assert.equal(value.tasks.length, 11);
    assert.deepEqual(
      value.tasks.slice(0, 10).map((row) => row.id),
      Array.from({ length: 10 }, (_, i) => summaryTestId(10 - i)),
    );
    assert.equal(value.tasks.at(-1)!.id, summaryTestId(104));
    assert.deepEqual(
      new Set(value.tasks.map((row) => row.operation)),
      new Set(SUMMARY_TEST_OPERATIONS),
    );
    assert.deepEqual(new Set(value.tasks.map((row) => row.recordedTaskStatus)), new Set(statuses));
    assert.deepEqual(
      value.tasks.find((row) => row.id === summaryTestId(3)),
      {
        id: summaryTestId(3),
        kind: 'write',
        operation: 'update_work_metadata',
        recordedTaskStatus: 'waiting_for_login',
        requestedAt: summaryTestAt,
        endedAt: summaryTestAt,
      },
    );
    for (const row of value.tasks)
      assert.deepEqual(
        Object.keys(row).sort(),
        ['id', 'kind', 'operation', 'recordedTaskStatus', 'requestedAt', 'endedAt'].sort(),
      );
    assert.deepEqual(calls, []);
    assert.equal(sql.length, 1);
    assert.match(
      sql[0]!,
      /^SELECT id, kind, operation, status AS recordedTaskStatus,\s*requested_at AS requestedAt, ended_at AS endedAt\s*FROM jobs WHERE account_id = \? AND kind = 'write'\s*AND operation IN \(\?,\?,\?,\?,\?,\?,\?,\?,\?,\?\)\s*ORDER BY requested_at DESC, id DESC LIMIT 257$/,
    );
    assert(!JSON.stringify(value).includes('SYNTHETIC_UNSELECTED'));
    assert(!JSON.stringify(value).includes('foreign'));
  } finally {
    t.mock.restoreAll();
    await f.cleanup();
  }
});
