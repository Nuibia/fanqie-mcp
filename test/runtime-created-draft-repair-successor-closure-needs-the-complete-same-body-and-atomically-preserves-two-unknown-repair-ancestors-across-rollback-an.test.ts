import test from 'node:test';

import { fixture, digest, recoveryTarget } from './helpers/runtime-deferred.js';

import { Store, type Job } from '../src/runtime/store.js';

import {
  repairChain,
  unknownRepairSuccessor,
  repairBindings,
  successorRepairPrior,
  repairBaseline,
  repairResult,
  repairFullSnapshot,
  repairRequested,
} from './helpers/runtime-recovery-baseline.js';

import { readFileSync } from 'node:fs';

import path from 'node:path';

import assert from 'node:assert/strict';

test('created draft repair successor closure needs the complete same body and atomically preserves two unknown repair ancestors across rollback and restart', async () => {
  for (const completeBody of [false, true]) {
    const f = fixture(30_000, 'live');
    let reopened: Store | undefined;
    try {
      const p = await repairChain(f);
      const first = await unknownRepairSuccessor(f, p, 'closure-first');
      const secondBindings = { ...repairBindings, repairInputHash: digest('closure second input') };
      const second = await unknownRepairSuccessor(
        f,
        p,
        'closure-second',
        first.id,
        secondBindings,
        true,
      );
      const lastBindings = { ...repairBindings, repairInputHash: digest('closure final input') };
      const oldJobs = [p.original, p.recovery, first, second];
      const oldRefs = oldJobs.map((job) => f.store.listEvidence(job.id));
      const oldBytes = oldRefs.map((refs) =>
        refs.map((ref) => readFileSync(path.join(f.options.evidenceDirectory, ref.path))),
      );
      const priors = [first, second].map((job) => successorRepairPrior(f.store, job));
      const last = await f.queue.enqueueWrite({
        accountId: lastBindings.accountId,
        operation: 'repair_created_draft',
        idempotencyKey: 'closure-final',
        inputHash: lastBindings.repairInputHash,
        run: async (ctx) => {
          f.store.claimCreationRepair(
            p.original.id,
            p.recovery.id,
            ctx.jobId,
            lastBindings,
            second.id,
          );
          repairBaseline(ctx, p.original.id, p.recovery.id);
          const result = repairResult();
          ctx.saveEvidence('creation-repair-verification', {
            originalJobId: p.original.id,
            recoveryJobId: p.recovery.id,
            target: recoveryTarget,
            source: { mode: 'live', origin: 'https://fanqienovel.com' },
            snapshot: repairFullSnapshot(completeBody ? repairRequested.body : 'Synthetic'),
          });
          ctx.saveEvidence('write-result', result);
          return result;
        },
      }).completion;
      assert.equal(last.status, 'succeeded');
      assert.deepEqual(f.store.getCreationRepairSuccessor(first.id), {
        repairJobId: second.id,
        closedAt: null,
      });
      assert.deepEqual(f.store.getCreationRepairSuccessor(second.id), {
        repairJobId: last.id,
        closedAt: null,
      });
      if (!completeBody) {
        assert.throws(() => f.store.completeCreationRepair(p.original.id, p.recovery.id, last.id), {
          code: 'creation_repair_incomplete',
        });
        for (const old of oldJobs) assert.deepEqual(f.store.getJob(old.id), old);
        assert.equal(f.store.getCreationRecovery(p.original.id)!.closedAt, null);
        assert.equal(f.store.getCreationRepair(p.recovery.id)!.closedAt, null);
        assert.equal(f.store.getCreationRepairSuccessor(first.id)!.closedAt, null);
        assert.equal(f.store.getCreationRepairSuccessor(second.id)!.closedAt, null);
        continue;
      }
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(f.options.databasePath);
      const tables = [
        'creation_recoveries',
        'creation_repairs',
        'creation_repair_successors',
      ] as const;
      const beforeRows = tables.map((table) =>
        db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      );
      try {
        db.exec(
          "CREATE TRIGGER reject_successor_closure BEFORE UPDATE OF status ON jobs WHEN NEW.operation='create_draft' AND NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'synthetic successor closure fault'); END",
        );
        assert.throws(() => f.store.completeCreationRepair(p.original.id, p.recovery.id, last.id));
        for (const old of oldJobs) assert.deepEqual(f.store.getJob(old.id), old);
        assert.deepEqual(f.store.getJob(last.id), last);
        assert.deepEqual(
          tables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()),
          beforeRows,
        );
        db.exec('DROP TRIGGER reject_successor_closure');
      } finally {
        db.close();
      }
      const census = f.store.listJobs().length;
      await f.queue.drainAndStop();
      f.store.close();
      reopened = new Store(f.options);
      for (const old of oldJobs) assert.deepEqual(reopened.getJob(old.id), old);
      const closed = reopened.completeCreationRepair(p.original.id, p.recovery.id, last.id);
      assert.equal(closed.status, 'succeeded');
      assert.equal(closed.error, null);
      const result = closed.result as {
        creationRepair: {
          repairJobId: string;
          requestedContentHash: string;
          desiredContentHash: string;
          proof: { kind: string };
          closedAt: string;
        };
        prior: unknown;
      };
      assert.equal(result.creationRepair.repairJobId, last.id);
      assert.equal(result.creationRepair.requestedContentHash, repairBindings.requestedContentHash);
      assert.equal(result.creationRepair.desiredContentHash, repairBindings.desiredContentHash);
      assert.equal(result.creationRepair.proof.kind, 'saved-verified-repair');
      assert.deepEqual(result.prior, {
        status: p.original.status,
        error: p.original.error,
        result: p.original.result,
        target: p.original.target,
        endedAt: p.original.endedAt,
        intentRefs: oldRefs[0],
      });
      for (const [index, old] of [first, second].entries()) {
        const failed: Job = reopened.getJob(old.id)!;
        assert.equal(failed.status, 'failed');
        assert.equal(failed.error?.code, 'superseded_by_verified_repair');
        assert.equal(failed.endedAt, old.endedAt);
        assert.deepEqual((failed.result as { prior: unknown }).prior, priors[index]);
      }
      const recovery = reopened.getJob(p.recovery.id)!;
      assert.equal(recovery.status, 'failed');
      assert.equal(recovery.error?.code, 'superseded_by_verified_repair');
      assert.equal(recovery.endedAt, p.recovery.endedAt);
      assert.deepEqual((recovery.result as { prior: unknown }).prior, {
        status: p.recovery.status,
        error: p.recovery.error,
        result: p.recovery.result,
        target: p.recovery.target,
        endedAt: p.recovery.endedAt,
        evidence: oldRefs[1],
        metadata: p.recovery.metadata,
      });
      assert.deepEqual(reopened.getJob(last.id), last);
      for (const [index, old] of oldJobs.entries()) {
        assert.deepEqual(reopened.listEvidence(old.id), oldRefs[index]);
        assert.deepEqual(
          reopened
            .listEvidence(old.id)
            .map((ref) => readFileSync(path.join(f.options.evidenceDirectory, ref.path))),
          oldBytes[index],
        );
      }
      assert.equal(
        reopened.getCreationRecovery(p.original.id)!.closedAt,
        result.creationRepair.closedAt,
      );
      assert.equal(
        reopened.getCreationRepair(p.recovery.id)!.closedAt,
        result.creationRepair.closedAt,
      );
      assert.deepEqual(reopened.getCreationRepairSuccessor(first.id), {
        repairJobId: second.id,
        closedAt: result.creationRepair.closedAt,
      });
      assert.deepEqual(reopened.getCreationRepairSuccessor(second.id), {
        repairJobId: last.id,
        closedAt: result.creationRepair.closedAt,
      });
      assert.equal(reopened.getCreationRepairSuccessor(last.id), null);
      assert.equal(reopened.listJobs().length, census);
      reopened.close();
      reopened = new Store(f.options);
      assert.deepEqual(
        reopened.completeCreationRepair(p.original.id, p.recovery.id, last.id),
        closed,
      );
      assert.equal(reopened.listJobs().length, census);
      for (const old of [p.recovery, first, second])
        assert.equal(reopened.getJob(old.id)!.error?.code, 'superseded_by_verified_repair');
    } finally {
      reopened?.close();
      await f.cleanup();
    }
  }
});
