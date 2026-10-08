import test from 'node:test';

import { fixture, digest } from './helpers/runtime-deferred.js';

import { Store } from '../src/runtime/store.js';

import { JobQueue } from '../src/runtime/jobs.js';

import {
  repairChain,
  unknownRepairSuccessor,
  repairBindings,
  successorRepairPrior,
  successorReconciliationRead,
  nativeStoreSnapshot,
  nativeStoreRowCount,
  nativeStoreDb,
  NATIVE_STORE_WORK,
} from './helpers/runtime-recovery-baseline.js';

import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import path from 'node:path';

import { nativeStoreOriginal, nativeStoreLater } from './helpers/runtime-native-store-original.js';

import {
  type NativeShortClosure,
  nativeShortReadScope,
} from '../src/platform/short-native-metadata-proof.js';

test('created draft repair successor latest unknown alone may reconcile and close after same-key restart with zero or one historical result', async () => {
  for (const persistedResult of [false, true]) {
    const f = fixture(30_000, 'live');
    let reopened: Store | undefined;
    let restartedQueue: JobQueue | undefined;
    try {
      const p = await repairChain(f);
      const first = await unknownRepairSuccessor(f, p, 'reconcile-first');
      const bindings = { ...repairBindings, repairInputHash: digest('reconcile successor input') };
      const last = await unknownRepairSuccessor(
        f,
        p,
        'reconcile-latest',
        first.id,
        bindings,
        persistedResult,
      );
      assert.equal(last.status, 'uncertain');
      const lastRefs = f.store.listEvidence(last.id),
        firstPrior = successorRepairPrior(f.store, first);
      const lastBytes = lastRefs.map((ref) =>
        readFileSync(path.join(f.options.evidenceDirectory, ref.path)),
      );
      assert.equal(
        lastRefs.filter((ref) => ref.dataset === 'write-result').length,
        persistedResult ? 1 : 0,
      );
      assert.throws(() => f.store.completeCreationRepair(p.original.id, p.recovery.id, last.id), {
        code: 'creation_repair_incomplete',
      });
      for (const nonleaf of [p.recovery, first]) {
        const read = await successorReconciliationRead(f, nonleaf);
        assert.throws(
          () =>
            f.store.reconcileWriteJob(nonleaf.id, read.id, {
              status: 'succeeded',
              result: {
                contentHash: repairBindings.desiredContentHash,
                platformState: 'draft_saved',
              },
            }),
          { code: 'creation_repair_conflict' },
        );
        assert.deepEqual(f.store.getJob(nonleaf.id), nonleaf);
      }
      const count = f.store.listJobs().length;
      const replay = await f.queue.enqueueWrite({
        accountId: bindings.accountId,
        operation: 'repair_created_draft',
        idempotencyKey: 'reconcile-latest',
        inputHash: bindings.repairInputHash,
        run: async () => {
          assert.fail('An unknown successor must not replay while waiting for reconciliation.');
        },
      }).completion;
      assert.deepEqual(replay, last);
      assert.equal(f.store.listJobs().length, count);
      const read = await successorReconciliationRead(f, last);
      const reconciled = f.store.reconcileWriteJob(last.id, read.id, {
        status: 'succeeded',
        result: { contentHash: repairBindings.desiredContentHash, platformState: 'draft_saved' },
      });
      assert.equal(reconciled.status, 'succeeded');
      assert.equal(
        (reconciled.result as { reconciliationJobId: string }).reconciliationJobId,
        read.id,
      );
      assert.deepEqual(f.store.getJob(p.original.id), p.original);
      assert.deepEqual(f.store.getJob(p.recovery.id), p.recovery);
      assert.deepEqual(f.store.getJob(first.id), first);
      assert.deepEqual(f.store.listEvidence(last.id), lastRefs);
      const db = (f.store as unknown as { db: import('node:sqlite').DatabaseSync }).db;
      assert.equal(
        Number(db.prepare('SELECT COUNT(*) AS count FROM write_reconciliations').get()!.count),
        1,
      );
      const census = f.store.listJobs().length;
      await f.queue.drainAndStop();
      f.store.close();
      reopened = new Store(f.options);
      restartedQueue = new JobQueue(reopened);
      const sameKey = await restartedQueue.enqueueWrite({
        accountId: bindings.accountId,
        operation: 'repair_created_draft',
        idempotencyKey: 'reconcile-latest',
        inputHash: bindings.repairInputHash,
        run: async () => {
          assert.fail('Restarted same-key closure must be read-only.');
        },
      }).completion;
      assert.deepEqual(sameKey, reconciled);
      const closed = reopened.completeCreationRepair(p.original.id, p.recovery.id, last.id);
      assert.equal(closed.status, 'succeeded');
      assert.equal(
        (closed.result as { creationRepair: { proof: { kind: string } } }).creationRepair.proof
          .kind,
        'reconciled-verified-repair',
      );
      assert.deepEqual(
        reopened.completeCreationRepair(p.original.id, p.recovery.id, last.id),
        closed,
      );
      assert.equal(reopened.listJobs().length, census);
      assert.deepEqual(reopened.getJob(last.id), reconciled);
      assert.equal(reopened.getJob(p.recovery.id)!.error?.code, 'superseded_by_verified_repair');
      assert.equal(reopened.getJob(p.recovery.id)!.endedAt, p.recovery.endedAt);
      const failedFirst = reopened.getJob(first.id)!;
      assert.equal(failedFirst.status, 'failed');
      assert.equal(failedFirst.error?.code, 'superseded_by_verified_repair');
      assert.equal(failedFirst.endedAt, first.endedAt);
      assert.deepEqual((failedFirst.result as { prior: unknown }).prior, firstPrior);
      assert.deepEqual(reopened.listEvidence(last.id), lastRefs);
      assert.deepEqual(
        reopened
          .listEvidence(last.id)
          .map((ref) => readFileSync(path.join(f.options.evidenceDirectory, ref.path))),
        lastBytes,
      );
      assert.equal(
        reopened.listEvidence(last.id).filter((ref) => ref.dataset === 'write-result').length,
        persistedResult ? 1 : 0,
      );
    } finally {
      await restartedQueue?.drainAndStop();
      reopened?.close();
      await f.cleanup();
    }
  }
});

