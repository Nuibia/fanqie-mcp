import {
  type metadataSchema_ShortMetadataAliasFixture,
  metadataSchema_DOC,
  metadataSchema_tick,
  metadataSchema_EDIT,
  metadataSchema_OWN,
  metadataSchema_ACCOUNT,
  metadataSchema_WORK,
} from './platform-reads-current-chapter-body-fixture.js';

import { EventEmitter } from 'node:events';

import assert from 'node:assert/strict';

import {
  SHORT_METADATA_STATIC_ALIAS,
  SHORT_METADATA_ASSETS,
} from '../../src/platform/short-metadata-schema.js';

import { BrowserSession } from '../../src/platform/browser.js';

export function metadataSchema_shortMetadataFixture(
  options: {
    redirect?: number;
    duplicate?: boolean;
    ownerChanged?: boolean;
    foreign?: boolean;
    blockedPost?: boolean;
    lateWithin?: boolean;
    closeGate?: Promise<void>;
    createGate?: Promise<void>;
    pageGate?: Promise<void>;
    jsonGate?: Promise<void>;
    callbackFails?: boolean;
    disposeFails?: boolean;
    cookieGate?: Promise<void>;
    routeGate?: Promise<void>;
    websocket?: boolean;
    worker?: boolean;
    staleLoader?: boolean;
    unknownGet?: boolean;
    lateRouteError?: 'unknown' | 'target_closed';
    lateFetchError?: 'unknown' | 'target_closed';
    closeReject?: boolean;
    earlyRouteTargetClosed?: boolean;
    alias?: metadataSchema_ShortMetadataAliasFixture;
  } = {},
) {
  const lateRoute = { reject: null as ((error: Error) => void) | null };
  const lateFetch = { reject: null as ((error: Error) => void) | null };
  class TargetClosedError2 extends Error {}
  const terminalError = (kind: 'unknown' | 'target_closed') =>
    kind === 'target_closed'
      ? new TargetClosedError2('Synthetic owned target ended')
      : new Error('PRIVATE UNRELATED ASYNC ERROR');
  const stats = {
    cookies: 0,
    primaryClose: 0,
    freshClose: 0,
    newPage: 0,
    pageClose: 0,
    go: 0,
    beforeRead: 0,
    owner: 0,
    api: 0,
    apiResponsesDisposed: 0,
    apiDisposed: 0,
    jsonStarted: false,
    routeAborts: 0,
    redirectsFailed: 0,
    aliasContinues: [] as unknown[],
    aliasFetchAck: 0,
    guardsBeforePage: false,
    state: null as any,
  };
  let connected = true,
    routeHandler: Function,
    wsHandler: Function,
    frameUrl = 'about:blank';
  const page = new EventEmitter() as any,
    fresh = new EventEmitter() as any,
    primary = new EventEmitter() as any,
    cdp = new EventEmitter() as any;
  const frame = { page: () => page };
  page.mainFrame = () => frame;
  page.context = () => fresh;
  page.url = () => frameUrl;
  page.isClosed = () => false;
  page.close = async () => {
    stats.pageClose++;
  };
  cdp.send = async (method: string, value: any) => {
    if (method === 'Page.enable')
      cdp.emit('Page.frameNavigated', {
        frame: { id: 'ROOT', loaderId: 'INITIAL', url: 'about:blank' },
      });
    if (method === 'Page.getFrameTree')
      return {
        frameTree: {
          frame: {
            id: 'ROOT',
            loaderId: frameUrl === 'about:blank' ? 'INITIAL' : 'LOADER',
            url: frameUrl,
          },
        },
      };
    if (
      method === 'Fetch.continueResponse' &&
      value.requestId === 'fetch-static-late' &&
      options.lateFetchError
    )
      await new Promise<void>((_resolve, reject) => {
        lateFetch.reject = reject;
      });
    if (method === 'Fetch.failRequest') stats.redirectsFailed++;
    if (method === 'Fetch.continueResponse' && value.requestId === 'fetch-alias')
      stats.aliasFetchAck++;
    return {};
  };
  const request = (url: string, method = 'GET', resourceType = 'fetch', navigation = false) => ({
    url: () => url,
    method: () => method,
    resourceType: () => resourceType,
    isNavigationRequest: () => navigation,
    frame: () => frame,
    serviceWorker: () => null,
    redirectedFrom: () => null,
  });
  const route = {
    abort: async () => {
      stats.routeAborts++;
    },
    continue: async () => {},
  };
  const sendNetwork = (url: string, id: string, type: string, method = 'GET') =>
    cdp.emit('Network.requestWillBeSent', {
      requestId: id,
      loaderId: 'LOADER',
      frameId: 'ROOT',
      type,
      request: { url, method },
    });
  const pause = (url: string, id: string, type: string, status = 200) =>
    cdp.emit('Fetch.requestPaused', {
      requestId: `fetch-${id}`,
      networkId: id,
      frameId: 'ROOT',
      resourceType: type,
      request: { url, method: 'GET' },
      responseStatusCode: status,
    });
  page.goto = async (url: string) => {
    stats.go++;
    assert.equal(url, metadataSchema_DOC);
    const start = {
      frameId: 'ROOT',
      loaderId: 'LOADER',
      url: metadataSchema_DOC,
      navigationType: 'differentDocument',
    };
    cdp.emit('Page.frameStartedNavigating', start);
    cdp.emit('Page.frameStartedNavigating', start);
    sendNetwork(metadataSchema_DOC, 'doc', 'Document');
    await routeHandler(route, request(metadataSchema_DOC, 'GET', 'document', true));
    pause(metadataSchema_DOC, 'doc', 'Document', options.redirect ?? 200);
    await metadataSchema_tick();
    if (options.redirect) return;
    frameUrl = metadataSchema_DOC;
    cdp.emit('Page.frameNavigated', {
      frame: { id: 'ROOT', loaderId: 'LOADER', url: metadataSchema_DOC },
    });
    if (options.websocket) {
      wsHandler({ close: async () => {} });
      return;
    }
    if (options.worker) {
      fresh.emit('serviceworker', {});
      return;
    }
    if (options.unknownGet) {
      await routeHandler(route, request('https://fanqienovel.com/api/unknown-read'));
      return;
    }
    if (options.staleLoader) {
      cdp.emit('Network.requestWillBeSent', {
        requestId: 'old',
        loaderId: 'OLD-LOADER',
        frameId: 'ROOT',
        type: 'Fetch',
        request: { url: metadataSchema_EDIT, method: 'GET' },
      });
      return;
    }
    if (options.foreign) {
      cdp.emit('Page.frameAttached', { frameId: 'OTHER', parentFrameId: 'ROOT' });
      return;
    }
    if (options.blockedPost) {
      await routeHandler(route, request('https://fanqienovel.com/api/write', 'POST'));
      return;
    }
    if (options.alias) {
      const alias = options.alias,
        source = alias.sourceUrl ?? SHORT_METADATA_STATIC_ALIAS.source;
      let routedUrl = source;
      const req = (registered = false) =>
        Object.assign(
          request(source, alias.method ?? 'GET', alias.type ?? 'script', alias.navigation ?? false),
          {
            url: () => (registered ? routedUrl : source),
            frame: () => (alias.child ? { page: () => page } : frame),
            redirectedFrom: () => (alias.redirected ? request(source) : null),
          },
        );
      const original = req(true);
      if (!alias.omitNetwork)
        sendNetwork(
          source,
          'alias',
          alias.type === 'fetch' ? 'Fetch' : 'Script',
          alias.method ?? 'GET',
        );
      if (alias.duplicateNetwork) sendNetwork(source, 'alias-extra', 'Script');
      if (!alias.omitPageRequest) page.emit('request', original);
      if (!alias.unrouted) {
        const aliasRoute = {
          abort: route.abort,
          continue: async (value: unknown) => {
            stats.aliasContinues.push(value);
            routedUrl = SHORT_METADATA_STATIC_ALIAS.wire;
          },
        };
        await routeHandler(aliasRoute, alias.routeRequestMismatch ? req() : original);
        if (stats.freshClose) return;
        if (alias.duplicateSource) {
          page.emit('request', req());
          return;
        }
        pause(
          alias.pauseUrl ?? SHORT_METADATA_STATIC_ALIAS.source,
          alias.pauseNetworkId ?? 'alias',
          'Script',
          alias.pauseStatus ?? 200,
        );
        await metadataSchema_tick();
        if (stats.freshClose) return;
        if (!alias.omitResponse) {
          const response = {
            request: () => (alias.responseRequestMismatch ? req() : original),
            url: () => alias.responseUrl ?? SHORT_METADATA_STATIC_ALIAS.wire,
            status: () => 200,
          };
          page.emit('response', response);
          if (alias.duplicateResponse) page.emit('response', response);
          await metadataSchema_tick();
          if (stats.freshClose) return;
        }
      }
    }
    sendNetwork(metadataSchema_EDIT, 'edit', 'Fetch');
    const req = request(metadataSchema_EDIT);
    page.emit('request', req);
    await routeHandler(route, req);
    pause(metadataSchema_EDIT, 'edit', 'Fetch');
    const response = {
      request: () => req,
      url: () => metadataSchema_EDIT,
      status: () => 200,
      body: async () => {
        stats.jsonStarted = true;
        if (options.jsonGate) await options.jsonGate;
        return Buffer.from(
          JSON.stringify({
            code: 0,
            data: {
              item_id: '0',
              publish_status: 0,
              category: [
                { category_id: 'private-id', label: 'private-label', name: 'private-name' },
              ],
              thumb_uri: 'private-cover',
              body: 'PRIVATE FULL BODY',
              title: 'PRIVATE TITLE',
            },
          }),
        );
      },
    };
    page.emit('response', response);
    if (options.duplicate) page.emit('response', response);
    await metadataSchema_tick();
    if (options.alias?.lateDuplicateNetwork)
      sendNetwork(SHORT_METADATA_STATIC_ALIAS.source, 'alias-extra-late', 'Script');
    if (options.lateRouteError || options.lateFetchError || options.earlyRouteTargetClosed) {
      const asset = SHORT_METADATA_ASSETS[0]![0];
      sendNetwork(asset, 'static-late', 'Script');
      const late = {
        abort: async () => {},
        continue: async () => {
          if (options.earlyRouteTargetClosed)
            throw new TargetClosedError2('Synthetic unrelated target closure');
          if (options.lateRouteError)
            await new Promise<void>((_resolve, reject) => {
              lateRoute.reject = reject;
            });
        },
      };
      // This allowed static route remains genuinely pending past the natural
      // metadata response. It must settle before the account FIFO is released.
      void routeHandler(late, request(asset, 'GET', 'script')).catch(() => {});
      if (options.lateFetchError) pause(asset, 'static-late', 'Script');
    }
  };
  fresh.route = async (_pattern: string, fn: Function) => {
    routeHandler = fn;
    if (options.routeGate) await options.routeGate;
  };
  fresh.routeWebSocket = async (_pattern: string, fn: Function) => {
    wsHandler = fn;
  };
  fresh.newPage = async () => {
    stats.newPage++;
    stats.guardsBeforePage = Boolean(routeHandler && wsHandler);
    if (options.pageGate) await options.pageGate;
    fresh.emit('page', page);
    return page;
  };
  fresh.newCDPSession = async () => cdp;
  fresh.close = async () => {
    stats.freshClose++;
    if (options.closeGate) await options.closeGate;
    if (options.lateWithin)
      cdp.emit('Page.navigatedWithinDocument', {
        frameId: 'ROOT',
        url: metadataSchema_DOC + '#leave',
      });
    cdp.emit('Disconnected');
    fresh.emit('close');
    page.emit('close');
    if (options.lateRouteError) {
      assert(lateRoute.reject);
      lateRoute.reject(terminalError(options.lateRouteError));
    }
    if (options.lateFetchError) {
      assert(lateFetch.reject);
      lateFetch.reject(terminalError(options.lateFetchError));
    }
    if (options.closeReject) throw Error('PRIVATE UNRELATED CLOSE ERROR');
  };
  fresh.request = {
    get: async (url: string, opts: any) => {
      assert.equal(url, metadataSchema_OWN);
      assert.equal(opts.maxRedirects, 0);
      assert.equal(opts.maxRetries, 0);
      stats.api++;
      return {
        url: () => metadataSchema_OWN,
        status: () => 200,
        body: async () =>
          Buffer.from(
            JSON.stringify({
              code: 0,
              data: {
                id: options.ownerChanged && stats.api === 2 ? '2001' : metadataSchema_ACCOUNT,
              },
            }),
          ),
        dispose: async () => {
          stats.apiResponsesDisposed++;
          if (options.disposeFails) throw Error('PRIVATE DISPOSAL ERROR');
        },
      };
    },
    dispose: async () => {
      stats.apiDisposed++;
    },
  };
  const browser = {
    isConnected: () => connected,
    newContext: async (state: any) => {
      stats.state = state;
      if (options.createGate) await options.createGate;
      return fresh;
    },
  };
  primary.browser = () => browser;
  primary.cookies = async (url: string) => {
    stats.cookies++;
    assert.equal(url, 'https://fanqienovel.com');
    if (options.cookieGate) await options.cookieGate;
    return [
      {
        name: 'private-cookie',
        value: 'private-token',
        domain: '.fanqienovel.com',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ];
  };
  primary.close = async () => {
    stats.primaryClose++;
    connected = false;
  };
  const session = new BrowserSession({
    profileDir: '/synthetic/never-read',
    headless: true,
    operationTimeoutMs: 5000,
  });
  (session as any).context = primary;
  const call = (signal?: AbortSignal, timeoutMs?: number) =>
    session.diagnoseShortMetadataSchema(metadataSchema_WORK, {
      signal,
      ...(timeoutMs ? { timeoutMs } : {}),
      expectedAccountId: metadataSchema_ACCOUNT,
      assertLease: () => {},
      onBeforePlatformRead: () => {
        stats.beforeRead++;
      },
      onVerifiedAccount: () => {
        stats.owner++;
        if (options.callbackFails) throw Error('PRIVATE CALLBACK ERROR');
      },
    });
  return { session, stats, call, fresh, page, cdp, primary };
}
