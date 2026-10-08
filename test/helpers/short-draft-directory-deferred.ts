import { BrowserSession } from '../../src/platform/browser.js';

import {
  type BrowserContext,
  type APIRequest,
  type APIResponse,
  type APIRequestContext,
} from 'playwright';

import {
  type ShortDraftDirectoryResult,
  type ShortDraftDirectoryOptions,
  OwnedShortDraftDirectoryRun,
} from '../../src/platform/short-draft-directory.js';

import assert from 'node:assert/strict';

export const ACCOUNT = '0001001',
  INPUT = '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';

export const OWN = 'https://fanqienovel.com/api/user/info/v2';

export const listUrl = (index: number) =>
  `https://fanqienovel.com/api/author/short_article/draft_list/v0/?aid=2503&app_name=muye_novel&page_count=10&page_index=${index}&time_sort=0&image_fmt_list=450x800&book_image_fmt_list=190x250&pack_type=1`;

export const RAW = 'PRIVATE_RAW_SENTINEL_body_cookie_token_title_html_query_error';

export const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export type BrowserOptions = Parameters<BrowserSession['runShortDraftDirectory']>[0];

type SessionState = {
  context: BrowserContext | null;
  identityEpoch: number;
  apiQuarantined: boolean;
  activeShortDraftDirectory: { stop(): void; done: Promise<ShortDraftDirectoryResult> } | null;
};

export interface Controls {
  total?: number;
  ids?: string[];
  ownerBefore?: unknown;
  ownerAfter?: unknown;
  mutate?: (data: Record<string, unknown>, kind: 'own' | 'list', index: number) => unknown;
  status?: number;
  responseUrl?: string;
  contentType?: string;
  contentLength?: string;
  bytes?: Buffer;
  bytesKind?: 'own' | 'list';
  cookiesGate?: Promise<void>;
  creationGate?: Promise<void>;
  getGate?: Promise<void>;
  bodyGate?: Promise<void>;
  responseDisposeGate?: Promise<void>;
  sessionDisposeGate?: Promise<void>;
  responseDisposeFails?: boolean;
  sessionDisposeFails?: boolean;
  getFails?: boolean;
  onCreate?: () => void;
  onGet?: (kind: 'own' | 'list', index: number) => void;
}

