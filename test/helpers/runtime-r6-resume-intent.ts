import {
  type R6RuntimeFixture,
  type R6RuntimeWitness,
  r6StatusSnapshot,
  r6Protocol,
  r6Db,
  r6Begin,
} from './runtime-native-compensation-later.js';

import { allocatedCreation, recoveryBindings, recoveryTarget, digest } from './runtime-deferred.js';

import { randomUUID } from 'node:crypto';

import { canonicalJson, type Manifest } from '../../src/runtime/store.js';

import { r6Advance, r6LegacyUnknownRoot } from './runtime-r6-advance.js';

import { type ModernShortSnapshot } from '../../src/platform/writes.js';

import { writeFileSync } from 'node:fs';

import path from 'node:path';

import assert from 'node:assert/strict';

import {
  repairChain,
  unknownRepairSuccessor,
  repairBindings,
  repairBaseline,
  repairResult,
  repairFullSnapshot,
} from './runtime-recovery-baseline.js';

export async function r6ResumeIntent(f: R6RuntimeFixture, wrongIntent = false) {
  const original = await allocatedCreation(f),
    queued = f.store.createJob({
      accountId: recoveryBindings.accountId,
      kind: 'write',
      operation: 'resume_create_draft',
      idempotencyKey: randomUUID(),
      inputHash: recoveryBindings.resumeInputHash,
    }).job,
    job = f.store.startJob(queued.id);
  const creationContext = {
      originalJobId: original.id,
      recoveryJobId: null,
      previousRepairJobId: null,
    },
    requestBindings = { ...recoveryBindings };
  const witness: R6RuntimeWitness = {
    schema: 'fanqie-generic-short-execution/v1',
    operation: 'resume_create_draft',
    target: recoveryTarget,
    creationContext,
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
    inputHash: job.inputHash,
    target: witness.target,
    creationContext,
    requestBindings,
    identityType: 'account',
    platformOwnerId: '1001',
    profileId: witness.profileId,
    profileVerifiedAt: witness.profileVerifiedAt,
    provenance: witness.provenance,
  });
  f.store.addJobMetadata(job.id, { genericShortStatus: witness });
  f.store.claimCreationRecovery(original.id, job.id, recoveryBindings);
  const run = { job, witness },
    beforeAt = f.store.markPlatformReadStarted(job.id),
    before = {
      ...r6StatusSnapshot(beforeAt),
      title: '',
      body: '',
      contentHash: digest(canonicalJson({ title: '', body: '', metadata: {} })),
    },
    source = { mode: 'live', origin: 'https://fanqienovel.com' };
  const special = f.store.saveEvidence(job.id, 'creation-resume-baseline', {
    originalJobId: original.id,
    requestedContentHash: recoveryBindings.requestedContentHash,
    target: recoveryTarget,
    snapshot: before,
    source,
    statusProtocol: r6Protocol,
  });
  r6Advance(f, run, 'baseline_saved', special, 'baseline');
  const writerBefore = f.store.saveEvidence(job.id, 'editable_snapshot', {
    schema: 'fanqie-generic-short-editor-observation/v1',
    phase: 'baseline',
    snapshot: before,
    source,
  });
  r6Advance(f, run, 'baseline_saved', writerBefore, 'baseline');
  const intent = f.store.saveEvidence(job.id, 'write-intent', {
    desiredContentHash: wrongIntent
      ? digest('r6-wrong-resume-intent')
      : recoveryBindings.requestedContentHash,
    expectedStates: ['draft_saved'],
    target: recoveryTarget,
    statusProtocol: r6Protocol,
  });
  return { original, run, intent, source };
}

function r6HistoricalSettlement(f: R6RuntimeFixture, rootId: string, readId: string) {
  const db = r6Db(f),
    at = '2025-01-02T00:00:00.000Z',
    read = f.store.getJob(readId)!,
    ref = f.store.listEvidence(readId)[0]!,
    document = f.store.readEvidence(ref),
    payload = document.payload as { platformReadAt: string; statusSnapshot?: ModernShortSnapshot };
  document.capturedAt = at;
  payload.platformReadAt = at;
  if (payload.statusSnapshot) {
    const snapshot = payload.statusSnapshot;
    snapshot.platformReadAt = at;
    for (const key of [
      'readStartedAt',
      'getRequestedAt',
      'getCompletedAt',
      'readFinishedAt',
    ] as const)
      snapshot.statusProof[key] = at;
    for (const key of ['before', 'after'] as const)
      snapshot.statusProof.owner[key] = { requestedAt: at, completedAt: at, checkedAt: at };
  }
  const bytes = JSON.stringify(document),
    historicalRef = { ...ref, capturedAt: at, sha256: digest(bytes) };
  writeFileSync(path.join(f.options.evidenceDirectory, ref.path), bytes);
  db.prepare('UPDATE evidence SET captured_at=?,sha256=? WHERE id=?').run(
    at,
    historicalRef.sha256,
    ref.id,
  );
  const manifest = (read.result as { manifest: Manifest }).manifest;
  Object.assign(manifest, {
    requestedAt: at,
    platformReadStartedAt: at,
    committedAt: at,
    evidence: [historicalRef],
  });
  const metadata = structuredClone(read.metadata);
  if (metadata.genericShortStatus) {
    const witness = metadata.genericShortStatus as R6RuntimeWitness;
    witness.startedAt = at;
    witness.observations = witness.observations.map((value) => ({
      ...value,
      evidenceHash: historicalRef.sha256,
    }));
  }
  db.prepare('UPDATE manifests SET committed_at=?,manifest_json=? WHERE job_id=?').run(
    at,
    canonicalJson(manifest),
    readId,
  );
  db.prepare(
    'UPDATE jobs SET requested_at=?,started_at=?,read_started_at=?,ended_at=?,updated_at=?,result_json=?,metadata_json=? WHERE id=?',
  ).run(at, at, at, at, at, canonicalJson({ manifest }), canonicalJson(metadata), readId);
  const root = f.store.getJob(rootId)!,
    closure = { ...(root.result as Record<string, unknown>), evidence: historicalRef };
  db.prepare(
    'UPDATE write_reconciliations SET created_at=?,result_json=? WHERE original_job_id=?',
  ).run(at, canonicalJson(closure), rootId);
  db.prepare('UPDATE jobs SET ended_at=?,updated_at=?,result_json=? WHERE id=?').run(
    at,
    at,
    canonicalJson(closure),
    rootId,
  );
  return f.store.getJob(rootId)!;
}

