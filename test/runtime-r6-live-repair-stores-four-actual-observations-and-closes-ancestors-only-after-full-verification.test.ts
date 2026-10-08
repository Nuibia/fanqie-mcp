import test from 'node:test';

import {
  r6RuntimeFixture,
  type R6RuntimeWitness,
  r6StatusSnapshot,
  r6Protocol,
  r6WriterTarget,
  r6Db,
} from './helpers/runtime-native-compensation-later.js';

import {
  repairChain,
  repairBindings,
  repairRequested,
  repairExpected,
} from './helpers/runtime-recovery-baseline.js';

import { recoveryTarget, digest } from './helpers/runtime-deferred.js';

import { canonicalJson, type EvidenceRef } from '../src/runtime/store.js';

import { r6Advance } from './helpers/runtime-r6-advance.js';

import assert from 'node:assert/strict';

test('R6 live repair stores four actual observations and closes ancestors only after full verification', async () => {
  const f = r6RuntimeFixture();
  try {
    const ancestors = await repairChain(f),
      queued = f.store.createJob({
        accountId: repairBindings.accountId,
        kind: 'write',
        operation: 'repair_created_draft',
        idempotencyKey: 'r6-full-live-repair',
        inputHash: repairBindings.repairInputHash,
      }).job,
      job = f.store.startJob(queued.id);
    const creationContext = {
      originalJobId: ancestors.original.id,
      recoveryJobId: ancestors.recovery.id,
      previousRepairJobId: null,
    };
    const witness: R6RuntimeWitness = {
      schema: 'fanqie-generic-short-execution/v1',
      operation: 'repair_created_draft',
      target: recoveryTarget,
      creationContext,
      requestBindings: { ...repairBindings },
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
      inputHash: job.inputHash,
      target: recoveryTarget,
      creationContext,
      requestBindings: witness.requestBindings,
      identityType: 'account',
      platformOwnerId: '1001',
      profileId: witness.profileId,
      profileVerifiedAt: witness.profileVerifiedAt,
      provenance: witness.provenance,
    });
    f.store.addJobMetadata(job.id, { genericShortStatus: witness });
    const run = { job, witness };
    const beforeAt = f.store.markPlatformReadStarted(job.id),
      snapshot = (at: string, body: string) => ({
        ...r6StatusSnapshot(at),
        title: repairRequested.title,
        body,
        contentHash: digest(canonicalJson({ title: repairRequested.title, body, metadata: {} })),
      });
    const baseline = snapshot(beforeAt, 'Synthetic'),
      source = { mode: 'live', origin: 'https://fanqienovel.com' };
    const special = f.store.saveEvidence(job.id, 'creation-repair-baseline', {
      originalJobId: ancestors.original.id,
      recoveryJobId: ancestors.recovery.id,
      requestedContentHash: repairBindings.requestedContentHash,
      expectedContentHash: repairExpected,
      target: recoveryTarget,
      snapshot: baseline,
      source,
      statusProtocol: r6Protocol,
    });
    r6Advance(f, run, 'baseline_saved', special, 'baseline');
    const writerBefore = f.store.saveEvidence(job.id, 'editable_snapshot', {
      schema: 'fanqie-generic-short-editor-observation/v1',
      phase: 'baseline',
      snapshot: baseline,
      source,
    });
    r6Advance(f, run, 'baseline_saved', writerBefore, 'baseline');
    assert.equal(f.store.getJob(job.id)!.target, null);
    assert.equal(f.store.getJob(job.id)!.platformWriteStartedAt, null);
    f.store.claimCreationRepair(
      ancestors.original.id,
      ancestors.recovery.id,
      job.id,
      repairBindings,
    );
    f.store.saveEvidence(job.id, 'write-intent', {
      desiredContentHash: repairBindings.desiredContentHash,
      expectedStates: ['draft_saved'],
      target: recoveryTarget,
      statusProtocol: r6Protocol,
    });
    r6Advance(f, run, 'save_marked');
    f.store.markPlatformWriteStarted(job.id);
    const afterAt = new Date().toISOString(),
      afterSnapshot = snapshot(afterAt, repairRequested.body),
      after = f.store.saveEvidence(job.id, 'editable_snapshot', {
        schema: 'fanqie-generic-short-editor-observation/v1',
        phase: 'after',
        snapshot: afterSnapshot,
        source,
      });
    r6Advance(f, run, 'after_saved', after, 'after');
    const verified = f.store.saveEvidence(job.id, 'creation-repair-verification', {
      originalJobId: ancestors.original.id,
      recoveryJobId: ancestors.recovery.id,
      target: recoveryTarget,
      snapshot: snapshot(new Date().toISOString(), repairRequested.body),
      source,
      statusProtocol: r6Protocol,
    });
    r6Advance(f, run, 'final_observed', verified, 'after');
    r6Advance(f, run, 'final_verified');
    r6Advance(f, run, 'completed');
    const result = {
      status: 'succeeded',
      capability: 'update_draft',
      target: r6WriterTarget,
      contentHash: repairBindings.desiredContentHash,
      platformState: 'draft',
      verifiedAt: afterAt,
      sourceUrl: afterSnapshot.sourceUrl,
    };
    f.store.saveEvidence(job.id, 'write-result', result);
    assert.equal(f.store.completeWriteJob(job.id, result).status, 'succeeded');
    const refs = f.store.listEvidence(job.id),
      observations = (f.store.getJob(job.id)!.metadata.genericShortStatus as R6RuntimeWitness)
        .observations;
    assert.deepEqual(
      refs.map((ref) => ref.dataset),
      [
        'creation-repair-baseline',
        'editable_snapshot',
        'write-intent',
        'editable_snapshot',
        'creation-repair-verification',
        'write-result',
      ],
    );
    assert.deepEqual(
      observations,
      [
        [special, 'baseline'],
        [writerBefore, 'baseline'],
        [after, 'after'],
        [verified, 'after'],
      ].map(([ref, phase], i) => ({
        ordinal: i + 1,
        dataset: (ref as EvidenceRef).dataset,
        phase,
        evidenceId: (ref as EvidenceRef).id,
        evidenceHash: (ref as EvidenceRef).sha256,
      })),
    );
    assert.equal(f.store.getJob(ancestors.original.id)!.status, 'uncertain');
    assert.equal(f.store.getJob(ancestors.recovery.id)!.status, 'uncertain');
    const closed = f.store.completeCreationRepair(
      ancestors.original.id,
      ancestors.recovery.id,
      job.id,
    );
    assert.equal(closed.status, 'succeeded');
    assert.equal(
      f.store.getJob(ancestors.recovery.id)!.error?.code,
      'superseded_by_verified_repair',
    );
    const projection = f.store.genericShortProjection(job.id, repairBindings.accountId);
    assert.equal(projection.tuple.statusEvidence?.id, verified.id);
    assert.equal(projection.tuple.statusSource?.phase, 'after');
    assert.deepEqual(
      Object.keys(
        projection.data.find((row) => row.dataset === 'creation-repair-verification')!
          .snapshot as object,
      ).sort(),
      [
        'title',
        'body',
        'metadata',
        'accountId',
        'target',
        'state',
        'contentHash',
        'sourceUrl',
        'platformReadAt',
        'statusFacts',
      ].sort(),
    );
    const census = f.store.listJobs(repairBindings.accountId).map((value) => value.id),
      parentEvidence = f.store.listEvidence(ancestors.original.id),
      parentRelation = r6Db(f)
        .prepare('SELECT * FROM creation_repairs WHERE original_job_id = ? AND recovery_job_id = ?')
        .get(ancestors.original.id, ancestors.recovery.id),
      parentProjection = f.store.genericShortProjection(
        ancestors.original.id,
        repairBindings.accountId,
      );
    assert.equal(parentProjection.job.id, ancestors.original.id);
    assert.equal(parentProjection.job.status, 'succeeded');
    assert.deepEqual(parentProjection.job.result, closed.result);
    assert.deepEqual(parentProjection.evidence, parentEvidence);
    assert.deepEqual(parentProjection.tuple, projection.tuple);
    assert.equal(parentProjection.tuple.statusEvidence?.jobId, job.id);
    assert.equal(parentProjection.tuple.statusEvidence?.id, verified.id);
    assert.deepEqual(
      f.store.genericShortPublication(ancestors.original.id, repairBindings.accountId),
      projection.tuple,
    );
    assert.deepEqual(
      f.store.listJobs(repairBindings.accountId).map((value) => value.id),
      census,
    );
    assert.deepEqual(f.store.getJob(ancestors.original.id), closed);
    assert.deepEqual(
      r6Db(f)
        .prepare('SELECT * FROM creation_repairs WHERE original_job_id = ? AND recovery_job_id = ?')
        .get(ancestors.original.id, ancestors.recovery.id),
      parentRelation,
    );
    assert.throws(
      () => f.store.genericShortProjection(ancestors.recovery.id, repairBindings.accountId),
      { code: 'creation_repair_conflict' },
    );
    assert.deepEqual(
      f.store.completeCreationRepair(ancestors.original.id, ancestors.recovery.id, job.id),
      closed,
    );
  } finally {
    await f.cleanup();
  }
});
