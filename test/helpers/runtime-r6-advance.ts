import {
  type R6RuntimeFixture,
  r6Begin,
  r6StatusSnapshot,
  r6Protocol,
  r6Target,
  r6Db,
  type R6RuntimeWitness,
  r6WriterTarget,
} from './runtime-native-compensation-later.js';

import {
  type EvidenceRef,
  type Job,
  canonicalJson,
  type Manifest,
} from '../../src/runtime/store.js';

import { randomUUID } from 'node:crypto';

import { digest } from './runtime-deferred.js';

import { writeFileSync } from 'node:fs';

import path from 'node:path';

export function r6Advance(
  f: R6RuntimeFixture,
  run: ReturnType<typeof r6Begin>,
  stage: string,
  ref?: EvidenceRef,
  phase = 'snapshot_read',
  failure?: string,
) {
  run.witness = {
    ...run.witness,
    stage,
    observations: ref
      ? [
          ...run.witness.observations,
          {
            ordinal: run.witness.observations.length + 1,
            dataset: ref.dataset,
            phase,
            evidenceId: ref.id,
            evidenceHash: ref.sha256,
          },
        ]
      : run.witness.observations,
    failure: failure ? { kind: failure, at: new Date().toISOString() } : run.witness.failure,
  };
  f.store.addJobMetadata(run.job.id, { genericShortStatus: run.witness });
}

export function r6SavedRead(f: R6RuntimeFixture, original?: Job, display?: 1 | 4) {
  const run = r6Begin(f, original),
    at = f.store.markPlatformReadStarted(run.job.id),
    snapshot = r6StatusSnapshot(at, display);
  const dataset = original ? 'reconciliation' : 'editable_snapshot';
  const payload = original
    ? {
        source: { mode: 'live', origin: 'https://fanqienovel.com' },
        reconciliation: {
          originalJobId: original.id,
          target: original.target,
          inputHash: original.inputHash,
          observedContentHash: snapshot.contentHash,
          observedStatus: 'unknown',
        },
        sourceUrl: snapshot.sourceUrl,
        platformReadAt: at,
        statusProtocol: r6Protocol,
        statusSnapshot: snapshot,
        originalAudit: f.store.getGenericShortOriginalAudit(original.id, 'author', run.job.id),
      }
    : {
        schema: 'fanqie-generic-short-editor-observation/v1',
        phase: 'snapshot_read',
        snapshot,
        source: { mode: 'live', origin: 'https://fanqienovel.com' },
      };
  const ref = f.store.saveEvidence(run.job.id, dataset, payload);
  r6Advance(f, run, 'read_saved', ref, original ? 'later_read' : 'snapshot_read');
  r6Advance(f, run, 'completed');
  const manifest = f.store.completeReadJob(run.job.id, [ref]),
    job = f.store.getJob(run.job.id)!;
  return { job, ref, snapshot, manifest, payload };
}

export function r6LegacyUnknownRoot(f: R6RuntimeFixture) {
  const queued = f.store.createJob({
    accountId: 'author',
    kind: 'write',
    operation: 'update_draft',
    idempotencyKey: randomUUID(),
    inputHash: digest('r6-synthetic-original-input'),
  }).job;
  f.store.startJob(queued.id);
  f.store.markPlatformReadStarted(queued.id);
  f.store.recordTarget(queued.id, r6Target);
  const ref = f.store.saveEvidence(queued.id, 'write-intent', {
    desiredContentHash: digest('r6-independent-desired-version'),
    expectedStates: ['draft_saved'],
    target: r6Target,
  });
  f.store.markPlatformWriteStarted(queued.id);
  f.store.failJob(queued.id, {
    code: 'synthetic_lost_ack',
    message: 'Synthetic original acknowledgement lost.',
  });
  // Controlled historical fixture dates avoid adding timer waits to establish a strict later read.
  const at = '2025-01-01T00:00:00.000Z',
    db = r6Db(f),
    doc = f.store.readEvidence(ref);
  doc.capturedAt = at;
  const bytes = JSON.stringify(doc);
  writeFileSync(path.join(f.options.evidenceDirectory, ref.path), bytes);
  const historicalRef = { ...ref, capturedAt: at, sha256: digest(bytes) };
  db.prepare('UPDATE evidence SET captured_at=?,sha256=? WHERE id=?').run(
    at,
    historicalRef.sha256,
    ref.id,
  );
  db.prepare(
    'UPDATE jobs SET requested_at=?,started_at=?,read_started_at=?,write_started_at=?,ended_at=?,updated_at=?,result_json=? WHERE id=?',
  ).run(at, at, at, at, at, at, canonicalJson({ evidence: [historicalRef] }), queued.id);
  return f.store.getJob(queued.id)!;
}

