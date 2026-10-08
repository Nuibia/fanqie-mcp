import {
  snapshot,
  WORK,
  fixtureProvenance,
  ACCOUNT,
  SCOPE,
} from './short-native-metadata-integration-snapshot.js';

import {
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
  nativeShortMetadataEndpoints,
} from '../../src/platform/short-native-metadata.js';

import {
  type NativeShortWriteBusinessInput,
  type NativeShortWriteEvidenceContext,
  NATIVE_SHORT_BASELINE_DATASET,
  NATIVE_SHORT_AFTER_DATASET,
  nativeShortWriteInputHash,
} from '../../src/platform/short-native-metadata-proof.js';

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { loadConfig } from '../../src/config.js';

import { Store } from '../../src/runtime/store.js';

import { JobQueue } from '../../src/runtime/jobs.js';

import {
  type APIResponse,
  type APIRequestContext,
  type BrowserContext,
  type APIRequest,
} from 'playwright';

import assert from 'node:assert/strict';

import { BrowserSession } from '../../src/platform/browser.js';

import {
  OwnedNativeShortMetadataRun,
  OwnedNativeShortMetadataWriteRun,
} from '../../src/platform/short-native-metadata-api.js';

import { createHash } from 'node:crypto';

import { runNativeShortMetadataSaveJob } from '../../src/application.js';

export function nativeWriteSnapshot() {
  const before = snapshot();
  return createNativeShortMetadataSnapshot({
    binding: before.binding,
    editData: { ...before.editData, latest_version: 100, modify_time: '0000000123' },
    categoryData: before.categoryData,
  });
}

export function writeBusiness(
  patch: Pick<NativeShortWriteBusinessInput, 'title' | 'metadata'> = { title: 'Changed title' },
): NativeShortWriteBusinessInput {
  return {
    target: { kind: 'short', workId: WORK },
    snapshotScope: 'short-native-metadata/v1',
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedSnapshotVersionHash: nativeWriteSnapshot().snapshotVersionHash,
    expectedState: 'draft',
    ...patch,
  };
}

