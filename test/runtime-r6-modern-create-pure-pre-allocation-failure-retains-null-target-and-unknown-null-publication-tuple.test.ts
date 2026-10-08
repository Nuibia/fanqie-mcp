import test from 'node:test';

import {
  r6RuntimeFixture,
  type R6RuntimeWitness,
  r6StatusSnapshot,
  r6WriterTarget,
  r6Db,
} from './helpers/runtime-native-compensation-later.js';

import {
  digest,
  recoveryBindings,
  allocatedCreation,
  recoveryTarget,
} from './helpers/runtime-deferred.js';

import { r6Advance, r6Unavailable } from './helpers/runtime-r6-advance.js';

import assert from 'node:assert/strict';

import { r6ResumeIntent } from './helpers/runtime-r6-resume-intent.js';

import { type EvidenceRef } from '../src/runtime/store.js';

import { recoveryBaseline, desiredRecoveryIntent } from './helpers/runtime-recovery-baseline.js';

import { randomUUID } from 'node:crypto';

test('R6 modern create pure pre-allocation failure retains null target and unknown null publication tuple', async () => {
  const f = r6RuntimeFixture();
  try {
    const inputHash = digest('r6-create-not-allocated'),
      queued = f.store.createJob({
        accountId: 'author',
        kind: 'write',
        operation: 'create_draft',
        idempotencyKey: 'r6-null-target-create',
        inputHash,
      }).job,
      job = f.store.startJob(queued.id);
    const requestBindings = {
      inputHash,
      clientReferenceHash: digest('r6-reference'),
      requestedContentHash: digest('r6-request'),
      requestedTitleHash: digest('r6-title'),
      requestedBodyHash: digest('r6-body'),
    };
    const witness: R6RuntimeWitness = {
      schema: 'fanqie-generic-short-execution/v1',
      operation: 'create_draft',
      target: null,
      creationContext: null,
      requestBindings,
      identityType: 'account',
      platformOwnerId: '1001',
      profileId: 'r6-public-store-vector',
      profileVerifiedAt: '2026-10-03T00:00:00Z',
      provenance: { mode: 'live', executor: 'application-default-browser/v1' },
      startedAt: job.startedAt!,
      stage: 'before_first_read',
      observations: [],
      failure: null,
    };
    f.contexts.set(job.id, {
      jobId: job.id,
      accountId: job.accountId,
      kind: job.kind,
      operation: job.operation,
      scope: job.scope,
      datasets: job.datasets,
      inputHash,
      target: null,
      creationContext: null,
      requestBindings,
      identityType: 'account',
      platformOwnerId: '1001',
      profileId: witness.profileId,
      profileVerifiedAt: witness.profileVerifiedAt,
      provenance: witness.provenance,
    });
    f.store.addJobMetadata(job.id, { genericShortStatus: witness });
    const run = { job, witness };
    r6Advance(f, run, 'source_unavailable', undefined, 'baseline', 'source_unavailable');
    const failed = f.store.failJob(job.id, {
      code: 'capability_unavailable',
      message: 'Synthetic source unavailable before allocation.',
    });
    assert.equal(failed.target, null);
    assert.equal(failed.platformWriteStartedAt, null);
    assert.deepEqual(f.store.listEvidence(job.id), []);
    assert.deepEqual(f.store.genericShortPublication(job.id, 'author'), {
      state: 'unknown',
      statusFacts: null,
      statusSource: null,
      statusEvidence: null,
    });
    const projection = f.store.genericShortProjection(job.id, 'author');
    assert.equal(projection.job.target, null);
    assert.deepEqual(projection.data, []);
    assert.deepEqual(projection.evidence, []);
    assert.equal(projection.manifest, null);
    assert.equal(Object.hasOwn(projection.job.metadata, 'genericShortStatus'), false);
  } finally {
    await f.cleanup();
  }
});

