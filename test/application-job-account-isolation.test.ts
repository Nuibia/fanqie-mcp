import test from 'node:test';

import { mkdtempSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { loadConfig } from '../src/config.js';

import { type Job } from '../src/runtime/store.js';

import assert from 'node:assert/strict';

import { BrowserSession, type LoginState } from '../src/platform/browser.js';

import { createApplication } from '../src/application.js';

import { resumeAppFixture } from './helpers/application-resume-app-fixture.js';

import { a6Observe, a6Closed } from './helpers/application-a6-observe.js';

import { r6AssertActualPrefix } from './helpers/application-complete-diagnostic-privacy-fixture.js';

import { a6Unclosed } from './helpers/application-a6-unclosed.js';

test('saved job details isolate known foreign read and write IDs before evidence access without queuing or browser work', async (t) => {
  const { Store } = await import('../src/runtime/store.js');
  const { JobQueue } = await import('../src/runtime/jobs.js');
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-saved-job-account-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'synthetic-saved-job-account-token',
    FANQIE_ACCOUNT_ID: 'synthetic-own-account',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  const storage = {
    databasePath: path.join(config.dataDir, 'operations.sqlite'),
    evidenceDirectory: path.join(config.dataDir, 'evidence'),
    evidenceMode: 'fixture' as const,
  };
  const seed = new Store(storage),
    seedQueue = new JobQueue(seed);
  let own!: Job, foreignRead!: Job, foreignWrite!: Job;
  let originalJobs!: string, ownEvidence!: ReturnType<InstanceType<typeof Store>['listEvidence']>;
  try {
    for (const accountId of [config.accountId, 'synthetic-foreign-account']) {
      const job = await seedQueue.enqueueRead({
        accountId,
        operation: 'synthetic_saved_read',
        scope: 'account',
        datasets: ['synthetic_saved'],
        run: async (ctx) => {
          ctx.beforePlatformRead();
          return [
            ctx.saveEvidence('synthetic_saved', { complete: true, syntheticMarker: accountId }),
          ];
        },
      }).completion;
      assert.equal(job.status, 'succeeded');
      if (accountId === config.accountId) own = job;
      else foreignRead = job;
    }
    foreignWrite = await seedQueue.enqueueWrite({
      accountId: 'synthetic-foreign-account',
      operation: 'synthetic_saved_write',
      idempotencyKey: 'synthetic-foreign-write-key',
      inputHash: '1'.repeat(64),
      run: async (ctx) => {
        ctx.beforePlatformWrite();
        ctx.saveEvidence('write-result', { syntheticMarker: 'synthetic-foreign-write' });
        return { syntheticMarker: 'synthetic-foreign-write' };
      },
    }).completion;
    assert.equal(foreignWrite.status, 'succeeded');
    ownEvidence = seed.listEvidence(own.id);
    assert.equal(ownEvidence.length, 1);
    originalJobs = JSON.stringify(seed.listJobs());
  } finally {
    await seedQueue.drainAndStop();
    seed.close();
  }
  let browserCalls = 0,
    enqueueCalls = 0,
    foreignEvidenceReads = 0,
    cancellationCalls = 0;
  class SavedOnlyBrowser extends BrowserSession {
    override async checkLogin(): Promise<LoginState> {
      browserCalls++;
      throw Error('Synthetic saved-only fixture forbids login checks');
    }
    override async withPage<T>(): Promise<T> {
      browserCalls++;
      throw Error('Synthetic saved-only fixture forbids browser work');
    }
  }
  t.mock.method(JobQueue.prototype, 'enqueueRead', () => {
    enqueueCalls++;
    throw Error('Synthetic saved-only fixture forbids enqueue');
  });
  t.mock.method(JobQueue.prototype, 'enqueueWrite', () => {
    enqueueCalls++;
    throw Error('Synthetic saved-only fixture forbids enqueue');
  });
  const originalReadEvidence = Store.prototype.readEvidence;
  t.mock.method(
    Store.prototype,
    'readEvidence',
    function (
      this: InstanceType<typeof Store>,
      reference: Parameters<InstanceType<typeof Store>['readEvidence']>[0],
    ) {
      if (reference.accountId !== config.accountId) foreignEvidenceReads++;
      return originalReadEvidence.call(this, reference);
    },
  );
  t.mock.method(Store.prototype, 'requestCancellation', () => {
    cancellationCalls++;
    throw Error('Synthetic saved-only fixture forbids foreign cancellation');
  });
  const application = createApplication(config, {
    browser: new SavedOnlyBrowser({ profileDir: config.profileDir, headless: true }),
  });
  const get = application.tools.find((item) => item.name === 'fanqie_get_job'),
    cancel = application.tools.find((item) => item.name === 'fanqie_cancel_job');
  assert(get);
  assert(cancel);
  type SavedResult = {
    job: Job;
    retrievalMode: string;
    sourceMode: string;
    evidence: typeof ownEvidence;
    data: Array<Record<string, unknown>>;
  };
  const ownDetail = () =>
    application.dispatch(
      'GET',
      `/api/v1/jobs/${own.id}`,
      new URLSearchParams(),
      undefined,
    ) as Promise<SavedResult>;
  try {
    const ownResult = (await get.run({ jobId: own.id })) as SavedResult;
    assert.deepEqual(ownResult.job, own);
    assert.equal(ownResult.retrievalMode, 'saved');
    assert.equal(ownResult.sourceMode, 'saved');
    assert.deepEqual(ownResult.evidence, ownEvidence);
    assert.equal(ownResult.data[0]?.syntheticMarker, config.accountId);
    assert.equal(ownResult.data[0]?.sourceRef, ownEvidence[0]?.id);
    assert.equal(ownResult.data[0]?.evidenceHash, ownEvidence[0]?.sha256);
    assert.equal(ownResult.data[0]?.evidenceCapturedAt, ownEvidence[0]?.capturedAt);
    assert.deepEqual(await ownDetail(), ownResult);
    const snapshot = (await application.dispatch(
      'GET',
      '/api/v1/snapshot',
      new URLSearchParams(),
      undefined,
    )) as { manifest: { accountId: string; jobId: string }; data: Array<Record<string, unknown>> };
    assert.equal(snapshot.manifest.accountId, config.accountId);
    assert.equal(snapshot.manifest.jobId, own.id);
    assert.equal(snapshot.data[0]?.syntheticMarker, config.accountId);
    const history = (await application.dispatch(
      'GET',
      '/api/v1/history',
      new URLSearchParams(),
      undefined,
    )) as { manifests: Array<{ manifest: { accountId: string; jobId: string } }> };
    assert.equal(history.manifests.length, 1);
    assert.equal(history.manifests[0]?.manifest.accountId, config.accountId);
    assert.equal(history.manifests[0]?.manifest.jobId, own.id);
    const listed = (await application.dispatch(
      'GET',
      '/api/v1/jobs',
      new URLSearchParams(),
      undefined,
    )) as { jobs: Job[] };
    assert.deepEqual(listed.jobs, [own]);
    for (const jobId of [foreignRead.id, foreignWrite.id, '00000000-0000-4000-8000-000000000001']) {
      const refusal = {
        name: 'AppError',
        code: 'not_found',
        httpStatus: 404,
        message: 'Job not found',
      };
      await assert.rejects(get.run({ jobId }), refusal);
      await assert.rejects(
        application.dispatch('GET', `/api/v1/jobs/${jobId}`, new URLSearchParams(), undefined),
        refusal,
      );
      await assert.rejects(cancel.run({ jobId }), refusal);
      await assert.rejects(
        application.dispatch('POST', '/api/v1/tools/fanqie_cancel_job', new URLSearchParams(), {
          jobId,
        }),
        refusal,
      );
      assert.equal(foreignEvidenceReads, 0);
      assert.equal(cancellationCalls, 0);
    }
    const filteredHistory = (await application.dispatch(
      'GET',
      '/api/v1/history',
      new URLSearchParams({
        manifestId: (foreignRead.result as { manifest: { id: string } }).manifest.id,
      }),
      undefined,
    )) as { manifests: unknown[] };
    assert.deepEqual(filteredHistory.manifests, []);
    assert.deepEqual(await ownDetail(), ownResult);
    assert.deepEqual(
      await application.dispatch('GET', '/api/v1/snapshot', new URLSearchParams(), undefined),
      snapshot,
    );
    assert.deepEqual(
      await application.dispatch('GET', '/api/v1/history', new URLSearchParams(), undefined),
      history,
    );
    assert.deepEqual(
      await application.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined),
      listed,
    );
    assert.deepEqual(
      { browserCalls, enqueueCalls, foreignEvidenceReads, cancellationCalls },
      { browserCalls: 0, enqueueCalls: 0, foreignEvidenceReads: 0, cancellationCalls: 0 },
    );
  } finally {
    await application.close();
    const inspected = new Store(storage);
    try {
      assert.equal(JSON.stringify(inspected.listJobs()), originalJobs);
    } finally {
      inspected.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test('normal creation recovery saves only the allocated native blank target and keeps original intent on same-key replay', async (t) => {
  const f = await resumeAppFixture(),
    o = a6Observe(t, f);
  try {
    await assert.rejects(
      o.run(() => f.invoke('resume_create_draft', f.args), false),
      { code: 'creation_recovery_incomplete' },
    );
    const resume = o.records('resume_create_draft')[0]!;
    assert.equal(resume.row.status, 'succeeded');
    r6AssertActualPrefix(resume, [
      ['creation-resume-baseline', 'baseline'],
      ['editable_snapshot', 'baseline'],
      ['editable_snapshot', 'after'],
    ]);
    assert.equal(f.state.gotos.length, 3);
    assert.equal(f.state.newEntries, 0);
    assert.equal(f.state.fills, 2);
    assert.equal(f.state.saves, 1);
    a6Unclosed(f, o);
    const entry = o.store.listEvidence(f.original.id);
    assert.equal(entry.length, 1);
    const payload = o.store.readEvidence(entry[0]!).payload as Record<string, unknown>;
    assert.equal(payload.desiredContentHash, undefined);
    assert.equal(payload.phase, 'creation-entry');
    assert.deepEqual(o.store.getJob(f.original.id), f.original);
  } finally {
    t.mock.restoreAll();
    await f.cleanup();
  }
  await a6Closed(t, { recovery: 'write' });
});

test('normal creation recovery rejects changed request or nonblank/published baseline before any fill/save', async () => {
  for (const variant of ['request', 'reference', 'nonblank', 'published'] as const) {
    const f = await resumeAppFixture();
    try {
      if (variant === 'request')
        await assert.rejects(
          f.invoke('resume_create_draft', {
            ...f.args,
            content: { ...f.input.content, body: 'Changed synthetic body' },
          }),
          { code: 'invalid_creation_recovery' },
        );
      else if (variant === 'reference')
        await assert.rejects(
          f.invoke('resume_create_draft', { ...f.args, clientReference: 'changed-reference' }),
          { code: 'invalid_creation_recovery' },
        );
      else {
        if (variant === 'nonblank') f.state.title = 'Existing content';
        else {
          f.state.published = true;
          f.state.displayStatus = 1;
        } // Official O15: published requires explicit display1.
        const response = (await f.invoke('resume_create_draft', f.args)) as {
          job: Job;
          original: { job: Job };
        };
        assert.equal(response.job.status, 'failed');
        assert.equal(response.job.error?.code, 'creation_recovery_not_blank');
        assert.equal(response.original.job.status, 'uncertain');
      }
      assert.equal(f.state.fills, 0);
      assert.equal(f.state.saves, 0);
      assert.equal(f.state.newEntries, 0);
    } finally {
      await f.cleanup();
    }
  }
});
