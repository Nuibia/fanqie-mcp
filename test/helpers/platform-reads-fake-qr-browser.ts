import { fakeBrowser, QR_FIXTURE } from './platform-reads-metrics-page.js';

import { type Page } from 'playwright';

import assert from 'node:assert/strict';

import { CANONICAL_OWN_USER_URL } from '../../src/platform/browser.js';

import {
  collectShortMetrics,
  collectLongWorks,
  collectLongMetrics,
} from '../../src/platform/reads.js';

export function fakeQrBrowser(
  options: {
    authenticated?: boolean;
    expired?: boolean;
    challenge?: boolean;
    image?: Buffer;
    tabMissing?: boolean;
    screenshotError?: Error;
    gotoError?: Error;
  } = {},
) {
  const fixture = fakeBrowser();
  const page = fixture.pages[0]!;
  const counters = { goto: 0, tabClicks: 0, elementScreenshots: 0, fullPageScreenshots: 0 };
  let authenticated = options.authenticated ?? false;
  page.url = () => 'https://fanqienovel.com/main/writer/login?nonce=PRIVATE_QUERY#PRIVATE_FRAGMENT';
  page.goto = (async () => {
    counters.goto += 1;
    if (options.gotoError) throw options.gotoError;
    return null;
  }) as Page['goto'];
  page.waitForLoadState = async () => undefined;
  page.evaluate = (async () => ({
    loginRequired: !authenticated,
    managementVisible: authenticated,
    ownAccount: authenticated ? { user_id: '1001', author_id: '2001' } : null,
    challenge: options.challenge ?? false,
    expired: options.expired ?? false,
    appInstructions: '番茄作家助手扫码登录',
    expiryText: null,
  })) as Page['evaluate'];
  page.waitForFunction = (async () => undefined) as unknown as Page['waitForFunction'];
  page.screenshot = (async () => {
    counters.fullPageScreenshots += 1;
    throw new Error('Full page screenshots are forbidden');
  }) as Page['screenshot'];
  const tab = {
    first() {
      return tab;
    },
    filter() {
      return tab;
    },
    async all() {
      return options.tabMissing ? [] : [tab];
    },
    async isVisible() {
      return !options.tabMissing;
    },
    async waitFor() {
      if (options.tabMissing) throw new Error('PRIVATE_NONCE');
    },
    async click() {
      counters.tabClicks += 1;
    },
  };
  const image = {
    first() {
      return image;
    },
    async waitFor() {},
    async boundingBox() {
      return { x: 0, y: 0, width: 180, height: 180 };
    },
    async screenshot() {
      counters.elementScreenshots += 1;
      if (options.screenshotError) throw options.screenshotError;
      return options.image ?? QR_FIXTURE;
    },
  };
  page.locator = ((selector: string) => {
    assert.ok(
      [
        '.slogin-pc-form-header__title__tab',
        'img.slogin-qrcode-scan-page__content__code__img',
        '.slogin-qrcode-scan-page__content__code',
      ].includes(selector),
    );
    return selector.includes('title__tab') ? tab : image;
  }) as unknown as Page['locator'];
  return {
    ...fixture,
    counters,
    authenticate() {
      authenticated = true;
    },
  };
}

export function identityEvents() {
  const fixture = fakeBrowser();
  const page = fixture.pages[0]!;
  const events = new Map<string, (...args: unknown[]) => void>();
  page.on = ((event: string, listener: (...args: unknown[]) => void) => {
    events.set(event, listener);
    return page;
  }) as typeof page.on;
  const session = fixture.session as unknown as {
    observeIdentity(current: Page): void;
    identity: unknown;
    identityEpoch: number;
  };
  session.observeIdentity(page);
  const request = () => ({
    url: () => 'https://fanqienovel.com/api/author/info/v1/',
    method: () => 'GET',
    resourceType: () => 'xhr',
  });
  const response = (source: ReturnType<typeof request>, json: () => Promise<unknown>) => ({
    url: source.url,
    request: () => source,
    status: () => 200,
    ok: () => true,
    json,
  });
  const neutral = { loginRequired: false, managementVisible: false, ownAccount: null };
  page.evaluate = (async () => neutral) as Page['evaluate'];
  page.goto = (async () => {
    events.get('framenavigated')!(null);
    return null;
  }) as Page['goto'];
  page.waitForLoadState = async () => undefined;
  return { ...fixture, events, request, response, sessionInternal: session, neutral };
}

export function readDiagnosticFixture(shellReady: boolean, stableRouter = false) {
  const fixture = fakeBrowser();
  const page = fixture.pages[0]!;
  let source = page.url();
  page.url = () => source;
  page.goto = (async (url: string) => {
    source = url;
    return null;
  }) as Page['goto'];
  page.waitForLoadState = async () => undefined;
  page.waitForFunction = (async () => {
    if (!shellReady) throw new Error('Writer shell not ready');
    return {} as never;
  }) as Page['waitForFunction'];
  page.waitForResponse = (async () => {
    throw new Error('No observed own source');
  }) as Page['waitForResponse'];
  page.evaluate = (async (_callback: unknown, arg: unknown) =>
    arg && typeof arg === 'object'
      ? {
          elements: [{ tag: 'div', attributes: { id: 'app' }, label: null }],
          links: [],
          truncated: false,
        }
      : {
          loginRequired: false,
          managementVisible: shellReady,
          ownAccount: stableRouter ? { user_id: '1001' } : null,
        }) as Page['evaluate'];
  return { ...fixture, page };
}

