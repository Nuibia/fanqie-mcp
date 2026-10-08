import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { loadConfig } from '../../src/config.js';

import {
  DIRECTORY_PRIVATE_OWNER,
  DIRECTORY_PRIVATE_MARKER,
  directoryRecordIds,
} from './application-a6-unclosed.js';

import assert from 'node:assert/strict';

import {
  type APIRequest as DirectoryAPIRequest,
  type BrowserContext as DirectoryBrowserContext,
} from 'playwright';

import { BrowserSession } from '../../src/platform/browser.js';

import * as directoryDomain from '../../src/platform/short-draft-directory.js';

import { createApplication } from '../../src/application.js';

import { Store as DirectoryStore } from '../../src/runtime/store.js';

import { randomUUID as directoryUuid } from 'node:crypto';

export function directoryApplicationFixture(
  options: {
    total?: number;
    binding?: boolean;
    mode?: 'success' | 'cold' | 'outside_error' | 'owner_changed' | 'bounded';
  } = {},
) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-f02-app-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'synthetic-f02-directory-service-token',
    FANQIE_ACCOUNT_ID: 'synthetic-f02-service',
    FANQIE_PORT: '0',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
    FANQIE_TIMEOUT_MS: '10000',
  });
  mkdirSync(config.dataDir, { recursive: true });
  if (options.binding !== false)
    writeFileSync(
      path.join(config.dataDir, 'account-binding.json'),
      JSON.stringify({
        accountId: config.accountId,
        platformId: DIRECTORY_PRIVATE_OWNER,
        platformIdType: 'account',
      }),
      { mode: 0o600 },
    );
  let total = options.total ?? 1,
    mode = options.mode ?? 'success',
    calls = 0,
    sessions = 0,
    disposed = 0,
    active = 0,
    maximumActive = 0;
  const urls: string[] = [];
  const factory = {
    async newContext() {
      sessions++;
      active++;
      maximumActive = Math.max(maximumActive, active);
      let own = 0;
      return {
        async get(url: string, requestOptions: Record<string, unknown>) {
          calls++;
          urls.push(url);
          assert.equal(requestOptions.maxRedirects, 0);
          assert.equal(requestOptions.maxRetries, 0);
          let data: unknown;
          if (url === 'https://fanqienovel.com/api/user/info/v2') {
            own++;
            data = {
              id: mode === 'owner_changed' && own === 2 ? '2' : DIRECTORY_PRIVATE_OWNER,
              secret: DIRECTORY_PRIVATE_MARKER,
            };
          } else {
            const source = new URL(url);
            assert.equal(source.origin, 'https://fanqienovel.com');
            assert.equal(source.pathname, '/api/author/short_article/draft_list/v0/');
            assert.equal(source.searchParams.get('page_count'), '10');
            const index = Number(source.searchParams.get('page_index')),
              count = mode === 'bounded' ? 101 : total;
            data = {
              total_count: count,
              item_list: directoryRecordIds(Math.min(count, 100))
                .slice(index * 10, index * 10 + 10)
                .map((item_id) => ({
                  item_id,
                  title: DIRECTORY_PRIVATE_MARKER,
                  status: 1,
                  body: DIRECTORY_PRIVATE_MARKER,
                  cookie: DIRECTORY_PRIVATE_MARKER,
                })),
              unknown: DIRECTORY_PRIVATE_MARKER,
            };
          }
          return {
            url: () => url,
            status: () => 200,
            headers: () => ({ 'content-type': 'application/json' }),
            body: async () =>
              Buffer.from(JSON.stringify({ code: 0, data, unknown: DIRECTORY_PRIVATE_MARKER })),
            dispose: async () => {},
          };
        },
        async dispose() {
          disposed++;
          active--;
        },
      };
    },
  } as unknown as Pick<DirectoryAPIRequest, 'newContext'>;
  class DirectoryFixtureBrowser extends BrowserSession {
    override async runShortDraftDirectory(
      input: Parameters<BrowserSession['runShortDraftDirectory']>[0],
    ) {
      if (mode === 'outside_error') throw Error(DIRECTORY_PRIVATE_MARKER);
      if (mode === 'cold')
        return directoryDomain.unavailableShortDraftDirectory('context_unavailable');
      const run = new directoryDomain.OwnedShortDraftDirectoryRun(
        { cookies: async () => [] } as unknown as DirectoryBrowserContext,
        {
          mode: input.mode,
          expectedOwner: input.expectedOwner,
          deadline: performance.now() + (input.timeoutMs ?? 10000),
          signal: input.signal,
          assertLease: input.assertLease,
          assertBorrowedActive: () => {},
          onBeforePlatformRead: input.onBeforePlatformRead,
          onVerifiedAccount: input.onVerifiedAccount,
          onQuarantine: () => {},
        },
        factory,
      );
      return run.run();
    }
  }
  let application = createApplication(config, {
    browser: new DirectoryFixtureBrowser({ profileDir: config.profileDir, headless: true }),
  });
  const fresh = () =>
    application.dispatch(
      'POST',
      '/api/v1/tools/fanqie_list_short_drafts',
      new URLSearchParams(),
      {},
    ) as Promise<Record<string, any>>;
  const get = (jobId: string) =>
    application.dispatch(
      'GET',
      `/api/v1/jobs/${jobId}`,
      new URLSearchParams(),
      undefined,
    ) as Promise<Record<string, any>>;
  const snapshot = (scope = 'native_short_draft_directory.v1') =>
    application.dispatch(
      'GET',
      '/api/v1/snapshot',
      new URLSearchParams({ scope }),
      undefined,
    ) as Promise<Record<string, any>>;
  const history = (scope = 'native_short_draft_directory.v1') =>
    application.dispatch(
      'GET',
      '/api/v1/history',
      new URLSearchParams({ scope }),
      undefined,
    ) as Promise<Record<string, any>>;
  return {
    directory,
    config,
    get application() {
      return application;
    },
    fresh,
    get,
    snapshot,
    history,
    get calls() {
      return calls;
    },
    get sessions() {
      return sessions;
    },
    get disposed() {
      return disposed;
    },
    get maximumActive() {
      return maximumActive;
    },
    urls,
    setMode(next: typeof mode) {
      mode = next;
    },
    setTotal(next: number) {
      total = next;
    },
    async reopen(defaultBrowser = false) {
      await application.close();
      application = defaultBrowser
        ? createApplication(config)
        : createApplication(config, {
            browser: new DirectoryFixtureBrowser({ profileDir: config.profileDir, headless: true }),
          });
    },
    async close() {
      await application.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export function assertDirectoryPublicPrivacy(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const privateValue of [
    DIRECTORY_PRIVATE_OWNER,
    DIRECTORY_PRIVATE_MARKER,
    'shortDraftDirectoryOwnerId',
    'shortDraftDirectorySchema',
    'idempotencyKey',
    'inputHash',
    'default-request',
    'fixture-request',
    'accountId',
    'ownerId',
    'result',
    'metadata',
    'evidenceKind',
    'collectionMode',
  ])
    assert.equal(serialized.includes(`"${privateValue}"`), false, privateValue);
  assert.equal(serialized.includes(DIRECTORY_PRIVATE_MARKER), false);
  assert.equal(serialized.includes(DIRECTORY_PRIVATE_OWNER), false);
  if (value && typeof value === 'object' && 'job' in value) {
    const job = (value as Record<string, any>).job;
    assert.deepEqual(
      Object.keys(job).sort(),
      [
        'id',
        'kind',
        'operation',
        'scope',
        'status',
        'requestedAt',
        'startedAt',
        'platformReadStartedAt',
        'endedAt',
        'target',
        'error',
      ].sort(),
    );
    assert.equal(job.target, null);
  }
}

export async function directoryStoreObservation(
  store: DirectoryStore,
  accountId = 'synthetic-f02-store',
) {
  const { job } = store.createJob({
    accountId,
    kind: 'read',
    operation: 'list_short_drafts',
    scope: 'native_short_draft_directory.v1',
    datasets: ['short_drafts'],
    inputHash: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    idempotencyKey: directoryUuid(),
    timeoutMs: 10000,
  });
  store.startJob(job.id);
  const factory = {
    async newContext() {
      return {
        async get(url: string) {
          const data =
            url === 'https://fanqienovel.com/api/user/info/v2'
              ? { id: DIRECTORY_PRIVATE_OWNER }
              : { total_count: 1, item_list: [{ item_id: '7900000000000000001' }] };
          return {
            url: () => url,
            status: () => 200,
            headers: () => ({ 'content-type': 'application/json' }),
            body: async () => Buffer.from(JSON.stringify({ code: 0, data })),
            dispose: async () => {},
          };
        },
        dispose: async () => {},
      };
    },
  } as unknown as Pick<DirectoryAPIRequest, 'newContext'>;
  const raw = await new directoryDomain.OwnedShortDraftDirectoryRun(
    { cookies: async () => [] } as unknown as DirectoryBrowserContext,
    {
      mode: 'read',
      expectedOwner: { kind: 'account', id: DIRECTORY_PRIVATE_OWNER },
      deadline: performance.now() + 10000,
      assertLease: () => store.assertLeaseOwnership(),
      assertBorrowedActive: () => {},
      onBeforePlatformRead: () => {
        store.markPlatformReadStarted(job.id);
      },
      onVerifiedAccount: () => {},
      onQuarantine: () => {},
    },
    factory,
  ).run();
  assert.equal(raw.status, 'success');
  const evidence = directoryDomain.createShortDraftDirectoryEvidence(raw, 'injected');
  store.addJobMetadata(job.id, {
    shortDraftDirectorySchema: 'short-draft-directory-job/v1',
    shortDraftDirectoryOwnerKind: 'account',
    shortDraftDirectoryOwnerId: DIRECTORY_PRIVATE_OWNER,
    shortDraftDirectorySource: 'fixture',
  });
  const ref = store.saveEvidence(job.id, 'short_drafts', evidence);
  return { job: store.getJob(job.id)!, ref, evidence };
}

export function directoryStoreFixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-f02-store-gate-')),
    databasePath = path.join(directory, 'operations.sqlite'),
    evidenceDirectory = path.join(directory, 'evidence');
  const store = new DirectoryStore({ databasePath, evidenceDirectory });
  return {
    directory,
    databasePath,
    evidenceDirectory,
    store,
    close() {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
