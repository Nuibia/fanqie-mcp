import { contextVolumeProbeFixture } from './platform-reads-context-volume-probe-fixture.js';

import {
  DRAFT_DIRECTORY_SOURCE,
  DRAFT_DIRECTORY_NEXT,
} from './platform-reads-draft-directory-source.js';

import {
  CURRENT_DIRECTORY_BOOK,
  currentBookJson,
  currentDirectoryFixture,
} from './platform-reads-assert-context-probe-safe.js';

import { CONTEXT_PROBE_TARGET } from './platform-reads-legacy-chapter-application-fixture.js';

import assert from 'node:assert/strict';

import { runInNewContext } from 'node:vm';

import { type Page } from 'playwright';

import { type LoginState, BrowserSession } from '../../src/platform/browser.js';

import { CHAPTER_ENTRY_FIXTURE_WORK } from './platform-reads-chapter-entry-fixture-work.js';

export function chapterDraftDirectoryFixture(
  options: Parameters<typeof contextVolumeProbeFixture>[0] & {
    empty?: boolean;
    noNext?: boolean;
    tabChanged?: boolean;
    leaveAndReturn?: boolean;
    nextChanged?: boolean;
    totalDrift?: boolean;
    repeatedId?: boolean;
    initialSource?: string;
    nextSource?: string;
    noTable?: boolean;
    pageDelay?: number;
    handleDisposeError?: boolean;
    delayedNext?: number;
    entryUnknownNavigation?: boolean;
    noTabRole?: boolean;
    roleOnlyTab?: boolean;
    duplicateTab?: boolean;
    unrelatedDraftLabel?: boolean;
    disabledTab?: boolean;
    delayedTab?: number;
  } = {},
) {
  const row = (id: string) => ({
    item_id: id,
    title: 'Synthetic draft list title',
    word_number: 10,
    modify_time: 'RAW_DRAFT_MODIFIED',
    content: 'PRIVATE_DRAFT_BODY',
  });
  const initialSource = options.initialSource ?? DRAFT_DIRECTORY_SOURCE;
  const replies = {
    [CURRENT_DIRECTORY_BOOK]: currentBookJson(),
    [initialSource]: {
      code: 0,
      data: {
        total_count: options.empty ? 0 : 2,
        draft_list: options.empty ? [] : [row('7900000000000000001')],
      },
    },
    [DRAFT_DIRECTORY_NEXT]: {
      code: 0,
      data: {
        total_count: options.totalDrift ? 3 : 2,
        draft_list: [row(options.repeatedId ? '7900000000000000001' : '7900000000000000002')],
      },
    },
  };
  const fixture = currentDirectoryFixture({
    ...options,
    directoryReplies: { ...replies, ...options.directoryReplies },
    sources: options.sources ?? [{ url: CURRENT_DIRECTORY_BOOK }, { url: initialSource }],
  });
  const internals = fixture.session as unknown as {
    openExistingChapterDirectory(...args: unknown[]): Promise<unknown>;
  };
  const existingEntry = internals.openExistingChapterDirectory.bind(internals);
  internals.openExistingChapterDirectory = async (...args) => {
    const entry = await existingEntry(...args);
    fixture.setUrl(CONTEXT_PROBE_TARGET);
    fixture.emit('framenavigated', fixture.page.mainFrame());
    return entry;
  };
  const withPage = fixture.session.withPage.bind(fixture.session);
  fixture.session.withPage = ((read, callOptions = {}) =>
    withPage(read, { timeoutMs: 8_000, ...callOptions })) as typeof fixture.session.withPage;
  let active = false,
    index = 0,
    tabClicks = 0,
    nextClicks = 0,
    handleDisposals = 0,
    tabReplaced = false,
    nextReplaced = false,
    readyAt = 0,
    tabReadyAt: number | null = null;
  class Node {
    isConnected = true;
    constructor(
      public tagName: string,
      public textContent = '',
      public attrs: Record<string, string> = {},
    ) {}
    getAttribute(name: string) {
      return this.attrs[name] ?? null;
    }
    hasAttribute(name: string) {
      return name in this.attrs;
    }
    get classList() {
      return { contains: (key: string) => (this.attrs.class ?? '').split(/\s+/).includes(key) };
    }
    getBoundingClientRect() {
      return { width: this.isConnected ? 100 : 0, height: this.isConnected ? 30 : 0 };
    }
    querySelectorAll(_selector: string): Node[] {
      return [];
    }
  }
  const manager = new Node('DIV', '章节管理', {
      role: 'tab',
      'aria-selected': 'true',
      class: 'arco-tabs-header-title arco-tabs-header-title-active',
    }),
    tab = new Node('DIV', '草稿箱', {
      role: 'tab',
      'aria-selected': 'false',
      class: 'arco-tabs-header-title',
    }),
    replacedTab = new Node('DIV', '草稿箱', {
      role: 'tab',
      'aria-selected': 'true',
      class: 'arco-tabs-header-title arco-tabs-header-title-active',
    });
  const duplicateTab = new Node('DIV', '草稿箱', { class: 'arco-tabs-header-title' }),
    unrelatedDraftLabel = new Node('DIV', '草稿箱', {
      role: 'tab',
      class: 'arco-tabs-header-title',
    });
  if (options.noTabRole) {
    for (const node of [manager, tab, replacedTab]) {
      delete node.attrs.role;
      delete node.attrs['aria-selected'];
    }
  }
  if (options.roleOnlyTab) tab.attrs.class = '';
  if (options.disabledTab) tab.attrs['aria-disabled'] = 'true';
  const table = new Node('DIV', '', { class: 'draft-table auto-editor-draft' }),
    pager = new Node('DIV'),
    next = new Node('LI', '', { class: 'arco-pagination-item-next', role: 'button' }),
    replacementNext = new Node('LI', '', { class: 'arco-pagination-item-next', role: 'button' });
  const query = (selector: string): Node[] => {
    // This branch models only the official scoped header path; an identically
    // labelled node outside that path never participates in action binding.
    if (
      selector ===
      '.chapter-manage-tabs.serial-tabs.serial-tabs-text.arco-tabs-size-small .arco-tabs-header-nav .arco-tabs-header-title'
    ) {
      tabReadyAt ??= performance.now() + (options.delayedTab ?? 0);
      return performance.now() < tabReadyAt
        ? []
        : [
            manager,
            tabReplaced ? replacedTab : tab,
            ...(options.duplicateTab ? [duplicateTab] : []),
          ].filter((node) => node.classList.contains('arco-tabs-header-title'));
    }
    if (selector === '.chapter-manage-tabs [role="tab"]')
      assert.fail(
        'Draft collection must use the fixed official header path, not require an unobserved tab role',
      );
    if (selector === '[role="tab"],.arco-tabs-header-title')
      return options.unrelatedDraftLabel ? [unrelatedDraftLabel] : [];
    if (selector === '.draft-table.auto-editor-draft')
      return active && !options.noTable ? [table] : [];
    if (selector === '.arco-pagination,.byte-pagination') return [pager];
    assert.fail('The draft DOM function used an unexpected selector');
  };
  pager.querySelectorAll = (selector) => {
    assert.equal(
      selector,
      '.arco-pagination-item-next,.byte-pagination-item-next,[aria-label="下一页"],[aria-label="Next page"]',
    );
    return active &&
      index === 0 &&
      !options.empty &&
      !options.noNext &&
      performance.now() >= readyAt
      ? [nextReplaced ? replacementNext : next]
      : [];
  };
  const unwrap = (arg: any): any =>
    arg?.__draftHandle === true
      ? arg.value
      : Array.isArray(arg)
        ? arg.map(unwrap)
        : arg && Object.getPrototypeOf(arg) === Object.prototype
          ? Object.fromEntries(Object.entries(arg).map(([key, value]) => [key, unwrap(value)]))
          : arg;
  const execute = (callback: unknown, arg: unknown) =>
    runInNewContext(`(${String(callback)})(arg)`, {
      arg: unwrap(arg),
      document: { querySelectorAll: query },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
      ...(new URL('../platform-reads.test.ts', import.meta.url).href.endsWith('.js')
        ? {}
        : { __name: (value: unknown) => value }),
    });
  fixture.page.evaluate = (async (callback: unknown, arg: unknown) => {
    const input = unwrap(arg);
    if (options.pageDelay && input?.mode === 'state' && fixture.getCount)
      await new Promise((resolve) => setTimeout(resolve, options.pageDelay));
    return execute(callback, arg);
  }) as Page['evaluate'];
  fixture.page.waitForFunction = (async (callback: unknown, arg: unknown) => {
    assert.equal(execute(callback, arg), true);
  }) as unknown as Page['waitForFunction'];
  const handle = (value: any): any => ({
    __draftHandle: true,
    value,
    asElement() {
      return value instanceof Node ? this : null;
    },
    async getProperty(key: string) {
      if (key === 'tab' && options.tabChanged && !tabReplaced) {
        tabReplaced = true;
        tab.isConnected = false;
      }
      if (key === 'next' && value?.next && options.nextChanged && !nextReplaced) {
        nextReplaced = true;
        next.isConnected = false;
      }
      return handle(value?.[key]);
    },
    async click() {
      assert.equal(value.isConnected, true);
      if (value === tab) {
        tabClicks++;
        if (options.entryUnknownNavigation)
          await fixture.triggerBlocked({
            url: CONTEXT_PROBE_TARGET,
            method: 'GET',
            navigation: 'unknown',
          });
        active = true;
        if (!options.noTabRole) {
          tab.attrs['aria-selected'] = 'true';
          manager.attrs['aria-selected'] = 'false';
        }
        tab.attrs.class = 'arco-tabs-header-title arco-tabs-header-title-active';
        manager.attrs.class = 'arco-tabs-header-title';
        const actual = CONTEXT_PROBE_TARGET.replace('type=1', 'type=2');
        fixture.setUrl(actual);
        fixture.emit('framenavigated', fixture.page.mainFrame());
        if (options.leaveAndReturn) {
          fixture.setUrl('https://fanqienovel.com/main/writer/create-book');
          fixture.emit('framenavigated', fixture.page.mainFrame());
          fixture.setUrl(actual);
          fixture.emit('framenavigated', fixture.page.mainFrame());
        }
        readyAt = performance.now() + (options.delayedNext ?? 0);
      } else {
        assert.equal(value, next, 'Never click a replacement draft next control');
        nextClicks++;
        index++;
        fixture.emitSource({ url: options.nextSource ?? DRAFT_DIRECTORY_NEXT });
      }
    },
    async dispose() {
      handleDisposals++;
      if (options.handleDisposeError && fixture.getCount)
        throw Error('PRIVATE_DRAFT_HANDLE_FAILURE');
    },
  });
  fixture.page.evaluateHandle = (async (callback: unknown, arg: unknown) =>
    handle(await fixture.page.evaluate(callback as never, arg as never))) as Page['evaluateHandle'];
  let currentGuard: ((route: unknown) => Promise<void>) | null = null;
  const route = fixture.page.route.bind(fixture.page);
  fixture.page.route = (async (
    pattern: Parameters<Page['route']>[0],
    handler: Parameters<Page['route']>[1],
  ) => {
    currentGuard = handler as unknown as (route: unknown) => Promise<void>;
    return await route(pattern, handler);
  }) as unknown as Page['route'];
  const invokeAllowedRoute = (continued: () => Promise<void>) => {
    assert(currentGuard);
    return currentGuard({
      request: () => fixture.request(DRAFT_DIRECTORY_SOURCE),
      async abort() {
        assert.fail('The valid synthetic draft GET must not be blocked');
      },
      continue: continued,
    });
  };
  const invokeGuardedRoute = (
    url: string,
    continued: () => Promise<void>,
    aborted: () => Promise<void>,
  ) => {
    assert(currentGuard);
    return currentGuard({
      request: () => fixture.request(url),
      abort: aborted,
      continue: continued,
    });
  };
  const identities: LoginState[] = [];
  const call = (
    extra: Partial<Parameters<BrowserSession['collectCurrentChapterDraftDirectory']>[2]> = {},
  ) =>
    fixture.session.withPage(
      (page) =>
        fixture.session.collectCurrentChapterDraftDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK, {
          jobId: '12345678-1234-1234-1234-123456789abc',
          expectedOwner: { kind: 'account', id: '1001' },
          onVerifiedOwner: (state) => identities.push(state),
          timeoutMs: 4_000,
          ...extra,
        }),
      { signal: extra.signal },
    );
  const result = Object.assign(fixture, {
    call,
    identities,
    invokeAllowedRoute,
    invokeGuardedRoute,
  });
  Object.defineProperties(result, {
    tabClicks: { get: () => tabClicks },
    nextClicks: { get: () => nextClicks },
    handleDisposals: { get: () => handleDisposals },
  });
  return result as typeof result & {
    readonly tabClicks: number;
    readonly nextClicks: number;
    readonly handleDisposals: number;
  };
}
