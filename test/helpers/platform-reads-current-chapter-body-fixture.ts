import {
  currentDirectoryFixture,
  CURRENT_CHAPTER_ITEM,
  CURRENT_CHAPTER_VOLUME,
  CURRENT_DIRECTORY_CHAPTER,
} from './platform-reads-assert-context-probe-safe.js';

import { managementDirectoryFixture } from './platform-reads-management-directory-fixture.js';

import { type Page } from 'playwright';

import assert from 'node:assert/strict';

import { CANONICAL_OWN_USER_URL, BrowserSession } from '../../src/platform/browser.js';

import { CHAPTER_ENTRY_FIXTURE_WORK } from './platform-reads-chapter-entry-fixture-work.js';

import { shortMetadataDocument } from '../../src/platform/short-metadata-schema.js';

/** Synthetic response adapter; the public candidate is never treated as a natural source. */
export function currentChapterBodyFixture(
  options: {
    targetLaterVolume?: boolean;
    directory?: Parameters<typeof currentDirectoryFixture>[0];
    patch?: Record<string, unknown>;
    code?: number;
    status?: number;
    responseUrl?: string;
    transportError?: boolean;
    jsonError?: boolean;
    disposeError?: boolean;
    duringGet?: () => Promise<void> | void;
    duringJson?: () => Promise<void> | void;
    duringDispose?: () => Promise<void> | void;
  } = {},
) {
  const fixture = options.targetLaterVolume
    ? managementDirectoryFixture({ onePage: true })
    : currentDirectoryFixture(options.directory);
  const chapterId = options.targetLaterVolume ? '7800000000000000003' : CURRENT_CHAPTER_ITEM;
  const volumeId = options.targetLaterVolume ? '7700000000000000002' : CURRENT_CHAPTER_VOLUME;
  const rawContent = '<p>Synthetic body\r\n</p><p></p>  ';
  const context = fixture.page.context(),
    get = context.request.get.bind(context.request);
  let bodyGets = 0,
    bodyDisposals = 0,
    ownGets = 0,
    ownDisposals = 0,
    canonicalGotos = 0,
    canonicalDetaches = 0;
  const newCdp = context.newCDPSession.bind(context);
  context.newCDPSession = async (target) => {
    const cdp = await newCdp(target),
      detach = cdp.detach.bind(cdp);
    cdp.detach = async () => {
      canonicalDetaches++;
      await detach();
    };
    return cdp;
  };
  const goto = fixture.page.goto.bind(fixture.page);
  fixture.page.goto = (async (url: string, callOptions) => {
    if (url !== 'https://fanqienovel.com/main/writer/book-manage') canonicalGotos++;
    return goto(url, callOptions);
  }) as Page['goto'];
  const candidates: string[] = [];
  let bodyRoute: ((route: unknown) => Promise<void>) | null = null,
    routeAborts = 0,
    routeForwards = 0;
  const installRoute = fixture.page.route.bind(fixture.page);
  fixture.page.route = (async (pattern: unknown, handler: (route: unknown) => Promise<void>) => {
    bodyRoute = handler;
    return installRoute(pattern as never, handler as never);
  }) as Page['route'];
  const invokeBodyRoute = (
    input: {
      method?: string;
      navigation?: boolean | 'unknown';
      continue?: () => Promise<void>;
      abort?: () => Promise<void>;
    } = {},
  ) => {
    assert(bodyRoute);
    const request = fixture.request(CURRENT_DIRECTORY_CHAPTER, input.method ?? 'GET');
    request.isNavigationRequest = (() =>
      input.navigation === 'unknown'
        ? undefined
        : (input.navigation ?? false)) as unknown as typeof request.isNavigationRequest;
    return bodyRoute({
      request: () => request,
      async continue() {
        routeForwards++;
        if (input.continue) await input.continue();
      },
      async abort() {
        routeAborts++;
        if (input.abort) await input.abort();
      },
    });
  };
  context.request.get = (async (url: string, callOptions) => {
    if (url === CANONICAL_OWN_USER_URL) {
      ownGets++;
      const response = await get(url, callOptions),
        dispose = response.dispose.bind(response);
      response.dispose = async () => {
        ownDisposals++;
        await dispose();
      };
      return response;
    }
    if (new URL(url).pathname !== '/api/author/edit_article/v0/') return get(url, callOptions);
    assert.equal(ownGets, 1);
    assert.equal(ownDisposals, 1);
    assert.ok(
      fixture.calls.some(
        (call) => new URL(call.url).pathname === '/api/author/chapter/chapter_list/v1',
      ),
    );
    bodyGets++;
    candidates.push(url);
    if (options.duringGet) await options.duringGet();
    if (options.transportError) throw Error('PRIVATE_BODY_TRANSPORT_TOKEN');
    const response = await get(url, callOptions),
      dispose = response.dispose.bind(response);
    response.status = () => options.status ?? 200;
    response.ok = () => (options.status ?? 200) >= 200 && (options.status ?? 200) < 300;
    response.url = () => options.responseUrl ?? url;
    response.json = async () => {
      if (options.duringJson) await options.duringJson();
      if (options.jsonError) throw Error('PRIVATE_BODY_JSON');
      return {
        code: options.code ?? 0,
        data: {
          book_id: CHAPTER_ENTRY_FIXTURE_WORK,
          item_id: chapterId,
          volume_id: volumeId,
          title: 'Synthetic author edit title',
          content: rawContent,
          publish_status: 2,
          creation_status: 0,
          latest_version: 7,
          unknown_field: 'PRIVATE_BODY_UNKNOWN',
          ...options.patch,
        },
      };
    };
    response.dispose = async () => {
      bodyDisposals++;
      await dispose();
      if (options.duringDispose) await options.duringDispose();
      if (options.disposeError) throw Error('PRIVATE_BODY_DISPOSAL');
    };
    return response;
  }) as typeof context.request.get;
  const call = (
    extra: Partial<Parameters<BrowserSession['collectCurrentChapterBody']>[3]> = {},
    requested = chapterId,
  ) =>
    fixture.session.withPage(
      (page) =>
        fixture.session.collectCurrentChapterBody(page, CHAPTER_ENTRY_FIXTURE_WORK, requested, {
          timeoutMs: 500,
          jobId: '12345678-1234-1234-1234-123456789abc',
          expectedOwner: { kind: 'account', id: '1001' },
          onVerifiedOwner: (state) => fixture.identities.push(state),
          ...extra,
        }),
      { signal: extra.signal },
    );
  return Object.defineProperties(
    Object.assign(fixture, { call, chapterId, volumeId, rawContent, candidates, invokeBodyRoute }),
    {
      bodyGets: { get: () => bodyGets },
      bodyDisposals: { get: () => bodyDisposals },
      routeAborts: { get: () => routeAborts },
      routeForwards: { get: () => routeForwards },
      ownGetCount: { get: () => ownGets },
      ownDisposals: { get: () => ownDisposals },
      gotos: { get: () => canonicalGotos },
      detachCount: { get: () => canonicalDetaches },
    },
  ) as unknown as typeof fixture & {
    call: typeof call;
    invokeBodyRoute: typeof invokeBodyRoute;
    chapterId: string;
    volumeId: string;
    rawContent: string;
    candidates: string[];
    readonly bodyGets: number;
    readonly bodyDisposals: number;
    readonly routeAborts: number;
    readonly routeForwards: number;
  };
}

