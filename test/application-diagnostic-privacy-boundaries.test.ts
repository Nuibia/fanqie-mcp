import test from 'node:test';

import { completeDiagnosticPrivacyFixture } from './helpers/application-complete-diagnostic-privacy-fixture.js';

import assert from 'node:assert/strict';

import { diagnosticPrivacyScan } from './helpers/application-diagnostic-privacy-scan.js';

import { mkdtempSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { loadConfig } from '../src/config.js';

import { BrowserSession } from '../src/platform/browser.js';

import { createApplication } from '../src/application.js';

import { DatabaseSync } from 'node:sqlite';

test('diagnostic privacy raw key token body and nonopaque 1001 are never exempt', () => {
  const jobId = '11111111-1111-4111-8111-111111111111',
    id = '22222222-2222-4222-8222-222222222222',
    sha256 = 'a'.repeat(64),
    at = '2026-10-04T00:00:00.000Z';
  for (const api of [false, true]) {
    const f = completeDiagnosticPrivacyFixture(api, jobId, id, sha256, at),
      base = f.result,
      data = base.data[0]!;
    const scan = (bad: unknown) =>
      assert.throws(() =>
        diagnosticPrivacyScan(bad, f.identity, ['PRIVATE', '1001', 'raw-token', '<p>']),
      );
    for (const bad of [
      { ...base, raw: '1001' },
      { ...base, data: [{ field: '1001' }] },
      { ...base, data: [{ token: 'raw-token' }] },
      { ...base, data: [{ body: '<p>PRIVATE</p>' }] },
      { ...base, reason: '1001' },
      { ...base, job: { ...base.job, operation: '1001' } },
      { ...base, evidence: [{ ...base.evidence[0]!, dataset: '1001' }] },
      { ...base, evidence: [{ ...base.evidence[0]!, sha256: '1001' }] },
      { ...base, job: { ...base.job, id: '00001001-1111-4111-8111-111111111111' } },
    ])
      scan(bad);
    const changed = (path: readonly (string | number)[], key: string, value: unknown) => {
      const copy = structuredClone(base);
      let selected: unknown = copy;
      for (const part of path) {
        if (typeof part === 'number') {
          assert(Array.isArray(selected));
          selected = selected[part];
        } else {
          assert(selected && typeof selected === 'object' && !Array.isArray(selected));
          const parent = selected as Record<string, unknown>;
          assert(Object.hasOwn(parent, part));
          selected = parent[part];
        }
      }
      assert(selected && typeof selected === 'object' && !Array.isArray(selected));
      (selected as Record<string, unknown>)[key] = value;
      scan(copy);
    };
    const mutations: Array<{ path: Array<string | number>; key: string; value: unknown }> = [
      { path: ['data', 0], key: 'unknownSafeKey', value: true },
      { path: ['data', 0], key: 'reason', value: '1001' },
      { path: ['data', 0, 'fields', 1], key: 'uri', value: '1001' },
      { path: ['data', 0, 'fields', 1], key: 'value', value: 'raw-token' },
      { path: ['data', 0, 'fields', 1], key: 'type', value: 'unknown' },
      { path: ['data', 0, 'fields', 1], key: 'present', value: 'true' },
      { path: ['data', 0, 'fields', 0], key: 'arrayCount', value: 1.5 },
      { path: ['data', 0, 'proof'], key: 'accountId', value: '1001' },
      { path: ['data', 0, 'proof'], key: 'unknownSafeKey', value: true },
      { path: ['data', 0, 'proof'], key: 'ownerBefore', value: 'true' },
      { path: ['data', 0, 'fields', 0, 'categorySamples', 0], key: 'unknownSafeKey', value: true },
      {
        path: ['data', 0, 'fields', 0, 'categorySamples', 0, 'fields', 0],
        key: 'value',
        value: '1001',
      },
      {
        path: ['data', 0, 'fields', 0, 'categorySamples', 0, 'fields', 1],
        key: 'label',
        value: 'PRIVATE',
      },
      {
        path: ['data', 0, 'fields', 0, 'categorySamples', 0, 'fields', 2],
        key: 'type',
        value: 'unknown',
      },
      { path: ['data', 0, 'cleanup'], key: 'unknownSafeKey', value: true },
      { path: ['data', 0, 'own'], key: 'unknownSafeKey', value: true },
      { path: ['data', 0, 'cleanup'], key: 'pendingAtEnd', value: '0' },
      { path: ['data', 0, 'proof'], key: 'proofCapturedAt', value: '2026-10-04T00:00:00Z' },
      { path: ['data', 0, 'cleanup'], key: 'checkedAt', value: '2026-10-04T00:00:00.001Z' },
      { path: ['job'], key: 'requestedAt', value: '2026-10-03T23:59:59.999Z' },
      { path: ['job'], key: 'endedAt', value: '2026-10-04T00:00:00.001Z' },
      { path: ['evidence', 0], key: 'capturedAt', value: '2026-10-04T00:00:00.001Z' },
    ];
    for (const mutation of mutations) changed(mutation.path, mutation.key, mutation.value);
    changed(['data', 0, api ? 'transport' : 'blocked'], 'unknownSafeKey', true);
    if (api) {
      changed(['data', 0, 'list'], 'unknownSafeKey', true);
      changed(['data', 0, 'proof'], 'readStartedAt', 'not-a-time');
    }
    assert.equal(data.status, 'success');
  }
});

test('HTTP task summary is saved scalar metadata only with no browser, queue, proof or MCP addition', async (t) => {
  const { Store } = await import('../src/runtime/store.js'),
    { JobQueue } = await import('../src/runtime/jobs.js');
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-task-summary-http-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'synthetic-task-summary-long-token',
    FANQIE_ACCOUNT_ID: 'summary-own',
    FANQIE_ENABLE_WRITES: 'false',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'browser'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  let browserArmed = false,
    browserCalls = 0;
  const browser = new Proxy(
    { async close() {} },
    {
      get(target, key) {
        if (browserArmed) {
          browserCalls++;
          throw Error('Synthetic task summary forbids browser access');
        }
        return Reflect.get(target, key);
      },
    },
  ) as unknown as BrowserSession;
  const application = createApplication(config, { browser }),
    db = new DatabaseSync(path.join(config.dataDir, 'operations.sqlite'));
  const calls: string[] = [],
    at = '2099-01-01T00:00:00.000Z',
    own = '32000000-0000-4000-8000-000000000001',
    foreign = '32000000-0000-4000-8000-000000000002';
  try {
    const insert = db.prepare(
        `INSERT INTO jobs(id,account_id,owner_id,kind,operation,scope,datasets_json,input_hash,status,requested_at,ended_at,updated_at,result_json,error_json,target_json,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ),
      bad = '[SYNTHETIC_UNSELECTED_INVALID_JSON';
    for (const [id, account, status] of [
      [own, config.accountId, 'succeeded'],
      [foreign, 'synthetic-foreign', 'PRIVATE_UNKNOWN_STATUS'],
    ])
      insert.run(
        id!,
        account!,
        'synthetic-owner',
        'write',
        'update_short_body',
        'synthetic-scope',
        bad,
        '0'.repeat(64),
        status!,
        at,
        at,
        at,
        bad,
        bad,
        bad,
        bad,
      );
    for (const name of [
      'getJob',
      'getJobForPublicProjection',
      'readEvidence',
      'listJobs',
      'listJobsForPublicProjection',
    ] as const)
      t.mock.method(Store.prototype, name, () => {
        calls.push(name);
        throw Error('Synthetic task summary forbids saved proof/decode');
      });
    for (const name of ['enqueueRead', 'enqueueWrite'] as const)
      t.mock.method(JobQueue.prototype, name, () => {
        calls.push(name);
        throw Error('Synthetic task summary forbids new tasks');
      });
    browserArmed = true;
    const value = await application.dispatch(
      'GET',
      '/api/v1/job-summaries',
      new URLSearchParams(),
      undefined,
    );
    assert.deepEqual(value, {
      schema: 'fanqie-job-summaries/v1',
      sourceMode: 'saved',
      purpose: 'task-state-only',
      authoritative: false,
      bodyIncluded: false,
      scope: 'known_write_tasks/v1',
      tasks: [
        {
          id: own,
          kind: 'write',
          operation: 'update_short_body',
          recordedTaskStatus: 'succeeded',
          requestedAt: at,
          endedAt: at,
        },
      ],
      truncated: false,
    });
    assert.equal(application.tools.length, 40);
    assert(!application.tools.some((tool) => /summary|summaries/.test(tool.name)));
    for (const query of ['accountId=synthetic-foreign', 'limit=1', 'scope=account', 'refresh=true'])
      await assert.rejects(
        application.dispatch('GET', '/api/v1/job-summaries', new URLSearchParams(query), undefined),
        { code: 'invalid_input' },
      );
    await assert.rejects(
      application.dispatch('POST', '/api/v1/job-summaries', new URLSearchParams(), {}),
      { code: 'not_found' },
    );
    db.prepare('UPDATE jobs SET status=? WHERE id=?').run('PRIVATE_UNKNOWN_STATUS', own);
    await assert.rejects(
      application.dispatch('GET', '/api/v1/job-summaries', new URLSearchParams(), undefined),
      { code: 'capability_unavailable', message: 'Saved task records are unavailable.' },
    );
    assert.deepEqual(calls, []);
    assert.equal(browserCalls, 0);
    t.mock.restoreAll();
    browserArmed = false;
    // Old native proof timestamps keep their future guard; durable task metadata above retains at.
    const safeJob = {
      id: own,
      status: null,
      operation: 'update_short_body',
      requestedAt: null,
      endedAt: null,
    };
    const legacyList = (await application.dispatch(
      'GET',
      '/api/v1/jobs',
      new URLSearchParams(),
      undefined,
    )) as { jobs: Array<Record<string, unknown>> };
    assert.deepEqual(legacyList, { jobs: [safeJob] });
    const legacyDetail = (await application.dispatch(
      'GET',
      '/api/v1/jobs/' + own,
      new URLSearchParams(),
      undefined,
    )) as {
      job: Record<string, unknown>;
      retrievalMode: string;
      sourceMode: string;
      evidence: unknown[];
      data: unknown[];
    };
    assert.deepEqual(legacyDetail, {
      job: safeJob,
      retrievalMode: 'saved',
      sourceMode: 'saved',
      evidence: [],
      data: [
        {
          schema: 'native-short-body-summary/v1',
          state: 'unknown',
          statusFacts: null,
          statusSource: null,
          status: 'capability_unavailable',
          reason: 'durability_unverified',
          source: null,
          atomicRevision: false,
          hashBasesHash: 'fcb2726382d9f0fbdb7c065588e3b2ef253b1ea64cd0cb7cd42fec5ed7f4084a',
          desiredContentHash: null,
          verifiedLive: false,
          durable: false,
          bodyIncluded: false,
          summaries: {
            stageCount: 0,
            attemptOrdinal: null,
            baselineObserved: false,
            preSaveVerified: false,
            postAttempted: false,
            acknowledged: false,
            afterObserved: false,
            desiredMatched: false,
            pendingAtEnd: 0,
            disposalFailures: 0,
            quarantined: false,
          },
        },
      ],
    });
    const isolated = JSON.stringify({ legacyList, legacyDetail });
    for (const marker of [
      'PRIVATE',
      'UNSELECTED',
      foreign,
      'synthetic-foreign',
      config.accountId,
      'synthetic-owner',
    ])
      assert(!isolated.includes(marker));
    for (const job of [legacyList.jobs[0]!, legacyDetail.job]) {
      assert.deepEqual(
        Object.keys(job).sort(),
        ['id', 'status', 'operation', 'requestedAt', 'endedAt'].sort(),
      );
      for (const key of [
        'accountId',
        'ownerId',
        'kind',
        'inputHash',
        'result',
        'target',
        'metadata',
        'error',
        'datasets',
      ])
        assert.equal(Object.hasOwn(job, key), false);
    }
  } finally {
    t.mock.restoreAll();
    browserArmed = false;
    db.close();
    await application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
