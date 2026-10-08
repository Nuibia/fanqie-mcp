import {
  type Mode,
  ACCOUNT,
  edit,
  WORK,
  catalog,
  UPLOAD,
  afterEdit,
  asset,
  JPEG,
  readResult,
  snapshot,
  digest,
} from './short-native-cover-integration-jpeg.js';

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { loadConfig } from '../../src/config.js';

import { randomUUID } from 'node:crypto';

import {
  type APIResponse,
  type APIRequestContext,
  type BrowserContext,
  type APIRequest,
} from 'playwright';

import {
  nativeShortMetadataFixedReadUrl,
  type NativeShortMetadataApiResult,
} from '../../src/platform/short-native-metadata-api.js';

import assert from 'node:assert/strict';

import {
  nativeShortMetadataEndpoints,
  NATIVE_SHORT_HASH_BASES,
} from '../../src/platform/short-native-metadata.js';

import { BrowserSession } from '../../src/platform/browser.js';

import {
  type NativeShortCoverApiResult,
  OwnedNativeShortCoverRun,
} from '../../src/platform/short-native-cover-api.js';

import { createApplication } from '../../src/application.js';

import { NATIVE_SHORT_COVER_SCOPE } from '../../src/platform/short-native-cover.js';

export function fixture(writesEnabled = true, mode: Mode = 'success') {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'native-cover-integration-synthetic-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'synthetic-cover-integration-token',
    FANQIE_ENABLE_WRITES: String(writesEnabled),
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  writeFileSync(
    path.join(config.dataDir, 'account-binding.json'),
    JSON.stringify({ accountId: config.accountId, platformId: ACCOUNT, platformIdType: 'account' }),
  );
  const uploadPath = `${randomUUID()}.jpg`;
  let writes = 0,
    reads = 0,
    coverCalls = 0,
    editCalls = 0,
    imagePreparations = 0,
    quarantine = false,
    current: unknown = edit();
  const posts: string[] = [];
  const response = (url: string, data: unknown, save = false) =>
    ({
      url: () => url,
      status: () => 200,
      headers: () => ({ 'content-type': 'application/json' }),
      async body() {
        return Buffer.from(JSON.stringify({ code: 0, ...(save ? {} : { data }) }));
      },
      async dispose() {},
    }) as unknown as APIResponse;
  const client = {
    async get(url: string) {
      reads++;
      let data: unknown;
      if (url === nativeShortMetadataFixedReadUrl(WORK, 'own')) data = { id: ACCOUNT };
      else if (url === nativeShortMetadataFixedReadUrl(WORK, 'list', 0))
        data = { total_count: 1, item_list: [{ item_id: WORK }] };
      else if (url === nativeShortMetadataFixedReadUrl(WORK, 'catalog')) data = catalog();
      else if (url === nativeShortMetadataFixedReadUrl(WORK, 'edit')) {
        editCalls++;
        data =
          mode === 'pre-save-drift' && editCalls === 2
            ? { ...edit(), opaque: { changed: true } }
            : current;
      } else throw Error('Unexpected synthetic fixed GET');
      return response(url, data);
    },
    async post(url: string, input: Record<string, unknown>) {
      writes++;
      posts.push(url);
      if (url === UPLOAD) {
        assert.equal((input.multipart as { file: { name: string } }).file.name, 'temp');
        if (mode === 'upload-ack-lost') throw Error('PRIVATE_NEW_URI lost synthetic upload ACK');
        return response(url, {
          pic_uri: 'PRIVATE_NEW_URI',
          pic_url: 'https://example.invalid/PRIVATE_PIC_URL',
        });
      }
      assert.equal(url, nativeShortMetadataEndpoints(WORK).save);
      const form = new URLSearchParams(String(input.data));
      assert.equal(form.get('book_thumb_uri'), 'PRIVATE_NEW_URI');
      assert.equal(form.get('thumb_uri'), 'PRIVATE_HEAD_URI');
      assert.equal(form.get('content'), edit().content);
      current = afterEdit();
      if (mode === 'save-ack-lost') throw Error('PRIVATE_HTML lost synthetic save ACK');
      return response(url, {}, true);
    },
    async dispose() {},
  } as unknown as APIRequestContext;
  class FixtureBrowser extends BrowserSession {
    override get hasUnsafeApiCleanup() {
      return quarantine;
    }
    override async checkLogin(): Promise<never> {
      throw Error('Forbidden login navigation');
    }
    override async withPage<T>(): Promise<T> {
      throw Error('Forbidden generic Page writer');
    }
    override async runNativeShortCoverUpdate(
      workId: string,
      options: Parameters<BrowserSession['runNativeShortCoverUpdate']>[1],
    ): Promise<NativeShortCoverApiResult> {
      coverCalls++;
      assert.equal(workId, WORK);
      const { timeoutMs, ...ownedOptions } = options;
      assert(typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0);
      const borrowed = {
        async cookies() {
          return [];
        },
        browser() {
          return {};
        },
      } as unknown as BrowserContext;
      // Honor the finite deadline supplied by the caller, including time needed for durable proof.
      const owned = new OwnedNativeShortCoverRun(
        borrowed,
        workId,
        {
          ...ownedOptions,
          deadline: performance.now() + timeoutMs,
          assertBorrowedActive() {},
          onQuarantine() {
            quarantine = true;
          },
        },
        {
          async newContext() {
            return client;
          },
        } as Pick<APIRequest, 'newContext'>,
        async () => {
          imagePreparations++;
          return { asset: asset(), bytes: JPEG };
        },
      );
      return owned.run();
    }
    override async runNativeShortMetadata(
      workId: string,
      options: Parameters<BrowserSession['runNativeShortMetadata']>[1],
    ): Promise<NativeShortMetadataApiResult> {
      assert.equal(workId, WORK);
      assert.equal(options.mode, 'read');
      reads++;
      options.assertLease();
      options.onBeforePlatformRead();
      const raw = readResult(current);
      options.onVerifiedAccount(ACCOUNT, raw.proof.proofCapturedAt!);
      return raw;
    }
  }
  const browser = new FixtureBrowser({ profileDir: config.profileDir, headless: true });
  const app = createApplication(config, { browser });
  const request = (key = 'synthetic-cover-key') => ({
    idempotencyKey: key,
    target: { kind: 'short', workId: WORK },
    expectedState: 'draft',
    snapshotScope: NATIVE_SHORT_COVER_SCOPE,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedSnapshotVersionHash: snapshot().snapshotVersionHash,
    metadata: { cover: { uploadPath, sha256: digest(JPEG), fit: 'cover' } },
  });
  const call = (input: unknown = request()) =>
    app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_update_work_metadata',
      new URLSearchParams(),
      input,
    ) as Promise<any>;
  const view = (name: string, jobId: string) =>
    app.dispatch('POST', '/api/v1/tools/fanqie_' + name, new URLSearchParams(), {
      jobId,
    }) as Promise<any>;
  return {
    directory,
    config,
    app,
    browser,
    call,
    request,
    view,
    posts,
    setCurrent(value: unknown) {
      current = value;
    },
    get writes() {
      return writes;
    },
    get reads() {
      return reads;
    },
    get coverCalls() {
      return coverCalls;
    },
    get imagePreparations() {
      return imagePreparations;
    },
    async close() {
      await app.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