export function fixture(control: Controls = {}) {
  const calls: string[] = [],
    events: string[] = [];
  let creates = 0,
    cookieCalls = 0,
    borrowedCloses = 0,
    sessionDisposals = 0,
    responseDisposals = 0,
    ownCalls = 0;
  const connected = { value: true };
  const context = {
    browser: () => ({ isConnected: () => connected.value }),
    async cookies(origin: string) {
      assert.equal(origin, 'https://fanqienovel.com');
      cookieCalls++;
      events.push('cookies');
      await control.cookiesGate;
      return [
        {
          name: 'session',
          value: RAW,
          domain: '.fanqienovel.com',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax' as const,
        },
        {
          name: 'foreign',
          value: RAW,
          domain: '.invalid.example',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax' as const,
        },
      ];
    },
    async close() {
      borrowedCloses++;
    },
    get request() {
      throw Error('Primary request client must not be borrowed');
    },
  } as unknown as BrowserContext;
  const factory: Pick<APIRequest, 'newContext'> = {
    async newContext(options) {
      creates++;
      events.push('create-enter');
      control.onCreate?.();
      const state = options?.storageState;
      assert(state && typeof state !== 'string');
      assert.deepEqual(state.origins, []);
      assert.equal(state.cookies.length, 1);
      assert.equal(state.cookies[0]!.domain, '.fanqienovel.com');
      await control.creationGate;
      events.push('created');
      const api = {
        async get(url: string, options: Record<string, unknown>) {
          calls.push(url);
          assert.equal(options.maxRedirects, 0);
          assert.equal(options.maxRetries, 0);
          assert.equal(options.failOnStatusCode, false);
          assert.equal(typeof options.timeout, 'number');
          assert((options.timeout as number) > 0);
          const kind = url === OWN ? 'own' : 'list';
          const index =
            kind === 'list' ? Number(new URL(url).searchParams.get('page_index')) : ownCalls++;
          assert.equal(url, kind === 'own' ? OWN : listUrl(index));
          events.push(`get-${kind}-${index}`);
          control.onGet?.(kind, index);
          await control.getGate;
          if (control.getFails) throw Error(RAW);
          const total = control.total ?? 1,
            ids =
              control.ids ??
              Array.from({ length: Math.min(total, 100) }, (_, i) =>
                (1000000000n + BigInt(i)).toString(),
              );
          const data: Record<string, unknown> =
            kind === 'own'
              ? {
                  id:
                    index === 0
                      ? (control.ownerBefore ?? ACCOUNT)
                      : (control.ownerAfter ?? ACCOUNT),
                  token: RAW,
                }
              : {
                  total_count: total,
                  item_list: ids.slice(index * 10, index * 10 + 10).map((item_id) => ({
                    item_id,
                    title: RAW,
                    body: RAW,
                    content: RAW,
                    thumb_uri: `https://invalid.example/${RAW}`,
                  })),
                  private_unknown: RAW,
                };
          const changed = control.mutate ? control.mutate(data, kind, index) : data;
          const bytes =
            control.bytes && (control.bytesKind === undefined || control.bytesKind === kind)
              ? control.bytes
              : Buffer.from(JSON.stringify({ code: 0, data: changed }));
          const response = {
            status: () => control.status ?? 200,
            url: () => control.responseUrl ?? url,
            headers: () => ({
              'content-type': control.contentType ?? 'application/json; charset=utf-8',
              ...(control.contentLength !== undefined
                ? { 'content-length': control.contentLength }
                : {}),
              authorization: RAW,
            }),
            async body() {
              events.push('body-enter');
              await control.bodyGate;
              return bytes;
            },
            async dispose() {
              events.push('response-dispose-enter');
              await control.responseDisposeGate;
              if (control.responseDisposeFails) throw Error(RAW);
              responseDisposals++;
              events.push('response-disposed');
            },
          };
          return response as unknown as APIResponse;
        },
        async dispose() {
          events.push('session-dispose-enter');
          await control.sessionDisposeGate;
          if (control.sessionDisposeFails) throw Error(RAW);
          sessionDisposals++;
          events.push('session-disposed');
        },
      };
      return api as unknown as APIRequestContext;
    },
  };
  const browser = new BrowserSession({
    profileDir: '/synthetic-short-directory-no-profile',
    headless: true,
    operationTimeoutMs: 5_000,
  });
  const state = browser as unknown as SessionState;
  state.context = context;
  const callbacks = { reads: 0, owners: 0, quarantines: 0, leases: 0, sources: 0 };
  const options: ShortDraftDirectoryOptions = {
    mode: 'read',
    expectedOwner: { kind: 'account', id: ACCOUNT },
    deadline: performance.now() + 5_000,
    assertLease() {
      callbacks.leases++;
    },
    assertBorrowedActive() {
      callbacks.sources++;
    },
    onBeforePlatformRead() {
      callbacks.reads++;
    },
    onVerifiedAccount(id, checkedAt) {
      assert.equal(id, ACCOUNT);
      assert.match(checkedAt, /^\d{4}-\d{2}-\d{2}T/);
      callbacks.owners++;
      events.push('owner-callback');
    },
    onQuarantine() {
      callbacks.quarantines++;
    },
  };
  const browserOptions: BrowserOptions = {
    mode: 'read',
    expectedOwner: { kind: 'account', id: ACCOUNT },
    assertLease: options.assertLease,
    onBeforePlatformRead: options.onBeforePlatformRead,
    onVerifiedAccount: options.onVerifiedAccount,
  };
  return {
    control,
    calls,
    events,
    factory,
    context,
    browser,
    state,
    connected,
    callbacks,
    options,
    browserOptions,
    counts: () => ({ creates, cookieCalls, borrowedCloses, sessionDisposals, responseDisposals }),
    run: (overrides: Partial<ShortDraftDirectoryOptions> = {}) =>
      new OwnedShortDraftDirectoryRun(context, { ...options, ...overrides }, factory).run(),
  };
}
