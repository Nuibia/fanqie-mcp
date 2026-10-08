import test from 'node:test';

import {
  fixture,
  allocatedCreation,
  digest,
  recoveryBindings,
  recoveryTarget,
  delay,
} from './helpers/runtime-deferred.js';

import { RuntimeError, type EvidenceRef, Store } from '../src/runtime/store.js';

import assert from 'node:assert/strict';

import { recoveryBaseline, desiredRecoveryIntent } from './helpers/runtime-recovery-baseline.js';

test('creation recovery claims exact initial allocation once and rejects changed bindings or other unknown writes', async () => {
  for (const variant of [
    'input',
    'request',
    'reference',
    'desired',
    'other-unknown',
    'valid',
  ] as const) {
    const f = fixture(30_000, 'live');
    try {
      const original = await allocatedCreation(f, (intent) => {
        if (variant === 'desired') intent.desiredContentHash = digest('invented desired');
      });
      if (variant === 'other-unknown')
        await f.queue.enqueueWrite({
          accountId: recoveryBindings.accountId,
          operation: 'update_draft',
          idempotencyKey: 'other-unknown-write',
          inputHash: digest('other'),
          run: async (ctx) => {
            ctx.beforePlatformWrite();
            throw Error('Synthetic unknown');
          },
        }).completion;
      const bindings = { ...recoveryBindings };
      if (variant === 'input') bindings.originalInputHash = digest('changed original');
      if (variant === 'request') bindings.requestedContentHash = digest('changed content');
      if (variant === 'reference') bindings.clientReferenceHash = digest('changed reference');
      const resume = await f.queue.enqueueWrite({
        accountId: recoveryBindings.accountId,
        operation: 'resume_create_draft',
        idempotencyKey: 'first-resume-key',
        inputHash: recoveryBindings.resumeInputHash,
        run: async (ctx) => {
          f.store.claimCreationRecovery(original.id, ctx.jobId, bindings);
          throw new RuntimeError('fixture_stop', 'Claim only; no browser or platform operation');
        },
      }).completion;
      assert.equal(resume.platformReadStartedAt, null);
      assert.equal(resume.platformWriteStartedAt, null);
      if (variant !== 'valid') {
        assert.equal(f.store.getCreationRecovery(original.id), null);
        assert.equal(
          resume.error?.code,
          variant === 'other-unknown' ? 'unresolved_write' : 'creation_recovery_unverified',
        );
      } else {
        assert.deepEqual(f.store.getCreationRecovery(original.id), {
          resumeJobId: resume.id,
          closedAt: null,
        });
        const otherKey = await f.queue.enqueueWrite({
          accountId: recoveryBindings.accountId,
          operation: 'resume_create_draft',
          idempotencyKey: 'different-resume-key',
          inputHash: recoveryBindings.resumeInputHash,
          run: async (ctx) => {
            f.store.claimCreationRecovery(original.id, ctx.jobId, bindings);
            return {};
          },
        }).completion;
        assert.equal(otherKey.error?.code, 'creation_recovery_conflict');
        assert.equal(otherKey.platformWriteStartedAt, null);
        assert.deepEqual(f.store.getJob(original.id), original);
      }
    } finally {
      await f.cleanup();
    }
  }
});

test('creation recovery closes the parent only from durable desired/readback proof and preserves allocation audit', async () => {
  const f = fixture(30_000, 'live');
  try {
    const original = await allocatedCreation(f);
    const originalRefs = f.store.listEvidence(original.id);
    const resume = await f.queue.enqueueWrite({
      accountId: recoveryBindings.accountId,
      operation: 'resume_create_draft',
      idempotencyKey: 'direct-resume-key',
      inputHash: recoveryBindings.resumeInputHash,
      run: async (ctx) => {
        f.store.claimCreationRecovery(original.id, ctx.jobId, recoveryBindings);
        recoveryBaseline(ctx, original.id);
        desiredRecoveryIntent(ctx);
        const result = {
          status: 'succeeded',
          capability: 'update_draft',
          target: { kind: 'short', workId: recoveryTarget.id },
          contentHash: recoveryBindings.requestedContentHash,
          platformState: 'draft',
          sourceUrl: 'https://fanqienovel.com/main/writer/publish-short/' + recoveryTarget.id,
          verifiedAt: new Date().toISOString(),
        };
        ctx.saveEvidence('write-result', result);
        return result;
      },
    }).completion;
    assert.equal(resume.status, 'succeeded');
    const closed = f.store.completeCreationRecovery(original.id, resume.id),
      result = closed.result as {
        prior: { error: unknown; result: unknown; intentRefs: EvidenceRef[] };
        creationRecovery: { resumeJobId: string };
      };
    assert.equal(closed.status, 'succeeded');
    assert.deepEqual(result.prior.error, original.error);
    assert.deepEqual(result.prior.result, original.result);
    assert.deepEqual(result.prior.intentRefs, originalRefs);
    assert.equal(result.creationRecovery.resumeJobId, resume.id);
    assert.deepEqual(f.store.listEvidence(original.id), originalRefs);
    assert.equal(
      'desiredContentHash' in (f.store.readEvidence(originalRefs[0]!).payload as object),
      false,
    );
    assert.deepEqual(f.store.completeCreationRecovery(original.id, resume.id), closed);
  } finally {
    await f.cleanup();
  }
});

