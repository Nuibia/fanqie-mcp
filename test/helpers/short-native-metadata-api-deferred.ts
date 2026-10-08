import {
  type NativeShortMetadataApiOptions,
  OwnedNativeShortMetadataRun,
  type NativeShortMetadataApiResult,
} from '../../src/platform/short-native-metadata-api.js';

import { nativeShortMetadataEndpoints } from '../../src/platform/short-native-metadata.js';

import {
  type APIResponse,
  type APIRequestContext,
  type APIRequest,
  type BrowserContext,
  type Page,
  request,
} from 'playwright';

import assert from 'node:assert/strict';

import { WRITER_HOME, BrowserSession } from '../../src/platform/browser.js';

export const WORK = '1234567890123456789',
  ACCOUNT = '0001001',
  OWN = 'https://fanqienovel.com/api/user/info/v2';

type Stage = 'cookies' | 'creation' | 'get' | 'body' | 'response_dispose' | 'api_dispose';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

export const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

export const edit = () => ({
  item_id: '0',
  publish_status: 0,
  multi_title: ['主标题 &+% 中文', '尾标题一', '尾标题二'],
  content:
    '<p style="color:red" pay_tag="1">实体 &amp; <strong>正文</strong></p><p><br></p><img src="private-image">',
  thumb_uri: 'private-thumb-uri',
  book_thumb_uri: 'private-book-uri',
  category: [{ category_id: 'c1', label: '主类', name: '都市' }],
  sign_type: '1',
  origin_activity_flag: '0',
  authorize_type: 0,
  category_max_count: 8,
  unknown: {
    absentIsDistinct: null,
    nested: [true, '值'],
    url_list: ['https://private.invalid/?nonce=private'],
  },
});

export const catalog = () => ({
  category_list: [
    { category_id: 'c1', label: '主类', name: '都市' },
    { category_id: 2, label: '标签', name: '奇遇' },
  ],
  unknown_catalog: { preserved: 'private' },
});

export interface Overrides {
  hold?: Stage;
  failDispose?: 'response' | 'api';
  rows?: string[];
  workId?: string;
  response?: (
    url: string,
    index: number,
  ) => {
    status?: number;
    url?: string;
    headers?: Record<string, string>;
    bytes?: Buffer;
    envelope?: unknown;
  };
  callback?: () => void;
  lease?: () => void;
  source?: () => void;
  beforeRead?: () => void;
  owner?: NativeShortMetadataApiOptions['expectedOwner'];
  deadlineMs?: number;
}

