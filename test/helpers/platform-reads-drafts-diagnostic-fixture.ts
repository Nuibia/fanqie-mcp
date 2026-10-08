import { fakeBrowser } from './platform-reads-metrics-page.js';

import {
  CHAPTER_ENTRY_FIXTURE_WORK,
  CHAPTER_ENTRY_FIXTURE_TITLE,
} from './platform-reads-chapter-entry-fixture-work.js';

import { CANONICAL_OWN_USER_URL } from '../../src/platform/browser.js';

import { type Page } from 'playwright';

import assert from 'node:assert/strict';

import { runInNewContext } from 'node:vm';

export function draftsDiagnosticFixture(
  options: {
    tabLabels?: readonly string[];
    hiddenDraft?: boolean;
    disabledDraft?: boolean;
    noBookSource?: boolean;
    wrongBook?: boolean;
    wrongTitle?: boolean;
    parentSourceOtherWork?: boolean;
    alreadyActive?: boolean;
    stayInactive?: boolean;
    changeOwner?: boolean;
    destination?: string;
    post?: boolean;
    spa?: boolean;
    staleBookFetch?: number;
    omitDraftSource?: boolean;
    leaveAndReturn?: boolean;
    draftSourceWorkId?: string;
    duplicateDraftParent?: boolean;
    delayedQueryPhase?: 'active' | 'networkidle';
    delayedQueryInvalidReturn?: boolean;
    blockedRequests?: Array<{
      url: string;
      method: string;
      resourceType?: string;
      navigation?: boolean;
    }>;
  } = {},
) {
  const { session, pages } = fakeBrowser();
  const page = pages[0]!;
  const initial = `https://fanqienovel.com/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}&${encodeURIComponent(CHAPTER_ENTRY_FIXTURE_TITLE)}?type=1`;
  const targetRef = 'a'.repeat(24);
  let currentUrl = initial;
  let clicked = 0;
  let blocked = 0;
  let forwarded = 0;
  let bookReads = 0;
  let unknownBodyReads = 0;
  let privateRequestFieldReads = 0;
  let active = Boolean(options.alreadyActive);
  const ownUrl = CANONICAL_OWN_USER_URL;
  const bookUrl = `https://fanqienovel.com/api/author/book/book_detail/v0/?book_id=${options.parentSourceOtherWork ? '7600000000000000002' : CHAPTER_ENTRY_FIXTURE_WORK}&nonce=PRIVATE_PARENT_NONCE`;
  const draftUrl = `https://fanqienovel.com/api/author/chapter/synthetic_draft_directory/v1?book_id=${options.draftSourceWorkId ?? CHAPTER_ENTRY_FIXTURE_WORK}${options.duplicateDraftParent ? '&work_id=' + CHAPTER_ENTRY_FIXTURE_WORK : ''}&token=PRIVATE_DRAFT_TOKEN`;
  const handlers = new Map<string, Set<(value: unknown) => void>>();
  const emit = (event: string, value: unknown) => {
    for (const handler of handlers.get(event) ?? []) handler(value);
  };
  page.on = ((event: string, handler: (value: unknown) => void) => {
    let set = handlers.get(event);
    if (!set) handlers.set(event, (set = new Set()));
    set.add(handler);
    return page;
  }) as typeof page.on;
  page.off = ((event: string, handler: (value: unknown) => void) => {
    handlers.get(event)?.delete(handler);
    return page;
  }) as typeof page.off;
  page.url = () => currentUrl;
  const request = (url: string, method = 'GET', navigation = false) => ({
    url: () => url,
    method: () => method,
    isNavigationRequest: () => navigation,
    frame: () => null,
    resourceType: (): string => (navigation ? 'document' : 'xhr'),
  });
  const own = () => ({
    code: 0,
    data: { id: clicked && options.changeOwner ? '3001' : '1001', name: 'PRIVATE_OWNER_NAME' },
  });
  const book = () => ({
    code: 0,
    data: {
      book_id: options.wrongBook ? '7600000000000000002' : CHAPTER_ENTRY_FIXTURE_WORK,
      book_name: options.wrongTitle ? 'PRIVATE_OTHER_WORK' : CHAPTER_ENTRY_FIXTURE_TITLE,
      content: 'PRIVATE_BOOK_BODY',
    },
  });
  const observe = (raw: string) => {
    const source = request(raw);
    emit('request', source);
    emit('response', {
      url: source.url,
      request: () => source,
      status: () => 200,
      ok: () => true,
      json: async () => {
        if (raw === draftUrl) {
          unknownBodyReads += 1;
          throw new Error('PRIVATE_DRAFT_BODY_MUST_NOT_BE_READ');
        }
        return raw === ownUrl ? own() : book();
      },
    });
  };
  const internal = session as unknown as {
    observeIdentity(page: Page): void;
    diagnosticTargets: Map<string, string>;
    discoveredStableTargets: Set<string>;
  };
  internal.diagnosticTargets.set(targetRef, initial);
  internal.discoveredStableTargets.add(new URL(initial).origin + new URL(initial).pathname);
  internal.observeIdentity(page);
  let routeHandler: ((route: unknown) => Promise<void>) | null = null;
  page.route = (async (_pattern: unknown, handler: (route: unknown) => Promise<void>) => {
    routeHandler = handler;
  }) as unknown as Page['route'];
  page.unroute = (async () => {
    routeHandler = null;
  }) as Page['unroute'];
  const throughGuard = async (source: ReturnType<typeof request>) => {
    if (!routeHandler) return true;
    let allowed = false;
    await routeHandler({
      request: () => source,
      async abort() {
        blocked += 1;
      },
      async continue() {
        forwarded += 1;
        allowed = true;
      },
    });
    return allowed;
  };
  page.goto = (async (url: string) => {
    emit('request', request(url, 'GET', true));
    currentUrl = url;
    emit('framenavigated', null);
    observe(ownUrl);
    if (!options.noBookSource) observe(bookUrl);
    return null;
  }) as Page['goto'];
  const delayedTransition = () => {
    if (options.delayedQueryInvalidReturn) {
      currentUrl = 'https://fanqienovel.com/main/writer/create-book';
      emit('framenavigated', null);
    }
    currentUrl = initial.replace('?type=1', '?type=5');
    emit('framenavigated', null);
  };
  page.waitForLoadState = async () => {
    if (clicked && options.delayedQueryPhase === 'networkidle') delayedTransition();
  };
  const labels = options.tabLabels ?? ['章节管理', '草稿箱'];
  const tabs = labels.map((label) => ({
    tagName: 'DIV',
    textContent: label,
    getAttribute(name: string) {
      if (name === 'role') return 'tab';
      if (name === 'aria-disabled' && options.disabledDraft && label === '草稿箱') return 'true';
      if (name === 'aria-selected') return String(label === '草稿箱' ? active : !active);
      if (name === 'class')
        return `arco-tabs-header-title${(label === '草稿箱' ? active : !active) ? ' arco-tabs-header-title-active' : ''}`;
      return null;
    },
    hasAttribute() {
      return false;
    },
    getBoundingClientRect() {
      return { width: options.hiddenDraft && label === '草稿箱' ? 0 : 100, height: 30 };
    },
    querySelector() {
      return null;
    },
  }));
  const nav = {
    tagName: 'DIV',
    textContent: '章节管理',
    getAttribute() {
      return 'new-nav-wrap';
    },
    getBoundingClientRect() {
      return { width: 100, height: 30 };
    },
  };
  const document = {
    body: { innerText: '章节管理' },
    querySelector(selector: string) {
      return selector === '.new-nav-wrap' ? nav : null;
    },
    querySelectorAll(selector: string) {
      return selector === '.chapter-manage-tabs [role="tab"]'
        ? tabs
        : selector === '.new-nav-item-label'
          ? [nav]
          : selector === 'a[href]' ||
              selector === '.book-select-title,.info-content-title' ||
              selector === '.chapter-status-select .byte-select-view-value' ||
              selector === '.chapter-select-left .serial-select' ||
              selector === '.arco-pagination,.byte-pagination'
            ? []
            : tabs;
    },
  };
  const execute = (callback: unknown, arg: unknown) => {
    const source = String(callback);
    const production = new URL('../platform-reads.test.ts', import.meta.url).href.endsWith('.js');
    if (production) assert.equal(source.includes('__name'), false);
    return runInNewContext(`(${source})(arg)`, {
      arg,
      document,
      window: { _ROUTER_DATA: {} },
      location: new URL(currentUrl),
      URLSearchParams,
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
      fetch: async (raw: string, init: Record<string, unknown>) => {
        assert.equal(init.method, 'GET');
        assert.equal(init.redirect, 'error');
        assert.ok(raw === ownUrl || raw === bookUrl, 'No draft API or guessed URL may be fetched');
        if (!(await throughGuard(request(raw)))) throw new Error('PRIVATE_BLOCKED_FETCH');
        if (raw === bookUrl) {
          bookReads += 1;
          if (bookReads === options.staleBookFetch) {
            currentUrl = `${initial}&tab=2`;
            emit('framenavigated', null);
          }
        }
        observe(raw);
        return { status: 200, ok: true, json: async () => (raw === ownUrl ? own() : book()) };
      },
      ...(production ? {} : { __name: (value: unknown) => value }),
    });
  };
  page.evaluate = (async (callback: unknown, arg: unknown) =>
    execute(callback, arg)) as Page['evaluate'];
  page.waitForFunction = (async (callback: unknown, arg: unknown) => {
    if (
      clicked &&
      options.delayedQueryPhase === 'active' &&
      arg !== null &&
      typeof arg === 'object' &&
      'pathname' in arg &&
      'workId' in arg
    )
      delayedTransition();
    if (!(await execute(callback, arg))) throw new Error('PRIVATE_WAIT_FAILED');
  }) as unknown as Page['waitForFunction'];
  page.locator = ((selector: string) => {
    assert.equal(selector, '.chapter-manage-tabs [role="tab"]');
    return {
      filter({ hasText }: { hasText: RegExp }) {
        return {
          async count() {
            return tabs.filter((tab) => hasText.test(tab.textContent)).length;
          },
        };
      },
      nth(index: number) {
        return {
          async click() {
            assert.equal(tabs[index]?.textContent, '草稿箱');
            clicked += 1;
            if (options.blockedRequests) {
              for (const input of options.blockedRequests) {
                const source = Object.defineProperties(
                  {
                    ...request(input.url, input.method, Boolean(input.navigation)),
                    resourceType: () =>
                      input.resourceType ?? (input.navigation ? 'document' : 'xhr'),
                  },
                  {
                    postData: {
                      get() {
                        privateRequestFieldReads += 1;
                        throw new Error('PRIVATE_POST_BODY_ACCESS');
                      },
                    },
                    headers: {
                      get() {
                        privateRequestFieldReads += 1;
                        throw new Error('PRIVATE_HEADER_ACCESS');
                      },
                    },
                  },
                );
                await throughGuard(source);
              }
              return;
            }
            if (options.post) {
              await throughGuard(
                request('https://fanqienovel.com/api/author/chapter/save/v0/', 'POST'),
              );
              return;
            }
            const destination = options.destination ?? initial.replace('?type=1', '?type=4');
            if (!options.spa && !(await throughGuard(request(destination, 'GET', true)))) return;
            if (!options.spa) emit('request', request(destination, 'GET', true));
            currentUrl = destination;
            emit('framenavigated', null);
            if (options.leaveAndReturn) {
              currentUrl = 'https://fanqienovel.com/main/writer/create-book';
              emit('framenavigated', null);
              currentUrl = destination;
              emit('framenavigated', null);
            }
            active = !options.stayInactive;
            if (!options.omitDraftSource && (await throughGuard(request(draftUrl))))
              observe(draftUrl);
          },
        };
      },
    };
  }) as unknown as Page['locator'];
  return {
    session,
    page,
    targetRef,
    initial,
    get clicked() {
      return clicked;
    },
    get blocked() {
      return blocked;
    },
    get forwarded() {
      return forwarded;
    },
    get bookReads() {
      return bookReads;
    },
    get unknownBodyReads() {
      return unknownBodyReads;
    },
    get privateRequestFieldReads() {
      return privateRequestFieldReads;
    },
    get guardInstalled() {
      return routeHandler !== null;
    },
    diagnose: () => session.diagnoseReadPage(`diagnostic:${targetRef}`, { chapterTab: 'drafts' }),
  };
}
