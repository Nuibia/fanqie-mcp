import {
  type ContextOwnFixture,
  type ContextBlockedFixture,
  CONTEXT_PROBE_REF,
  CONTEXT_PROBE_TARGET,
  CONTEXT_PROBE_SOURCE,
} from './platform-reads-legacy-chapter-application-fixture.js';

import { fakeBrowser } from './platform-reads-metrics-page.js';

import { type Page, type BrowserContext } from 'playwright';

import { type LoginState, CANONICAL_OWN_USER_URL } from '../../src/platform/browser.js';

import assert from 'node:assert/strict';

export function contextVolumeProbeFixture(
  options: {
    sources?: Array<{
      url: string;
      method?: string;
      subframe?: boolean;
      old?: boolean;
      cdp?: Record<string, unknown>;
    }>;
    duringCdpInitialize?: () => void;
    duringDetach?: () => Promise<void> | void;
    afterCdpClose?: () => Promise<void> | void;
    detachError?: boolean;
    cdpUnavailable?: boolean;
    bootstrapQuery?: boolean;
    reloadSameUrl?: boolean;
    ownerMismatch?: boolean;
    ownerAfter?: boolean;
    ownerKind?: 'account' | 'author';
    initialDocumentBeforeStart?: boolean;
    repeatInitialStart?: boolean;
    initialStartOverride?: { loaderId?: string; url?: string };
    initialSameDocument?: boolean;
    initialStarts?: Array<{ loaderId?: string; url?: string; navigationType: string }>;
    ownBefore?: ContextOwnFixture;
    ownAfter?: ContextOwnFixture;
    responseStatus?: number;
    responseUrl?: string;
    json?: unknown;
    jsonError?: boolean;
    transportError?: boolean;
    disposeError?: boolean;
    directoryReplies?: Record<string, unknown>;
    duringBootstrap?: () => Promise<void> | void;
    duringGet?: () => Promise<void> | void;
    cleanupNavigation?: 'unroute' | 'dispose';
    blockedRequest?: ContextBlockedFixture;
    blockedRequests?: ContextBlockedFixture[];
    cleanupBlockedRequest?: ContextBlockedFixture;
    contextMismatch?: boolean;
  } = {},
) {
  const { session, pages } = fakeBrowser();
  const page = pages[0]!;
  const context = page.context();
  const mainFrame = {} as ReturnType<Page['mainFrame']>;
  page.mainFrame = () => mainFrame;
  const internals = session as unknown as {
    diagnosticTargets: Map<string, string>;
    discoveredStableTargets: Set<string>;
    chapterTargetOwners: Map<string, { kind: 'account' | 'author'; id: string }>;
    observeIdentity(page: Page): void;
    verifyCurrentAccount(page: Page): Promise<LoginState>;
    waitForWriterReady(page: Page, timeout: number): Promise<boolean>;
  };
  internals.diagnosticTargets.set(CONTEXT_PROBE_REF, CONTEXT_PROBE_TARGET);
  internals.discoveredStableTargets.add(
    new URL(CONTEXT_PROBE_TARGET).origin + new URL(CONTEXT_PROBE_TARGET).pathname,
  );
  internals.chapterTargetOwners.set(CONTEXT_PROBE_REF, {
    kind: options.ownerKind ?? 'account',
    id: options.ownerMismatch ? '1002' : '1001',
  });
  let currentUrl = 'https://fanqienovel.com/main/writer/book-manage',
    ownCalls = 0,
    getCount = 0,
    disposals = 0,
    disposedAt = 0,
    gotos = 0,
    blocked = 0,
    ownGetCount = 0,
    ownDisposals = 0;
  const calls: Array<{ url: string; options: unknown }> = [],
    ownContextCalls: Array<{ url: string; options: unknown }> = [],
    apiOrder: string[] = [],
    events = new Map<string, Set<(value: unknown) => void>>();
  const cdpEvents = new Map<string, Set<(value: any) => void>>();
  const cdpRoot = 'SYNTHETIC_ROOT_FRAME';
  let currentLoader = 'SYNTHETIC_INITIAL_LOADER',
    cdpRequests = 0,
    detachCount = 0;
  const emitCdp = (name: string, value: unknown) => {
    for (const fn of cdpEvents.get(name) ?? []) fn(value);
  };
  const emit = (name: string, value: unknown) => {
    for (const fn of events.get(name) ?? []) fn(value);
  };
  const request = (
    url: string,
    method = 'GET',
    navigation = false,
    subframe = false,
    resource = 'xhr',
  ) => ({
    url: () => url,
    method: () => method,
    isNavigationRequest: () => navigation,
    resourceType: () => (navigation ? 'document' : resource),
    frame: () => (subframe ? 'child_frame' : page.mainFrame()),
  });
  page.on = ((name: string, fn: (value: unknown) => void) => {
    const set = events.get(name) ?? new Set();
    set.add(fn);
    events.set(name, set);
    return page;
  }) as typeof page.on;
  page.off = ((name: string, fn: (value: unknown) => void) => {
    events.get(name)?.delete(fn);
    return page;
  }) as typeof page.off;
  page.url = () => currentUrl;
  internals.observeIdentity(page);
  internals.verifyCurrentAccount = async () => {
    ownCalls += 1;
    return {
      status: 'authenticated',
      checkedAt: '2026-10-03T00:00:00.000Z',
      sourceUrl: CANONICAL_OWN_USER_URL,
      identity: {
        accountId: '1001',
        authorId: options.ownerKind === 'author' ? '1001' : null,
        displayName: 'PRIVATE_PROBE_OWNER',
        evidenceSource: CANONICAL_OWN_USER_URL,
      },
    };
  };
  internals.waitForWriterReady = async () => true;
  let guard: ((route: unknown) => Promise<void>) | null = null;
  page.route = (async (_pattern: unknown, fn: (route: unknown) => Promise<void>) => {
    guard = fn;
  }) as unknown as Page['route'];
  page.unroute = (async () => {
    if (options.cleanupBlockedRequest) await triggerBlocked(options.cleanupBlockedRequest);
    if (options.cleanupNavigation === 'unroute') emit('request', request(currentUrl, 'GET', true));
    guard = null;
  }) as Page['unroute'];
  const triggerBlocked = async (input: ContextBlockedFixture) => {
    if (!guard) throw Error('Fixture requires the read-only route guard');
    const source = request(
      input.url,
      input.method,
      input.navigation === true,
      input.subframe,
      input.resourceType,
    );
    if (input.navigation === 'unknown')
      source.isNavigationRequest = (() =>
        undefined) as unknown as typeof source.isNavigationRequest;
    await guard({
      request: () => source,
      async abort() {
        blocked += 1;
        if (input.abortError) throw Error('PRIVATE_ABORT_ERROR?token=PRIVATE_PROBE_TOKEN');
      },
      async continue() {
        assert.fail('A forbidden request must not continue');
      },
    });
  };
  const emitSource = (source: {
    url: string;
    method?: string;
    subframe?: boolean;
    cdp?: Record<string, unknown>;
  }) => {
    emit('request', request(source.url, source.method, false, source.subframe));
    emitCdp('Network.requestWillBeSent', {
      requestId: `SYNTHETIC_REQUEST_${++cdpRequests}`,
      loaderId: currentLoader,
      frameId: source.subframe ? 'SYNTHETIC_CHILD_FRAME' : cdpRoot,
      type: 'XHR',
      request: { url: source.url, method: source.method ?? 'GET' },
      ...source.cdp,
    });
  };
  const emitDocument = (url: string, newLoader: string) =>
    emitCdp('Network.requestWillBeSent', {
      requestId: `SYNTHETIC_DOCUMENT_${++cdpRequests}`,
      frameId: cdpRoot,
      loaderId: newLoader,
      type: 'Document',
      request: { url, method: 'GET' },
    });
  const commitDocument = (url: string, newLoader: string) => {
    currentUrl = url;
    currentLoader = newLoader;
    emitCdp('Page.frameNavigated', { frame: { id: cdpRoot, loaderId: currentLoader, url } });
    emit('framenavigated', page.mainFrame());
  };
  const emitNewDocument = (url: string, newLoader: string, initial = false) => {
    emit('request', request(url, 'GET', true));
    const start = () =>
      emitCdp('Page.frameStartedNavigating', {
        frameId: cdpRoot,
        loaderId: initial ? (options.initialStartOverride?.loaderId ?? newLoader) : newLoader,
        url: initial ? (options.initialStartOverride?.url ?? url) : url,
        navigationType: 'differentDocument',
      });
    const document = () => emitDocument(url, newLoader);
    if (initial && options.initialDocumentBeforeStart) {
      document();
      start();
    } else {
      start();
      document();
    }
    if (initial && options.repeatInitialStart) start();
    commitDocument(url, newLoader);
  };
  const emitWithinDocument = (url: string, start = true) => {
    if (start)
      emitCdp('Page.frameStartedNavigating', {
        frameId: cdpRoot,
        loaderId: currentLoader,
        url,
        navigationType: 'historySameDocument',
      });
    currentUrl = url;
    emitCdp('Page.navigatedWithinDocument', { frameId: cdpRoot, url });
    emit('framenavigated', page.mainFrame());
  };
  const fakeCdp = {
    on(name: string, fn: (value: any) => void) {
      const set = cdpEvents.get(name) ?? new Set();
      set.add(fn);
      cdpEvents.set(name, set);
      return fakeCdp;
    },
    off(name: string, fn: (value: any) => void) {
      cdpEvents.get(name)?.delete(fn);
      return fakeCdp;
    },
    async send(name: string) {
      if (name === 'Page.enable' && options.duringCdpInitialize) options.duringCdpInitialize();
      if (name === 'Page.getFrameTree')
        return { frameTree: { frame: { id: cdpRoot, loaderId: currentLoader, url: currentUrl } } };
      assert.ok(['Page.enable', 'Network.enable'].includes(name));
      return {};
    },
    async detach() {
      detachCount += 1;
      if (options.duringDetach) await options.duringDetach();
      if (options.detachError) throw Error('PRIVATE_CDP_DETACH_ERROR');
      emitCdp('close', fakeCdp);
      if (options.afterCdpClose) await options.afterCdpClose();
    },
  };
  Object.assign(context, {
    async newCDPSession(candidate: Page) {
      assert.equal(candidate, page);
      if (options.cdpUnavailable) throw Error('PRIVATE_CDP_ATTACH_ERROR');
      return fakeCdp;
    },
  });
  page.goto = (async (url: string) => {
    gotos += 1;
    for (const source of options.sources ?? [{ url: CONTEXT_PROBE_SOURCE }])
      if (source.old) emitSource(source);
    for (const start of options.initialStarts ?? [])
      emitCdp('Page.frameStartedNavigating', {
        frameId: cdpRoot,
        loaderId: start.loaderId ?? currentLoader,
        url: start.url ?? url,
        navigationType: start.navigationType,
      });
    if (options.initialSameDocument) emitWithinDocument(url);
    else emitNewDocument(url, 'SYNTHETIC_TARGET_LOADER', true);
    for (const source of options.sources ?? [{ url: CONTEXT_PROBE_SOURCE }])
      if (!source.old) emitSource(source);
    for (const blockedRequest of options.blockedRequests ??
      (options.blockedRequest ? [options.blockedRequest] : []))
      await triggerBlocked(blockedRequest);
    if (options.reloadSameUrl) emitNewDocument(url, 'SYNTHETIC_RELOAD_LOADER');
    return null;
  }) as Page['goto'];
  page.waitForLoadState = (async () => {
    if (options.bootstrapQuery) emitWithinDocument(`${CONTEXT_PROBE_TARGET}&tab=0`);
    if (options.duringBootstrap) await options.duringBootstrap();
  }) as Page['waitForLoadState'];
  page.evaluate = (async () => {
    throw new Error('The context experiment cannot call page fetch or read DOM bodies');
  }) as Page['evaluate'];
  const api = {
    async get(url: string, callOptions: Record<string, unknown>) {
      assert.deepEqual(
        Object.keys(callOptions).sort(),
        [
          'failOnStatusCode',
          'maxRedirects',
          'maxRetries',
          'timeout',
          ...(callOptions.signal ? ['signal'] : []),
        ].sort(),
      );
      assert.equal(callOptions.maxRedirects, 0);
      assert.equal(callOptions.maxRetries, 0);
      assert.equal(callOptions.failOnStatusCode, false);
      assert.ok(Number(callOptions.timeout) > 0 && Number(callOptions.timeout) <= 12_000);
      if (url === CANONICAL_OWN_USER_URL) {
        ownGetCount += 1;
        ownContextCalls.push({ url, options: callOptions });
        apiOrder.push('own_get');
        const fixture = ownGetCount === 1 ? (options.ownBefore ?? {}) : (options.ownAfter ?? {});
        if (fixture.duringGet) await fixture.duringGet();
        if (fixture.transportError)
          throw Error('PRIVATE_OWN_TRANSPORT_ERROR?token=PRIVATE_PROBE_TOKEN');
        const status = fixture.responseStatus ?? 200;
        return {
          url: () => fixture.responseUrl ?? url,
          status: () => status,
          ok: () => status >= 200 && status < 300,
          async json() {
            if (fixture.duringJson) await fixture.duringJson();
            if (fixture.jsonError) throw Error('PRIVATE_OWN_JSON_ERROR');
            return (
              fixture.json ?? {
                code: 0,
                data: {
                  id: options.ownerAfter && getCount ? '1002' : '1001',
                  name: 'PRIVATE_PROBE_OWNER',
                },
              }
            );
          },
          async dispose() {
            ownDisposals += 1;
            apiOrder.push('own_dispose');
            if (fixture.duringDispose) await fixture.duringDispose();
            if (fixture.disposeError) throw Error('PRIVATE_OWN_DISPOSE_ERROR');
          },
        };
      }
      getCount += 1;
      calls.push({ url, options: callOptions });
      apiOrder.push('volume_get');
      if (options.duringGet) await options.duringGet();
      if (options.transportError)
        throw new Error('PRIVATE_API_ERROR https://fanqienovel.com/?token=PRIVATE_PROBE_TOKEN');
      const status = options.responseStatus ?? 200;
      return {
        url: () => options.responseUrl ?? url,
        status: () => status,
        ok: () => status >= 200 && status < 300,
        async json() {
          if (options.jsonError) throw new Error('PRIVATE_HTML_RESPONSE_BODY');
          return (
            options.directoryReplies?.[url] ??
            options.json ?? {
              code: 0,
              data: {
                volume_list: [
                  { volume_id: '7700000000000000001', item_count: 0, content: 'PRIVATE_API_BODY' },
                ],
              },
            }
          );
        },
        async dispose() {
          disposals += 1;
          apiOrder.push('volume_dispose');
          if (options.cleanupNavigation === 'dispose')
            emit('request', request(currentUrl, 'GET', true));
          disposedAt = Date.now();
          if (options.disposeError) throw new Error('PRIVATE_DISPOSAL_ERROR');
        },
      };
    },
  };
  Object.assign(context, { request: api });
  if (options.contextMismatch) page.context = () => ({}) as BrowserContext;
  return {
    session,
    page,
    calls,
    ownContextCalls,
    apiOrder,
    listenerCount(name: string) {
      return events.get(name)?.size ?? 0;
    },
    cdpListenerCount(name: string) {
      return cdpEvents.get(name)?.size ?? 0;
    },
    emit,
    emitCdp,
    emitSource,
    emitNewDocument,
    emitDocument,
    commitDocument,
    emitWithinDocument,
    cdpRoot,
    request,
    triggerBlocked,
    get currentLoader() {
      return currentLoader;
    },
    get detachCount() {
      return detachCount;
    },
    setUrl(value: string) {
      currentUrl = value;
    },
    get getCount() {
      return getCount;
    },
    get ownCalls() {
      return ownCalls;
    },
    get ownGetCount() {
      return ownGetCount;
    },
    get ownDisposals() {
      return ownDisposals;
    },
    get disposals() {
      return disposals;
    },
    get disposedAt() {
      return disposedAt;
    },
    get gotos() {
      return gotos;
    },
    get blocked() {
      return blocked;
    },
    get guarded() {
      return guard !== null;
    },
  };
}