test('R6 modern resume authenticates its fixed five requested bindings through saved intent advance and parent closure', async () => {
  for (const wrongIntent of [false, true]) {
    const f = r6RuntimeFixture();
    try {
      const { original, run, intent, source } = await r6ResumeIntent(f, wrongIntent),
        originalRefs = f.store.listEvidence(original.id);
      assert.deepEqual(
        Object.keys(run.witness.requestBindings).sort(),
        [
          'accountId',
          'originalInputHash',
          'resumeInputHash',
          'clientReferenceHash',
          'requestedContentHash',
        ].sort(),
      );
      assert.equal(Object.hasOwn(run.witness.requestBindings, 'desiredContentHash'), false);
      assert.equal(
        f.store.readEvidence(intent).payload &&
          (f.store.readEvidence(intent).payload as { desiredContentHash: string })
            .desiredContentHash,
        wrongIntent ? digest('r6-wrong-resume-intent') : recoveryBindings.requestedContentHash,
      );
      if (wrongIntent) {
        assert.throws(() => r6Advance(f, run, 'save_marked'), r6Unavailable);
        const rejected = f.store.getJob(run.job.id)!;
        assert.equal(
          (rejected.metadata.genericShortStatus as R6RuntimeWitness).stage,
          'baseline_saved',
        );
        assert.equal(rejected.platformWriteStartedAt, null);
        assert.deepEqual(f.store.getJob(original.id), original);
        assert.deepEqual(f.store.listEvidence(original.id), originalRefs);
        assert.equal(f.store.getCreationRecovery(original.id)!.closedAt, null);
        assert.equal(
          f.store.listEvidence(run.job.id).filter((ref) => ref.dataset === 'write-result').length,
          0,
        );
        continue;
      }
      r6Advance(f, run, 'save_marked');
      assert.equal(
        (f.store.getJob(run.job.id)!.metadata.genericShortStatus as R6RuntimeWitness).stage,
        'save_marked',
      );
      f.store.markPlatformWriteStarted(run.job.id);
      const afterAt = new Date().toISOString(),
        afterSnapshot = {
          ...r6StatusSnapshot(afterAt),
          title: 'Synthetic title',
          body: 'Synthetic body',
          contentHash: recoveryBindings.requestedContentHash,
        },
        after = f.store.saveEvidence(run.job.id, 'editable_snapshot', {
          schema: 'fanqie-generic-short-editor-observation/v1',
          phase: 'after',
          snapshot: afterSnapshot,
          source,
        });
      r6Advance(f, run, 'after_saved', after, 'after');
      r6Advance(f, run, 'completed');
      const result = {
        status: 'succeeded',
        capability: 'update_draft',
        target: r6WriterTarget,
        contentHash: recoveryBindings.requestedContentHash,
        platformState: 'draft',
        verifiedAt: afterAt,
        sourceUrl: afterSnapshot.sourceUrl,
      };
      f.store.saveEvidence(run.job.id, 'write-result', result);
      assert.equal(f.store.completeWriteJob(run.job.id, result).status, 'succeeded');
      const closed = f.store.completeCreationRecovery(original.id, run.job.id),
        closure = closed.result as {
          creationRecovery: {
            resumeJobId: string;
            requestedContentHash: string;
            desiredContentHash: string;
          };
          prior: { result: unknown; error: unknown; intentRefs: EvidenceRef[] };
        };
      assert.equal(closed.status, 'succeeded');
      assert.equal(closure.creationRecovery.resumeJobId, run.job.id);
      assert.equal(
        closure.creationRecovery.requestedContentHash,
        recoveryBindings.requestedContentHash,
      );
      assert.equal(
        closure.creationRecovery.desiredContentHash,
        recoveryBindings.requestedContentHash,
      );
      assert.deepEqual(closure.prior.result, original.result);
      assert.deepEqual(closure.prior.error, original.error);
      assert.deepEqual(closure.prior.intentRefs, originalRefs);
      assert.deepEqual(f.store.listEvidence(original.id), originalRefs);
      assert.deepEqual(
        f.store.listEvidence(run.job.id).map((ref) => ref.dataset),
        [
          'creation-resume-baseline',
          'editable_snapshot',
          'write-intent',
          'editable_snapshot',
          'write-result',
        ],
      );
      assert.equal(
        (f.store.getJob(run.job.id)!.metadata.genericShortStatus as R6RuntimeWitness).observations
          .length,
        3,
      );
      assert.equal(
        f.store.genericShortPublication(original.id, recoveryBindings.accountId).statusEvidence?.id,
        after.id,
      );
      assert.deepEqual(f.store.completeCreationRecovery(original.id, run.job.id), closed);
    } finally {
      await f.cleanup();
    }
  }
});

test('R6 legacy closed recovery forwards only its actual relation member and refuses a stable different existing member', async () => {
  const f = r6RuntimeFixture();
  try {
    const original = await allocatedCreation(f),
      resume = await f.queue.enqueueWrite({
        accountId: recoveryBindings.accountId,
        operation: 'resume_create_draft',
        idempotencyKey: 'r6-legacy-member-positive',
        inputHash: recoveryBindings.resumeInputHash,
        run: async (ctx) => {
          f.store.claimCreationRecovery(original.id, ctx.jobId, recoveryBindings);
          recoveryBaseline(ctx, original.id);
          desiredRecoveryIntent(ctx);
          const result = {
            status: 'succeeded',
            capability: 'update_draft',
            target: r6WriterTarget,
            contentHash: recoveryBindings.requestedContentHash,
            platformState: 'draft',
            verifiedAt: new Date().toISOString(),
            sourceUrl: 'https://fanqienovel.com/main/writer/publish-short/' + recoveryTarget.id,
          };
          ctx.saveEvidence('write-result', result);
          return result;
        },
      }).completion;
    const closed = f.store.completeCreationRecovery(original.id, resume.id),
      db = r6Db(f),
      originalRefs = f.store.listEvidence(original.id),
      resumeRefs = f.store.listEvidence(resume.id);
    assert.equal(resume.status, 'succeeded');
    assert.equal(closed.status, 'succeeded');
    assert.deepEqual(f.store.genericShortPublication(original.id, recoveryBindings.accountId), {
      state: 'unknown',
      statusFacts: null,
      statusSource: null,
      statusEvidence: null,
    });
    const other = f.store.createJob({
      accountId: recoveryBindings.accountId,
      kind: 'write',
      operation: 'update_draft',
      idempotencyKey: randomUUID(),
      inputHash: digest('r6-legitimate-other-legacy-member'),
    }).job;
    const row = db
      .prepare('SELECT * FROM creation_recoveries WHERE original_job_id = ?')
      .get(original.id)!;
    assert.equal(row.resume_job_id, resume.id);
    db.prepare('UPDATE creation_recoveries SET resume_job_id = ? WHERE original_job_id = ?').run(
      other.id,
      original.id,
    );
    assert.equal(
      db.prepare('SELECT * FROM creation_recoveries WHERE original_job_id = ?').get(original.id)!
        .resume_job_id,
      other.id,
    );
    assert.throws(
      () => f.store.genericShortPublication(original.id, recoveryBindings.accountId),
      r6Unavailable,
    );
    assert.throws(
      () => f.store.genericShortProjection(original.id, recoveryBindings.accountId),
      r6Unavailable,
    );
    assert.deepEqual(f.store.getJob(original.id), closed);
    assert.deepEqual(f.store.listEvidence(original.id), originalRefs);
    assert.deepEqual(f.store.listEvidence(resume.id), resumeRefs);
    assert.equal(f.store.getJob(other.id)!.status, 'queued');
  } finally {
    await f.cleanup();
  }
});
