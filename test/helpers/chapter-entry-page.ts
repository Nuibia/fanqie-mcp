import { createEntryHandle } from './chapter-entry-handle.js';
import { createEntryEvaluate } from './chapter-entry-evaluate.js';
import { createEntryLocator } from './chapter-entry-locator.js';
import { request, type Page } from 'playwright';

import { BrowserSession } from '../../src/platform/browser.js';

import {
  type ChapterFixtureSource,
  type ChapterStaticUiFixture,
  type ChapterRenderReadinessFixture,
  type FixtureElement,
} from '../platform-reads.test.js';

interface Ports {
  page: Page & { closed: boolean; onClose?: () => void; evaluations: unknown[] };
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
  directoryGotoCount: number;
  emit: (event: string, value: unknown) => void;
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
  currentUrl: string;
  cleanupFailureObserved: () => void;
  blockedCount: number;
  deferredRouteStarted: boolean;
  deferredRoute: Promise<void>;
  deferredRouteSettled: boolean;
  forwardCount: number;
  volumeContainers: FixtureElement[];
  replacementClickCount: number;
  volumeClickCount: number;
  volumeExpanded: boolean;
  cards: FixtureElement[];
  buttons: FixtureElement[];
  clickCount: number;
  CHAPTER_ENTRY_FIXTURE_WORK: '7600000000000000001';
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
  diagnosticDomReads: number;
  readinessRendered: boolean;
  tableElement: FixtureElement;
  nav: FixtureElement;
  popup: FixtureElement;
  selectRoot: FixtureElement;
  tabsRoot: FixtureElement;
  unboundOptions: (FixtureElement & ({ selected?: undefined } | { selected: boolean }))[];
  pagerRoots: FixtureElement[];
  chapterTabs: FixtureElement[];
  statusValues: FixtureElement[];
  volumeControlOrder: FixtureElement[];
  body: FixtureElement;
  volumeFetchInputs: {
    kind: 'string' | 'request';
    url: string;
    method: string;
    credentials: string;
    redirect: string;
    cache: string;
  }[];
  managerUrl: 'https://fanqienovel.com/api/author/book/book_list/v0/?page_count=10&page_index=0&nonce=PRIVATE_SOURCE_NONCE';
  oldVolumeRequest: {
    url: () => string;
    method: () => string;
    isNavigationRequest: () => boolean;
    frame: () => 'SYNTHETIC_CHILD_FRAME' | null;
    resourceType: () => string;
  } | null;
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
  volumeViews: FixtureElement[];
  element: (
    tagName: string,
    textContent: string,
    attributes?: Record<string, string>,
  ) => FixtureElement;
  volumeHandleDisposals: number;
}
export function createEntryPage(ports: Ports) {
  return () => {
    let activeRoute: ((route: unknown) => Promise<void>) | null = null;

    ports.page.route = (async (_pattern: unknown, handler: (route: unknown) => Promise<void>) => {
      activeRoute = handler;
    }) as unknown as Page['route'];

    ports.page.unroute = (async () => {
      activeRoute = null;
      if (ports.options.realChapterReadiness?.cleanupNavigation && ports.directoryGotoCount)
        ports.emit('request', ports.request(ports.currentUrl, 'GET', true));
      if (ports.options.realChapterReadiness?.cleanupUnrouteFailure && ports.directoryGotoCount) {
        ports.cleanupFailureObserved();
        throw new Error('PRIVATE_UNROUTE_FAILURE');
      }
    }) as Page['unroute'];

    const throughGuard = async (source: ReturnType<Ports['request']>): Promise<boolean> => {
      let allowed = false;
      if (!activeRoute) return true;
      await activeRoute({
        request: () => source,
        async abort() {
          ports.blockedCount += 1;
          if (
            ports.options.realChapterReadiness?.deferredCleanupRoute &&
            source.url() === 'https://fanqienovel.com/api/author/sa_stats/analytics_deferred/v0/'
          ) {
            ports.deferredRouteStarted = true;
            await ports.deferredRoute;
            ports.deferredRouteSettled = true;
          }
        },
        async continue() {
          ports.forwardCount += 1;
          allowed = true;
        },
      });
      return allowed;
    };

    ports.page.locator = createEntryLocator({
      volumeContainers: ports.volumeContainers,
      get replacementClickCount() {
        return ports.replacementClickCount;
      },
      set replacementClickCount(value) {
        ports.replacementClickCount = value;
      },
      get volumeClickCount() {
        return ports.volumeClickCount;
      },
      set volumeClickCount(value) {
        ports.volumeClickCount = value;
      },
      get volumeExpanded() {
        return ports.volumeExpanded;
      },
      set volumeExpanded(value) {
        ports.volumeExpanded = value;
      },
      options: ports.options,
      get currentUrl() {
        return ports.currentUrl;
      },
      set currentUrl(value) {
        ports.currentUrl = value;
      },
      emit: ports.emit,
      cards: ports.cards,
      buttons: ports.buttons,
      get clickCount() {
        return ports.clickCount;
      },
      set clickCount(value) {
        ports.clickCount = value;
      },
      throughGuard,
      request: ports.request,
      CHAPTER_ENTRY_FIXTURE_WORK: ports.CHAPTER_ENTRY_FIXTURE_WORK,
      response: ports.response,
    }) as unknown as Page['locator'];

    ports.page.evaluate = createEntryEvaluate({
      get diagnosticDomReads() {
        return ports.diagnosticDomReads;
      },
      set diagnosticDomReads(value) {
        ports.diagnosticDomReads = value;
      },
      options: ports.options,
      get readinessRendered() {
        return ports.readinessRendered;
      },
      set readinessRendered(value) {
        ports.readinessRendered = value;
      },
      tableElement: ports.tableElement,
      nav: ports.nav,
      get volumeExpanded() {
        return ports.volumeExpanded;
      },
      set volumeExpanded(value) {
        ports.volumeExpanded = value;
      },
      popup: ports.popup,
      selectRoot: ports.selectRoot,
      tabsRoot: ports.tabsRoot,
      unboundOptions: ports.unboundOptions,
      pagerRoots: ports.pagerRoots,
      chapterTabs: ports.chapterTabs,
      statusValues: ports.statusValues,
      volumeControlOrder: ports.volumeControlOrder,
      cards: ports.cards,
      buttons: ports.buttons,
      body: ports.body,
      get currentUrl() {
        return ports.currentUrl;
      },
      set currentUrl(value) {
        ports.currentUrl = value;
      },
      volumeFetchInputs: ports.volumeFetchInputs,
      managerUrl: ports.managerUrl,
      throughGuard,
      request: ports.request,
      emit: ports.emit,
      get oldVolumeRequest() {
        return ports.oldVolumeRequest;
      },
      set oldVolumeRequest(value) {
        ports.oldVolumeRequest = value;
      },
      response: ports.response,
      get directoryFetchCount() {
        return ports.directoryFetchCount;
      },
      set directoryFetchCount(value) {
        ports.directoryFetchCount = value;
      },
      directoryFetchedSources: ports.directoryFetchedSources,
      session: ports.session,
      get pendingVolumeResponse() {
        return ports.pendingVolumeResponse;
      },
      set pendingVolumeResponse(value) {
        ports.pendingVolumeResponse = value;
      },
      list: ports.list,
      get clickCount() {
        return ports.clickCount;
      },
      set clickCount(value) {
        ports.clickCount = value;
      },
      get directoryGotoCount() {
        return ports.directoryGotoCount;
      },
      set directoryGotoCount(value) {
        ports.directoryGotoCount = value;
      },
      get volumeClickCount() {
        return ports.volumeClickCount;
      },
      set volumeClickCount(value) {
        ports.volumeClickCount = value;
      },
    }) as Page['evaluate'];

    const privateHandle = createEntryHandle({
      options: ports.options,
      volumeContainers: ports.volumeContainers,
      volumeViews: ports.volumeViews,
      volumeControlOrder: ports.volumeControlOrder,
      element: ports.element,
      page: ports.page,
      get volumeClickCount() {
        return ports.volumeClickCount;
      },
      set volumeClickCount(value) {
        ports.volumeClickCount = value;
      },
      get volumeExpanded() {
        return ports.volumeExpanded;
      },
      set volumeExpanded(value) {
        ports.volumeExpanded = value;
      },
      get currentUrl() {
        return ports.currentUrl;
      },
      set currentUrl(value) {
        ports.currentUrl = value;
      },
      emit: ports.emit,
      get volumeHandleDisposals() {
        return ports.volumeHandleDisposals;
      },
      set volumeHandleDisposals(value) {
        ports.volumeHandleDisposals = value;
      },
    });

    ports.page.evaluateHandle = (async (callback: unknown) =>
      privateHandle(await ports.page.evaluate(callback as never))) as Page['evaluateHandle'];
    return {
      throughGuard,
      get activeRoute() {
        return activeRoute;
      },
    };
  };
}
