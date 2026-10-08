import assert from 'node:assert/strict';

import { shortMetadataApiListUrl } from '../../src/platform/short-metadata-api-schema.js';

import { request } from 'playwright';

import { BrowserSession } from '../../src/platform/browser.js';

// FQ-12-SHORT-METADATA-API-SCHEMA: no browser frontend/transport fallbacks.
export const metadataApiSchema_WORK = '8545000000000000001',
  metadataApiSchema_ACCOUNT = '1001',
  metadataApiSchema_OWN = 'https://fanqienovel.com/api/user/info/v2';

export const metadataApiSchema_pause = () => new Promise<void>((resolve) => setImmediate(resolve));

export function metadataApiSchema_apiSchemaDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

export function metadataApiSchema_rows(total: number) {
  return Array.from({ length: total }, (_, i) => ({
    item_id: String(8545000000000000001n + BigInt(i)),
    category: [{ category_id: 'PRIVATE-CATEGORY', name: 'PRIVATE-NAME', label: 'PRIVATE-LABEL' }],
    thumb_uri: 'PRIVATE-COVER',
    thumb_url_list: ['PRIVATE-URL'],
    book_thumb_uri: null,
    book_thumb_url_list: [],
    body: 'PRIVATE-BODY',
    title: 'PRIVATE-TITLE',
  }));
}

export function metadataApiSchema_fixture(
  options: {
    total?: number;
    listData?: (page: number) => unknown;
    targetAbsent?: boolean;
    ownerChanged?: boolean;
    badOwn?: boolean;
    redirect?: boolean;
    wrongUrl?: boolean;
    badContentType?: boolean;
    oversize?: boolean;
    declaredOversize?: boolean;
    codeFailure?: boolean;
    getReject?: boolean;
    responseDisposeFail?: boolean;
    sessionDisposeFail?: boolean;
    callbackFail?: boolean;
    cookieGate?: Promise<void>;
    createGate?: Promise<void>;
    getGate?: Promise<void>;
    bodyGate?: Promise<void>;
    responseDisposeGate?: Promise<void>;
    sessionDisposeGate?: Promise<void>;
  } = {},
) {
  const allRows = metadataApiSchema_rows(options.total ?? 11);
  if (options.targetAbsent) allRows[0]!.item_id = '9545000000000000001';
  const stats = {
    cookies: 0,
    created: 0,
    state: null as any,
    gets: [] as string[],
    bodies: 0,
    responseDispose: 0,
    sessionDispose: 0,
    callback: 0,
    beforeRead: 0,
    primaryClose: 0,
    primaryReads: 0,
    pages: 0,
  };
  let connected = true,
    ownCalls = 0;
  const api = {
    async get(url: string, opts: any) {
      assert.equal(opts.maxRedirects, 0);
      assert.equal(opts.maxRetries, 0);
      assert(opts.timeout > 0);
      assert.deepEqual(Object.keys(opts).sort(), ['maxRedirects', 'maxRetries', 'timeout']);
      stats.gets.push(url);
      const isOwn = url === metadataApiSchema_OWN,
        page = isOwn ? -1 : Number(new URL(url).searchParams.get('page_index'));
      if (!isOwn) {
        assert.equal(url, shortMetadataApiListUrl(page));
        if (options.getGate) await options.getGate;
        if (options.getReject) throw Error('PRIVATE HTTP FAILURE');
      } else ownCalls++;
      const data = isOwn
        ? {
            id: options.badOwn
              ? 1001
              : options.ownerChanged && ownCalls === 2
                ? '2001'
                : metadataApiSchema_ACCOUNT,
          }
        : options.listData
          ? options.listData(page)
          : {
              total_count: options.total ?? 11,
              item_list: allRows.slice(page * 10, page * 10 + 10),
            };
      return {
        url: () => (!isOwn && options.wrongUrl ? url + '&PRIVATE=1' : url),
        status: () => (!isOwn && options.redirect ? 303 : 200),
        headers: () => ({
          'content-type':
            !isOwn && options.badContentType ? 'text/html' : 'application/json; charset=utf-8',
          ...(!isOwn && options.declaredOversize
            ? { 'content-length': String(4 * 1024 * 1024) }
            : {}),
        }),
        body: async () => {
          stats.bodies++;
          if (!isOwn && options.bodyGate) await options.bodyGate;
          return !isOwn && options.oversize
            ? Buffer.alloc(3 * 1024 * 1024 + 1)
            : Buffer.from(JSON.stringify({ code: !isOwn && options.codeFailure ? 1 : 0, data }));
        },
        dispose: async () => {
          stats.responseDispose++;
          if (!isOwn && options.responseDisposeGate) await options.responseDisposeGate;
          if (!isOwn && options.responseDisposeFail) throw Error('PRIVATE DISPOSE FAILURE');
        },
      };
    },
    dispose: async () => {
      stats.sessionDispose++;
      if (options.sessionDisposeGate) await options.sessionDisposeGate;
      if (options.sessionDisposeFail) throw Error('PRIVATE SESSION DISPOSE FAILURE');
    },
  };
  const primary = {
    browser: () => ({ isConnected: () => connected }),
    cookies: async (url: string) => {
      stats.cookies++;
      assert.equal(url, 'https://fanqienovel.com');
      if (options.cookieGate) await options.cookieGate;
      return [
        {
          name: 'session',
          value: 'PRIVATE-COOKIE',
          domain: '.fanqienovel.com',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
        {
          name: 'other',
          value: 'PRIVATE-FOREIGN',
          domain: '.evil.invalid',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ];
    },
    close: async () => {
      stats.primaryClose++;
      connected = false;
    },
    newPage: async () => {
      stats.pages++;
      throw Error('API fixture forbids pages');
    },
  };
  const original = request.newContext;
  request.newContext = (async (state: any) => {
    stats.created++;
    stats.state = state;
    if (options.createGate) await options.createGate;
    return api;
  }) as unknown as typeof request.newContext;
  const session = new BrowserSession({
    profileDir: '/synthetic/never-read-api-profile',
    headless: true,
    operationTimeoutMs: 5000,
  });
  (session as any).context = primary;
  (session as any).page = { isClosed: () => false, context: () => primary };
  const call = (signal?: AbortSignal, timeoutMs?: number) =>
    session.diagnoseShortMetadataApiSchema(metadataApiSchema_WORK, {
      signal,
      timeoutMs,
      expectedAccountId: metadataApiSchema_ACCOUNT,
      assertLease: () => {},
      onBeforePlatformRead: () => {
        stats.beforeRead++;
      },
      onVerifiedAccount: () => {
        stats.callback++;
        if (options.callbackFail) throw Error('PRIVATE CALLBACK FAILURE');
      },
    });
  const next = () =>
    session.read(async () => {
      stats.primaryReads++;
      return 'next';
    });
  const close = async () => {
    request.newContext = original;
    (session as any).apiQuarantined = false;
    await session.close();
  };
  return { stats, session, call, next, close };
}
