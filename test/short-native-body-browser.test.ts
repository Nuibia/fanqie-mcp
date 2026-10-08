import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type APIRequest,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
} from 'playwright';
import { BrowserSession, BrowserSessionError } from '../src/platform/browser.js';
import {
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
} from '../src/platform/short-native-metadata.js';
import { nativeShortMetadataFixedReadUrl } from '../src/platform/short-native-metadata-api.js';
import {
  NATIVE_SHORT_BODY_REPRESENTATION,
  type NativeShortBodyWriteRequest,
} from '../src/platform/short-native-body.js';
import {
  type NativeShortBodyApiOptions,
  type NativeShortBodyApiResult,
  type NativeShortBodyBrowserOptions,
} from '../src/platform/short-native-body-api.js';

const WORK = '7000000001',
  ACCOUNT = '0001001';
const FIRST = '甲'.repeat(90),
  SECOND = '乙'.repeat(60),
  THIRD = '丙'.repeat(150);
const SOURCE = `<p>${FIRST}</p><p>${SECOND}</p><p>${THIRD}</p><p></p>`;
const DESIRED = `<p>${FIRST}</p><div data-percentage="0.3" data-fanqie-type="pay_tag" data-min-text="200" data-min-paragraphs="3" data-min-radio="0.3" data-para-nums="3" class="fq-pay-node-animation"></div><p>${SECOND}</p><p>${THIRD}</p><p></p>`;
function edit() {
  return {
    item_id: WORK,
    publish_status: 0,
    content: SOURCE,
    multi_title: ['Synthetic title'],
    thumb_uri: 'synthetic/head',
    book_thumb_uri: 'synthetic/cover',
    category: [{ category_id: 'c1', label: '主类', name: '都市' }],
    sign_type: 1,
    origin_activity_flag: 0,
    latest_version: 7,
    modify_time: '1789450000',
    opaque: { unchanged: ['x', true, null] },
  };
}
function catalog() {
  return { category_list: [{ category_id: 'c1', label: '主类', name: '都市' }], opaque: true };
}
function request(): NativeShortBodyWriteRequest {
  const before = createNativeShortMetadataSnapshot({
    binding: { account: { kind: 'account_id', id: ACCOUNT }, work: { kind: 'short', id: WORK } },
    editData: edit(),
    categoryData: catalog(),
  });
  return {
    expectedSnapshotVersionHash: before.snapshotVersionHash,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedState: 'draft',
    representation: NATIVE_SHORT_BODY_REPRESENTATION,
    paragraphs: [
      { sourceIndex: 0, lines: [FIRST] },
      { sourceIndex: 1, lines: [SECOND] },
      { sourceIndex: 2, lines: [THIRD] },
    ],
    trial: { action: 'set', beforeParagraph: 1 },
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
type FixtureOptions = Omit<
  NativeShortBodyApiOptions,
  'deadline' | 'assertBorrowedActive' | 'onQuarantine'
> & { timeoutMs?: number };
interface Internals {
  context: BrowserContext | null;
  page: unknown;
  queue: Promise<void>;
  identityEpoch: number;
  apiQuarantined: boolean;
  activeNativeShortBody: {
    stop(): void;
    done: Promise<NativeShortBodyApiResult>;
    cleanupDone: Promise<void>;
  } | null;
}
function fixture(
  input: {
    hold?: 'cookies' | 'creation' | 'dispose';
    operationTimeoutMs?: number;
    timeoutMs?: number;
  } = {},
) {
  const session = new BrowserSession({
    profileDir: '/synthetic/body-owned-unused-profile',
    headless: true,
    operationTimeoutMs: input.operationTimeoutMs ?? 5000,
  });
  const state = session as unknown as Internals,
    gate = deferred(),
    entered = deferred(),
    controller = new AbortController();
  const calls: Array<{ method: 'GET' | 'POST'; timeout: number }> = [];
  let connected = true,
    creates = 0,
    disposes = 0,
    cookies = 0,
    borrowedClosed = 0,
    editReads = 0,
    holdUsed = false;
  async function pause(kind: 'cookies' | 'creation' | 'dispose') {
    if (input.hold === kind && !holdUsed) {
      holdUsed = true;
      entered.resolve();
      await gate.promise;
    }
  }
  const context = {
    browser() {
      return { isConnected: () => connected };
    },
    async cookies() {
      cookies++;
      await pause('cookies');
      return [];
    },
    async close() {
      borrowedClosed++;
    },
    async newPage() {
      throw Error('Page creation forbidden');
    },
    get request() {
      throw Error('Shared request forbidden');
    },
  } as unknown as BrowserContext;
  state.context = context;
  state.page = {
    context: () => context,
    isClosed: () => false,
    async goto() {
      throw Error('Navigation forbidden');
    },
  };
  function response(url: string, data?: unknown): APIResponse {
    return {
      url: () => url,
      status: () => 200,
      headers: () => ({ 'content-type': 'application/json' }),
      async body() {
        return Buffer.from(JSON.stringify({ code: 0, ...(data === undefined ? {} : { data }) }));
      },
      async dispose() {},
    } as unknown as APIResponse;
  }
  const api = {
    async get(url: string, options: { timeout: number }) {
      calls.push({ method: 'GET', timeout: options.timeout });
      if (url === nativeShortMetadataFixedReadUrl(WORK, 'own'))
        return response(url, { id: ACCOUNT });
      if (url === nativeShortMetadataFixedReadUrl(WORK, 'list', 0))
        return response(url, { total_count: 1, item_list: [{ item_id: WORK }] });
      if (url === nativeShortMetadataFixedReadUrl(WORK, 'catalog')) return response(url, catalog());
      if (url === nativeShortMetadataFixedReadUrl(WORK, 'edit')) {
        editReads++;
        return response(
          url,
          editReads === 3
            ? { ...edit(), content: DESIRED, latest_version: 8, modify_time: '1789450001' }
            : edit(),
        );
      }
      throw Error('Unexpected endpoint');
    },
    async post(
      url: string,
      options: { timeout: number; data: string; maxRedirects: number; maxRetries: number },
    ) {
      calls.push({ method: 'POST', timeout: options.timeout });
      assert.equal(new URLSearchParams(options.data).get('content'), DESIRED);
      assert.equal(options.maxRedirects, 0);
      assert.equal(options.maxRetries, 0);
      return response(url);
    },
    async dispose() {
      disposes++;
      await pause('dispose');
    },
  } as unknown as APIRequestContext;
  const factory: Pick<APIRequest, 'newContext'> = {
    async newContext() {
      creates++;
      await pause('creation');
      return api;
    },
  };
  const options: FixtureOptions = {
    accountId: 'owner',
    expectedOwner: { kind: 'account', id: ACCOUNT },
    businessRequest: request(),
    signal: controller.signal,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    assertLease() {},
    onBeforePlatformRead() {},
    onVerifiedAccount() {},
  };
  return {
    session,
    state,
    options,
    factory,
    calls,
    controller,
    entered: entered.promise,
    release: () => gate.resolve(),
    disconnect: () => {
      connected = false;
    },
    run: () => session.runNativeShortBodyFixtureUpdate(WORK, options, factory),
    get creates() {
      return creates;
    },
    get disposes() {
      return disposes;
    },
    get cookies() {
      return cookies;
    },
    get borrowedClosed() {
      return borrowedClosed;
    },
  };
}

test('body Browser production hardguard precedes FIFO context cookies and factory', async () => {
  const f = fixture();
  let touches = 0;
  for (const key of ['queue', 'context', 'page'])
    Object.defineProperty(f.session, key, {
      configurable: true,
      get() {
        touches++;
        throw Error('Must not borrow');
      },
      set() {
        touches++;
        throw Error('Must not reserve');
      },
    });
  const options: NativeShortBodyBrowserOptions = { ...f.options, authority: { fake: 'durable' } };
  const result = await f.session.runNativeShortBodyUpdate(WORK, options);
  assert.equal(result.reason, 'production_disabled');
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.verifiedLive, false);
  assert.equal(result.durable, false);
  assert.equal(touches, 0);
  assert.equal(f.creates, 0);
  assert.equal(f.cookies, 0);
  assert.equal(f.calls.length, 0);
});

test('body Browser captures descriptors without getters symbols or mutable aliases', async () => {
  const f = fixture();
  let getters = 0;
  for (const options of [
    Object.defineProperty({ ...f.options }, 'businessRequest', {
      enumerable: true,
      get() {
        getters++;
        return request();
      },
    }),
    { ...f.options, [Symbol('extra')]: 1 },
    { ...f.options, mode: 'live' },
    {
      ...f.options,
      expectedOwner: {
        kind: 'account',
        get id() {
          getters++;
          return ACCOUNT;
        },
      },
    },
  ]) {
    assert.equal(
      (await f.session.runNativeShortBodyFixtureUpdate(WORK, options as FixtureOptions, f.factory))
        .reason,
      'invalid_input',
    );
  }
  assert.equal(getters, 0);
  assert.equal(f.cookies, 0);
  assert.equal(f.creates, 0);
  const signal = new AbortController().signal;
  for (const key of ['aborted', 'addEventListener', 'removeEventListener'])
    Object.defineProperty(signal, key, {
      configurable: true,
      get() {
        getters++;
        throw Error('Signal override forbidden');
      },
    });
  f.options.signal = signal;
  const waiting = deferred();
  f.state.queue = waiting.promise;
  const owner = f.options.expectedOwner;
  const running = f.run();
  owner.id = '9999';
  f.options.businessRequest = { ...request(), expectedSnapshotVersionHash: '0'.repeat(64) };
  f.options.onVerifiedAccount = () => {
    throw Error('Mutated callback forbidden');
  };
  waiting.resolve();
  assert.equal((await running).status, 'fixture_complete');
  assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
  assert.equal(getters, 0);
  await f.session.close();
});

test('body Browser explicit fixture path threads caller timeout and config fallback', async () => {
  for (const input of [
    { operationTimeoutMs: 4500 },
    { operationTimeoutMs: 4500, timeoutMs: 2500 },
  ]) {
    const f = fixture(input),
      result = await f.run();
    assert.equal(result.status, 'fixture_complete');
    const limit = input.timeoutMs ?? input.operationTimeoutMs;
    assert.equal(f.calls.length, 16);
    assert(f.calls.every((call) => call.timeout > 0 && call.timeout <= limit));
    await f.session.close();
  }
  const f = fixture();
  const missing = await f.session.runNativeShortBodyFixtureUpdate(
    WORK,
    f.options,
    undefined as unknown as Pick<APIRequest, 'newContext'>,
  );
  assert.equal(missing.reason, 'invalid_input');
  assert.equal(f.cookies, 0);
  assert.equal(f.creates, 0);
  for (const timeoutMs of [0, NaN, Infinity, 2_147_483_648])
    assert.equal(
      (
        await f.session.runNativeShortBodyFixtureUpdate(
          WORK,
          { ...f.options, timeoutMs },
          f.factory,
        )
      ).reason,
      'invalid_input',
    );
  await f.session.close();
});

test('body Browser installs active handle before the first awaited cookies operation', async () => {
  const f = fixture({ hold: 'cookies' }),
    running = f.run();
  await f.entered;
  assert(f.state.activeNativeShortBody);
  assert.equal(f.creates, 0);
  assert.equal(f.calls.length, 0);
  const closing = f.session.close();
  assert.equal(f.borrowedClosed, 0);
  f.release();
  const result = await running;
  assert.equal(result.reason, 'cancelled');
  await closing;
  assert.equal(f.creates, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(f.borrowedClosed, 1);
  assert.equal(f.state.activeNativeShortBody, null);
});

test('body Browser close retains borrowed context when owned cleanup remains pending', async () => {
  const f = fixture({ hold: 'dispose' }),
    running = f.run();
  await f.entered;
  const active = f.state.activeNativeShortBody;
  assert(active);
  assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
  const originalTimeout = globalThis.setTimeout;
  // Only shorten the Browser shutdown grace in this negative. The caller/config operation deadline is untouched.
  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ) => originalTimeout(callback, ms === 25_000 ? 2 : ms, ...args)) as typeof setTimeout;
  try {
    await assert.rejects(
      () => f.session.close(),
      (error: unknown) =>
        error instanceof BrowserSessionError && error.code === 'shutdown_incomplete',
    );
    const result = await running;
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.cleanup.pendingAtEnd > 0, true);
    assert.equal(result.cleanup.sessionDisposed, false);
    assert.equal(f.borrowedClosed, 0);
    assert(f.state.activeNativeShortBody);
  } finally {
    globalThis.setTimeout = originalTimeout;
    f.release();
  }
  await active.cleanupDone;
  assert.equal(f.disposes, 1);
  assert.equal(f.borrowedClosed, 0);
  assert.equal(f.calls.filter((call) => call.method === 'POST').length, 1);
});

test('body Browser fixture FIFO checks identity epoch and quarantine before client work', async () => {
  for (const state of ['quarantine', 'closed', 'disconnected'] as const) {
    const f = fixture(),
      waiting = deferred();
    f.state.queue = waiting.promise;
    const running = f.run();
    if (state === 'quarantine') f.state.apiQuarantined = true;
    if (state === 'closed') {
      const closed = f.session as unknown as { closed: boolean };
      closed.closed = true;
    }
    if (state === 'disconnected') f.disconnect();
    waiting.resolve();
    assert.equal(
      (await running).reason,
      state === 'quarantine'
        ? 'cleanup_failed'
        : state === 'closed'
          ? 'cancelled'
          : 'context_unavailable',
    );
    assert.equal(f.creates, 0);
    assert.equal(f.cookies, 0);
  }
  const changed = fixture({ hold: 'creation' }),
    running = changed.run();
  await changed.entered;
  changed.state.identityEpoch++;
  changed.release();
  const result = await running;
  assert.equal(result.reason, 'source_changed');
  assert.equal(changed.calls.length, 0);
  assert.equal(changed.creates, 1);
  assert.equal(changed.disposes, 1);
  await changed.session.close();
});
