import test from 'node:test';

import { fixture, digest } from './helpers/runtime-deferred.js';

import {
  repairChain,
  unknownRepairSuccessor,
  repairBindings,
  repairBaseline,
} from './helpers/runtime-recovery-baseline.js';

import assert from 'node:assert/strict';

import { canonicalJson, RuntimeError, type Job } from '../src/runtime/store.js';

test('created draft repair successor claims preserve the exact allocation and desired request and reject replacement, nonleaf, or altered unknown ancestors', async () => {
  for (const variant of [
    'valid',
    'root',
    'desired',
    'requested',
    'original-input',
    'recovery-input',
    'repair-input',
    'reference',
    'prior-hash',
    'prior-input',
    'prior-target',
    'other-unknown',
  ] as const) {
    const f = fixture(30_000, 'live');
    try {
      const p = await repairChain(f);
      const first = await unknownRepairSuccessor(f, p, 'successor-first');
      assert.equal(first.status, 'uncertain');
      assert.deepEqual(
        f.store.getCreationRepairAncestorIds(p.original.id, p.recovery.id, first.id),
        [first.id],
      );
      const bindings = { ...repairBindings, repairInputHash: digest('successor second input') };
      const db = (f.store as unknown as { db: import('node:sqlite').DatabaseSync }).db;
      if (variant === 'desired') bindings.desiredContentHash = digest('changed desired request');
      if (variant === 'requested') bindings.requestedContentHash = digest('changed root request');
      if (variant === 'original-input')
        bindings.originalInputHash = digest('changed allocation input');
      if (variant === 'recovery-input')
        bindings.recoveryInputHash = digest('changed recovery input');
      if (variant === 'reference')
        bindings.clientReferenceHash = digest('changed client reference');
      if (variant === 'prior-hash') {
        const row = db
          .prepare('SELECT bindings_json FROM creation_repairs WHERE repair_job_id = ?')
          .get(first.id)!;
        const saved = JSON.parse(String(row.bindings_json)) as typeof repairBindings;
        db.prepare('UPDATE creation_repairs SET bindings_json = ? WHERE repair_job_id = ?').run(
          canonicalJson({
            ...saved,
            expectedContentHash: digest('changed ancestor baseline hash'),
          }),
          first.id,
        );
      }
      if (variant === 'prior-input')
        db.prepare('UPDATE jobs SET input_hash = ? WHERE id = ?').run(
          digest('changed ancestor input'),
          first.id,
        );
      if (variant === 'prior-target')
        db.prepare('UPDATE jobs SET target_json = ? WHERE id = ?').run(
          canonicalJson({ kind: 'short-story', id: '2234567890123456789' }),
          first.id,
        );
      if (variant === 'other-unknown') {
        const unrelated = await f.queue.enqueueWrite({
          accountId: bindings.accountId,
          operation: 'update_draft',
          idempotencyKey: 'successor-unrelated',
          inputHash: digest('unrelated successor write'),
          run: async (ctx) => {
            ctx.beforePlatformWrite();
            throw new RuntimeError('outcome_unknown', 'Synthetic unrelated write');
          },
        }).completion;
        assert.equal(unrelated.status, 'uncertain');
      }
      const ancestorBefore = f.store.getJob(first.id)!;
      const second = await f.queue.enqueueWrite({
        accountId: bindings.accountId,
        operation: 'repair_created_draft',
        idempotencyKey: 'successor-second',
        inputHash:
          variant === 'repair-input' ? digest('wrong claimant input') : bindings.repairInputHash,
        run: async (ctx) => {
          f.store.claimCreationRepair(
            variant === 'root' ? p.recovery.id : p.original.id,
            p.recovery.id,
            ctx.jobId,
            bindings,
            first.id,
          );
          repairBaseline(ctx, p.original.id, p.recovery.id);
          throw new RuntimeError('outcome_unknown', 'Synthetic second repair acknowledgement loss');
        },
      }).completion;
      assert.deepEqual(f.store.getJob(p.original.id), p.original);
      assert.deepEqual(f.store.getJob(p.recovery.id), p.recovery);
      assert.deepEqual(f.store.getJob(first.id), ancestorBefore);
      assert.deepEqual(f.store.getCreationRepair(p.recovery.id), {
        repairJobId: first.id,
        closedAt: null,
      });
      if (variant !== 'valid') {
        assert.equal(second.status, 'failed');
        assert.equal(
          second.error?.code,
          variant === 'other-unknown' ? 'unresolved_write' : 'creation_repair_unverified',
        );
        assert.equal(second.platformReadStartedAt, null);
        assert.equal(second.platformWriteStartedAt, null);
        assert.equal(second.target, null);
        assert.deepEqual(f.store.listEvidence(second.id), []);
        assert.equal(f.store.getCreationRepairSuccessor(first.id), null);
        assert.equal(
          Number(
            db.prepare('SELECT COUNT(*) AS count FROM creation_repair_successors').get()!.count,
          ),
          0,
        );
        continue;
      }
      assert.equal(second.status, 'uncertain');
      assert.deepEqual(f.store.getCreationRepairSuccessor(first.id), {
        repairJobId: second.id,
        closedAt: null,
      });
      assert.equal(f.store.getCreationRepairSuccessor(second.id), null);
      assert.deepEqual(
        f.store.getCreationRepairAncestorIds(p.original.id, p.recovery.id, second.id),
        [first.id, second.id],
      );
      assert.throws(
        () => f.store.getCreationRepairAncestorIds(p.original.id, p.recovery.id, first.id),
        { code: 'creation_repair_conflict' },
      );
      const saved = db
        .prepare(
          'SELECT original_job_id, recovery_job_id, bindings_json FROM creation_repair_successors WHERE previous_repair_job_id = ?',
        )
        .get(first.id)!;
      assert.equal(saved.original_job_id, p.original.id);
      assert.equal(saved.recovery_job_id, p.recovery.id);
      assert.deepEqual(JSON.parse(String(saved.bindings_json)), bindings);
      const count = f.store.listJobs().length;
      const replay = await f.queue.enqueueWrite({
        accountId: bindings.accountId,
        operation: 'repair_created_draft',
        idempotencyKey: 'successor-second',
        inputHash: bindings.repairInputHash,
        run: async () => {
          assert.fail('Unknown successor keys must never replay platform work.');
        },
      }).completion;
      assert.deepEqual(replay, second);
      assert.equal(f.store.listJobs().length, count);
      assert.throws(
        () =>
          f.queue.enqueueWrite({
            accountId: bindings.accountId,
            operation: 'repair_created_draft',
            idempotencyKey: 'successor-second',
            inputHash: digest('same key changed input'),
            run: async () => {
              assert.fail('Conflicting keys must not reach a callback.');
            },
          }),
        { code: 'idempotency_conflict' },
      );
      for (const previous of [first.id, undefined]) {
        const rejected = await f.queue.enqueueWrite({
          accountId: bindings.accountId,
          operation: 'repair_created_draft',
          idempotencyKey: previous ? 'successor-sibling-key' : 'successor-root-replacement-key',
          inputHash: bindings.repairInputHash,
          run: async (ctx) => {
            f.store.claimCreationRepair(
              p.original.id,
              p.recovery.id,
              ctx.jobId,
              bindings,
              previous,
            );
            assert.fail('An existing chain cannot be replaced.');
          },
        }).completion;
        assert.equal(rejected.status, 'failed');
        assert.equal(
          rejected.error?.code,
          previous ? 'creation_repair_conflict' : 'unresolved_write',
        );
        assert.equal(rejected.platformReadStartedAt, null);
        assert.equal(rejected.platformWriteStartedAt, null);
      }
      assert.deepEqual(f.store.getCreationRepairSuccessor(first.id), {
        repairJobId: second.id,
        closedAt: null,
      });
      assert.equal(
        Number(db.prepare('SELECT COUNT(*) AS count FROM creation_repair_successors').get()!.count),
        1,
      );
      // The bounded chain is rejected before claim or intent even at its exact cap.
      const bounded = f.store as unknown as {
        creationRepairJobs: (originalId: string, recoveryId: string) => Job[];
      };
      const readChain = bounded.creationRepairJobs.bind(f.store);
      bounded.creationRepairJobs = () => Array.from({ length: 128 }, () => second);
      try {
        assert.throws(
          () => f.store.getCreationRepairAncestorIds(p.original.id, p.recovery.id, second.id),
          { code: 'creation_repair_conflict' },
        );
        const capped = await f.queue.enqueueWrite({
          accountId: bindings.accountId,
          operation: 'repair_created_draft',
          idempotencyKey: 'successor-over-cap',
          inputHash: bindings.repairInputHash,
          run: async (ctx) => {
            f.store.claimCreationRepair(
              p.original.id,
              p.recovery.id,
              ctx.jobId,
              bindings,
              second.id,
            );
            assert.fail('A capped chain cannot claim an additional attempt.');
          },
        }).completion;
        assert.equal(capped.error?.code, 'creation_repair_conflict');
        assert.equal(capped.platformWriteStartedAt, null);
        assert.equal(capped.target, null);
        assert.deepEqual(f.store.listEvidence(capped.id), []);
        assert.equal(
          Number(
            db.prepare('SELECT COUNT(*) AS count FROM creation_repair_successors').get()!.count,
          ),
          1,
        );
      } finally {
        bounded.creationRepairJobs = readChain;
      }
    } finally {
      await f.cleanup();
    }
  }
});
