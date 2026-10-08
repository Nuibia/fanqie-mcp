import { type JobContext } from '../../src/runtime/jobs.js';

import {
  recoveryBindings,
  recoveryTarget,
  digest,
  fixture,
  allocatedCreation,
  delay,
} from './runtime-deferred.js';

import { canonicalJson, RuntimeError, Store, type Job } from '../../src/runtime/store.js';

import assert from 'node:assert/strict';

import {
  type NativeShortMetadataSnapshot,
  createNativeShortMetadataSnapshot,
} from '../../src/platform/short-native-metadata.js';

import { type NativeShortMetadataApiResult } from '../../src/platform/short-native-metadata-api.js';

export function recoveryBaseline(ctx: JobContext, originalId: string) {
  ctx.beforePlatformRead();
  return ctx.saveEvidence('creation-resume-baseline', {
    originalJobId: originalId,
    requestedContentHash: recoveryBindings.requestedContentHash,
    target: recoveryTarget,
    source: { mode: 'live', origin: 'https://fanqienovel.com' },
    snapshot: {
      target: { kind: 'short', workId: recoveryTarget.id },
      accountId: '1001',
      title: '',
      body: '',
      metadata: {},
      state: 'draft',
      contentHash: digest(canonicalJson({ title: '', body: '', metadata: {} })),
      sourceUrl: 'https://fanqienovel.com/main/writer/publish-short/' + recoveryTarget.id,
      platformReadAt: new Date().toISOString(),
    },
  });
}

export function desiredRecoveryIntent(ctx: JobContext) {
  ctx.saveEvidence('write-intent', {
    target: recoveryTarget,
    desiredContentHash: recoveryBindings.requestedContentHash,
    expectedStates: ['draft_saved'],
  });
  ctx.beforePlatformWrite();
}

export const repairRequested = { title: 'Synthetic title', body: 'Synthetic body' };

export const repairExpected = digest(
  canonicalJson({ title: repairRequested.title, body: 'Synthetic', metadata: {} }),
);

export const repairBindings = {
  accountId: recoveryBindings.accountId,
  originalInputHash: recoveryBindings.originalInputHash,
  recoveryInputHash: recoveryBindings.resumeInputHash,
  repairInputHash: digest('repair input'),
  clientReferenceHash: recoveryBindings.clientReferenceHash,
  requestedContentHash: recoveryBindings.requestedContentHash,
  desiredContentHash: recoveryBindings.requestedContentHash,
  expectedContentHash: repairExpected,
  requestedTitleHash: digest(repairRequested.title),
  requestedBodyHash: digest(repairRequested.body),
};

export async function repairChain(f: ReturnType<typeof fixture>) {
  const original = await allocatedCreation(f);
  const recovery = await f.queue.enqueueWrite({
    accountId: recoveryBindings.accountId,
    operation: 'resume_create_draft',
    idempotencyKey: 'repair-chain-recovery',
    inputHash: recoveryBindings.resumeInputHash,
    run: async (ctx) => {
      f.store.claimCreationRecovery(original.id, ctx.jobId, recoveryBindings);
      recoveryBaseline(ctx, original.id);
      desiredRecoveryIntent(ctx);
      throw new RuntimeError('outcome_unknown', 'Synthetic first save stored only one paragraph');
    },
  }).completion;
  assert.equal(recovery.status, 'uncertain');
  return { original, recovery };
}

export function repairBaseline(ctx: JobContext, originalId: string, recoveryId: string) {
  ctx.beforePlatformRead();
  ctx.saveEvidence('creation-repair-baseline', {
    originalJobId: originalId,
    recoveryJobId: recoveryId,
    requestedContentHash: repairBindings.requestedContentHash,
    expectedContentHash: repairExpected,
    target: recoveryTarget,
    source: { mode: 'live', origin: 'https://fanqienovel.com' },
    snapshot: {
      target: { kind: 'short', workId: recoveryTarget.id },
      accountId: '1001',
      title: repairRequested.title,
      body: 'Synthetic',
      metadata: {},
      state: 'draft',
      contentHash: repairExpected,
      sourceUrl: 'https://fanqienovel.com/main/writer/publish-short/' + recoveryTarget.id,
      platformReadAt: new Date().toISOString(),
    },
  });
  ctx.saveEvidence('write-intent', {
    target: recoveryTarget,
    desiredContentHash: repairBindings.desiredContentHash,
    expectedStates: ['draft_saved'],
  });
  ctx.beforePlatformWrite();
}

export function repairFullSnapshot(body = repairRequested.body) {
  return {
    target: { kind: 'short', workId: recoveryTarget.id },
    accountId: '1001',
    title: repairRequested.title,
    body,
    metadata: {},
    state: 'draft',
    contentHash: repairBindings.desiredContentHash,
    sourceUrl: 'https://fanqienovel.com/main/writer/publish-short/' + recoveryTarget.id,
    platformReadAt: new Date().toISOString(),
  };
}

export function repairResult() {
  return {
    status: 'succeeded',
    capability: 'update_draft',
    target: { kind: 'short', workId: recoveryTarget.id },
    contentHash: repairBindings.desiredContentHash,
    platformState: 'draft',
    sourceUrl: 'https://fanqienovel.com/main/writer/publish-short/' + recoveryTarget.id,
    verifiedAt: new Date().toISOString(),
  };
}