export async function nativeSaveFixture(
  fault:
    'none' | 'intent' | 'after' | 'result' | 'post' | 'acklost' | 'mismatch' | 'cleanup' = 'none',
  collection: 'fixture' | 'live' = 'fixture',
) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'native-save-production-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'native-save-synthetic-token',
    FANQIE_ENABLE_WRITES: 'false',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  const storage = {
    databasePath: path.join(config.dataDir, 'operations.sqlite'),
    evidenceDirectory: path.join(config.dataDir, 'evidence'),
    evidenceMode: collection,
  };
  const saveProvenance =
    collection === 'live'
      ? { executor: 'application-default-browser/v1' as const, mode: 'live' as const }
      : fixtureProvenance;
  const store = new Store(storage),
    queue = new JobQueue(store);
  const before = nativeWriteSnapshot(),
    editData = structuredClone(before.editData) as any,
    categoryData = structuredClone(before.categoryData);
  let postCount = 0,
    getCount = 0,
    ownerCount = 0,
    postDurability = false,
    currentContext: NativeShortWriteEvidenceContext | null = null;
  let currentJobId = '';
  const response = (url: string, data: unknown) =>
    ({
      status: () => 200,
      url: () => url,
      headers: () => ({ 'content-type': 'application/json;charset=utf-8' }),
      body: async () => Buffer.from(JSON.stringify({ code: 0, data })),
      dispose: async () => {},
    }) as unknown as APIResponse;
  const api = {
    async get(url: string) {
      getCount++;
      if (url === 'https://fanqienovel.com/api/user/info/v2') return response(url, { id: ACCOUNT });
      if (url.startsWith('https://fanqienovel.com/api/author/short_article/draft_list/v0/'))
        return response(url, { total_count: 1, item_list: [{ item_id: WORK }] });
      if (url.includes('/edit/')) return response(url, editData);
      if (url.includes('/get_category_list/')) return response(url, categoryData);
      throw new Error('Unexpected fixed GET');
    },
    async post(url: string, options: Record<string, unknown>) {
      postCount++;
      // This is the actual synthetic POST callsite, not an assertion in a mirrored callback.
      const job = store.getJob(currentJobId)!;
      const refs = store.listEvidence(currentJobId);
      assert.equal(refs.length, 2);
      assert.deepEqual(
        refs.map((ref) => ref.dataset),
        [NATIVE_SHORT_BASELINE_DATASET, 'write-intent'],
      );
      assert.deepEqual(job.target, { kind: 'short-story', id: WORK });
      assert.notEqual(job.platformWriteStartedAt, null);
      for (const ref of refs) assert.equal(store.readEvidence(ref).jobId, currentJobId);
      assert.equal(url, nativeShortMetadataEndpoints(WORK).save);
      assert.equal(options.maxRedirects, 0);
      assert.equal(options.maxRetries, 0);
      assert.deepEqual(options.headers, {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      });
      const form = new URLSearchParams(String(options.data));
      assert.equal(form.get('content'), editData.content);
      assert.equal(form.get('thumb_uri'), editData.thumb_uri);
      assert.equal(form.get('book_thumb_uri'), editData.book_thumb_uri);
      assert.equal(form.get('item_version'), '-1');
      assert.equal(JSON.parse(form.get('multi_title')!)[1], 'PRIVATE_TAIL');
      postDurability = true;
      if (fault === 'post') throw new Error('PRIVATE_FORM PRIVATE_HTML');
      if (fault !== 'mismatch') editData.multi_title = JSON.parse(form.get('multi_title')!);
      editData.latest_version += 1;
      if (fault === 'acklost')
        throw new Error('Synthetic ACK lost after platform fields were saved');
      return response(url, {});
    },
    async dispose() {
      if (fault === 'cleanup') throw new Error('PRIVATE_COOKIE');
    },
  } as unknown as APIRequestContext;
  const borrowed = {
    cookies: async () => [],
    browser: () => ({ isConnected: () => true }),
  } as unknown as BrowserContext;
  const factory: Pick<APIRequest, 'newContext'> = {
    async newContext() {
      return api;
    },
  };
  class NativeWriteBrowser extends BrowserSession {
    override async withPage<T>(): Promise<T> {
      throw new Error('Forbidden Page');
    }
    override async checkLogin(): Promise<never> {
      throw new Error('Forbidden login navigation');
    }
    override async runNativeShortMetadata(
      workId: string,
      options: Parameters<BrowserSession['runNativeShortMetadata']>[1],
    ) {
      return new OwnedNativeShortMetadataRun(
        borrowed,
        workId,
        {
          ...options,
          deadline: performance.now() + 5000,
          assertBorrowedActive: () => {},
          onQuarantine: () => {},
        },
        factory,
      ).run();
    }
    override async runNativeShortMetadataUpdate(
      workId: string,
      options: Parameters<BrowserSession['runNativeShortMetadataUpdate']>[1],
    ) {
      const run = new OwnedNativeShortMetadataWriteRun(
        borrowed,
        workId,
        {
          ...options,
          deadline: performance.now() + 5000,
          assertBorrowedActive: () => {},
          onQuarantine: () => {},
        },
        factory,
      );
      return run.run();
    }
  }
  const browser = new NativeWriteBrowser({ profileDir: config.profileDir, headless: true });
  const obstruction =
    fault === 'intent'
      ? 'write-intent'
      : fault === 'after'
        ? NATIVE_SHORT_AFTER_DATASET
        : fault === 'result'
          ? 'write-result'
          : null;
  if (obstruction) {
    const { mkdirSync } = await import('node:fs');
    const accountDirectory = path.join(
      storage.evidenceDirectory,
      createHash('sha256').update('owner').digest('hex').slice(0, 24),
    );
    mkdirSync(accountDirectory, { recursive: true });
    writeFileSync(path.join(accountDirectory, obstruction), 'synthetic EEXIST obstruction');
  }
  const handle = queue.enqueueWrite({
    accountId: 'owner',
    operation: 'update_work_metadata',
    scope: SCOPE,
    idempotencyKey: 'native-save-production-key',
    inputHash: nativeShortWriteInputHash(writeBusiness()),
    run: async (ctx) => {
      currentJobId = ctx.jobId;
      return runNativeShortMetadataSaveJob(store, browser, ctx, writeBusiness(), {
        timeoutMs: 5000,
        expectedPlatformAccount: ACCOUNT,
        provenance: saveProvenance,
        currentPlatformAccount: () => ACCOUNT,
        onVerifiedAccount: (id, at) => {
          assert.equal(id, ACCOUNT);
          assert(Number.isFinite(Date.parse(at)));
          ownerCount++;
        },
      });
    },
  });
  const job = await handle.completion;
  const refs = store.listEvidence(job.id),
    documents = refs.map((ref) => store.readEvidence(ref));
  currentContext = { accountId: 'owner', job, manifest: null, refs, documents };
  await queue.drainAndStop();
  store.close();
  await browser.close();
  writeFileSync(
    path.join(config.dataDir, 'account-binding.json'),
    JSON.stringify({ accountId: 'owner', platformId: ACCOUNT, platformIdType: 'account' }),
  );
  return {
    directory,
    config,
    storage,
    job,
    refs,
    documents,
    context: currentContext,
    setTitle(value: string) {
      editData.multi_title[0] = value;
    },
    createBrowser: () => new NativeWriteBrowser({ profileDir: config.profileDir, headless: true }),
    get postCount() {
      return postCount;
    },
    get getCount() {
      return getCount;
    },
    ownerCount,
    postDurability,
    async close() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
