import { request, type Page } from 'playwright';

import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

import { BrowserSession, CANONICAL_OWN_USER_URL } from '../../src/platform/browser.js';

import {
  type ChapterFixtureSource,
  type ChapterStaticUiFixture,
  type ChapterRenderReadinessFixture,
  type FixtureElement,
} from '../platform-reads.test.js';

interface Ports {
  diagnosticDomReads: number;
  options: {
    rows?: unknown[];
    titles?: string[];
    buttons?: Array<{ label: string; type?: string; className?: string; disabled?: boolean }>;
    method?: string;
    destination?: string;
    apiDestination?: string;
    spa?: boolean;
    postOnClick?: boolean;
    changedOwner?: boolean;
    oldRequest?: boolean;
    navigateDuringReplay?: boolean;
    directorySources?: ChapterFixtureSource[];
    navigateDuringDirectoryReplay?: boolean;
    directoryReplayError?: boolean;
    directoryNavigationAfterIndex?: number;
    navigateDuringDiagnosticDom?: boolean;
    cancelDuringDirectoryReplay?: AbortController;
    ownerAfterDirectoryReplay?: boolean;
    navigateBeforeVolumeRefresh?: boolean;
    duplicateFreshVolumeRequest?: boolean;
    suppressFreshVolumeEvents?: boolean;
    replayVolumeStatus?: number;
    freshVolumeUrlDrift?: boolean;
    volumeInputWrapper?: 'strings' | 'all';
    freshVolumeOverride?: {
      query?: string;
      resourceType?: string;
      subframe?: boolean;
      frameUnavailable?: boolean;
    };
    extraFreshVolumeEvents?: number;
    oldVolumeResponseDuringFresh?: boolean;
    suppressFreshVolumeResponse?: boolean;
    delayedFreshVolumeResponse?: boolean;
    mismatchedFreshResponseStatus?: number;
    oldResponseDuringVolumeWait?: boolean;
    navigateDuringVolumeWait?: boolean;
    cancelDuringVolumeWait?: AbortController;
    duplicateDuringVolumeWait?: boolean;
    bootstrapNavigation?: string[];
    loseSlotDuringDirectoryReplay?: boolean;
    chapterUi?: ChapterStaticUiFixture;
    realChapterReadiness?: ChapterRenderReadinessFixture;
  };
  readinessRendered: boolean;
  tableElement: FixtureElement;
  nav: FixtureElement;
  volumeExpanded: boolean;
  popup: FixtureElement;
  selectRoot: FixtureElement;
  tabsRoot: FixtureElement;
  unboundOptions: (FixtureElement & ({ selected?: undefined } | { selected: boolean }))[];
  pagerRoots: FixtureElement[];
  chapterTabs: FixtureElement[];
  statusValues: FixtureElement[];
  volumeControlOrder: FixtureElement[];
  cards: FixtureElement[];
  buttons: FixtureElement[];
  body: FixtureElement;
  currentUrl: string;
  volumeFetchInputs: {
    kind: 'string' | 'request';
    url: string;
    method: string;
    credentials: string;
    redirect: string;
    cache: string;
  }[];
  managerUrl: 'https://fanqienovel.com/api/author/book/book_list/v0/?page_count=10&page_index=0&nonce=PRIVATE_SOURCE_NONCE';
  throughGuard: (
    source: ReturnType<
      (
        url: string,
        method?: string,
        navigation?: boolean,
        resource?: string,
        subframe?: boolean,
      ) => {
        url: () => string;
        method: () => string;
        isNavigationRequest: () => boolean;
        frame: () => 'SYNTHETIC_CHILD_FRAME' | null;
        resourceType: () => string;
      }
    >,
  ) => Promise<boolean>;
  request: (
    url: string,
    method?: string,
    navigation?: boolean,
    resource?: string,
    subframe?: boolean,
  ) => {
    url: () => string;
    method: () => string;
    isNavigationRequest: () => boolean;
    frame: () => 'SYNTHETIC_CHILD_FRAME' | null;
    resourceType: () => string;
  };
  emit: (event: string, value: unknown) => void;
  oldVolumeRequest: {
    url: () => string;
    method: () => string;
    isNavigationRequest: () => boolean;
    frame: () => 'SYNTHETIC_CHILD_FRAME' | null;
    resourceType: () => string;
  } | null;
  response: (
    source: ReturnType<
      (
        url: string,
        method?: string,
        navigation?: boolean,
        resource?: string,
        subframe?: boolean,
      ) => {
        url: () => string;
        method: () => string;
        isNavigationRequest: () => boolean;
        frame: () => 'SYNTHETIC_CHILD_FRAME' | null;
        resourceType: () => string;
      }
    >,
    json?: unknown,
    status?: number,
  ) => {
    url: () => string;
    status: () => number;
    ok: () => boolean;
    request: () => {
      url: () => string;
      method: () => string;
      isNavigationRequest: () => boolean;
      frame: () => 'SYNTHETIC_CHILD_FRAME' | null;
      resourceType: () => string;
    };
    json: () => Promise<unknown>;
  };
  directoryFetchCount: number;
  directoryFetchedSources: string[];
  session: BrowserSession;
  pendingVolumeResponse: {
    url: () => string;
    status: () => number;
    ok: () => boolean;
    request: () => {
      url: () => string;
      method: () => string;
      isNavigationRequest: () => boolean;
      frame: () => 'SYNTHETIC_CHILD_FRAME' | null;
      resourceType: () => string;
    };
    json: () => Promise<unknown>;
  } | null;
  list: { code: number; data: { total_count: number; book_list: unknown[] } };
  clickCount: number;
  directoryGotoCount: number;
  volumeClickCount: number;
}
export function createEntryEvaluate(ports: Ports) {
  return async (callback: unknown, arg: unknown) => {
    if (arg && typeof arg === 'object' && 'maxElements' in arg) ports.diagnosticDomReads += 1;
    const source = String(callback);
    const production = import.meta.url.endsWith('.js');
    if (production) assert.equal(source.includes('__name'), false);
    const result = await runInNewContext(`(${source})(arg)`, {
      arg,
      document: {
        body: { innerText: '作品管理 PRIVATE_OWNER_NAME PRIVATE_CHAPTER_BODY' },
        querySelector: (selector: string) =>
          selector === '.chapter-table'
            ? ports.options.chapterUi?.table &&
              (!ports.options.realChapterReadiness || ports.readinessRendered)
              ? ports.tableElement
              : null
            : ports.nav,
        getElementById: (id: string) =>
          id === 'PRIVATE_POPUP_ID' && ports.volumeExpanded ? ports.popup : null,
        querySelectorAll: (selector: string) =>
          selector === '[role="listbox"]'
            ? ports.volumeExpanded
              ? [ports.popup]
              : []
            : selector === '.chapter-select,.chapter-manage-tabs'
              ? [ports.selectRoot, ports.tabsRoot]
              : selector === 'option,[role="option"]'
                ? ports.unboundOptions
                : selector === '.arco-pagination,.byte-pagination'
                  ? ports.pagerRoots
                  : selector === '.chapter-manage-tabs [role="tab"]'
                    ? ports.options.realChapterReadiness && !ports.readinessRendered
                      ? []
                      : ports.chapterTabs
                    : selector === '.chapter-status-select .byte-select-view-value'
                      ? ports.statusValues
                      : selector === '.chapter-select-left .serial-select'
                        ? ports.volumeControlOrder
                        : selector === '.home-book-item'
                          ? ports.cards
                          : selector === 'a[href]'
                            ? []
                            : selector === '.new-nav-item-label'
                              ? [ports.nav]
                              : selector === '.book-select-title,.info-content-title'
                                ? ports.cards.map((card) =>
                                    card.querySelector('.info-content-title'),
                                  )
                                : ports.options.chapterUi?.genericElementCount
                                  ? Array.from(
                                      { length: ports.options.chapterUi.genericElementCount },
                                      () => ports.nav,
                                    )
                                  : [
                                      ports.nav,
                                      ...ports.cards,
                                      ...ports.buttons,
                                      ports.body,
                                      ...ports.unboundOptions,
                                    ],
      },
      window: { _ROUTER_DATA: {} },
      location: new URL(ports.currentUrl),
      getComputedStyle: (element: FixtureElement) => ({
        display: element.hasAttribute('data-fixture-hidden') ? 'none' : 'block',
        visibility: 'visible',
        opacity: '1',
      }),
      Request,
      fetch: async (input: string | Request, init?: RequestInit) => {
        const isRequest = input instanceof Request;
        const inputRequest = isRequest ? input : new Request(input, init);
        const raw = inputRequest.url;
        const directorySource = ports.options.directorySources?.find((value) => value.url === raw);
        if (directorySource && new URL(raw).pathname === '/api/author/volume/volume_list/v1') {
          ports.volumeFetchInputs.push({
            kind: isRequest ? 'request' : 'string',
            url: raw,
            method: inputRequest.method,
            credentials: inputRequest.credentials,
            redirect: inputRequest.redirect,
            cache: inputRequest.cache,
          });
          assert.equal(inputRequest.method, 'GET');
          assert.equal(inputRequest.credentials, 'same-origin');
          assert.equal(inputRequest.redirect, 'error');
          if (isRequest) {
            assert.equal(init, undefined);
            assert.equal(inputRequest.cache, 'no-store');
            assert.equal(inputRequest.body, null);
          }
        }
        assert.ok(
          raw === CANONICAL_OWN_USER_URL || raw === ports.managerUrl || directorySource,
          'No guessed chapter endpoint can be fetched',
        );
        if (!(await ports.throughGuard(ports.request(raw))))
          throw new Error('PRIVATE_FETCH_FAILURE');
        if (raw === ports.managerUrl && ports.options.navigateDuringReplay)
          ports.emit('framenavigated', null);
        if (directorySource) {
          if (ports.options.navigateBeforeVolumeRefresh) ports.emit('framenavigated', null);
          const rewrittenRaw =
            ports.options.volumeInputWrapper === 'all' ||
            (ports.options.volumeInputWrapper === 'strings' && !isRequest)
              ? raw + '&nonce=PRIVATE_WRAPPER_NONCE&nonce=PRIVATE_WRAPPER_DUPLICATE'
              : raw;
          const projectedRaw =
            ports.options.freshVolumeOverride?.query === undefined
              ? rewrittenRaw
              : `${new URL(raw).origin}${new URL(raw).pathname}?${ports.options.freshVolumeOverride.query}`;
          const replayRequest = ports.request(
            ports.options.freshVolumeUrlDrift
              ? raw + '&opaque_drift=PRIVATE_DRIFT_VALUE'
              : projectedRaw,
            'GET',
            false,
            ports.options.freshVolumeOverride?.resourceType ?? 'xhr',
            ports.options.freshVolumeOverride?.subframe ?? false,
          );
          if (ports.options.freshVolumeOverride?.frameUnavailable)
            replayRequest.frame = () => {
              throw new Error('PRIVATE_WORKER_FRAME');
            };
          for (let index = 0; index < (ports.options.extraFreshVolumeEvents ?? 0); index += 1)
            ports.emit('request', ports.request(raw, 'GET', false, 'xhr', true));
          if (!ports.options.suppressFreshVolumeEvents) ports.emit('request', replayRequest);
          if (ports.options.duplicateFreshVolumeRequest) ports.emit('request', ports.request(raw));
          if (ports.options.oldVolumeResponseDuringFresh && ports.oldVolumeRequest)
            ports.emit('response', ports.response(ports.oldVolumeRequest, {}, 200));
          ports.directoryFetchCount += 1;
          ports.directoryFetchedSources.push(raw);
          if (ports.options.navigateDuringDirectoryReplay) ports.emit('framenavigated', null);
          ports.options.cancelDuringDirectoryReplay?.abort();
          if (ports.options.loseSlotDuringDirectoryReplay)
            (ports.session as unknown as { activeReaderPage: Page | null }).activeReaderPage = null;
          if (ports.options.directoryReplayError) throw new Error('PRIVATE_REPLAY_NONCE');
          const status = ports.options.replayVolumeStatus ?? 200;
          if (
            !ports.options.suppressFreshVolumeEvents &&
            !ports.options.suppressFreshVolumeResponse
          ) {
            const value = ports.response(
              replayRequest,
              directorySource.replayJson ?? directorySource.json ?? {},
              ports.options.mismatchedFreshResponseStatus ?? status,
            );
            if (ports.options.delayedFreshVolumeResponse) ports.pendingVolumeResponse = value;
            else ports.emit('response', value);
          }
          return {
            status,
            ok: status >= 200 && status < 300,
            arrayBuffer: async () => new ArrayBuffer(0),
            json: async () => directorySource.replayJson ?? directorySource.json ?? {},
          };
        }
        return {
          status: 200,
          ok: true,
          json: async () =>
            raw === ports.managerUrl
              ? ports.list
              : {
                  code: 0,
                  data: {
                    id:
                      (ports.options.changedOwner && ports.clickCount) ||
                      (ports.options.ownerAfterDirectoryReplay && ports.directoryFetchCount) ||
                      (ports.options.realChapterReadiness?.changedOwner &&
                        ports.directoryGotoCount) ||
                      (ports.options.realChapterReadiness?.volumeOwnerChanged &&
                        ports.volumeClickCount)
                        ? '3001'
                        : '1001',
                    name: 'PRIVATE_OWNER_NAME',
                  },
                },
        };
      },
      ...(production ? {} : { __name: (value: unknown) => value }),
    });
    if (
      arg &&
      typeof arg === 'object' &&
      'maxElements' in arg &&
      ports.options.navigateDuringDiagnosticDom
    )
      ports.emit('framenavigated', null);
    return result;
  };
}