export async function r6OtherRootSettlement(f: R6RuntimeFixture, legacy: boolean) {
  const root = r6LegacyUnknownRoot(f),
    db = r6Db(f),
    intentRef = f.store.listEvidence(root.id)[0]!,
    intentDocument = f.store.readEvidence(intentRef),
    desired = r6StatusSnapshot('2025-01-01T00:00:00.000Z').contentHash;
  (intentDocument.payload as { desiredContentHash: string }).desiredContentHash = desired;
  const bytes = JSON.stringify(intentDocument),
    actualIntent = { ...intentRef, sha256: digest(bytes) };
  writeFileSync(path.join(f.options.evidenceDirectory, intentRef.path), bytes);
  db.prepare('UPDATE evidence SET sha256=? WHERE id=?').run(actualIntent.sha256, intentRef.id);
  db.prepare('UPDATE jobs SET result_json=? WHERE id=?').run(
    canonicalJson({ evidence: [actualIntent] }),
    root.id,
  );
  const prior = f.store.getJob(root.id)!;
  let readId: string;
  if (legacy) {
    const queued = f.store.createJob({
      accountId: 'author',
      kind: 'read',
      operation: 'reconcile_write',
      scope: 'reconciliation',
      datasets: ['reconciliation'],
      inputHash: digest(canonicalJson({ jobId: root.id })),
    }).job;
    f.store.startJob(queued.id);
    const at = f.store.markPlatformReadStarted(queued.id),
      snapshot = r6StatusSnapshot(at);
    const ref = f.store.saveEvidence(queued.id, 'reconciliation', {
      source: { mode: 'live', origin: 'https://fanqienovel.com' },
      reconciliation: {
        originalJobId: root.id,
        target: root.target,
        inputHash: root.inputHash,
        observedContentHash: desired,
        observedStatus: 'draft_saved',
      },
      sourceUrl: snapshot.sourceUrl,
      platformReadAt: at,
    });
    f.store.completeReadJob(queued.id, [ref]);
    readId = queued.id;
  } else {
    const run = r6Begin(f, prior),
      at = f.store.markPlatformReadStarted(run.job.id),
      snapshot = r6StatusSnapshot(at),
      originalAudit = f.store.getGenericShortOriginalAudit(root.id, 'author', run.job.id);
    const ref = f.store.saveEvidence(run.job.id, 'reconciliation', {
      source: { mode: 'live', origin: 'https://fanqienovel.com' },
      reconciliation: {
        originalJobId: root.id,
        target: root.target,
        inputHash: root.inputHash,
        observedContentHash: desired,
        observedStatus: 'draft_saved',
      },
      sourceUrl: snapshot.sourceUrl,
      platformReadAt: at,
      statusProtocol: r6Protocol,
      statusSnapshot: snapshot,
      originalAudit,
    });
    r6Advance(f, run, 'read_saved', ref, 'later_read');
    r6Advance(f, run, 'completed');
    f.store.completeReadJob(run.job.id, [ref]);
    readId = run.job.id;
  }
  assert.equal(
    f.store.reconcileWriteJob(root.id, readId, {
      status: 'succeeded',
      result: { contentHash: desired, platformState: 'draft_saved' },
    }).status,
    'succeeded',
  );
  return r6HistoricalSettlement(f, root.id, readId);
}

export async function r6HistoricalEventFamily(f: R6RuntimeFixture) {
  const p = await repairChain(f),
    first = await unknownRepairSuccessor(f, p, 'r6-event-first'),
    lastBindings = { ...repairBindings, repairInputHash: digest('r6-event-final-input') };
  const last = await f.queue.enqueueWrite({
    accountId: lastBindings.accountId,
    operation: 'repair_created_draft',
    idempotencyKey: 'r6-event-final',
    inputHash: lastBindings.repairInputHash,
    run: async (ctx) => {
      f.store.claimCreationRepair(p.original.id, p.recovery.id, ctx.jobId, lastBindings, first.id);
      repairBaseline(ctx, p.original.id, p.recovery.id);
      const result = repairResult();
      ctx.saveEvidence('creation-repair-verification', {
        originalJobId: p.original.id,
        recoveryJobId: p.recovery.id,
        target: recoveryTarget,
        source: { mode: 'live', origin: 'https://fanqienovel.com' },
        snapshot: repairFullSnapshot(),
      });
      ctx.saveEvidence('write-result', result);
      return result;
    },
  }).completion;
  assert.equal(last.status, 'succeeded');
  const closed = f.store.completeCreationRepair(p.original.id, p.recovery.id, last.id);
  return { ...p, first, last, closed };
}

export function r6EventRows(f: R6RuntimeFixture) {
  const db = r6Db(f);
  return [
    'jobs',
    'manifests',
    'current_manifests',
    'evidence',
    'creation_recoveries',
    'creation_repairs',
    'creation_repair_successors',
    'write_reconciliations',
  ].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
}