// Append-only successor fixtures: all jobs/evidence remain synthetic and use queue boundaries.
export async function unknownRepairSuccessor(
  f: ReturnType<typeof fixture>,
  p: Awaited<ReturnType<typeof repairChain>>,
  key: string,
  previousRepairId?: string,
  bindings = repairBindings,
  persistedResult = false,
) {
  return f.queue.enqueueWrite({
    accountId: bindings.accountId,
    operation: 'repair_created_draft',
    idempotencyKey: key,
    inputHash: bindings.repairInputHash,
    run: async (ctx) => {
      f.store.claimCreationRepair(
        p.original.id,
        p.recovery.id,
        ctx.jobId,
        bindings,
        previousRepairId,
      );
      repairBaseline(ctx, p.original.id, p.recovery.id);
      if (persistedResult) ctx.saveEvidence('write-result', repairResult());
      throw new RuntimeError(
        'outcome_unknown',
        'Synthetic repair acknowledgement lost after the durable write boundary',
      );
    },
  }).completion;
}

export function successorRepairPrior(store: Store, job: Job) {
  return {
    id: job.id,
    status: job.status,
    error: job.error,
    result: job.result,
    target: job.target,
    endedAt: job.endedAt,
    evidence: store.listEvidence(job.id),
    metadata: job.metadata,
  };
}

export async function successorReconciliationRead(f: ReturnType<typeof fixture>, job: Job) {
  // Normal reconciliation requires a read strictly after the ended write, not a fixed fixture date.
  await delay(2);
  return f.queue.enqueueRead({
    accountId: job.accountId,
    operation: 'reconcile_write',
    scope: 'reconciliation',
    datasets: ['reconciliation'],
    inputHash: digest(canonicalJson({ jobId: job.id })),
    run: async (ctx) => {
      ctx.beforePlatformRead();
      return [
        ctx.saveEvidence('reconciliation', {
          source: { mode: 'live', origin: 'https://fanqienovel.com' },
          reconciliation: {
            originalJobId: job.id,
            inputHash: job.inputHash,
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
}

// Synthetic trusted-live contracts exercise only local Store/SQLite validators;
// they are not platform evidence and never open a browser or send a request.
export const NATIVE_STORE_WORK = '7000000001';

const NATIVE_STORE_ACCOUNT = '1001';

export const nativeStoreProvenance = {
  executor: 'application-default-browser/v1',
  mode: 'live',
} as const;

export function nativeStoreSnapshot(
  title = 'Before',
  change?: (edit: Record<string, unknown>, catalog: Record<string, unknown>) => void,
): NativeShortMetadataSnapshot {
  const edit: Record<string, unknown> = {
    item_id: NATIVE_STORE_WORK,
    publish_status: 0,
    multi_title: [title, 'SYNTHETIC_PRIVATE_TAIL'],
    content: '<p>SYNTHETIC_PRIVATE_HTML &amp; stable</p>',
    thumb_uri: 'SYNTHETIC_PRIVATE_URI_ONE',
    book_thumb_uri: 'SYNTHETIC_PRIVATE_URI_TWO',
    category: [{ category_id: 10, label: '主类', name: '主甲' }],
    category_max_count: 4,
    sign_type: 1,
    origin_activity_flag: 0,
    unknown_saved: 'SYNTHETIC_PRIVATE_UNKNOWN',
  };
  const catalog: Record<string, unknown> = {
    category_list: [
      { category_id: 10, label: '主类', name: '主甲' },
      { category_id: 11, label: '主类', name: '主乙' },
    ],
  };
  change?.(edit, catalog);
  return createNativeShortMetadataSnapshot({
    binding: {
      account: { kind: 'account_id', id: NATIVE_STORE_ACCOUNT },
      work: { kind: 'short', id: NATIVE_STORE_WORK },
    },
    editData: edit,
    categoryData: catalog,
  });
}

export function nativeStoreReadResult(
  snapshot: NativeShortMetadataSnapshot,
  at: string,
): NativeShortMetadataApiResult {
  return {
    schema: 'native-short-metadata-api-read/v1',
    status: 'success',
    reason: null,
    snapshot,
    proof: {
      platformStarted: true,
      ownerBefore: true,
      ownerAfter: true,
      ownerCallback: true,
      fixedSourceVerified: true,
      targetUnique: true,
      paginationComplete: true,
      atomicRevision: false,
      readStartedAt: at,
      readFinishedAt: at,
      proofCapturedAt: at,
    },
    requests: {
      own: { attempts: 2, disposed: 2 },
      list: { attempts: 1, disposed: 1 },
      edit: { attempts: 1, disposed: 1 },
      catalog: { attempts: 1, disposed: 1 },
    },
    list: { pagesRead: 1, rowsRead: 1, totalCount: 1 },
    cleanup: {
      sessionCreated: true,
      sessionDisposed: true,
      pendingAtEnd: 0,
      disposalFailures: 0,
      quarantined: false,
      checkedAt: at,
    },
  };
}

export function nativeStoreDb(f: ReturnType<typeof fixture>) {
  return (f.store as unknown as { db: import('node:sqlite').DatabaseSync }).db;
}

export function nativeStoreRowCount(f: ReturnType<typeof fixture>) {
  return Number(
    nativeStoreDb(f).prepare('SELECT COUNT(*) AS count FROM write_reconciliations').get()!.count,
  );
}
