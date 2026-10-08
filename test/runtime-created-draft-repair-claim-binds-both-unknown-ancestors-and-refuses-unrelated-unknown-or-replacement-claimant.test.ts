import test from 'node:test';

import {
  fixture,
  delay,
  digest,
  recoveryTarget,
  recoveryBindings,
} from './helpers/runtime-deferred.js';

import {
  repairChain,
  repairBindings,
  repairExpected,
  repairBaseline,
  repairResult,
  repairFullSnapshot,
  repairRequested,
} from './helpers/runtime-recovery-baseline.js';

import { canonicalJson, RuntimeError, Store } from '../src/runtime/store.js';

import assert from 'node:assert/strict';

test('created draft repair claim binds both unknown ancestors and refuses unrelated unknown or replacement claimant', async () => {
  for (const variant of [
    'input',
    'reference',
    'desired',
    'ancestor',
    'other-unknown',
    'valid',
    'uncertain-reconciled',
  ] as const) {
    const f = fixture(30_000, 'live');
    try {
      const p = await repairChain(f),
        bindings = { ...repairBindings };
      if (variant === 'uncertain-reconciled') {
        await delay(2);
        const read = await f.queue.enqueueRead({
          accountId: bindings.accountId,
          operation: 'reconcile_write',
          scope: 'reconciliation',
          datasets: ['reconciliation'],
          inputHash: digest(canonicalJson({ jobId: p.recovery.id })),
          run: async (ctx) => {
            ctx.beforePlatformRead();
            return [
              ctx.saveEvidence('reconciliation', {
                source: { mode: 'live', origin: 'https://fanqienovel.com' },
                reconciliation: {
                  originalJobId: p.recovery.id,
                  target: recoveryTarget,
                  inputHash: p.recovery.inputHash,
                  observedStatus: 'unknown',
                  observedContentHash: repairExpected,
                },
                sourceUrl: 'https://fanqienovel.com/main/writer/publish-short/' + recoveryTarget.id,
                platformReadAt: new Date().toISOString(),
              }),
            ];
          },
        }).completion;
        p.recovery = f.store.reconcileWriteJob(p.recovery.id, read.id, {
          status: 'uncertain',
          result: { contentHash: repairExpected, platformState: 'unknown' },
        });
      }
      if (variant === 'input') bindings.originalInputHash = digest('changed');
      if (variant === 'reference') bindings.clientReferenceHash = digest('changed');
      if (variant === 'desired') bindings.desiredContentHash = digest('changed');
      if (variant === 'other-unknown')
        await f.queue.enqueueWrite({
          accountId: recoveryBindings.accountId,
          operation: 'update_draft',
          idempotencyKey: 'unrelated',
          inputHash: digest('unrelated'),
          run: async (ctx) => {
            ctx.beforePlatformWrite();
            throw Error('Synthetic unrelated unknown');
          },
        }).completion;
      const repair = await f.queue.enqueueWrite({
        accountId: bindings.accountId,
        operation: 'repair_created_draft',
        idempotencyKey: 'repair-claim-key',
        inputHash: bindings.repairInputHash,
        run: async (ctx) => {
          f.store.claimCreationRepair(
            variant === 'ancestor' ? p.recovery.id : p.original.id,
            p.recovery.id,
            ctx.jobId,
            bindings,
          );
          throw new RuntimeError('synthetic_stop', 'Claim only');
        },
      }).completion;
      assert.equal(repair.platformReadStartedAt, null);
      assert.equal(repair.platformWriteStartedAt, null);
      if (!['valid', 'uncertain-reconciled'].includes(variant)) {
        assert.equal(f.store.getCreationRepair(p.recovery.id), null);
        assert.equal(
          repair.error?.code,
          variant === 'other-unknown' ? 'unresolved_write' : 'creation_repair_unverified',
        );
      } else {
        assert.deepEqual(f.store.getCreationRepair(p.recovery.id), {
          repairJobId: repair.id,
          closedAt: null,
        });
        const next = await f.queue.enqueueWrite({
          accountId: bindings.accountId,
          operation: 'repair_created_draft',
          idempotencyKey: 'replacement-key',
          inputHash: bindings.repairInputHash,
          run: async (ctx) => {
            f.store.claimCreationRepair(p.original.id, p.recovery.id, ctx.jobId, bindings);
            return {};
          },
        }).completion;
        assert.equal(next.error?.code, 'creation_repair_conflict');
        assert.equal(next.platformWriteStartedAt, null);
        assert.deepEqual(f.store.getJob(p.original.id), p.original);
        assert.deepEqual(f.store.getJob(p.recovery.id), p.recovery);
      }
    } finally {
      await f.cleanup();
    }
  }
});

