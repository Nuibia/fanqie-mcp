import { createHash } from 'node:crypto';

import { mkdtempSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import {
  Store,
  type EvidenceRef,
  type Job,
  canonicalJson,
  RuntimeError,
} from '../../src/runtime/store.js';

import { JobQueue, type JobContext } from '../../src/runtime/jobs.js';

export const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function fixture(leaseDurationMs = 30_000, evidenceMode: 'live' | 'fixture' = 'fixture') {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-runtime-'));
  const options = {
    databasePath: path.join(directory, 'runtime.sqlite'),
    evidenceDirectory: path.join(directory, 'evidence'),
    leaseDurationMs,
    evidenceMode,
  };
  const store = new Store(options);
  const queue = new JobQueue(store);
  return {
    directory,
    options,
    store,
    queue,
    async cleanup() {
      await queue.drainAndStop();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export function collect(context: JobContext): EvidenceRef[] {
  context.beforePlatformRead();
  return [
    context.saveEvidence('works', { complete: true, works: [] }),
    context.saveEvidence('metrics', {
      complete: true,
      statisticsThrough: 'observed-in-fixture',
      metrics: [],
    }),
  ];
}

export const desiredContentHash = digest('verified-platform-body');

export async function unknownDraft(f: ReturnType<typeof fixture>, withIntent = true): Promise<Job> {
  return f.queue.enqueueWrite({
    accountId: 'author',
    operation: 'save-draft',
    idempotencyKey: 'unknown-draft',
    inputHash: digest('operation-args'),
    run: async (context) => {
      context.addMetadata({ clientWorkId: 'local-work', version: 'v1' });
      if (withIntent)
        context.saveEvidence('write-intent', {
          desiredContentHash,
          expectedStates: ['draft_saved'],
        });
      context.beforePlatformWrite();
      // The platform can create this 0-word target before it saves the body.
      context.recordTarget('7691713595993768510');
      throw new Error('Save acknowledgement lost.');
    },
  }).completion;
}

export async function reconciliationRead(
  f: ReturnType<typeof fixture>,
  original: Job,
  overrides: Record<string, unknown> = {},
  accountId = 'author',
): Promise<Job> {
  // No injected timestamp: ensure this actual read boundary is later than the failed write.
  await delay(3);
  return f.queue.enqueueRead({
    accountId,
    operation: 'reconcile',
    datasets: ['reconciliation'],
    scope: 'reconciliation',
    run: async (context) => {
      context.beforePlatformRead();
      return [
        context.saveEvidence('reconciliation', {
          source: { mode: 'live', origin: 'https://fanqienovel.com' },
          reconciliation: {
            originalJobId: original.id,
            target: original.target,
            inputHash: original.inputHash,
            observedStatus: 'draft_saved',
            observedContentHash: desiredContentHash,
            ...overrides,
          },
        }),
      ];
    },
  }).completion;
}

// Synthetic trusted-adapter evidence, never a claim that these fixtures contacted the platform.
export async function operatorEntryPair(
  store: Store,
  options: {
    intent?: Record<string, unknown>;
    baseline?: Record<string, unknown>;
    observation?: Record<string, unknown>;
    original?: Record<string, unknown>;
    read?: Record<string, unknown>;
  } = {},
) {
  const titleHash = digest('synthetic-selected-title'),
    itemId = '1234567890123456789';
  const original = store.createJob({
    accountId: 'operator-test',
    kind: 'write',
    operation: 'operator_short_draft_bootstrap_calibration_v2',
    scope: 'operator_short_calibration',
    idempotencyKey: 'operator-short-bootstrap-v2-' + titleHash,
    inputHash: digest(
      canonicalJson({
        schema: 'operator-short-bootstrap/v1',
        titleHash,
        actions: 'draft-box-read_then_existing-or-one-new-entry',
      }),
    ),
  }).job;
  store.startJob(original.id);
  store.markPlatformReadStarted(original.id);
  const intentRef = store.saveEvidence(original.id, 'write-intent', {
    schema: 'operator-short-bootstrap/v1',
    action: 'one_observed_native_new_entry',
    selectedTitleHash: titleHash,
    expectedOwnerType: 'account',
    publicationPermitted: false,
    fillPermitted: false,
    ...options.intent,
  });
  store.markPlatformWriteStarted(original.id);
  const baselineRef = store.saveEvidence(original.id, 'operator_short_incomplete_calibration', {
    schema: 'operator-short-bootstrap-calibration/v2',
    scope: 'operator_incomplete_calibration',
    target: null,
    sourceUrl: 'https://fanqienovel.com/main/writer/publish-short/?enter_from=MODIFYDRAFT',
    navigationTrace: [],
    state: 'unknown',
    profileReady: false,
    mcpCreatePassed: false,
    mcpSavePassed: false,
    draftBoxClickAttempts: 1,
    newEntryClickAttempts: 1,
    explicitFillCalls: 0,
    explicitAgreementCalls: 0,
    explicitSubmitCalls: 0,
    getSamples: [
      {
        path: '/api/author/short_article/draft_list/v0/',
        queryKeys: ['page_count', 'page_index', 'time_sort'],
        status: 200,
        fields: [
          { path: '$.code', type: 'number', value: 0 },
          { path: '$.data.item_list', type: 'array', length: 1 },
          { path: '$.data.item_list[0].item_id', type: 'string', value: itemId },
        ],
      },
    ],
    ...options.baseline,
  });
  store.failJob(original.id, {
    code: 'operator_management_route_changed',
    message: 'Synthetic route calibration failure.',
  });
  await delay(3);
  const read = store.createJob({
    accountId: 'operator-test',
    kind: 'read',
    operation: 'operator_short_entry_investigation',
    scope: 'operator_short_entry_investigation',
    datasets: ['operator_entry_investigation'],
  }).job;
  store.startJob(read.id);
  const started = store.markPlatformReadStarted(read.id);
  const ref = store.saveEvidence(read.id, 'operator_entry_investigation', {
    schema: 'operator-short-entry-investigation/v1',
    originalJobId: original.id,
    originalInputHash: original.inputHash,
    originalBaselineRef: baselineRef,
    source: { mode: 'live', origin: 'https://fanqienovel.com' },
    sourceUrl: 'https://fanqienovel.com/main/writer/short-draft',
    apiPath: '/api/author/short_article/draft_list/v0/',
    nativeGetOnly: true,
    httpStatus: 200,
    code: 0,
    pageIndex: 0,
    pageCount: 10,
    currentTotal: 1,
    complete: true,
    beforeObservedIds: [itemId],
    records: [
      {
        itemId,
        titles: ['Synthetic draft'],
        wordNumber: 0,
        createTime: 'raw unknown',
        modifyTime: 'raw unknown',
      },
    ],
    newIds: [],
    beforeObservedIdsStillPresent: true,
    ownAccountMatched: true,
    ownerBefore: started,
    ownerAfter: started,
    httpDate: null,
    observedAt: started,
    editorEntryAttempts: 0,
    explicitFillCalls: 0,
    explicitSaveCalls: 0,
    ...options.observation,
  });
  const manifest = store.completeReadJob(read.id, [ref]);
  const db = (store as unknown as { db: import('node:sqlite').DatabaseSync }).db;
  for (const [id, changes] of [
    [original.id, options.original],
    [read.id, options.read],
  ] as const) {
    for (const [column, value] of Object.entries(changes ?? {}))
      db.prepare(`UPDATE jobs SET ${column} = ? WHERE id = ?`).run(
        value as string | number | null,
        id,
      );
  }
  return {
    original: store.getJob(original.id)!,
    read: store.getJob(read.id)!,
    intentRef,
    baselineRef,
    ref,
    manifest,
    db,
    itemId,
  };
}

export function operatorEntryAuditCount(db: import('node:sqlite').DatabaseSync): number {
  return Number(db.prepare('SELECT COUNT(*) AS count FROM write_reconciliations').get()!.count);
}

export const recoveryBindings = {
  accountId: 'resume-fixture-account',
  originalInputHash: digest(
    canonicalJson({
      clientReference: 'resume-fixture-ref',
      content: { title: 'Synthetic title', body: 'Synthetic body' },
    }),
  ),
  resumeInputHash: digest('resume input fixture'),
  clientReferenceHash: digest(
    canonicalJson({ kind: 'short', clientReference: 'resume-fixture-ref' }),
  ),
  requestedContentHash: digest(
    canonicalJson({ title: 'Synthetic title', body: 'Synthetic body', metadata: {} }),
  ),
};

export const recoveryTarget = { kind: 'short-story' as const, id: '1234567890123456789' };

export async function allocatedCreation(
  f: ReturnType<typeof fixture>,
  mutate: (value: Record<string, unknown>) => void = () => {},
) {
  return f.queue.enqueueWrite({
    accountId: recoveryBindings.accountId,
    operation: 'create_draft',
    idempotencyKey: 'creation-recovery-original',
    inputHash: recoveryBindings.originalInputHash,
    run: async (ctx) => {
      ctx.addMetadata({ clientReferenceHash: recoveryBindings.clientReferenceHash });
      ctx.beforePlatformRead();
      const intent: Record<string, unknown> = {
        phase: 'creation-entry',
        capability: 'create_draft',
        clientReferenceHash: recoveryBindings.clientReferenceHash,
        requestedContentHash: recoveryBindings.requestedContentHash,
      };
      mutate(intent);
      ctx.saveEvidence('write-intent', intent);
      ctx.beforePlatformWrite();
      ctx.recordTarget(recoveryTarget);
      throw new RuntimeError(
        'capability_unavailable',
        'Synthetic allocation stopped before fill/save',
      );
    },
  }).completion;
}