test('C3 native reconciliation Store closes only rebuilt content and persists first endedAt across bounded unknown rounds and restart', async () => {
  const f = fixture(30_000, 'live');
  try {
    const original = await nativeStoreOriginal(f),
      originalRefs = f.store.listEvidence(original.id);
    const firstRead = await nativeStoreLater(f, original, nativeStoreSnapshot());
    const first = f.store.reconcileWriteJob(original.id, firstRead.read.id, firstRead.resolution);
    assert.equal(first.status, 'uncertain');
    const secondRead = await nativeStoreLater(f, first, nativeStoreSnapshot('Unrelated'));
    const second = f.store.reconcileWriteJob(
      original.id,
      secondRead.read.id,
      secondRead.resolution,
    );
    assert.equal(second.status, 'uncertain');
    const lastRead = await nativeStoreLater(f, second);
    const closed = f.store.reconcileWriteJob(original.id, lastRead.read.id, lastRead.resolution);
    assert.equal(closed.status, 'succeeded');
    assert.equal(closed.error, null);
    assert.equal(nativeStoreRowCount(f), 3);
    const firstAudit = (f.store.readEvidence(firstRead.ref).payload as { originalAudit: any })
      .originalAudit;
    assert.equal(firstAudit.originalEndedAt, original.endedAt);
    assert.deepEqual(firstAudit.originalResult, original.result);
    assert.deepEqual(firstAudit.priorError, original.error);
    const rows = nativeStoreDb(f)
      .prepare('SELECT result_json, created_at FROM write_reconciliations ORDER BY rowid')
      .all();
    for (let index = 0; index < rows.length; index++) {
      const result = JSON.parse(String(rows[index]!.result_json)) as NativeShortClosure;
      assert.equal(result.originalAudit.originalEndedAt, original.endedAt);
      assert.equal(result.originalAttemptEvidence.readJobId, firstRead.read.id);
      if (index > 0) {
        assert.equal(result.originalAudit.phase, 'continuation');
        assert.equal(result.originalAudit.priorEndedAt, rows[index - 1]!.created_at);
        assert.equal('originalResult' in result.originalAudit, false);
        assert.equal('priorResult' in result.originalAudit, false);
      }
    }
    assert.deepEqual(f.store.listEvidence(original.id), originalRefs);
    assert.equal(
      f.store
        .history('author')
        .filter((item) => item.scope === nativeShortReadScope(NATIVE_STORE_WORK)).length,
      0,
    );
    const replay = await f.queue.enqueueWrite({
      accountId: original.accountId,
      operation: original.operation,
      scope: original.scope,
      idempotencyKey: original.idempotencyKey!,
      inputHash: original.inputHash,
      run: async () => assert.fail('Closed key must never replay.'),
    }).completion;
    assert.equal(replay.status, 'succeeded');
    await f.queue.drainAndStop();
    f.store.close();
    const reopened = new Store(f.options);
    try {
      assert.deepEqual(reopened.getJob(original.id), closed);
      assert.deepEqual(
        reopened.listJobs('author').find((item) => item.id === original.id),
        closed,
      );
      assert.equal(
        reopened.findIdempotent('author', 'write', original.operation, original.idempotencyKey!)!
          .status,
        'succeeded',
      );
    } finally {
      reopened.close();
    }
  } finally {
    await f.cleanup();
  }
});

test('C3 native reconciliation Store valid preservation mismatch remains unknown without not_applied', async (t) => {
  const mutations: [
    string,
    (edit: Record<string, unknown>, catalog: Record<string, unknown>) => void,
  ][] = [
    [
      'HTML attribute',
      (edit) => {
        edit.content = '<p class="changed">SYNTHETIC_PRIVATE_HTML &amp; stable</p>';
      },
    ],
    [
      'tail title',
      (edit) => {
        edit.multi_title = ['After', 'Different tail'];
      },
    ],
    [
      'second URI',
      (edit) => {
        edit.book_thumb_uri = 'Different uri';
      },
    ],
    [
      'unknown saved field',
      (edit) => {
        edit.unknown_saved = 'Different unknown';
      },
    ],
    [
      'same ID different selection label',
      (edit) => {
        edit.category = [{ category_id: 10, label: '主类', name: 'Different name' }];
      },
    ],
    [
      'catalog',
      (_edit, catalog) => {
        catalog.category_list = [
          { category_id: 10, label: '主类', name: '主甲' },
          { category_id: 11, label: '主类', name: 'Changed catalogue' },
        ];
      },
    ],
  ];
  for (const [name, mutate] of mutations)
    await t.test(name, async () => {
      const f = fixture(30_000, 'live');
      try {
        const original = await nativeStoreOriginal(f),
          later = await nativeStoreLater(f, original, nativeStoreSnapshot('After', mutate));
        const closed = f.store.reconcileWriteJob(original.id, later.read.id, later.resolution);
        assert.equal(closed.status, 'uncertain');
        assert.equal((closed.result as NativeShortClosure).observedStatus, 'unknown');
        assert.equal(closed.error?.code, 'outcome_unknown');
      } finally {
        await f.cleanup();
      }
    });
});