export function r6RewriteReadDocument(
  f: R6RuntimeFixture,
  ref: EvidenceRef,
  edit: (payload: Record<string, any>) => void,
) {
  const db = r6Db(f),
    document = f.store.readEvidence(ref);
  edit(document.payload as Record<string, any>);
  const bytes = JSON.stringify(document),
    sha256 = digest(bytes);
  writeFileSync(path.join(f.options.evidenceDirectory, ref.path), bytes);
  db.prepare('UPDATE evidence SET sha256=? WHERE id=?').run(sha256, ref.id);
  const job = f.store.getJob(ref.jobId)!,
    manifest = (job.result as { manifest: Manifest }).manifest;
  manifest.evidence = manifest.evidence.map((value) =>
    value.id === ref.id ? { ...value, sha256 } : value,
  );
  const metadata = structuredClone(job.metadata) as Record<string, any>;
  metadata.genericShortStatus.observations = metadata.genericShortStatus.observations.map(
    (value: Record<string, unknown>) =>
      value.evidenceId === ref.id ? { ...value, evidenceHash: sha256 } : value,
  );
  db.prepare('UPDATE manifests SET manifest_json=? WHERE job_id=?').run(
    canonicalJson(manifest),
    job.id,
  );
  db.prepare('UPDATE jobs SET result_json=?,metadata_json=? WHERE id=?').run(
    canonicalJson({ manifest }),
    canonicalJson(metadata),
    job.id,
  );
}

export const r6Unavailable = {
  code: 'capability_unavailable',
  message: 'Generic short publication status is unavailable.',
};

export function r6DirectSuccess(f: R6RuntimeFixture) {
  const desired = r6StatusSnapshot(new Date().toISOString()).contentHash,
    inputHash = digest('r6-modern-direct-input');
  const queued = f.store.createJob({
      accountId: 'author',
      kind: 'write',
      operation: 'update_draft',
      idempotencyKey: randomUUID(),
      inputHash,
    }).job,
    job = f.store.startJob(queued.id);
  f.store.markPlatformReadStarted(job.id);
  f.store.recordTarget(job.id, r6Target);
  const witness: R6RuntimeWitness = {
    schema: 'fanqie-generic-short-execution/v1',
    operation: 'update_draft',
    target: r6Target,
    creationContext: null,
    requestBindings: { inputHash, expectedContentHash: desired, desiredContentHash: desired },
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
    target: r6Target,
    creationContext: null,
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
    before = f.store.saveEvidence(job.id, 'editable_snapshot', {
      schema: 'fanqie-generic-short-editor-observation/v1',
      phase: 'baseline',
      snapshot: r6StatusSnapshot(beforeAt),
      source: { mode: 'live', origin: 'https://fanqienovel.com' },
    });
  r6Advance(f, run, 'baseline_saved', before, 'baseline');
  f.store.saveEvidence(job.id, 'write-intent', {
    desiredContentHash: desired,
    expectedStates: ['draft_saved'],
    target: r6Target,
    statusProtocol: r6Protocol,
  });
  r6Advance(f, run, 'save_marked');
  f.store.markPlatformWriteStarted(job.id);
  const afterAt = new Date().toISOString(),
    after = f.store.saveEvidence(job.id, 'editable_snapshot', {
      schema: 'fanqie-generic-short-editor-observation/v1',
      phase: 'after',
      snapshot: r6StatusSnapshot(afterAt),
      source: { mode: 'live', origin: 'https://fanqienovel.com' },
    });
  r6Advance(f, run, 'after_saved', after, 'after');
  r6Advance(f, run, 'completed');
  const result = {
    status: 'succeeded',
    capability: 'update_draft',
    target: r6WriterTarget,
    contentHash: desired,
    platformState: 'draft',
    verifiedAt: afterAt,
    sourceUrl: 'https://fanqienovel.com/main/writer/publish-short/' + r6Target.id,
  };
  f.store.saveEvidence(job.id, 'write-result', result);
  f.store.completeWriteJob(job.id, result);
  // Move the complete synthetic original and all its actual documents together;
  // no injected clock or timer wait grants the later-source relation.
  const at = '2025-01-01T00:00:00.000Z',
    db = r6Db(f),
    current = f.store.getJob(job.id)!,
    metadata = structuredClone(current.metadata) as Record<string, any>;
  for (const ref of f.store.listEvidence(job.id)) {
    const doc = f.store.readEvidence(ref),
      payload = doc.payload as Record<string, any>;
    doc.capturedAt = at;
    if (payload.snapshot) {
      const s = payload.snapshot;
      s.platformReadAt = at;
      for (const key of ['readStartedAt', 'getRequestedAt', 'getCompletedAt', 'readFinishedAt'])
        s.statusProof[key] = at;
      for (const key of ['before', 'after'])
        s.statusProof.owner[key] = { requestedAt: at, completedAt: at, checkedAt: at };
    }
    if (ref.dataset === 'write-result') payload.verifiedAt = at;
    const bytes = JSON.stringify(doc),
      sha256 = digest(bytes);
    writeFileSync(path.join(f.options.evidenceDirectory, ref.path), bytes);
    db.prepare('UPDATE evidence SET captured_at=?,sha256=? WHERE id=?').run(at, sha256, ref.id);
    metadata.genericShortStatus.observations = metadata.genericShortStatus.observations.map(
      (value: Record<string, unknown>) =>
        value.evidenceId === ref.id ? { ...value, evidenceHash: sha256 } : value,
    );
  }
  metadata.genericShortStatus.startedAt = at;
  db.prepare(
    'UPDATE jobs SET requested_at=?,started_at=?,read_started_at=?,write_started_at=?,ended_at=?,updated_at=?,metadata_json=?,result_json=? WHERE id=?',
  ).run(
    at,
    at,
    at,
    at,
    at,
    at,
    canonicalJson(metadata),
    canonicalJson({ ...result, verifiedAt: at }),
    job.id,
  );
  return f.store.getJob(job.id)!;
}
