import {
  Store,
  type Job,
  type EvidenceRef,
  type EvidenceDocument,
  canonicalJson,
} from '../../src/runtime/store.js';

import { DatabaseSync } from 'node:sqlite';

import assert from 'node:assert/strict';

import { createHash } from 'node:crypto';

import path from 'node:path';

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

import { BrowserSession } from '../../src/platform/browser.js';

import { syntheticCompensationFixture } from './public-overview-synthetic-compensation-fixture.js';

import {
  validateNativeShortCompensationContext,
  NATIVE_SHORT_READ_OPERATION,
  NATIVE_SHORT_READ_DATASET,
  nativeShortInputHash,
  createNativeShortReadEvidence,
} from '../../src/platform/short-native-metadata-proof.js';

import { trialGraph } from './public-overview-trial-graph.js';

import { coverGraph } from './public-overview-cover-graph.js';

import { bodyGraph } from './public-overview-body-graph.js';

import { SCOPE, WORK, result, fixtureProvenance, ACCOUNT } from './public-overview-snapshot.js';

import { loadConfig } from '../../src/config.js';

import { createApplication } from '../../src/application.js';

import { pathToFileURL } from 'node:url';

// This ledger materializes the unchanged proof fixtures into actual synthetic
// SQLite rows and evidence files. It never substitutes a successful DTO for a
// full Store/native validation and does not contact any platform.
function materializeGraph(
  store: Store,
  context: { job: Job; refs: EvidenceRef[]; documents: EvidenceDocument[]; attempts: any[] },
) {
  const db = new DatabaseSync(store.databasePath),
    job = context.job;
  try {
    const columns = [
      'id',
      'account_id',
      'owner_id',
      'kind',
      'operation',
      'scope',
      'datasets_json',
      'idempotency_key',
      'input_hash',
      'status',
      'requested_at',
      'started_at',
      'read_started_at',
      'write_started_at',
      'ended_at',
      'updated_at',
      'result_json',
      'error_json',
      'target_json',
      'metadata_json',
      'timeout_ms',
      'deadline_at',
      'cancellation_requested_at',
      'cancellation_reason_json',
    ];
    const values = [
      job.id,
      job.accountId,
      job.ownerId,
      job.kind,
      job.operation,
      job.scope,
      canonicalJson(job.datasets),
      job.idempotencyKey,
      job.inputHash,
      job.status,
      job.requestedAt,
      job.startedAt,
      job.platformReadStartedAt,
      job.platformWriteStartedAt,
      job.endedAt,
      job.updatedAt,
      canonicalJson(job.result),
      canonicalJson(job.error),
      canonicalJson(job.target),
      canonicalJson(job.metadata),
      job.timeoutMs,
      job.deadlineAt,
      job.cancellationRequestedAt,
      canonicalJson(job.cancellationReason),
    ];
    db.prepare(
      `INSERT INTO jobs(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
    ).run(...values);
    for (const [index, ref] of context.refs.entries()) {
      // Link-only native receipts retain their exact bytes; physical paths are
      // supplied by the fixture's own trusted materialization below.
      const bytes = canonicalJson(context.documents[index]) + '\n';
      assert.equal(createHash('sha256').update(bytes).digest('hex'), ref.sha256);
      assert.equal(path.isAbsolute(ref.path), false);
      const destination = path.join(store.evidenceDirectory, ref.path);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, bytes);
      db.prepare(
        'INSERT INTO evidence(id,account_id,job_id,dataset,captured_at,path,sha256) VALUES(?,?,?,?,?,?,?)',
      ).run(ref.id, ref.accountId, ref.jobId, ref.dataset, ref.capturedAt, ref.path, ref.sha256);
    }
    const table =
      job.operation === 'update_short_trial'
        ? 'native_short_trial_attempts'
        : job.operation === 'update_short_cover'
          ? 'native_short_cover_attempts'
          : 'native_short_body_attempts';
    for (const attempt of context.attempts) {
      const fields = [
        'job_id',
        'account_id',
        ...(table === 'native_short_cover_attempts' ? ['phase'] : []),
        'ordinal',
        'evidence_id',
        'evidence_sha256',
        'evidence_captured_at',
        'event_at',
      ];
      const values = [
        attempt.jobId,
        attempt.accountId,
        ...(table === 'native_short_cover_attempts' ? [attempt.phase] : []),
        attempt.ordinal,
        attempt.evidence.id,
        attempt.evidence.sha256,
        attempt.evidence.capturedAt,
        attempt.eventAt,
      ];
      db.prepare(
        `INSERT INTO ${table}(${fields.join(',')}) VALUES(${fields.map(() => '?').join(',')})`,
      ).run(...values);
    }
  } finally {
    db.close();
  }
  assert.equal(store.getJob(job.id, 'owner')!.status, 'succeeded');
}

export class OverviewBrowser extends BrowserSession {
  platformCalls = 0;
  closeCalls = 0;
  override async checkLogin(): Promise<never> {
    this.platformCalls++;
    throw Error('Synthetic overview forbids platform');
  }
  override async withPage<T>(): Promise<T> {
    this.platformCalls++;
    throw Error('Synthetic overview forbids platform');
  }
  override async close(): Promise<void> {
    this.closeCalls++;
  }
}

export async function seedOverview(native = true) {
  const f = await syntheticCompensationFixture(true);
  const later = await f.fresh(),
    checked = validateNativeShortCompensationContext(later);
  f.store.reconcileWriteJob(f.originalId, later.readJob.id, {
    status: checked.status,
    result: checked.result,
  });
  const familyIds: Record<string, string> = {
    metadata: f.originalId,
    compensation: f.registration.id,
  };
  if (native) {
    const trial = trialGraph(),
      cover = coverGraph(),
      body = bodyGraph();
    try {
      for (const [family, graph] of [
        ['trial', trial],
        ['cover', cover],
        ['body', body],
      ] as const) {
        materializeGraph(f.store, graph.context);
        familyIds[family] = graph.context.job.id;
      }
    } finally {
      trial.close();
      body.close();
    }
  }
  const handle = f.queue.enqueueRead({
    accountId: 'owner',
    operation: 'refresh',
    scope: 'overview_legacy',
    datasets: ['short_works', 'short_metrics', 'long_works', 'long_metrics'],
    run: async (ctx) => {
      ctx.beforePlatformRead();
      return ['short_works', 'short_metrics', 'long_works', 'long_metrics'].map((dataset) =>
        ctx.saveEvidence(dataset, {
          dataset,
          status: 'success',
          capturedAt: new Date().toISOString(),
          records: [],
          coverage: {
            complete: true,
            paginationComplete: true,
            pagesFetched: 1,
            pagesDiscovered: 1,
            recordsFetched: 0,
            totalRecords: 0,
            fields: ['workId'],
          },
          errors: [],
          limitations: [],
        }),
      );
    },
  });
  const legacy = await handle.completion;
  assert.equal(legacy.status, 'succeeded');
  const legacyRef = f.store.listEvidence(legacy.id)[0]!;
  const nativeRead = f.queue.enqueueRead({
    accountId: 'owner',
    operation: NATIVE_SHORT_READ_OPERATION,
    scope: SCOPE,
    datasets: [NATIVE_SHORT_READ_DATASET],
    inputHash: nativeShortInputHash(WORK),
    run: async (ctx) => {
      ctx.beforePlatformRead();
      ctx.recordTarget({ kind: 'short-story', id: WORK });
      return [
        ctx.saveEvidence(
          NATIVE_SHORT_READ_DATASET,
          createNativeShortReadEvidence(result(), fixtureProvenance),
        ),
      ];
    },
  });
  assert.equal((await nativeRead.completion).status, 'succeeded');
  familyIds.metadataRead = nativeRead.jobId;
  await f.queue.drainAndStop();
  f.store.close();
  const config = loadConfig({
    FANQIE_ACCOUNT_ID: 'owner',
    FANQIE_TOKEN: 'synthetic-public-overview-contract-token',
    FANQIE_ENABLE_WRITES: 'false',
    FANQIE_PORT: '0',
    FANQIE_DATA_DIR: f.directory,
    FANQIE_PROFILE_DIR: path.join(f.directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(f.directory, 'runtime'),
  });
  writeFileSync(
    path.join(f.directory, 'account-binding.json'),
    JSON.stringify({ accountId: 'owner', platformId: ACCOUNT, platformIdType: 'account' }),
  );
  return {
    directory: f.directory,
    config,
    storage: f.storage,
    familyIds,
    legacy,
    legacyRef,
    async close() {
      rmSync(f.directory, { recursive: true, force: true });
    },
  };
}

export const routes = ['/api/v1/status', '/api/v1/capabilities', '/api/v1/jobs'] as const;

export async function capture(app: ReturnType<typeof createApplication>) {
  const output: any = {};
  for (const route of routes)
    try {
      output[route] = JSON.parse(
        JSON.stringify(await app.dispatch('GET', route, new URLSearchParams(), undefined)),
      );
    } catch (error) {
      const failure = error as Error & { code: string };
      output[route] = { rejected: { code: failure.code, message: failure.message } };
    }
  return output;
}

export async function frozenOrFreshBaseline(f: Awaited<ReturnType<typeof seedOverview>>) {
  const source = process.env.F04_PUBLIC_BASELINE_SOURCE;
  let create: typeof createApplication = createApplication;
  if (source) {
    assert.equal(path.isAbsolute(source), true);
    create = (await import(pathToFileURL(path.join(source, 'src/application.ts')).href))
      .createApplication;
  }
  const scope = Store.prototype.withPublicProjectionRead;
  if (!source)
    Store.prototype.withPublicProjectionRead = function <T>(
      _account: string,
      _purpose: any,
      callback: () => T,
    ): T {
      return callback();
    };
  const browser = new OverviewBrowser({ profileDir: f.config.profileDir, headless: true }),
    app = create(f.config, { browser });
  try {
    return await capture(app);
  } finally {
    await app.close();
    if (!source) Store.prototype.withPublicProjectionRead = scope;
    assert.equal(browser.platformCalls, 0);
  }
}

export function noNativePrivate(value: unknown) {
  const bytes = JSON.stringify(value);
  for (const marker of [
    'PRIVATE_HTML',
    'PRIVATE_URI_ONE',
    'PRIVATE_URI_TWO',
    'PRIVATE_SIGNED_QUERY',
    'PRIVATE_COOKIE',
    'private-recommended',
    'private-source-unknown',
  ])
    assert.equal(bytes.includes(marker), false, marker);
}
