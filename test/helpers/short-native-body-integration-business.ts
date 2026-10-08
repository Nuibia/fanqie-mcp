import {
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
  nativeShortMetadataEndpoints,
} from '../../src/platform/short-native-metadata.js';

import {
  validateNativeShortBodyBusinessInput,
  NATIVE_SHORT_BODY_SCOPE,
  NATIVE_SHORT_BODY_REPRESENTATION,
  nativeShortBodyBusinessInputHash,
} from '../../src/platform/short-native-body.js';

import {
  type BrowserContext,
  type APIResponse,
  type APIRequestContext,
  type APIRequest,
} from 'playwright';

import { mkdtempSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { nativeShortMetadataFixedReadUrl } from '../../src/platform/short-native-metadata-api.js';

import assert from 'node:assert/strict';

import { BrowserSession } from '../../src/platform/browser.js';

import { Store } from '../../src/runtime/store.js';

import { JobQueue } from '../../src/runtime/jobs.js';

import {
  NATIVE_SHORT_BODY_OPERATION,
  nativeShortBodyScope,
} from '../../src/platform/short-native-body-proof.js';

import {
  runNativeShortBodyJob,
  reconcileNativeShortBodyWrite,
} from '../../src/platform/short-native-body-runtime.js';

export const OWNER = 'fixture-owner',
  ACCOUNT = '900100190010019001001',
  WORK = '7000000001';

const SOURCE = '<p>PRIVATE_BODY甲</p><p>PRIVATE_TAIL乙</p><p></p>',
  DESIRED = '<p>PRIVATE_BODY修改</p><p>PRIVATE_TAIL乙</p><p></p>';

export const edit = (content = SOURCE) => ({
  item_id: WORK,
  publish_status: 0,
  content,
  multi_title: ['Synthetic title', 'PRIVATE_TITLE'],
  thumb_uri: 'PRIVATE_HEAD_URI',
  book_thumb_uri: 'PRIVATE_COVER_URI',
  category: [],
  sign_type: 1,
  origin_activity_flag: 0,
  latest_version: 7,
  modify_time: '1789450000',
  opaque: { keep: [null, true, 'PRIVATE_OPAQUE'] },
});

const catalog = () => ({
  category_list: [{ category_id: 'c1', label: 'Synthetic', name: 'Fixture' }],
  opaque_catalog: 'PRIVATE_CATALOG',
});

const before = () =>
  createNativeShortMetadataSnapshot({
    binding: { account: { kind: 'account_id', id: ACCOUNT }, work: { kind: 'short', id: WORK } },
    editData: edit(),
    categoryData: catalog(),
  });

export function business(noChange = false) {
  return validateNativeShortBodyBusinessInput({
    target: { kind: 'short', workId: WORK },
    snapshotScope: NATIVE_SHORT_BODY_SCOPE,
    expectedSnapshotVersionHash: before().snapshotVersionHash,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedState: 'draft',
    representation: NATIVE_SHORT_BODY_REPRESENTATION,
    paragraphs: [
      {
        sourceIndex: noChange ? 0 : null,
        lines: [noChange ? 'PRIVATE_BODY甲' : 'PRIVATE_BODY修改'],
      },
      { sourceIndex: 1, lines: ['PRIVATE_TAIL乙'] },
    ],
    trial: { action: 'clear' },
  });
}

interface Internals {
  context: BrowserContext | null;
  page: unknown;
  identityEpoch: number;
}

export function fixture(mode: 'success' | 'ack-lost' | 'pre-save-drift' = 'success') {
  // Successful persistence uses the production 120 s operation budget; dedicated API/runtime tests cover short deadlines.
  const timeoutMs = 120_000;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'body-owned-sqlite-')),
    databasePath = path.join(dir, 'operations.sqlite'),
    evidenceDirectory = path.join(dir, 'evidence');
  let gets = 0,
    posts = 0,
    contexts = 0,
    editReads = 0,
    partial = false,
    owner = ACCOUNT,
    current: Record<string, unknown> = edit();
  const response = (url: string, data?: unknown) =>
    ({
      url: () => url,
      status: () => 200,
      headers: () => ({ 'content-type': 'application/json' }),
      async body() {
        return Buffer.from(JSON.stringify({ code: 0, ...(data === undefined ? {} : { data }) }));
      },
      async dispose() {},
    }) as unknown as APIResponse;
  const client = {
    async get(url: string) {
      gets++;
      if (partial) {
        partial = false;
        throw Error('PRIVATE_BODY partial own response');
      }
      if (url === nativeShortMetadataFixedReadUrl(WORK, 'own')) return response(url, { id: owner });
      if (url === nativeShortMetadataFixedReadUrl(WORK, 'list', 0))
        return response(url, { total_count: 1, item_list: [{ item_id: WORK }] });
      if (url === nativeShortMetadataFixedReadUrl(WORK, 'catalog')) return response(url, catalog());
      if (url === nativeShortMetadataFixedReadUrl(WORK, 'edit')) {
        editReads++;
        return response(
          url,
          mode === 'pre-save-drift' && editReads === 2
            ? { ...current, opaque: { changed: true } }
            : current,
        );
      }
      throw Error('Forbidden synthetic GET');
    },
    async post(url: string, input: { data: string; maxRedirects: number; maxRetries: number }) {
      posts++;
      assert.equal(url, nativeShortMetadataEndpoints(WORK).save);
      assert.equal(input.maxRedirects, 0);
      assert.equal(input.maxRetries, 0);
      const form = new URLSearchParams(input.data);
      assert.equal(form.get('content'), DESIRED);
      assert.equal(form.get('thumb_uri'), 'PRIVATE_HEAD_URI');
      current = {
        ...current,
        content: form.get('content'),
        latest_version: 8,
        modify_time: '1789450001',
      };
      if (mode === 'ack-lost') throw Error('PRIVATE_BODY synthetic lost ACK');
      return response(url);
    },
    async dispose() {},
  } as unknown as APIRequestContext;
  const factory: Pick<APIRequest, 'newContext'> = {
    async newContext() {
      contexts++;
      return client;
    },
  };
  class OwnedFixtureBrowser extends BrowserSession {
    override async withPage<T>(): Promise<T> {
      throw Error('Forbidden editor page');
    }
    override async checkLogin(): Promise<never> {
      throw Error('Forbidden login navigation');
    }
  }
  const browser = new OwnedFixtureBrowser({
    profileDir: path.join(dir, 'unused-profile'),
    headless: true,
    operationTimeoutMs: timeoutMs,
  });
  const borrowed = {
    browser() {
      return { isConnected: () => true };
    },
    async cookies() {
      return [];
    },
    async close() {},
    async newPage() {
      throw Error('Forbidden new page');
    },
  } as unknown as BrowserContext;
  const state = browser as unknown as Internals;
  state.context = borrowed;
  state.page = {
    isClosed: () => false,
    context: () => borrowed,
    async goto() {
      throw Error('Forbidden navigation');
    },
    async close() {},
  };
  let store = new Store({
      databasePath,
      evidenceDirectory,
      evidenceMode: 'fixture',
      nativeShortBodyWriteEnabled: true,
      nativeShortBodyFixtureFactory: factory,
    }),
    queue = new JobQueue(store, { timeoutMs });
  const options = {
    timeoutMs,
    currentPlatformAccount: () => ACCOUNT,
    onVerifiedAccount: (id: string, at: string) => {
      assert.equal(id, ACCOUNT);
      assert.equal(new Date(at).toISOString(), at);
    },
  };
  const write = async (noChange = false, key = 'synthetic-body-key') => {
    const input = business(noChange),
      handle = queue.enqueueWrite({
        accountId: OWNER,
        operation: NATIVE_SHORT_BODY_OPERATION,
        scope: nativeShortBodyScope(WORK),
        idempotencyKey: key,
        inputHash: nativeShortBodyBusinessInputHash(OWNER, input),
        run: (ctx) => runNativeShortBodyJob(store, browser, ctx, input, options),
      });
    return handle.completion;
  };
  const reconcile = async (id: string) => {
    const original = store.getJob(id, OWNER);
    assert(original);
    return reconcileNativeShortBodyWrite(store, queue, browser, OWNER, original, options);
  };
  return {
    dir,
    databasePath,
    evidenceDirectory,
    browser,
    factory,
    options,
    write,
    reconcile,
    get store() {
      return store;
    },
    get queue() {
      return queue;
    },
    get gets() {
      return gets;
    },
    get posts() {
      return posts;
    },
    get contexts() {
      return contexts;
    },
    nextPartial() {
      partial = true;
    },
    foreignOwner() {
      owner = '9002';
    },
    setCurrent(value: Record<string, unknown>) {
      current = value;
    },
    reopen() {
      store.close();
      store = new Store({
        databasePath,
        evidenceDirectory,
        evidenceMode: 'fixture',
        nativeShortBodyWriteEnabled: false,
        nativeShortBodyFixtureFactory: factory,
      });
      queue = new JobQueue(store, { timeoutMs });
    },
    async close() {
      await queue.drainAndStop();
      await browser.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function assertSafe(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const marker of ['PRIVATE', OWNER, ACCOUNT, WORK, 'operations.sqlite', 'evidence/'])
    assert.equal(serialized.includes(marker), false, marker);
}