test('creation recovery unknown uses normal reconciliation then survives restart for read-only parent closure', async () => {
  for (const persistedResultBeforeCrash of [false, true]) {
    const f = fixture(30_000, 'live');
    let reopened: Store | undefined;
    try {
      const original = await allocatedCreation(f);
      const resume = await f.queue.enqueueWrite({
        accountId: recoveryBindings.accountId,
        operation: 'resume_create_draft',
        idempotencyKey: 'unknown-resume-key',
        inputHash: recoveryBindings.resumeInputHash,
        run: async (ctx) => {
          f.store.claimCreationRecovery(original.id, ctx.jobId, recoveryBindings);
          recoveryBaseline(ctx, original.id);
          desiredRecoveryIntent(ctx);
          if (persistedResultBeforeCrash)
            ctx.saveEvidence('write-result', {
              status: 'succeeded',
              capability: 'update_draft',
              target: { kind: 'short', workId: recoveryTarget.id },
              contentHash: recoveryBindings.requestedContentHash,
              platformState: 'draft',
              verifiedAt: new Date().toISOString(),
              sourceUrl: 'https://fanqienovel.com/main/writer/publish-short/' + recoveryTarget.id,
            });
          throw new RuntimeError(
            'outcome_unknown',
            'Synthetic lost acknowledgement or interruption after result persistence',
          );
        },
      }).completion;
      assert.equal(resume.status, 'uncertain');
      assert.throws(() => f.store.completeCreationRecovery(original.id, resume.id), {
        code: 'creation_recovery_incomplete',
      });
      await delay(2);
      const read = await f.queue.enqueueRead({
        accountId: recoveryBindings.accountId,
        operation: 'reconcile_write',
        scope: 'reconciliation',
        datasets: ['reconciliation'],
        run: async (ctx) => {
          ctx.beforePlatformRead();
          return [
            ctx.saveEvidence('reconciliation', {
              source: { mode: 'live', origin: 'https://fanqienovel.com' },
              reconciliation: {
                originalJobId: resume.id,
                target: recoveryTarget,
                inputHash: resume.inputHash,
                observedStatus: 'draft_saved',
                observedContentHash: recoveryBindings.requestedContentHash,
              },
              sourceUrl: 'https://fanqienovel.com/main/writer/publish-short/' + recoveryTarget.id,
              platformReadAt: new Date().toISOString(),
            }),
          ];
        },
      }).completion;
      const reconciled = f.store.reconcileWriteJob(resume.id, read.id, {
        status: 'succeeded',
        result: {
          contentHash: recoveryBindings.requestedContentHash,
          platformState: 'draft_saved',
        },
      });
      assert.equal(reconciled.status, 'succeeded');
      assert.equal(f.store.getJob(original.id)!.status, 'uncertain');
      const census = f.store.listJobs().length;
      await f.queue.drainAndStop();
      f.store.close();
      reopened = new Store(f.options);
      const closed = reopened.completeCreationRecovery(original.id, resume.id);
      assert.equal(closed.status, 'succeeded');
      assert.equal(reopened.listJobs().length, census);
      assert.deepEqual(reopened.completeCreationRecovery(original.id, resume.id), closed);
      assert.equal(
        reopened.listEvidence(resume.id).filter((ref) => ref.dataset === 'write-intent').length,
        1,
      );
    } finally {
      reopened?.close();
      await f.cleanup();
    }
  }
});
