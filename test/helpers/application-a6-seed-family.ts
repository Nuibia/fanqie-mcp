import {
  Store as CreationRecoveryStore,
  type Job,
  canonicalJson as recoveryCanonicalJson,
} from '../../src/runtime/store.js';

import assert from 'node:assert/strict';

import {
  a6NativeDb,
  type A6FamilyPlan,
  recoveryAppHash,
} from './application-long-book-metadata-application-fixture.js';

import { createHash } from 'node:crypto';

import { writeFileSync } from 'node:fs';

import path from 'node:path';

import { loadConfig } from '../../src/config.js';

import { hashDraftContent as recoveryContentHash } from '../../src/platform/writes.js';

// Rebase a finished unknown fixture before another claim captures its prior.
// No existing closed proof/prior is rewritten. The original durable D9/hash
// preparation pattern is the R6 runtime historical-root fixture.
function a6HistoricalUnknown(
  store: CreationRecoveryStore,
  job: Job,
  directory: string,
  ordinal: number,
): Job {
  assert.equal(job.status, 'uncertain');
  const at = new Date(Date.UTC(2025, 0, 1, 0, 0, 0, ordinal)).toISOString(),
    db = a6NativeDb(store);
  const refs = store.listEvidence(job.id).map((ref) => {
    const document = store.readEvidence(ref),
      payload = document.payload as Record<string, unknown>;
    document.capturedAt = at;
    if (payload.snapshot && typeof payload.snapshot === 'object')
      (payload.snapshot as Record<string, unknown>).platformReadAt = at;
    const bytes = JSON.stringify(document),
      sha256 = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(path.join(directory, ref.path), bytes);
    db.prepare('UPDATE evidence SET captured_at=?,sha256=? WHERE id=?').run(at, sha256, ref.id);
    return { ...ref, capturedAt: at, sha256 };
  });
  db.prepare(
    'UPDATE jobs SET requested_at=?,started_at=?,read_started_at=?,write_started_at=?,ended_at=?,updated_at=?,result_json=? WHERE id=?',
  ).run(at, at, at, at, at, at, recoveryCanonicalJson({ evidence: refs }), job.id);
  // These are open fixture rows only; their own creation times remain within
  // the corresponding attempt's rebased requested/ended interval.
  if (job.operation === 'resume_create_draft')
    db.prepare(
      'UPDATE creation_recoveries SET created_at=? WHERE resume_job_id=? AND closed_at IS NULL',
    ).run(at, job.id);
  if (job.operation === 'repair_created_draft') {
    db.prepare(
      'UPDATE creation_repairs SET created_at=? WHERE repair_job_id=? AND closed_at IS NULL',
    ).run(at, job.id);
    db.prepare(
      'UPDATE creation_repair_successors SET created_at=? WHERE repair_job_id=? AND closed_at IS NULL',
    ).run(at, job.id);
  }
  return store.getJob(job.id)!;
}