test('created draft repair closure requires full body proof and atomically preserves the incomplete save audit', async () => {
  for (const valid of [false, true]) {
    const f = fixture(30_000, 'live');
    try {
      const p = await repairChain(f),
        refs = f.store.listEvidence(p.recovery.id);
      const repair = await f.queue.enqueueWrite({
        accountId: repairBindings.accountId,
        operation: 'repair_created_draft',
        idempotencyKey: 'direct-repair',
        inputHash: repairBindings.repairInputHash,
        run: async (ctx) => {
          f.store.claimCreationRepair(p.original.id, p.recovery.id, ctx.jobId, repairBindings);
          repairBaseline(ctx, p.original.id, p.recovery.id);
          const result = repairResult();
          ctx.saveEvidence('creation-repair-verification', {
            originalJobId: p.original.id,
            recoveryJobId: p.recovery.id,
            target: recoveryTarget,
            source: { mode: 'live', origin: 'https://fanqienovel.com' },
            snapshot: repairFullSnapshot(valid ? repairRequested.body : 'Synthetic'),
          });
          ctx.saveEvidence('write-result', result);
          return result;
        },
      }).completion;
      if (!valid) {
        assert.throws(
          () => f.store.completeCreationRepair(p.original.id, p.recovery.id, repair.id),
          { code: 'creation_repair_incomplete' },
        );
        assert.deepEqual(f.store.getJob(p.original.id), p.original);
        assert.deepEqual(f.store.getJob(p.recovery.id), p.recovery);
      } else {
        const { DatabaseSync } = await import('node:sqlite');
        const db = new DatabaseSync(f.options.databasePath);
        try {
          db.exec(
            "CREATE TRIGGER reject_repair_parent BEFORE UPDATE OF status ON jobs WHEN NEW.operation='create_draft' AND NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'synthetic closure fault'); END",
          );
          assert.throws(() =>
            f.store.completeCreationRepair(p.original.id, p.recovery.id, repair.id),
          );
          assert.equal(f.store.getCreationRepair(p.recovery.id)!.closedAt, null);
          assert.deepEqual(f.store.getJob(p.recovery.id), p.recovery);
          db.exec('DROP TRIGGER reject_repair_parent');
        } finally {
          db.close();
        }
        const parent = f.store.completeCreationRepair(p.original.id, p.recovery.id, repair.id),
          failed = f.store.getJob(p.recovery.id)!;
        assert.equal(parent.status, 'succeeded');
        assert.equal(failed.status, 'failed');
        assert.equal(failed.error?.code, 'superseded_by_verified_repair');
        assert.equal(failed.endedAt, p.recovery.endedAt);
        assert.deepEqual(f.store.listEvidence(failed.id), refs);
        assert.deepEqual((failed.result as { prior: unknown }).prior, {
          status: p.recovery.status,
          error: p.recovery.error,
          result: p.recovery.result,
          target: p.recovery.target,
          endedAt: p.recovery.endedAt,
          evidence: refs,
          metadata: p.recovery.metadata,
        });
        assert.deepEqual(
          f.store.completeCreationRepair(p.original.id, p.recovery.id, repair.id),
          parent,
        );
        assert.equal(f.store.getCreationRecovery(parent.id)!.resumeJobId, p.recovery.id);
      }
    } finally {
      await f.cleanup();
    }
  }
});

test('created draft repair unknown follows normal reconciliation then restart and same-key closure without discarding old result evidence', async () => {
  for (const persistedResult of [false, true]) {
    const f = fixture(30_000, 'live');
    let reopened: Store | undefined;
    try {
      const p = await repairChain(f);
      const repair = await f.queue.enqueueWrite({
        accountId: repairBindings.accountId,
        operation: 'repair_created_draft',
        idempotencyKey: 'unknown-repair',
        inputHash: repairBindings.repairInputHash,
        run: async (ctx) => {
          f.store.claimCreationRepair(p.original.id, p.recovery.id, ctx.jobId, repairBindings);
          repairBaseline(ctx, p.original.id, p.recovery.id);
          if (persistedResult) ctx.saveEvidence('write-result', repairResult());
          throw new RuntimeError(
            'outcome_unknown',
            'Synthetic ACK loss or crash after saving result',
          );
        },
      }).completion;
      assert.equal(repair.status, 'uncertain');
      assert.throws(() => f.store.completeCreationRepair(p.original.id, p.recovery.id, repair.id), {
        code: 'creation_repair_incomplete',
      });
      await delay(2);
      const read = await f.queue.enqueueRead({
        accountId: repairBindings.accountId,
        operation: 'reconcile_write',
        scope: 'reconciliation',
        datasets: ['reconciliation'],
        run: async (ctx) => {
          ctx.beforePlatformRead();
          return [
            ctx.saveEvidence('reconciliation', {
              source: { mode: 'live', origin: 'https://fanqienovel.com' },
              reconciliation: {
                originalJobId: repair.id,
                inputHash: repair.inputHash,
                target: recoveryTarget,
                observedStatus: 'draft_saved',
                observedContentHash: repairBindings.desiredContentHash,
              },
              repairVerification: repairFullSnapshot(),
              sourceUrl: 'https://fanqienovel.com/main/writer/publish-short/' + recoveryTarget.id,
              platformReadAt: new Date().toISOString(),
            }),
          ];
        },
      }).completion;
      assert.equal(
        f.store.reconcileWriteJob(repair.id, read.id, {
          status: 'succeeded',
          result: { contentHash: repairBindings.desiredContentHash, platformState: 'draft_saved' },
        }).status,
        'succeeded',
      );
      const census = f.store.listJobs().length;
      await f.queue.drainAndStop();
      f.store.close();
      reopened = new Store(f.options);
      assert.equal(
        reopened.completeCreationRepair(p.original.id, p.recovery.id, repair.id).status,
        'succeeded',
      );
      assert.equal(reopened.getJob(p.recovery.id)!.status, 'failed');
      assert.equal(reopened.getJob(p.recovery.id)!.error?.code, 'superseded_by_verified_repair');
      assert.equal(reopened.listJobs().length, census);
      assert.deepEqual(
        reopened.completeCreationRepair(p.original.id, p.recovery.id, repair.id),
        reopened.getJob(p.original.id),
      );
    } finally {
      reopened?.close();
      await f.cleanup();
    }
  }
});
