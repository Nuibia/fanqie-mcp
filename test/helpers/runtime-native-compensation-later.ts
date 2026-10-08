import { nativeCompensationFixture } from './runtime-native-compensation-fixture.js';

import assert from 'node:assert/strict';

import { delay, digest } from './runtime-deferred.js';

import {
  canonicalJson,
  type Manifest,
  type GenericShortTrustedContext,
  Store,
  type Job,
} from '../../src/runtime/store.js';

import {
  createNativeShortCompensationReconciliationEvidence,
  validateNativeShortCompensationContext,
} from '../../src/platform/short-native-metadata-proof.js';

import { nativeStoreReadResult } from './runtime-recovery-baseline.js';

import { readdirSync, mkdtempSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { JobQueue } from '../../src/runtime/jobs.js';

import { type ModernShortSnapshot } from '../../src/platform/writes.js';

export async function nativeCompensationLater(
  f: Awaited<ReturnType<typeof nativeCompensationFixture>>,
) {
  const source = f.store.getNativeCompensationContext(f.original.id)!;
  assert(source);
  await delay(3);
  const read = await f.queue.enqueueRead({
    accountId: 'author',
    operation: 'reconcile_write',
    scope: 'reconciliation',
    datasets: ['reconciliation'],
    inputHash: digest(canonicalJson({ jobId: f.original.id })),
    run: async (ctx) => {
      const at = ctx.beforePlatformRead();
      ctx.recordTarget(f.original.target!);
      return [
        ctx.saveEvidence(
          'reconciliation',
          createNativeShortCompensationReconciliationEvidence(
            source,
            nativeStoreReadResult(f.restored, at),
          ),
        ),
      ];
    },
  }).completion;
  assert.equal(
    read.status,
    'succeeded',
    'Synthetic compensation read must be a genuine durable completed read.',
  );
  const manifest = (read.result as { manifest: Manifest }).manifest,
    ref = f.store.listEvidence(read.id)[0]!,
    document = f.store.readEvidence(ref);
  const checked = validateNativeShortCompensationContext({
    source,
    readJob: read,
    manifest,
    ref,
    document,
  });
  return {
    read,
    manifest,
    ref,
    document,
    resolution: { status: checked.status, result: checked.result },
  };
}

export function nativeCompensationFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? nativeCompensationFiles(path.join(directory, entry.name))
        : [path.join(directory, entry.name)],
    )
    .sort();
}

// Independent literal task-record fixtures; no platform, JSON decoder or proof is involved.
export const SUMMARY_TEST_OPERATIONS = [
  'create_draft',
  'update_draft',
  'update_work_metadata',
  'save_chapter_draft',
  'submit_short_story',
  'publish_chapter',
  'resume_create_draft',
  'repair_created_draft',
  'update_short_cover',
  'update_short_body',
];

export const summaryTestId = (n: number) =>
  `31000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const summaryTestAt = '2099-01-01T00:00:00.000Z';

export function insertSummaryTestRow(
  db: import('node:sqlite').DatabaseSync,
  n: number,
  accountId = 'author',
  kind = 'write',
  operation = 'update_short_body',
  status = 'succeeded',
  requestedAt = summaryTestAt,
  endedAt: string | null = requestedAt,
) {
  const bad = '[SYNTHETIC_UNSELECTED_INVALID_JSON';
  db.prepare(
    `INSERT INTO jobs(id,account_id,owner_id,kind,operation,scope,datasets_json,input_hash,status,requested_at,ended_at,updated_at,result_json,error_json,target_json,metadata_json,cancellation_reason_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    summaryTestId(n),
    accountId,
    'synthetic-summary-owner',
    kind,
    operation,
    'synthetic-summary-scope',
    bad,
    '0'.repeat(64),
    status,
    requestedAt,
    endedAt,
    requestedAt,
    bad,
    bad,
    bad,
    bad,
    bad,
  );
}

// R6 vectors contain only synthetic public data. Expected status facts are literal
// contract values rather than calls to the production resolver or snapshot parser.
export const r6Protocol = 'fanqie-generic-short-status/v1';

export const r6Target = { kind: 'short-story' as const, id: '1234567890123456789' };

export const r6WriterTarget = { kind: 'short' as const, workId: r6Target.id };

export type R6RuntimeWitness = {
  schema: string;
  operation: string;
  target: GenericShortTrustedContext['target'];
  creationContext: GenericShortTrustedContext['creationContext'];
  requestBindings: Record<string, string>;
  identityType: 'account';
  platformOwnerId: string;
  profileId: string;
  profileVerifiedAt: string;
  provenance: { mode: 'live'; executor: 'application-default-browser/v1' };
  startedAt: string;
  stage: string;
  observations: Array<{
    ordinal: number;
    dataset: string;
    phase: string;
    evidenceId: string;
    evidenceHash: string;
  }>;
  failure: { kind: string; at: string } | null;
};

