import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { loadConfig } from '../src/config.js';

import { BrowserSession } from '../src/platform/browser.js';

import {
  type ShortMetadataApiOptions,
  type ShortMetadataApiResult,
  unavailableShortMetadataApi,
} from '../src/platform/short-metadata-api-schema.js';

import assert from 'node:assert/strict';

import { projectShortMetadataFields } from '../src/platform/short-metadata-schema.js';

import { createApplication } from '../src/application.js';

import test from 'node:test';

import {
  diagnosticPrivacyScan,
  actualDiagnosticIdentity,
} from './helpers/application-diagnostic-privacy-scan.js';

// FQ-12-SHORT-METADATA-API-SCHEMA: owned isolation and fixed DTO regression fixtures.
{
  const WORK = '8545000000000000001';
  function fixture(
    mode:
      | 'success'
      | 'failed'
      | 'cold'
      | 'unsafe'
      | 'no-binding'
      | 'author-binding'
      | 'collector-throws'
      | 'cleanup-failed' = 'success',
  ) {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-schema-app-fixture-'));
    const config = loadConfig({
      FANQIE_TOKEN: 'private-test-token-long-value',
      FANQIE_ACCOUNT_ID: 'private-service-alias',
      FANQIE_DATA_DIR: path.join(directory, 'data'),
      FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
      FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
      FANQIE_ENABLE_WRITES: 'false',
    });
    mkdirSync(config.dataDir, { recursive: true });
    if (mode !== 'no-binding')
      writeFileSync(
        path.join(config.dataDir, 'account-binding.json'),
        JSON.stringify({
          accountId: config.accountId,
          platformId: '1001',
          platformIdType: mode === 'author-binding' ? 'author' : 'account',
        }),
      );
    let calls = 0,
      reads = 0,
      primary = 0,
      currentMode = mode;
    class FixtureBrowser extends BrowserSession {
      override get hasUnsafeApiCleanup(): boolean {
        return currentMode === 'cleanup-failed';
      }
      override async close(): Promise<void> {
        if (currentMode === 'cleanup-failed') throw Error('shutdown_incomplete');
        await super.close();
      }
      override async checkLogin(): Promise<never> {
        primary++;
        throw Error('Diagnostic must never navigate a primary login page');
      }
      override async withPage<T>(): Promise<T> {
        primary++;
        throw Error('Diagnostic must never use the primary reader');
      }
      override async diagnoseShortMetadataApiSchema(
        workId: string,
        options: Omit<
          ShortMetadataApiOptions,
          'deadline' | 'assertBorrowedActive' | 'onQuarantine'
        >,
      ): Promise<ShortMetadataApiResult> {
        calls++;
        assert.equal(workId, WORK);
        options.assertLease();
        if (currentMode === 'collector-throws') throw Error('PRIVATE COLLECTOR FAILURE WITH VALUE');
        if (currentMode === 'cold') return unavailableShortMetadataApi('context_unavailable');
        options.onBeforePlatformRead();
        reads++;
        if (currentMode === 'cleanup-failed') {
          const result = unavailableShortMetadataApi('cleanup_failed');
          result.proof.platformStarted = true;
          result.proof.readStartedAt = new Date().toISOString();
          result.cleanup.sessionCreated = true;
          result.cleanup.disposalFailures = 1;
          result.cleanup.quarantined = true;
          return result;
        }
        if (currentMode === 'failed') {
          const result = unavailableShortMetadataApi('target_unverified');
          result.proof.platformStarted = true;
          result.proof.readStartedAt = new Date().toISOString();
          result.cleanup.sessionCreated = true;
          result.cleanup.sessionDisposed = true;
          return result;
        }
        const result = unavailableShortMetadataApi('response_unavailable');
        result.status = 'success';
        result.reason = null;
        Object.assign(
          result,
          projectShortMetadataFields({
            category: [
              { category_id: 'PRIVATE-CATEGORY', label: 'PRIVATE-LABEL', name: 'PRIVATE-NAME' },
            ],
            thumb_uri: 'PRIVATE-COVER',
            body: 'PRIVATE-BODY',
            title: 'PRIVATE-TITLE',
          }),
        );
        for (const key of [
          'platformStarted',
          'ownerBefore',
          'ownerAfter',
          'ownerCallback',
          'fixedSourceVerified',
          'targetUnique',
          'paginationComplete',
        ] as const)
          result.proof[key] = true;
        const at = new Date().toISOString();
        result.proof.readStartedAt = at;
        result.proof.readFinishedAt = at;
        result.proof.proofCapturedAt = at;
        result.own = { attempts: 2, disposed: 2 };
        result.list = { attempts: 1, disposed: 1, pagesRead: 1, rowsRead: 1, totalCount: 1 };
        result.cleanup = {
          sessionCreated: true,
          sessionDisposed: true,
          pendingAtEnd: 0,
          disposalFailures: 0,
          quarantined: false,
          checkedAt: at,
        };
        options.onVerifiedAccount('1001', result.proof.proofCapturedAt);
        if (currentMode === 'unsafe') (result.fields![1] as any).type = 'PRIVATE-INJECTED-TYPE';
        (result as any).body = 'PRIVATE-BODY';
        (result.proof as any).accountId = 'PRIVATE-ACCOUNT';
        (result.fields![1] as any).uri = 'PRIVATE-URI';
        return result;
      }
    }
    const app = createApplication(config, {
      browser: new FixtureBrowser({ profileDir: config.profileDir, headless: true }),
    });
    const call = () =>
      app.dispatch(
        'POST',
        '/api/v1/tools/fanqie_diagnose_short_metadata_api_schema',
        new URLSearchParams(),
        { target: { kind: 'short', workId: WORK } },
      ) as Promise<any>;
    const snapshot = (scope: string) =>
      app.dispatch(
        'GET',
        '/api/v1/snapshot',
        new URLSearchParams({ scope }),
        undefined,
      ) as Promise<any>;
    return {
      app,
      config,
      directory,
      call,
      snapshot,
      stats: () => ({ calls, reads, primary }),
      setMode: (mode: typeof currentMode) => {
        currentMode = mode;
      },
      close: async () => {
        await app.close();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  }

  test('short metadata API schema: new MCP contract rejects arbitrary URLs, extra target fields, zero/long IDs before creating jobs', async () => {
    const f = fixture();
    try {
      const tool = f.app.tools.find(
        (tool) => tool.name === 'fanqie_diagnose_short_metadata_api_schema',
      );
      assert(tool);
      assert.equal(tool.readOnly, true);
      for (const input of [
        { target: { kind: 'chapter', workId: WORK } },
        { target: { kind: 'short', workId: '0000000000' } },
        { target: { kind: 'short', workId: '1'.repeat(23) } },
        { target: { kind: 'short', workId: WORK, editorUrl: 'https://fanqienovel.com/create' } },
        { target: { kind: 'short', workId: WORK }, sourceUrl: 'https://fanqienovel.com' },
      ])
        await assert.rejects(tool.run(input));
      const jobs = (await f.app.dispatch(
        'GET',
        '/api/v1/jobs',
        new URLSearchParams(),
        undefined,
      )) as any;
      assert.equal(jobs.jobs.length, 0);
      assert.deepEqual(f.stats(), { calls: 0, reads: 0, primary: 0 });
    } finally {
      await f.close();
    }
  });

  for (const [mode, calls, reason] of [
    ['no-binding', 0, 'identity_unverified'],
    ['author-binding', 0, 'identity_unverified'],
    ['cold', 1, 'context_unavailable'],
  ] as const)
    test(`short metadata API schema: local ${mode} failure has no platform start and no observation evidence`, async () => {
      const f = fixture(mode);
      try {
        const result = await f.call();
        assert.equal(result.job.status, 'failed');
        assert.equal(result.reason, reason);
        assert.deepEqual(result.data, []);
        assert.deepEqual(result.evidence, []);
        assert.deepEqual(f.stats(), { calls, reads: 0, primary: 0 });
        const jobs = (await f.app.dispatch(
          'GET',
          '/api/v1/jobs',
          new URLSearchParams(),
          undefined,
        )) as any;
        assert.equal(jobs.jobs[0].platformReadStartedAt, null);
        assert.equal(jobs.jobs[0].target, null);
      } finally {
        await f.close();
      }
    });

  test('short metadata API schema: whole successful response contains only fixed safe job/ref/type DTO slots; old write gates stay disabled', async () => {
    const f = fixture();
    try {
      const result = await f.call();
      assert.equal(result.job.status, 'succeeded');
      assert.equal(result.reason, null);
      assert.deepEqual(Object.keys(result).sort(), [
        'data',
        'evidence',
        'job',
        'reason',
        'retrievalMode',
        'sourceMode',
      ]);
      assert.deepEqual(Object.keys(result.job).sort(), [
        'endedAt',
        'id',
        'operation',
        'requestedAt',
        'status',
      ]);
      assert.deepEqual(Object.keys(result.evidence[0]).sort(), [
        'capturedAt',
        'dataset',
        'id',
        'sha256',
      ]);
      diagnosticPrivacyScan(
        result,
        actualDiagnosticIdentity(
          path.join(f.config.dataDir, 'operations.sqlite'),
          f.config.accountId,
          result.job.id,
        ),
        ['PRIVATE', '1001', WORK, f.config.accountId, f.config.token],
      );
      assert.equal(result.data[0].fields[1].type, 'string');
      assert.equal(result.data[0].fields[1].uri, undefined);
      assert.equal(result.data[0].proof.accountId, undefined);
      assert.equal(result.data[0].body, undefined);
      assert.equal(result.data[0].cleanup.pendingAtEnd, 0);
      const current = await f.snapshot(`short_metadata_api_schema.${WORK}`);
      assert.equal(current.manifest.operation, 'diagnose_short_metadata_api_schema');
      for (const scope of ['account', 'short_drafts', 'editable_snapshot'])
        assert.equal((await f.snapshot(scope)).manifest, null);
      for (const tool of [
        'fanqie_diagnose_editor',
        'fanqie_get_editable_snapshot',
        'fanqie_prepare_submission',
        'fanqie_reconcile_write',
      ]) {
        const found = f.app.tools.find((x) => x.name === tool);
        assert(found);
        assert.equal(found.readOnly, false);
      }
      const status = (await f.app.dispatch(
        'GET',
        '/api/v1/status',
        new URLSearchParams(),
        undefined,
      )) as any;
      assert.equal(status.writesEnabled, false);
      assert.deepEqual(f.stats(), { calls: 1, reads: 1, primary: 0 });
    } finally {
      await f.close();
    }
  });

  test('short metadata API schema: post-read failure saves fixed safe facts and cannot promote over the last successful diagnostic', async () => {
    const f = fixture();
    try {
      await f.call();
      const before = await f.snapshot(`short_metadata_api_schema.${WORK}`);
      f.setMode('failed');
      const result = await f.call();
      assert.equal(result.job.status, 'partial');
      assert.equal(result.reason, 'target_unverified');
      assert.equal(result.sourceMode, 'incomplete');
      assert.equal(result.evidence.length, 1);
      assert.equal(result.data[0].fields, null);
      assert.equal(result.data[0].proof.platformStarted, true);
      assert.deepEqual(await f.snapshot(`short_metadata_api_schema.${WORK}`), before);
      assert(!JSON.stringify(result).includes('PRIVATE'));
      assert(!JSON.stringify(result).includes(WORK));
    } finally {
      await f.close();
    }
  });

  test('short metadata API schema: untrusted internal type labels never reach public or durable diagnostic payloads', async () => {
    const f = fixture('unsafe');
    try {
      const result = await f.call();
      assert.equal(result.job.status, 'failed');
      assert.equal(result.reason, 'response_unverified');
      assert.equal(result.evidence.length, 0);
      assert.equal(result.data.length, 0);
      assert(!JSON.stringify(result).includes('PRIVATE'));
      assert.equal((await f.snapshot(`short_metadata_api_schema.${WORK}`)).manifest, null);
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const name = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(name);
          else files.push(name);
        }
      };
      walk(path.join(f.config.dataDir, 'evidence'));
      assert.equal(files.length, 0);
    } finally {
      await f.close();
    }
  });

  test('short metadata API schema: unexpected collector rejection is replaced with a fixed safe failure without exposing its error', async () => {
    const f = fixture('collector-throws');
    try {
      const result = await f.call();
      assert.equal(result.job.status, 'failed');
      assert.equal(result.reason, 'response_unavailable');
      assert.deepEqual(result.data, []);
      assert(!JSON.stringify(result).includes('PRIVATE'));
    } finally {
      await f.close();
    }
  });
  test('short metadata API schema: quarantine makes service unavailable and failed close preserves the exclusive Store lease', async () => {
    const f = fixture('cleanup-failed');
    try {
      const result = await f.call();
      assert.equal(result.job.status, 'partial');
      assert.equal(result.reason, 'cleanup_failed');
      assert.equal(result.data[0].cleanup.quarantined, true);
      const status = (await f.app.dispatch(
        'GET',
        '/api/v1/status',
        new URLSearchParams(),
        undefined,
      )) as any;
      assert.equal(status.status, 'unavailable');
      assert.equal(status.writesEnabled, false);
      await assert.rejects(f.app.close(), /shutdown_incomplete/);
      assert.throws(() =>
        createApplication(f.config, {
          browser: new BrowserSession({ profileDir: f.config.profileDir, headless: true }),
        }),
      );
      const after = (await f.app.dispatch(
        'GET',
        '/api/v1/status',
        new URLSearchParams(),
        undefined,
      )) as any;
      assert.equal(after.status, 'unavailable');
    } finally {
      f.setMode('cold');
      await f.close();
    }
  });
}
