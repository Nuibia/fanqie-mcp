import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';

import { createHash } from 'node:crypto';

import {
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
} from '../../src/platform/short-native-metadata.js';

import {
  NATIVE_SHORT_SUBMISSION_SOURCE_PINS,
  validateNativeShortSubmissionContract,
  nativeShortSubmissionContractVersionHash,
  NATIVE_SHORT_SUBMISSION_TERMS_HASH,
  NATIVE_SHORT_SUBMISSION_SCOPE,
} from '../../src/platform/short-native-submission.js';

import path from 'node:path';

import { tmpdir } from 'node:os';

import { loadConfig } from '../../src/config.js';

import {
  type APIResponse,
  type APIRequestContext,
  type BrowserContext,
  type APIRequest,
} from 'playwright';

import { nativeShortMetadataFixedReadUrl } from '../../src/platform/short-native-metadata-api.js';

import assert from 'node:assert/strict';

import { BrowserSession } from '../../src/platform/browser.js';

import {
  type NativeShortSubmissionApiResult,
  createOwnedNativeShortSubmissionFixtureRun,
} from '../../src/platform/short-native-submission-api.js';

import { createApplication } from '../../src/application.js';

const WORK = '7000000001',
  ACCOUNT = '1001';

const terms = readFileSync(
  new URL(
    './fixtures/short-native-submission-terms-4c89ddd6.txt',
    new URL('../short-native-submission-integration.test.ts', import.meta.url).href,
  ),
  'utf8',
);

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

const marker =
  '<div data-percentage="0.3333333333333333" data-fanqie-type="pay_tag" data-min-text="200" data-min-paragraphs="3" data-min-radio="0.3" data-para-nums="3" class=""></div>';

function edit() {
  const p = `<p>${'PRIVATE_BODY'.repeat(30)}</p>`;
  return {
    item_id: WORK,
    publish_status: 0,
    display_status: 0,
    content: p + marker + p + p,
    multi_title: ['合成原创短故事'],
    thumb_uri: '',
    book_thumb_uri: 'PRIVATE_COVER',
    category: [{ category_id: 10, label: '主类', name: '主甲' }],
    sign_type: 1,
    origin_activity_flag: 0,
    story_origin_divided_chapters: 0,
    authorize_type: 0,
    use_ai: 2,
    opaque: 'PRIVATE_OPAQUE',
  };
}

const catalog = { category_list: [{ category_id: 10, label: '主类', name: '主甲' }] };

const snapshot = (value: unknown = edit()) =>
  createNativeShortMetadataSnapshot({
    binding: { account: { kind: 'account_id', id: ACCOUNT }, work: { kind: 'short', id: WORK } },
    editData: value,
    categoryData: catalog,
  });

function contract() {
  const at = new Date().toISOString(),
    sources = {
      writer: {
        url: NATIVE_SHORT_SUBMISSION_SOURCE_PINS.writer.url,
        sha256: sha('fixture'),
        observedAt: at,
      },
      main: { ...NATIVE_SHORT_SUBMISSION_SOURCE_PINS.main, observedAt: at },
      publishShort: { ...NATIVE_SHORT_SUBMISSION_SOURCE_PINS.publishShort, observedAt: at },
      asyncMain: { ...NATIVE_SHORT_SUBMISSION_SOURCE_PINS.asyncMain, observedAt: at },
    };
  return validateNativeShortSubmissionContract({
    schema: 'short-native-submission-contract/v1',
    mode: 'fixture-no-live',
    observedAt: at,
    sourceHash: nativeShortSubmissionContractVersionHash(sources),
    sources,
    terms: {
      title: '短故事发布事项',
      text: terms,
      sha256: NATIVE_SHORT_SUBMISSION_TERMS_HASH,
      sourceUrl: sources.publishShort.url,
      sourceSha256: sources.publishShort.sha256,
      byteStart: 192356,
      byteEndExclusive: 202397,
    },
    validation: {
      titleCount: 'unknown',
      validateThreshold: 'unknown',
      checkPre: 'not_called_get_only',
    },
  });
}

type Mode = 'success' | 'reject' | 'lost' | 'missing-ai' | 'drift';