export function a6SeedFamily(
  store: CreationRecoveryStore,
  config: ReturnType<typeof loadConfig>,
  initial: Job,
  input: { clientReference: string; content: { title: string; body: string } },
  target: { kind: 'short-story'; id: string },
  plan: A6FamilyPlan,
) {
  const evidenceDirectory = path.join(config.dataDir, 'evidence'),
    originalBefore = a6HistoricalUnknown(store, initial, evidenceDirectory, 0),
    requestedContentHash = recoveryContentHash(input.content),
    clientReferenceHash = recoveryAppHash({
      kind: 'short',
      clientReference: input.clientReference,
    });
  const resumeArgs = {
      originalJobId: initial.id,
      idempotencyKey: 'synthetic-resume-key',
      ...input,
    },
    { idempotencyKey: resumeKey, ...resumeBusiness } = resumeArgs;
  const resumeBindings = {
    accountId: config.accountId,
    originalInputHash: initial.inputHash,
    resumeInputHash: recoveryAppHash(resumeBusiness),
    clientReferenceHash,
    requestedContentHash,
  };
  const source = { mode: 'live', origin: 'https://fanqienovel.com' },
    writeTarget = { kind: 'short', workId: target.id },
    sourceUrl = 'https://fanqienovel.com/main/writer/publish-short/' + target.id;
  const snapshot = (title: string, body: string) => ({
    title,
    body,
    metadata: {},
    accountId: '1001',
    target: writeTarget,
    state: 'draft',
    contentHash: recoveryContentHash({ title, body }),
    sourceUrl,
    platformReadAt: new Date().toISOString(),
  });
  const result = () => ({
    status: 'succeeded',
    capability: 'update_draft',
    target: writeTarget,
    contentHash: requestedContentHash,
    platformState: 'draft',
    verifiedAt: new Date().toISOString(),
    sourceUrl,
  });
  const resume = store.createJob({
    accountId: config.accountId,
    kind: 'write',
    operation: 'resume_create_draft',
    idempotencyKey: resumeKey,
    inputHash: resumeBindings.resumeInputHash,
  }).job;
  store.startJob(resume.id);
  store.claimCreationRecovery(initial.id, resume.id, resumeBindings);
  store.markPlatformReadStarted(resume.id);
  store.saveEvidence(resume.id, 'creation-resume-baseline', {
    originalJobId: initial.id,
    requestedContentHash,
    target,
    snapshot: snapshot('', ''),
    source,
  });
  store.saveEvidence(resume.id, 'write-intent', {
    target,
    desiredContentHash: requestedContentHash,
    expectedStates: ['draft_saved'],
  });
  store.markPlatformWriteStarted(resume.id);
  if (plan.recovery === 'write') {
    const value = result();
    store.saveEvidence(resume.id, 'write-result', value);
    store.completeWriteJob(resume.id, value);
  } else
    store.failJob(resume.id, {
      code: 'outcome_unknown',
      message: 'Synthetic historical recovery ACK lost.',
    });
  let recoveryBefore = store.getJob(resume.id)!;
  const repairsBefore: Job[] = [],
    repairArgs: Record<string, unknown>[] = [],
    reads: Array<{ job: Job; manifest: ReturnType<CreationRecoveryStore['completeReadJob']> }> = [];
  const settle = (job: Job, isRepair: boolean) => {
    const read = store.createJob({
      accountId: config.accountId,
      kind: 'read',
      operation: 'reconcile_write',
      scope: 'reconciliation',
      datasets: ['reconciliation'],
      inputHash: recoveryAppHash({ jobId: job.id }),
    }).job;
    store.startJob(read.id);
    store.markPlatformReadStarted(read.id);
    const full = snapshot(input.content.title, input.content.body);
    const ref = store.saveEvidence(read.id, 'reconciliation', {
      source,
      reconciliation: {
        originalJobId: job.id,
        target,
        inputHash: job.inputHash,
        observedStatus: 'draft_saved',
        observedContentHash: requestedContentHash,
      },
      ...(isRepair ? { repairVerification: full } : {}),
      sourceUrl,
      platformReadAt: full.platformReadAt,
    });
    const manifest = store.completeReadJob(read.id, [ref]);
    reads.push({ job: store.getJob(read.id)!, manifest });
    store.reconcileWriteJob(job.id, read.id, {
      status: 'succeeded',
      result: { contentHash: requestedContentHash, platformState: 'draft_saved' },
    });
  };
  const count = plan.repairCount ?? 0;
  if (count || plan.recovery === 'reconciled')
    recoveryBefore = a6HistoricalUnknown(store, recoveryBefore, evidenceDirectory, 1);
  if (!count) {
    if (plan.recovery === 'reconciled') settle(recoveryBefore, false);
    if (plan.recovery === 'write' || plan.recovery === 'reconciled')
      store.completeCreationRecovery(initial.id, resume.id);
  }
  for (let index = 0; index < count; index++) {
    const previous = repairsBefore.at(-1),
      key =
        index === count - 1 && plan.key
          ? plan.key
          : index === 0
            ? 'successor-first-repair'
            : index === 1
              ? 'successor-second-repair'
              : 'successor-third-repair';
    const expectedContentHash = recoveryContentHash({
      title: input.content.title,
      body: 'Synthetic recovery body\n',
    });
    const args = {
      ...resumeArgs,
      recoveryJobId: resume.id,
      idempotencyKey: key,
      expectedState: 'draft',
      expectedContentHash,
      ...(previous ? { previousRepairJobId: previous.id } : {}),
    };
    const { idempotencyKey, ...business } = args,
      repairInputHash = recoveryAppHash(business),
      bindings = {
        accountId: config.accountId,
        originalInputHash: initial.inputHash,
        recoveryInputHash: resumeBindings.resumeInputHash,
        repairInputHash,
        clientReferenceHash,
        requestedContentHash,
        desiredContentHash: requestedContentHash,
        expectedContentHash,
        requestedTitleHash: createHash('sha256').update(input.content.title).digest('hex'),
        requestedBodyHash: createHash('sha256')
          .update(input.content.body.replace(/\r\n?/g, '\n'))
          .digest('hex'),
      };
    const queued = store.createJob({
      accountId: config.accountId,
      kind: 'write',
      operation: 'repair_created_draft',
      idempotencyKey,
      inputHash: repairInputHash,
    }).job;
    store.startJob(queued.id);
    store.claimCreationRepair(initial.id, resume.id, queued.id, bindings, previous?.id);
    store.markPlatformReadStarted(queued.id);
    store.saveEvidence(queued.id, 'creation-repair-baseline', {
      originalJobId: initial.id,
      recoveryJobId: resume.id,
      requestedContentHash,
      expectedContentHash,
      target,
      snapshot: snapshot(input.content.title, 'Synthetic recovery body\n'),
      source,
    });
    store.saveEvidence(queued.id, 'write-intent', {
      target,
      desiredContentHash: requestedContentHash,
      expectedStates: ['draft_saved'],
    });
    store.markPlatformWriteStarted(queued.id);
    const final = index === count - 1 ? (plan.final ?? 'unknown') : 'unknown';
    if (final === 'write') {
      const value = result(),
        full = snapshot(input.content.title, input.content.body);
      store.saveEvidence(queued.id, 'creation-repair-verification', {
        originalJobId: initial.id,
        recoveryJobId: resume.id,
        target,
        snapshot: full,
        source,
      });
      store.saveEvidence(queued.id, 'write-result', value);
      store.completeWriteJob(queued.id, value);
    } else
      store.failJob(queued.id, {
        code: 'outcome_unknown',
        message: 'Synthetic historical repair ACK lost.',
      });
    let saved = store.getJob(queued.id)!;
    if (final !== 'write') saved = a6HistoricalUnknown(store, saved, evidenceDirectory, index + 2);
    repairsBefore.push(saved);
    repairArgs.push(args);
    if (final === 'reconciled') settle(saved, true);
    if (final === 'write' || final === 'reconciled')
      store.completeCreationRepair(initial.id, resume.id, saved.id);
  }
  if (plan.unrelated) {
    const job = store.createJob({
      accountId: config.accountId,
      kind: 'write',
      operation: 'update_draft',
      idempotencyKey: 'other-family-unknown',
      inputHash: recoveryAppHash('other family'),
    }).job;
    store.startJob(job.id);
    store.markPlatformReadStarted(job.id);
    store.recordTarget(job.id, { kind: 'short-story', id: '9234567890123456789' });
    store.saveEvidence(job.id, 'write-intent', {
      target: { kind: 'short-story', id: '9234567890123456789' },
      desiredContentHash: recoveryAppHash('other desired'),
      expectedStates: ['draft_saved'],
    });
    store.markPlatformWriteStarted(job.id);
    store.failJob(job.id, { code: 'outcome_unknown', message: 'Synthetic unrelated unknown.' });
  }
  return {
    originalBefore,
    recoveryBefore,
    repairsBefore,
    resumeArgs,
    repairArgs,
    reads,
    jobs: [initial.id, resume.id, ...repairsBefore.map((job) => job.id)].map((id) =>
      store.getJob(id)!,
    ),
    closed:
      plan.recovery === 'write' ||
      plan.recovery === 'reconciled' ||
      plan.final === 'write' ||
      plan.final === 'reconciled',
  };
}