// FQ-12-SHORT-METADATA-SCHEMA: owned isolation and fixed DTO regression fixtures.
export const metadataSchema_WORK = '8545000000000000001',
  metadataSchema_ACCOUNT = '1001',
  metadataSchema_OWN = 'https://fanqienovel.com/api/user/info/v2';

export const metadataSchema_DOC = shortMetadataDocument(metadataSchema_WORK),
  metadataSchema_EDIT = `https://fanqienovel.com/api/author/short_article/edit/v1/?item_id=${metadataSchema_WORK}&aid=1967`;

export const metadataSchema_tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export function metadataSchema_shortMetadataDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

export interface metadataSchema_ShortMetadataAliasFixture {
  sourceUrl?: string;
  method?: string;
  type?: string;
  child?: boolean;
  navigation?: boolean;
  redirected?: boolean;
  omitPageRequest?: boolean;
  omitNetwork?: boolean;
  duplicateNetwork?: boolean;
  routeRequestMismatch?: boolean;
  responseRequestMismatch?: boolean;
  pauseUrl?: string;
  pauseNetworkId?: string;
  pauseStatus?: number;
  responseUrl?: string;
  duplicateResponse?: boolean;
  omitResponse?: boolean;
  duplicateSource?: boolean;
  unrouted?: boolean;
  lateDuplicateNetwork?: boolean;
}
