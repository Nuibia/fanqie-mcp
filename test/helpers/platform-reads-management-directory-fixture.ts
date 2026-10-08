import { CHAPTER_ENTRY_FIXTURE_WORK } from './platform-reads-chapter-entry-fixture-work.js';

import {
  CURRENT_CHAPTER_VOLUME,
  currentChapterJson,
  CURRENT_DIRECTORY_BOOK,
  currentBookJson,
  CURRENT_CHAPTER_ITEM,
  currentDirectoryFixture,
} from './platform-reads-assert-context-probe-safe.js';

import {
  CONTEXT_PROBE_SOURCE,
  CONTEXT_PROBE_TARGET,
} from './platform-reads-legacy-chapter-application-fixture.js';

import assert from 'node:assert/strict';

import { runInNewContext } from 'node:vm';

import { type Page } from 'playwright';

import { CANONICAL_OWN_USER_URL } from '../../src/platform/browser.js';

/** Executes the private management DOM functions in a separate realm, not a prefilled coverage DTO. */
export function managementDirectoryFixture(
  options: {
    portal?: boolean;
    noNext?: boolean;
    unknownOption?: boolean;
    clipped?: boolean;
    mutateControl?: boolean;
    wrongView?: 'old_loader' | 'other_work' | 'ambiguous';
    lateNavigation?: boolean;
    ownerAfter?: boolean;
    detachError?: boolean;
    callbackError?: boolean;
    onePage?: boolean;
    delayedView?: boolean;
    repeatedChapter?: boolean;
    totalDrift?: boolean;
    cleanupError?: boolean;
    preopenedPortal?: boolean;
    reuseViewRequestId?: boolean;
    initialFilterChange?: 'before' | 'after';
    boundAfterDeadline?: boolean;
    lastReadAfterDeadline?: boolean;
    finalOwnerAfterDeadline?: boolean;
    secondPaged?: boolean;
    pagerDelayMs?: number;
    unsupportedNextTag?: boolean;
    nextReplaced?: boolean;
    nextObservationExtent?: boolean;
    navigationWhileWaiting?: boolean;
  } = {},
) {
  const volumeB = '7700000000000000002';
  const inventory = {
    code: 0,
    data: {
      volume_list: [
        {
          index: 0,
          book_id: CHAPTER_ENTRY_FIXTURE_WORK,
          volume_id: CURRENT_CHAPTER_VOLUME,
          volume_name: 'Synthetic volume',
          item_count: options.onePage ? 1 : 2,
        },
        {
          index: 1,
          book_id: CHAPTER_ENTRY_FIXTURE_WORK,
          volume_id: volumeB,
          volume_name: 'Synthetic second volume',
          item_count: options.secondPaged ? 2 : 1,
        },
      ],
    },
  };
  const source = (volumeId: string, index: number) =>
    `https://fanqienovel.com/api/author/chapter/chapter_list/v1?book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&volume_id=${volumeId}&page_index=${index}&page_count=10&opaque_fixture=PRIVATE_CHAPTER_TOKEN%2f${volumeId === volumeB ? 'B' : 'A'}${index}`;
  const initial = source(CURRENT_CHAPTER_VOLUME, 0),
    next = source(CURRENT_CHAPTER_VOLUME, 1),
    second = source(volumeB, 0),
    secondNext = source(volumeB, 1);
  const row = (id: string, volumeId: string, index: number) => ({
    ...currentChapterJson().data.item_list[0]!,
    item_id: id,
    volume_id: volumeId,
    index,
  });
  const replies = {
    [CONTEXT_PROBE_SOURCE]: inventory,
    [CURRENT_DIRECTORY_BOOK]: currentBookJson(),
    [initial]: {
      code: 0,
      data: {
        total_count: options.onePage ? 1 : 2,
        item_list: [row(CURRENT_CHAPTER_ITEM, CURRENT_CHAPTER_VOLUME, 1)],
      },
    },
    [next]: {
      code: 0,
      data: {
        total_count: options.totalDrift ? 3 : 2,
        item_list: [
          row(
            options.repeatedChapter ? CURRENT_CHAPTER_ITEM : '7800000000000000002',
            CURRENT_CHAPTER_VOLUME,
            2,
          ),
        ],
      },
    },
    [second]: {
      code: 0,
      data: {
        total_count: options.secondPaged ? 2 : 1,
        item_list: [row('7800000000000000003', volumeB, 1)],
      },
    },
    [secondNext]: {
      code: 0,
      data: { total_count: 2, item_list: [row('7800000000000000004', volumeB, 2)] },
    },
  };
  const fixture = currentDirectoryFixture({
    directoryReplies: replies,
    sources: [{ url: CONTEXT_PROBE_SOURCE }, { url: CURRENT_DIRECTORY_BOOK }, { url: initial }],
    ...(options.ownerAfter ? { ownAfter: { json: { code: 0, data: { id: '1002' } } } } : {}),
    detachError: options.detachError,
  });
  // New 2.5-second readiness scenarios need an outer synthetic slot longer
  // than fakeBrowser's one-second default; the per-scope deadline is unchanged.
  if (options.secondPaged || options.unsupportedNextTag || options.nextObservationExtent) {
    const withPage = fixture.session.withPage.bind(fixture.session);
    fixture.session.withPage = ((reader, callOptions = {}) =>
      withPage(reader, { timeoutMs: 8_000, ...callOptions })) as typeof fixture.session.withPage;
  }
  let volume = CURRENT_CHAPTER_VOLUME,
    index = 0,
    popupOpen = options.preopenedPortal === true,
    clicks = 0,
    handleDisposals = 0,
    replaced = false,
    pagerReadyAt = 0,
    nextMutated = false,
    waitingNavigationScheduled = false,
    nextInspections = 0,
    observations = 0;
  class Node {
    isConnected = true;
    scrollHeight = 20;
    clientHeight = 20;
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
      return { contains: (value: string) => (this.attrs.class ?? '').split(/\s+/).includes(value) };
    }
    getBoundingClientRect() {
      return { width: this.isConnected ? 20 : 0, height: this.isConnected ? 20 : 0 };
    }
    querySelectorAll(_selector: string): Node[] {
      return [];
    }
    querySelector(selector: string): Node | null {
      return this.querySelectorAll(selector)[0] ?? null;
    }
  }
  const control = new Node('DIV', '', { class: 'serial-select' }),
    view = new Node('DIV', '', { class: 'byte-select-view' });
  if (options.preopenedPortal) control.attrs.class = 'serial-select byte-select-open';
  const replacement = new Node('DIV', '', { class: 'serial-select chapter-status-select' });
  const label = new Node('DIV', 'Synthetic volume'),
    table = new Node('DIV'),
    status = new Node('DIV', '全部');
  if (options.initialFilterChange === 'before') status.textContent = '已发布';
  const activeTab = new Node('DIV', '章节管理', { role: 'tab', 'aria-selected': 'true' });
  const popup = new Node('DIV', '', { class: 'byte-select-popup' }),
    inner = new Node('DIV');
  const optionsDom = inventory.data.volume_list.map(
    (item) =>
      new Node('DIV', item.volume_name, { class: 'byte-select-option chapter-select-option' }),
  );
  if (options.unknownOption) optionsDom[1]!.textContent += ' 1章';
  if (options.clipped) inner.scrollHeight = 200;
  const pager = new Node('DIV', '', { class: 'arco-pagination' }),
    nextControl = new Node('LI', '', { class: 'arco-pagination-item-next', role: 'button' });
  if (options.unsupportedNextTag) {
    nextControl.tagName = 'DIV';
    delete nextControl.attrs.role;
  }
  const knownExtras = Array.from(
    { length: 40 },
    () =>
      new Node('BUTTON', 'PRIVATE_PAGER_TITLE', {
        class: 'arco-pagination-item-next',
        role: 'button',
        disabled: '',
      }),
  );
  const replacementNext = new Node('LI', 'PRIVATE_REPLACEMENT', {
    class: 'arco-pagination-item-next',
    role: 'button',
  });
  control.querySelectorAll = (selector) =>
    selector === '.byte-select-view'
      ? [view]
      : selector === '.byte-select-view-value'
        ? [label]
        : selector === '.byte-select-popup' && popupOpen && !options.portal
          ? [popup]
          : [];
  popup.querySelectorAll = (selector) =>
    selector === '.byte-select-option'
      ? optionsDom
      : selector === '.byte-select-popup-inner'
        ? [inner]
        : [];
  pager.querySelectorAll = (selector) => {
    assert.equal(
      selector,
      '.arco-pagination-item-next,.byte-pagination-item-next,[aria-label="下一页"],[aria-label="Next page"]',
    );
    if (options.nextObservationExtent) return knownExtras;
    const needed =
      ((volume === CURRENT_CHAPTER_VOLUME && !options.onePage) ||
        (volume === volumeB && options.secondPaged)) &&
      index === 0;
    return !options.noNext && needed && Date.now() >= pagerReadyAt
      ? [nextMutated ? replacementNext : nextControl]
      : [];
  };
  const query = (selector: string): Node[] => {
    switch (selector) {
      case '.chapter-select-left .serial-select':
        return replaced ? [replacement] : [control];
      case '.chapter-manage-tabs [role="tab"]':
        return [activeTab];
      case '.chapter-status-select .byte-select-view-value':
        return [status];
      case '.byte-select-popup':
        return popupOpen ? [popup] : [];
      case '.serial-select.byte-select-open':
        return popupOpen ? [control] : [];
      case '.arco-pagination,.byte-pagination':
        return [pager];
      default:
        assert.fail(`Unexpected management-only selector: ${selector}`);
    }
  };
  const unwrap = (arg: any): any =>
    arg?.__managementHandle === true
      ? arg.value
      : Array.isArray(arg)
        ? arg.map(unwrap)
        : arg && Object.getPrototypeOf(arg) === Object.prototype
          ? Object.fromEntries(Object.entries(arg).map(([key, value]) => [key, unwrap(value)]))
          : arg;
  fixture.page.evaluate = (async (callback: unknown, arg: unknown) => {
    const callbackSource = String(callback);
    if (new URL('../platform-reads.test.ts', import.meta.url).href.endsWith('.js'))
      assert.equal(callbackSource.includes('__name'), false);
    const input = unwrap(arg);
    if (options.boundAfterDeadline && input?.mode === 'next' && input.next)
      await new Promise((resolve) => setTimeout(resolve, 240));
    if (input?.mode === 'next') {
      nextInspections++;
      if (options.navigationWhileWaiting && !waitingNavigationScheduled) {
        waitingNavigationScheduled = true;
        setTimeout(() => fixture.emitNewDocument(CONTEXT_PROBE_TARGET, fixture.currentLoader), 10);
      }
    }
    const metadataObservation = callbackSource.includes('management_next_control_observation');
    if (metadataObservation) observations++;
    const evaluated = runInNewContext(`(${callbackSource})(arg)`, {
      arg: input,
      document: {
        querySelectorAll: query,
        querySelector: (selector: string) =>
          selector === '.chapter-table' ? table : (query(selector)[0] ?? null),
      },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
      ...(new URL('../platform-reads.test.ts', import.meta.url).href.endsWith('.js')
        ? {}
        : { __name: (value: unknown) => value }),
    });
    // Playwright transfers page.evaluate metadata by value. Keep private DOM
    // nodes and ElementHandle identity untouched in every other fixture path.
    return metadataObservation ? structuredClone(evaluated) : evaluated;
  }) as Page['evaluate'];
  const handle = (value: any): any => ({
    __managementHandle: true,
    value,
    asElement() {
      return value instanceof Node ? this : null;
    },
    async getProperty(key: string) {
      if (key === 'view' && options.mutateControl && !replaced) {
        replaced = true;
        control.isConnected = false;
        view.isConnected = false;
      }
      if (key === 'next' && value?.next && options.nextReplaced && !nextMutated) {
        nextMutated = true;
        nextControl.isConnected = false;
      }
      return handle(value?.[key]);
    },
    async getProperties() {
      return new Map(Object.keys(value ?? {}).map((key) => [key, handle(value[key])]));
    },
    async evaluate(callback: unknown) {
      return fixture.page.evaluate(callback as never, value);
    },
    async click() {
      assert.equal(value.isConnected, true);
      clicks += 1;
      if (value === view) {
        popupOpen = true;
        control.attrs.class = 'serial-select byte-select-open';
        return;
      }
      if (value === nextControl) index += 1;
      else {
        const selected = optionsDom.indexOf(value);
        assert.ok(selected >= 0);
        volume = inventory.data.volume_list[selected]!.volume_id;
        index = 0;
        label.textContent = inventory.data.volume_list[selected]!.volume_name;
        popupOpen = false;
        control.attrs.class = 'serial-select';
      }
      pagerReadyAt = Date.now() + (options.pagerDelayMs ?? 0);
      if (options.lateNavigation) {
        fixture.emitNewDocument(CONTEXT_PROBE_TARGET, fixture.currentLoader);
        return;
      }
      const url = source(volume, index);
      const emitView = () => {
        fixture.emitSource({
          ...(options.reuseViewRequestId ? { cdp: { requestId: 'SYNTHETIC_REUSED_VIEW_ID' } } : {}),
          url:
            options.wrongView === 'other_work'
              ? url.replace(CHAPTER_ENTRY_FIXTURE_WORK, '7600000000000000002')
              : url,
          ...(options.wrongView === 'old_loader'
            ? { cdp: { loaderId: 'OLD_DIRECTORY_LOADER' } }
            : {}),
        });
        if (options.wrongView === 'ambiguous')
          fixture.emitSource({ url: url + '&different=PRIVATE_DIFFERENT_SIGNATURE' });
      };
      if (options.delayedView) setTimeout(emitView, 0);
      else emitView();
    },
    async dispose() {
      handleDisposals += 1;
    },
  });
  fixture.page.evaluateHandle = (async (callback: unknown, arg: unknown) =>
    handle(await fixture.page.evaluate(callback as never, arg as never))) as Page['evaluateHandle'];
  const ownedContext = fixture.page.context(),
    ownedGet = ownedContext.request.get.bind(ownedContext.request);
  ownedContext.request.get = (async (url: string, args) => {
    const response = await ownedGet(url, args);
    if (url === initial && options.initialFilterChange)
      status.textContent = options.initialFilterChange === 'before' ? '全部' : '已发布';
    if (
      url === CANONICAL_OWN_USER_URL &&
      fixture.ownGetCount === 2 &&
      options.finalOwnerAfterDeadline
    ) {
      const json = response.json.bind(response);
      response.json = async () => {
        await new Promise((resolve) => setTimeout(resolve, 240));
        return json();
      };
    }
    if (url === second && options.lastReadAfterDeadline) {
      const json = response.json.bind(response);
      response.json = async () => {
        await new Promise((resolve) => setTimeout(resolve, 240));
        return json();
      };
    }
    return response;
  }) as typeof ownedContext.request.get;
  if (options.cleanupError) {
    const unroute = fixture.page.unroute.bind(fixture.page);
    let removes = 0;
    fixture.page.unroute = (async (...args: Parameters<Page['unroute']>) => {
      await unroute(...args);
      removes += 1;
      if (removes === 2) throw Error('PRIVATE_UNROUTE_FAILURE');
    }) as Page['unroute'];
  }
  const call = (override: Parameters<typeof fixture.call>[0] = {}) =>
    fixture.call({
      timeoutMs:
        options.boundAfterDeadline ||
        options.lastReadAfterDeadline ||
        options.finalOwnerAfterDeadline
          ? 200
          : options.secondPaged || options.unsupportedNextTag || options.nextObservationExtent
            ? 4_000
            : 500,
      ...(options.callbackError
        ? {
            onVerifiedOwner: () => {
              throw Error('PRIVATE_OWNER_CALLBACK');
            },
          }
        : {}),
      ...override,
    });
  return {
    ...fixture,
    call,
    initial,
    next,
    second,
    secondNext,
    get clicks() {
      return clicks;
    },
    get handleDisposals() {
      return handleDisposals;
    },
    get nextInspections() {
      return nextInspections;
    },
    get observations() {
      return observations;
    },
  };
}
