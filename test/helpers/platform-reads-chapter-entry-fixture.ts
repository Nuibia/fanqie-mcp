import {
  type ChapterFixtureSource,
  type ChapterStaticUiFixture,
  type ChapterRenderReadinessFixture,
  CHAPTER_ENTRY_FIXTURE_WORK,
  CHAPTER_ENTRY_FIXTURE_TITLE,
} from './platform-reads-chapter-entry-fixture-work.js';

import { fakeBrowser } from './platform-reads-metrics-page.js';

import { type Page } from 'playwright';

import assert from 'node:assert/strict';

import { createEntryDom } from './chapter-entry-dom.js';

import { createEntryPage } from './chapter-entry-page.js';

import { createEntryReadiness } from './chapter-entry-readiness.js';

export function chapterEntryFixture(
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
  } = {},
) {
  const { session, pages } = fakeBrowser();
  const page = pages[0]!;
  // Existing fixture cases isolate their original entry/schema projection contracts.
  // New render-readiness groups deliberately use the real private bracket instead.
  if (!options.realChapterReadiness)
    (session as unknown as { prepareChapterDiagnostic: unknown }).prepareChapterDiagnostic = async (
      _page: Page,
      _target: string,
      login: unknown,
    ) => ({ ready: true, login, assertCurrent() {}, async close() {} });
  let readinessRendered = false,
    readinessChecks = 0,
    readinessWasInitiallyBlank = false,
    deferredRouteStarted = false,
    deferredRouteSettled = false,
    volumeExpanded = false,
    volumeClickCount = 0,
    replacementClickCount = 0,
    volumeHandleDisposals = 0;
  let releaseDeferredRoute!: () => void, cleanupFailureObserved!: () => void;
  const deferredRoute = new Promise<void>((resolve) => {
    releaseDeferredRoute = resolve;
  });
  const cleanupFailure = new Promise<void>((resolve) => {
    cleanupFailureObserved = resolve;
  });
  const managerUrl =
    'https://fanqienovel.com/api/author/book/book_list/v0/?page_count=10&page_index=0&nonce=PRIVATE_SOURCE_NONCE';
  let currentUrl = 'https://fanqienovel.com/main/writer/book-manage';
  let clickCount = 0;
  let blockedCount = 0;
  let forwardCount = 0;
  let diagnosticDomReads = 0;
  let directoryFetchCount = 0;
  let directoryGotoCount = 0;
  const directoryFetchedSources: string[] = [];
  const volumeFetchInputs: Array<{
    kind: 'string' | 'request';
    url: string;
    method: string;
    credentials: string;
    redirect: string;
    cache: string;
  }> = [];
  let pendingVolumeResponse: ReturnType<typeof response> | null = null;
  let oldVolumeRequest: ReturnType<typeof request> | null = null;
  let volumeResponseWaits = 0;
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const emit = (event: string, value: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(value);
  };
  const request = (
    url: string,
    method = 'GET',
    navigation = false,
    resource = 'xhr',
    subframe = false,
  ) => ({
    url: () => url,
    method: () => method,
    isNavigationRequest: () => navigation,
    frame: () => (subframe ? 'SYNTHETIC_CHILD_FRAME' : null),
    resourceType: () => (navigation ? 'document' : resource),
  });
  const response = (source: ReturnType<typeof request>, json: unknown = {}, status = 200) => ({
    url: source.url,
    status: () => status,
    ok: () => status >= 200 && status < 300,
    request: () => source,
    json: async () => json,
  });
  page.on = ((event: string, listener: (value: unknown) => void) => {
    let handlers = listeners.get(event);
    if (!handlers) listeners.set(event, (handlers = new Set()));
    handlers.add(listener);
    return page;
  }) as typeof page.on;
  page.off = ((event: string, listener: (value: unknown) => void) => {
    listeners.get(event)?.delete(listener);
    return page;
  }) as typeof page.off;
  page.url = () => currentUrl;
  (session as unknown as { observeIdentity(page: Page): void }).observeIdentity(page);
  const rows = options.rows ?? [
    { book_id: CHAPTER_ENTRY_FIXTURE_WORK, book_name: CHAPTER_ENTRY_FIXTURE_TITLE },
  ];
  const list = { code: 0, data: { total_count: rows.length, book_list: rows } };
  page.goto = (async (url: string) => {
    if (
      options.realChapterReadiness &&
      /^https:\/\/fanqienovel\.com\/main\/writer\/chapter-manage\//.test(url) &&
      !(await throughGuard(request(url, 'GET', true)))
    )
      return null;
    if (/^https:\/\/fanqienovel\.com\/main\/writer\/chapter-manage\//.test(url))
      directoryGotoCount += 1;
    const directorySources = /^https:\/\/fanqienovel\.com\/main\/writer\/chapter-manage\//.test(url)
      ? (options.realChapterReadiness ? [] : (options.directorySources ?? [])).map((value) => ({
          value,
          source: request(value.url, value.method, false, value.resourceType, value.subframe),
        }))
      : [];
    for (const { value, source } of directorySources) {
      if (new URL(value.url).pathname === '/api/author/volume/volume_list/v1')
        oldVolumeRequest = source;
    }
    for (const { value, source } of directorySources)
      if (value.oldRequest && !value.responseOnly) emit('request', source);
    const source = request(managerUrl, options.method ?? 'GET');
    if (options.oldRequest) emit('request', source);
    currentUrl = url;
    emit('framenavigated', null);
    if (!options.oldRequest) emit('request', source);
    emit('response', response(source, list));
    for (const [index, { value, source: directoryRequest }] of directorySources.entries()) {
      if (!value.oldRequest && !value.responseOnly) emit('request', directoryRequest);
      emit('response', response(directoryRequest, value.json));
      if (options.directoryNavigationAfterIndex === index) emit('framenavigated', null);
    }
    return null;
  }) as Page['goto'];
  page.waitForLoadState = async () => {
    if (directoryGotoCount)
      for (const url of options.bootstrapNavigation ?? []) {
        currentUrl = url;
        emit('framenavigated', null);
      }
  };
  page.waitForURL = (async (predicate: (url: URL) => boolean) => {
    if (!predicate(new URL(currentUrl))) throw new Error('PRIVATE_NAVIGATION_FAILURE');
  }) as Page['waitForURL'];
  page.waitForResponse = (async (
    predicate: (value: ReturnType<typeof response>) => boolean,
    waitOptions?: { timeout?: number },
  ) => {
    volumeResponseWaits += 1;
    assert.ok(
      waitOptions?.timeout !== undefined &&
        waitOptions.timeout >= 1_000 &&
        waitOptions.timeout <= 4_000,
    );
    if (options.navigateDuringVolumeWait) emit('framenavigated', null);
    options.cancelDuringVolumeWait?.abort();
    if (pendingVolumeResponse && options.duplicateDuringVolumeWait)
      emit('request', request(pendingVolumeResponse.url()));
    const value =
      pendingVolumeResponse && options.oldResponseDuringVolumeWait
        ? response(request(pendingVolumeResponse.url()), {}, pendingVolumeResponse.status())
        : pendingVolumeResponse;
    if (!value) throw new Error('PRIVATE_VOLUME_WAIT_FAILURE token=PRIVATE_WAIT_TOKEN');
    emit('response', value);
    if (!predicate(value)) throw new Error('PRIVATE_UNMATCHED_VOLUME_RESPONSE');
    return value;
  }) as unknown as Page['waitForResponse'];

  const initializeEntryDom = createEntryDom({
    options,
    CHAPTER_ENTRY_FIXTURE_TITLE,
    get volumeExpanded() {
      return volumeExpanded;
    },
    set volumeExpanded(value) {
      volumeExpanded = value;
    },
  });
  const {
    element,
    buttons,
    cards,
    nav,
    body,
    chapterTabs,
    statusValues,
    statusContainers,
    staticElement,
    volumeViews,
    optionGroups,
    volumeContainers,
    volumeControlOrder,
    popup,
    footer,
    footerNext,
    tableElement,
    selectRoot,
    tabsRoot,
    unboundOptions,
    pagerRoots,
  } = initializeEntryDom();

  const configureEntryPage = createEntryPage({
    page,
    options,
    get directoryGotoCount() {
      return directoryGotoCount;
    },
    set directoryGotoCount(value) {
      directoryGotoCount = value;
    },
    emit,
    request,
    get currentUrl() {
      return currentUrl;
    },
    set currentUrl(value) {
      currentUrl = value;
    },
    get cleanupFailureObserved() {
      return cleanupFailureObserved;
    },
    set cleanupFailureObserved(value) {
      cleanupFailureObserved = value;
    },
    get blockedCount() {
      return blockedCount;
    },
    set blockedCount(value) {
      blockedCount = value;
    },
    get deferredRouteStarted() {
      return deferredRouteStarted;
    },
    set deferredRouteStarted(value) {
      deferredRouteStarted = value;
    },
    deferredRoute,
    get deferredRouteSettled() {
      return deferredRouteSettled;
    },
    set deferredRouteSettled(value) {
      deferredRouteSettled = value;
    },
    get forwardCount() {
      return forwardCount;
    },
    set forwardCount(value) {
      forwardCount = value;
    },
    volumeContainers,
    get replacementClickCount() {
      return replacementClickCount;
    },
    set replacementClickCount(value) {
      replacementClickCount = value;
    },
    get volumeClickCount() {
      return volumeClickCount;
    },
    set volumeClickCount(value) {
      volumeClickCount = value;
    },
    get volumeExpanded() {
      return volumeExpanded;
    },
    set volumeExpanded(value) {
      volumeExpanded = value;
    },
    cards,
    buttons,
    get clickCount() {
      return clickCount;
    },
    set clickCount(value) {
      clickCount = value;
    },
    CHAPTER_ENTRY_FIXTURE_WORK,
    response,
    get diagnosticDomReads() {
      return diagnosticDomReads;
    },
    set diagnosticDomReads(value) {
      diagnosticDomReads = value;
    },
    get readinessRendered() {
      return readinessRendered;
    },
    set readinessRendered(value) {
      readinessRendered = value;
    },
    tableElement,
    nav,
    popup,
    selectRoot,
    tabsRoot,
    unboundOptions,
    pagerRoots,
    chapterTabs,
    statusValues,
    volumeControlOrder,
    body,
    volumeFetchInputs,
    managerUrl,
    get oldVolumeRequest() {
      return oldVolumeRequest;
    },
    set oldVolumeRequest(value) {
      oldVolumeRequest = value;
    },
    get directoryFetchCount() {
      return directoryFetchCount;
    },
    set directoryFetchCount(value) {
      directoryFetchCount = value;
    },
    directoryFetchedSources,
    session,
    get pendingVolumeResponse() {
      return pendingVolumeResponse;
    },
    set pendingVolumeResponse(value) {
      pendingVolumeResponse = value;
    },
    list,
    volumeViews,
    element,
    get volumeHandleDisposals() {
      return volumeHandleDisposals;
    },
    set volumeHandleDisposals(value) {
      volumeHandleDisposals = value;
    },
  });
  const entryPage = configureEntryPage();
  const { throughGuard } = entryPage;

  const configureEntryReadiness = createEntryReadiness({
    options,
    request,
    emit,
    response,
    page,
    get readinessChecks() {
      return readinessChecks;
    },
    set readinessChecks(value) {
      readinessChecks = value;
    },
    entryPage,
    get readinessWasInitiallyBlank() {
      return readinessWasInitiallyBlank;
    },
    set readinessWasInitiallyBlank(value) {
      readinessWasInitiallyBlank = value;
    },
    throughGuard,
    get readinessRendered() {
      return readinessRendered;
    },
    set readinessRendered(value) {
      readinessRendered = value;
    },
  });
  configureEntryReadiness();

  return {
    session,
    page,
    managerUrl,
    directoryFetchedSources,
    volumeFetchInputs,
    cleanupFailure,
    releaseDeferredRoute,
    get deferredRouteStarted() {
      return deferredRouteStarted;
    },
    get deferredRouteSettled() {
      return deferredRouteSettled;
    },
    get volumeClickCount() {
      return volumeClickCount;
    },
    get replacementClickCount() {
      return replacementClickCount;
    },
    get volumeHandleDisposals() {
      return volumeHandleDisposals;
    },
    get readinessChecks() {
      return readinessChecks;
    },
    get readinessWasInitiallyBlank() {
      return readinessWasInitiallyBlank;
    },
    get directoryGotoCount() {
      return directoryGotoCount;
    },
    get listenerCount() {
      return [...listeners.values()].reduce((sum, handlers) => sum + handlers.size, 0);
    },
    get volumeResponseWaits() {
      return volumeResponseWaits;
    },
    get clickCount() {
      return clickCount;
    },
    get blockedCount() {
      return blockedCount;
    },
    get forwardCount() {
      return forwardCount;
    },
    get diagnosticDomReads() {
      return diagnosticDomReads;
    },
    get directoryFetchCount() {
      return directoryFetchCount;
    },
    get routeInstalled() {
      return entryPage.activeRoute !== null;
    },
  };
}