export const longFixture = (book_id: string) => ({
  book_id,
  book_name: `FIXTURE_TITLE_${book_id}`,
  status: 3,
  category: 'FIXTURE_CATEGORY',
  create_time: '2026-10-01',
  word_count: 100,
  read_count: 0,
  creation_status: 4,
  last_chapter_time: '',
  last_chapter_id: '',
  chapter_number: 0,
  contract_status: 2,
});

export const longApi = (book_list: unknown[], total_count: unknown) => ({
  status: 200,
  ok: true,
  json: { code: 0, data: { book_list, total_count } },
});

export const longLoadedUrl =
  'https://fanqienovel.com/api/author/book/book_list/v0/?page_count=10&page_index=0';

export function localStatsDiagnosticFixture(sources: string[]) {
  const fixture = fakeBrowser();
  const page = fixture.pages[0]!;
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  page.on = ((event: string, listener: (...args: unknown[]) => void) => {
    let entries = listeners.get(event);
    if (!entries) listeners.set(event, (entries = new Set()));
    entries.add(listener);
    return page;
  }) as typeof page.on;
  page.off = ((event: string, listener: (...args: unknown[]) => void) => {
    listeners.get(event)?.delete(listener);
    return page;
  }) as typeof page.off;
  const emit = (event: string, value: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(value);
  };
  (fixture.session as unknown as { observeIdentity(current: Page): void }).observeIdentity(page);
  let currentUrl = 'https://fanqienovel.com/main/writer/data';
  page.url = () => currentUrl;
  page.goto = (async (url: string) => {
    currentUrl = url;
    emit('framenavigated', null);
    for (const source of sources) {
      const request = { url: () => source, method: () => 'GET', resourceType: () => 'xhr' };
      emit('request', request);
      emit('response', {
        url: () => source,
        status: () => 200,
        ok: () => true,
        request: () => request,
        json: async () => ({ code: 0, data: {} }),
      });
    }
    // Actual early GETs remain known only to this operation after the SPA history transition clears global caches.
    emit('framenavigated', null);
    return null;
  }) as Page['goto'];
  page.waitForLoadState = async () => undefined;
  const calls: string[] = [];
  const schema = {
    code: 0,
    data: {
      BookCommonData: {
        CurrentReaderUV: 'PRIVATE_METRIC_VALUE',
        CurrentReadingUserCount: 1,
        ChaseReadNumber: 0,
      },
    },
  };
  page.evaluate = (async (callback: unknown, arg: unknown) => {
    if (new URL('../platform-reads.test.ts', import.meta.url).href.endsWith('.js'))
      assert.equal(String(callback).includes('__name'), false);
    if (typeof arg === 'string') {
      calls.push(arg);
      return {
        status: 200,
        ok: true,
        json:
          arg === CANONICAL_OWN_USER_URL
            ? { code: 0, data: { id: '1001', name: 'PRIVATE_OWNER' } }
            : schema,
      };
    }
    if (arg && typeof arg === 'object')
      return {
        elements: [],
        links: [],
        navigationLabels: [],
        internalBookTitles: ['CurrentReadingUserCount'],
        truncated: false,
      };
    return { loginRequired: false, managementVisible: true, ownAccount: null };
  }) as Page['evaluate'];
  return { ...fixture, page, emit, calls, schema };
}

export const longMetricListUrl =
  'https://fanqienovel.com/api/author/stats/book_list/v0/?page_index=0';

export const longMetricCommonUrl =
  'https://fanqienovel.com/api/author/stats/book_common_v1/v0/?book_id=1001';

export const longMetricBook = (book_id: string) => ({
  book_id,
  book_name: `FIXTURE_METRIC_TITLE_${book_id}`,
  word_number: 0,
  creation_status: 0,
  read_count: '--',
});

export const longMetricList = (stats_book_list: unknown[], total_count: unknown) => ({
  status: 200,
  ok: true,
  json: { code: 0, data: { stats_book_list, total_count } },
});

export const longMetricCommon = (id: string, values: Record<string, unknown> = {}) => ({
  status: 200,
  ok: true,
  json: {
    code: 0,
    data: {
      book_name: longMetricBook(id).book_name,
      update_time: '2026-10-01',
      reader_uv_daily: '0',
      pursue_read_rate: '0%',
      ...values,
    },
  },
});

export const apiCollectorCases = [
  {
    collect: collectShortMetrics,
    source: 'https://fanqienovel.com/api/author/sa_stats/book_list/v0/?page_index=0',
    empty: { status: 200, ok: true, json: { code: 0, data: { stats_book_list: [] } } },
  },
  { collect: collectLongWorks, source: longLoadedUrl, empty: longApi([], 0) },
  { collect: collectLongMetrics, source: longMetricListUrl, empty: longMetricList([], 0) },
] as const;