export function r6RuntimeFixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-r6-store-public-'));
  const contexts = new Map<string, GenericShortTrustedContext>();
  const options = {
    databasePath: path.join(directory, 'runtime.sqlite'),
    evidenceDirectory: path.join(directory, 'evidence'),
    leaseDurationMs: 30_000,
    evidenceMode: 'live' as const,
    genericShortStatusContext: (id: string) => contexts.get(id) ?? null,
  };
  const store = new Store(options),
    queue = new JobQueue(store);
  return {
    directory,
    options,
    contexts,
    store,
    queue,
    async cleanup() {
      await queue.drainAndStop();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export type R6RuntimeFixture = ReturnType<typeof r6RuntimeFixture>;

export function r6Db(f: R6RuntimeFixture) {
  return (f.store as unknown as { db: import('node:sqlite').DatabaseSync }).db;
}

export function r6StatusSnapshot(at: string, display?: 1 | 4): ModernShortSnapshot {
  const state = display === 1 ? 'published' : display === 4 ? 'reviewing' : 'draft';
  const title = 'R6 synthetic title',
    body = 'R6 synthetic body';
  return {
    title,
    body,
    metadata: {},
    accountId: '1001',
    target: r6WriterTarget,
    state,
    contentHash: digest(canonicalJson({ title, body, metadata: {} })),
    sourceUrl: 'https://fanqienovel.com/main/writer/publish-short/' + r6Target.id,
    platformReadAt: at,
    statusInput:
      display === undefined
        ? { publish_status: 0 }
        : { publish_status: 1, display_status: display },
    statusFacts: {
      schema: 'fanqie-short-status-facts/v1',
      source: 'editor_edit_v1',
      basis: 'editor-publish-and-display/v1',
      editor: {
        namespace: 'publish_status',
        raw: display === undefined ? 0 : 1,
        presence: 'observed',
        branch: display === undefined ? 'draft' : 'non_draft',
      },
      management: {
        namespace: 'display_status',
        raw: display ?? null,
        presence: display === undefined ? 'missing' : 'observed',
        label: display === 1 ? '已发布' : display === 4 ? '审核中' : null,
        state: display === undefined ? 'unknown' : (state as 'published' | 'reviewing'),
        basis: display === undefined ? 'unknown' : 'observed_code',
      },
      resolvedState: state,
      draftEditable: display === undefined,
      conflict: false,
      reasons: display === undefined ? ['status_not_observed'] : [],
    },
    statusProof: {
      schema: 'fanqie-generic-short-editor-proof/v1',
      profileId: 'r6-public-store-vector',
      profileVerifiedAt: '2026-10-03T00:00:00Z',
      profileSource: 'short_article_edit_v1',
      owner: {
        kind: 'account',
        id: '1001',
        before: { requestedAt: at, completedAt: at, checkedAt: at },
        after: { requestedAt: at, completedAt: at, checkedAt: at },
      },
      method: 'GET',
      endpoint: '/api/author/short_article/edit/v1/',
      requestCount: 1,
      responseCount: 1,
      mainFrame: true,
      fixedSourceVerified: true,
      routeStable: true,
      bodyBound: true,
      readStartedAt: at,
      getRequestedAt: at,
      getCompletedAt: at,
      readFinishedAt: at,
    },
  };
}

export function r6Begin(f: R6RuntimeFixture, original?: Job) {
  const operation = original ? 'reconcile_write' : 'editable_snapshot';
  const inputHash = digest(
    canonicalJson(original ? { jobId: original.id } : { target: r6WriterTarget }),
  );
  const created = f.store.createJob({
    accountId: original?.accountId ?? 'author',
    kind: 'read',
    operation,
    scope: original ? 'reconciliation' : 'editable_snapshot',
    datasets: [original ? 'reconciliation' : 'editable_snapshot'],
    inputHash,
  }).job;
  const job = f.store.startJob(created.id);
  const requestBindings: Record<string, string> = original
    ? { inputHash, originalInputHash: original.inputHash }
    : { inputHash };
  const witness: R6RuntimeWitness = {
    schema: 'fanqie-generic-short-execution/v1',
    operation,
    target: r6Target,
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
    inputHash: job.inputHash,
    target: witness.target,
    creationContext: null,
    requestBindings,
    identityType: 'account',
    platformOwnerId: '1001',
    profileId: witness.profileId,
    profileVerifiedAt: witness.profileVerifiedAt,
    provenance: witness.provenance,
  });
  f.store.addJobMetadata(job.id, { genericShortStatus: witness });
  return { job, witness };
}