export function fixture(overrides: Overrides = {}) {
  const gate = deferred<void>(),
    entered = deferred<void>(),
    controller = new AbortController();
  const calls: Array<{ url: string; options: Record<string, unknown> }> = [],
    events: string[] = [];
  let held = false,
    apiCloses = 0,
    borrowedCloses = 0,
    pageTouches = 0,
    callbacks = 0,
    quarantines = 0,
    contextOptions: unknown;
  const pause = async (stage: Stage) => {
    events.push(stage);
    if (overrides.hold === stage && !held) {
      held = true;
      entered.resolve();
      await gate.promise;
    }
  };
  const rows = overrides.rows ?? [WORK];
  const sourceData = (url: string): unknown => {
    if (url === OWN) return { id: ACCOUNT, author_id: 'different-namespace' };
    if (url.startsWith('https://fanqienovel.com/api/author/short_article/draft_list/v0/')) {
      const index = Number(new URL(url).searchParams.get('page_index'));
      return {
        total_count: rows.length,
        item_list: rows
          .slice(index * 10, (index + 1) * 10)
          .map((item_id) => ({ item_id, private_other_draft: 'private-row' })),
      };
    }
    if (url === nativeShortMetadataEndpoints(WORK).edit) return edit();
    if (url === nativeShortMetadataEndpoints(WORK).catalog) return catalog();
    throw new Error('An unexpected endpoint was called');
  };
  const api = {
    async get(url: string, options: Record<string, unknown>) {
      calls.push({ url, options });
      await pause('get');
      const changed = overrides.response?.(url, calls.length) ?? {};
      const response = {
        status: () => changed.status ?? 200,
        url: () => changed.url ?? url,
        headers: () => changed.headers ?? { 'content-type': 'application/json;charset=utf-8' },
        async body() {
          await pause('body');
          return (
            changed.bytes ??
            Buffer.from(JSON.stringify(changed.envelope ?? { code: 0, data: sourceData(url) }))
          );
        },
        async dispose() {
          await pause('response_dispose');
          if (overrides.failDispose === 'response') throw new Error('private-response-disposal');
          events.push('response_disposed');
        },
      };
      return response as unknown as APIResponse;
    },
    async post() {
      throw new Error('No POST is allowed');
    },
    async dispose() {
      apiCloses++;
      await pause('api_dispose');
      if (overrides.failDispose === 'api') throw new Error('private-api-disposal');
      events.push('api_disposed');
    },
  } as unknown as APIRequestContext;
  const factory: Pick<APIRequest, 'newContext'> = {
    async newContext(options) {
      contextOptions = options;
      await pause('creation');
      return api;
    },
  };
  const connected = { value: true };
  const browser = { isConnected: () => connected.value };
  const borrowed = {
    async cookies(origin: string) {
      assert.equal(origin, 'https://fanqienovel.com');
      await pause('cookies');
      return [
        {
          name: 'secret-cookie',
          value: 'private-cookie',
          domain: '.fanqienovel.com',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
        {
          name: 'other',
          value: 'excluded',
          domain: '.other.invalid',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ];
    },
    browser: () => browser,
    async close() {
      borrowedCloses++;
      events.push('borrowed_closed');
    },
    get request() {
      throw new Error('The primary request client must never be borrowed');
    },
  } as unknown as BrowserContext;
  const page = {
    context: () => borrowed,
    isClosed: () => false,
    url: () => WRITER_HOME,
    async evaluate(fn: unknown) {
      pageTouches++;
      if (String(fn).includes('fetch(url'))
        return { status: 200, ok: true, json: { code: 0, data: { id: ACCOUNT } } };
      return { loginRequired: false, managementVisible: true, ownAccount: { account_id: ACCOUNT } };
    },
    async goto() {
      throw new Error('No navigation is allowed');
    },
    async close() {
      throw new Error('No primary page cleanup is allowed');
    },
  } as unknown as Page;
  const options: NativeShortMetadataApiOptions = {
    mode: 'read',
    expectedOwner: overrides.owner ?? { kind: 'account', id: ACCOUNT },
    deadline: performance.now() + (overrides.deadlineMs ?? 5_000),
    signal: controller.signal,
    assertLease: () => overrides.lease?.(),
    assertBorrowedActive: () => overrides.source?.(),
    onBeforePlatformRead: () => {
      events.push('read_boundary');
      overrides.beforeRead?.();
    },
    onVerifiedAccount: (id, at) => {
      assert.equal(id, ACCOUNT);
      assert.equal(new Date(at).toISOString(), at);
      callbacks++;
      overrides.callback?.();
    },
    onQuarantine: () => {
      quarantines++;
    },
  };
  const run = new OwnedNativeShortMetadataRun(borrowed, overrides.workId ?? WORK, options, factory);
  const session = new BrowserSession({
    profileDir: '/synthetic-no-profile',
    headless: true,
    operationTimeoutMs: 5_000,
  });
  const internals = session as unknown as {
    context: BrowserContext;
    page: Page;
    identityEpoch: number;
    activeNativeShortMetadata: unknown;
    apiQuarantined: boolean;
  };
  internals.context = borrowed;
  internals.page = page;
  const browserOptions = {
    mode: 'read' as const,
    expectedOwner: options.expectedOwner,
    assertLease: options.assertLease,
    onBeforePlatformRead: options.onBeforePlatformRead,
    onVerifiedAccount: options.onVerifiedAccount,
    signal: controller.signal,
  };
  return {
    run,
    options,
    session,
    internals,
    browserOptions,
    factory,
    page,
    calls,
    events,
    controller,
    entered: entered.promise,
    release: () => gate.resolve(),
    connected,
    get callbacks() {
      return callbacks;
    },
    get quarantines() {
      return quarantines;
    },
    get apiCloses() {
      return apiCloses;
    },
    get borrowedCloses() {
      return borrowedCloses;
    },
    get pageTouches() {
      return pageTouches;
    },
    get contextOptions() {
      return contextOptions;
    },
  };
}

export async function withFactory<T>(
  f: Pick<ReturnType<typeof fixture>, 'factory'>,
  run: () => Promise<T>,
): Promise<T> {
  const original = request.newContext;
  request.newContext = f.factory.newContext;
  try {
    return await run();
  } finally {
    request.newContext = original;
  }
}

export function failed(result: NativeShortMetadataApiResult, reason: string) {
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.reason, reason);
  assert.equal(result.snapshot, null);
  assert.equal(result.proof.ownerCallback, false);
  assert.equal(result.cleanup.pendingAtEnd, 0);
}