export function fixture(writes = true, mode: Mode = 'success') {
  const dir = mkdtempSync(path.join(tmpdir(), 'native-submission-integration-synthetic-')),
    config = loadConfig({
      FANQIE_TOKEN: 'synthetic-submission-token',
      FANQIE_ENABLE_WRITES: String(writes),
      FANQIE_DATA_DIR: path.join(dir, 'data'),
      FANQIE_PROFILE_DIR: path.join(dir, 'profile'),
      FANQIE_RUNTIME_DIR: path.join(dir, 'runtime'),
    });
  writeFileSync(
    path.join(config.dataDir, 'account-binding.json'),
    JSON.stringify({ accountId: config.accountId, platformId: ACCOUNT, platformIdType: 'account' }),
  );
  let gets = 0,
    posts = 0,
    calls = 0,
    lists = 0,
    current: Record<string, unknown> = edit();
  const source = contract();
  const response = (url: string, value: unknown, source = false) =>
    ({
      url: () => url,
      status: () => 200,
      headers: () => ({ 'content-type': source ? 'text/javascript' : 'application/json' }),
      async body() {
        return Buffer.from(source ? 'fixture' : JSON.stringify(value));
      },
      async dispose() {},
    }) as unknown as APIResponse;
  const client = {
    async get(url: string) {
      gets++;
      if (Object.values(NATIVE_SHORT_SUBMISSION_SOURCE_PINS).some((p) => p.url === url))
        return response(url, 'fixture', true);
      let data: unknown;
      if (url === nativeShortMetadataFixedReadUrl(WORK, 'own')) data = { id: ACCOUNT };
      else if (url === nativeShortMetadataFixedReadUrl(WORK, 'catalog')) data = catalog;
      else if (url === nativeShortMetadataFixedReadUrl(WORK, 'edit')) data = current;
      else if (url === nativeShortMetadataFixedReadUrl(WORK, 'list', 0)) {
        lists++;
        data = { total_count: 1, item_list: [{ item_id: WORK }] };
      } else throw Error('Unexpected GET');
      return response(url, { code: 0, data });
    },
    async post(url: string, options: Record<string, unknown>) {
      posts++;
      assert.equal(
        url,
        'https://fanqienovel.com/api/author/short_article/publish/v0/?aid=2503&app_name=muye_novel',
      );
      const form = new URLSearchParams(String(options.data));
      assert.equal(form.get('use_ai'), '1');
      assert.ok(form.get('content')!.includes(marker));
      assert.equal(form.has('item_version'), false);
      if (mode !== 'reject')
        current = {
          ...current,
          publish_status: 1,
          display_status: 1,
          ...(mode === 'missing-ai' ? {} : { use_ai: 1 }),
        };
      if (mode === 'missing-ai') delete current.use_ai;
      if (mode === 'lost') throw Error('PRIVATE_BODY lost ACK');
      return response(url, {
        code: mode === 'reject' ? 400123 : 0,
        message: 'PRIVATE_BODY ACK text',
        data: { item_id: WORK },
      });
    },
    async dispose() {},
  } as unknown as APIRequestContext;
  class FixtureBrowser extends BrowserSession {
    override async withPage<T>(): Promise<T> {
      throw Error('Forbidden editor');
    }
    override async runNativeShortSubmission(
      workId: string,
      options: Parameters<BrowserSession['runNativeShortSubmission']>[1],
    ): Promise<NativeShortSubmissionApiResult> {
      calls++;
      const { timeoutMs = 120000, ...owned } = options;
      return createOwnedNativeShortSubmissionFixtureRun(
        {
          async cookies() {
            return [];
          },
          browser() {
            return {};
          },
        } as unknown as BrowserContext,
        workId,
        {
          ...owned,
          deadline: performance.now() + timeoutMs,
          assertBorrowedActive() {},
          onQuarantine() {},
        },
        {
          async newContext() {
            return client;
          },
        } as Pick<APIRequest, 'newContext'>,
        source,
      ).run();
    }
  }
  const browser = new FixtureBrowser({ profileDir: config.profileDir, headless: true });
  let app = createApplication(config, { browser });
  const input = () => ({
    target: { kind: 'short', workId: WORK },
    snapshotScope: NATIVE_SHORT_SUBMISSION_SCOPE,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedSnapshotVersionHash: snapshot().snapshotVersionHash,
    expectedState: 'draft',
    useAi: 1,
  });
  const call = (name: string, args: unknown) =>
    app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_' + name,
      new URLSearchParams(),
      args,
    ) as Promise<any>;
  return {
    dir,
    config,
    browser,
    input,
    call,
    get app() {
      return app;
    },
    get gets() {
      return gets;
    },
    get posts() {
      return posts;
    },
    get calls() {
      return calls;
    },
    get lists() {
      return lists;
    },
    drift() {
      current = { ...current, opaque: 'changed' };
    },
    async restart() {
      await app.close();
      app = createApplication(config, {
        browser: new FixtureBrowser({ profileDir: config.profileDir, headless: true }),
      });
    },
    async close() {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function noPrivate(output: unknown) {
  for (const marker of [
    'PRIVATE_BODY',
    'PRIVATE_COVER',
    'PRIVATE_OPAQUE',
    'synthetic-submission-token',
    'operations.sqlite',
  ])
    assert.equal(JSON.stringify(output).includes(marker), false);
}

export async function prepare(f: ReturnType<typeof fixture>) {
  const r = await f.call('prepare_submission', f.input());
  assert.equal(r.job.status, 'succeeded', JSON.stringify(r));
  assert.equal(r.data[0].status, 'prepared');
  noPrivate(r);
  return r;
}

export async function submit(
  f: ReturnType<typeof fixture>,
  p: any,
  key = 'synthetic-submission-key',
) {
  return f.call('submit_short_story', {
    ...f.input(),
    idempotencyKey: key,
    preparationJobId: p.job.id,
    acceptPublicationTerms: true,
  });
}
