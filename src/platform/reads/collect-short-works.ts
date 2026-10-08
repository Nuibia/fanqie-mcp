import { type Page, type Request, type Response } from 'playwright';

import {
  type ReadOptions,
  makeDataset,
  identifierOrNull,
  normalizeShortStatus,
  numberOrNull,
  PlatformReadError,
} from './make-dataset.js';

import { type DatasetResult } from './is-metrics-dataset.js';

import {
  type ShortWork,
  navigate,
  inspectPageAccess,
  shortDom,
  pageLimit,
  allowedUrl,
} from './project-read-response-fields.js';

import { SHORT_WORKS_URL } from './fanqie-origin.js';

export async function collectShortWorks(
  page: Page,
  options: ReadOptions = {},
): Promise<DatasetResult<ShortWork>> {
  const result = makeDataset<ShortWork>('short_works', SHORT_WORKS_URL);
  try {
    await navigate(page, SHORT_WORKS_URL, options.timeoutMs);
    if ((await inspectPageAccess(page)).loginRequired) {
      result.status = 'login_required';
      return result;
    }
    let dom = await shortDom(page);
    if (!dom.cards.length && !dom.emptyVisible) {
      result.errors.push({ code: 'management_dom_unrecognized', scope: 'bootstrap' });
      return result;
    }
    const seen = new Set<string>();
    let maxPage = Math.max(1, ...dom.pageNumbers);
    let paginationObserved = dom.pageNumbers.length > 0;
    const limit = pageLimit(options);
    for (let index = 1; index <= Math.min(maxPage, limit); index += 1) {
      if (index > 1 || (dom.activePage && dom.activePage !== 1)) {
        const previousIds = dom.cards.map((card) => card.workId).join(',');
        const target = page.locator(`li[aria-label="第 ${index} 页"]`);
        if ((await target.count()) !== 1) {
          result.errors.push({
            code: 'pagination_control_missing',
            scope: 'management',
            page: index,
          });
          break;
        }
        await target.click();
        try {
          await page.waitForFunction(
            ({ index, previousIds }) => {
              const active = document
                .querySelector(`li[aria-label="第 ${index} 页"]`)
                ?.classList.contains('arco-pagination-item-active');
              const ids = [...document.querySelectorAll('a[href*="/main/writer/preview-short/"]')]
                .map(
                  (card) =>
                    card.getAttribute('href')?.match(/preview-short\/(\d{10,30})/)?.[1] ?? '',
                )
                .join(',');
              return active && ids.length > 0 && ids !== previousIds;
            },
            { index, previousIds },
            { timeout: options.timeoutMs ?? 8_000 },
          );
        } catch {
          result.errors.push({
            code: 'pagination_switch_timeout',
            scope: 'management',
            page: index,
          });
          break;
        }
        if ((await inspectPageAccess(page)).loginRequired) {
          result.status = 'login_required';
          result.records = [];
          result.coverage.recordsFetched = 0;
          return result;
        }
        dom = await shortDom(page);
        paginationObserved ||= dom.pageNumbers.length > 0;
        maxPage = Math.max(maxPage, ...dom.pageNumbers);
      }
      result.coverage.pagesFetched += 1;
      if (!dom.cards.length && !dom.emptyVisible) {
        result.errors.push({ code: 'empty_unrecognized_page', scope: 'management', page: index });
        break;
      }
      for (const card of dom.cards) {
        if (!identifierOrNull(card.workId) || !card.title || seen.has(card.workId)) {
          result.errors.push({
            code: 'missing_or_duplicate_work_id',
            scope: 'management',
            page: index,
          });
          continue;
        }
        seen.add(card.workId);
        result.records.push({
          workId: card.workId,
          title: card.title,
          managementUrl: card.managementUrl,
          statusTags: card.statusTags,
          ...normalizeShortStatus(card.statusTags),
          readCount: numberOrNull(card.readCountRaw.replace(/阅读|,/g, '').trim()),
          wordCount: numberOrNull(card.wordCountRaw.replace(/字|,/g, '').trim()),
          updatedAtRaw: card.updatedAtRaw || null,
        });
      }
    }
    result.coverage.pagesDiscovered = paginationObserved ? maxPage : dom.emptyVisible ? 1 : null;
    result.coverage.recordsFetched = result.records.length;
    result.coverage.fields = [
      'workId',
      'title',
      'managementUrl',
      'statusTags',
      'readCount',
      'wordCount',
      'updatedAtRaw',
    ];
    result.coverage.complete = result.coverage.paginationComplete =
      (paginationObserved || dom.emptyVisible) &&
      result.errors.length === 0 &&
      result.coverage.pagesFetched === maxPage;
    result.status = result.coverage.complete ? 'success' : 'partial';
    result.limitations.push(
      'Management update time is preserved as platform text; it is not a verified publication or submission time.',
      'Management work IDs and statistics book IDs are separate identifiers until explicitly matched.',
    );
    if (!paginationObserved && !dom.emptyVisible)
      result.limitations.push(
        'No pagination controls established the full management inventory; only visible cards were read.',
      );
    if (maxPage > limit)
      result.errors.push({ code: 'pagination_limit_reached', scope: 'management' });
  } catch {
    result.errors.push({ code: 'read_failed', scope: 'management' });
    result.status = result.records.length ? 'partial' : 'capability_unavailable';
  }
  return result;
}

export interface ShortMetric {
  statisticsBookId: string;
  title: string;
  showCount: number | null;
  readCount: number | null;
  reportedClickRate: number | string | null;
  commentCount: number | null;
  likeCount: number | null;
  shelfCount: number | null;
}

/** Replay only read URLs actually loaded by this page, keeping query credentials inside the browser. */
export async function loadedJson(
  page: Page,
  url: string,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const parsed = allowedUrl(url);
  if (!/^\/api\/author\/sa_stats\/(?:book_list|single_common)\/v0\/$/.test(parsed.pathname))
    throw new PlatformReadError('unverified_api', 'Statistics endpoint was not recognized');
  return page.evaluate(async (sourceUrl) => {
    const response = await fetch(sourceUrl, {
      method: 'GET',
      credentials: 'same-origin',
      redirect: 'error',
    });
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      /* Malformed API response remains unavailable. */
    }
    return { ok: response.ok, status: response.status, json };
  }, url);
}

export function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function successData(response: {
  ok: boolean;
  json: unknown;
}): Record<string, unknown> | null {
  const payload = object(response.json);
  return response.ok && payload?.code === 0 ? object(payload.data) : null;
}

export function responseRequiresLogin(response: { status: number; json: unknown }): boolean {
  const payload = object(response.json);
  const message = payload?.message ?? payload?.msg;
  return (
    response.status === 401 ||
    (typeof message === 'string' && /请(?:先)?登录|登录(?:已)?(?:失效|过期)|未登录/.test(message))
  );
}

export function loginRequired<T>(result: DatasetResult<T>): DatasetResult<T> {
  result.status = 'login_required';
  result.records = [];
  result.coverage.recordsFetched = 0;
  result.coverage.complete = result.coverage.paginationComplete = false;
  return result;
}

/** Source evidence is tied to a GET request that started in this service page's current document. */
export function observeCurrentGetSources(page: Page, matches: (raw: string) => boolean) {
  const sources = new Set<string>();
  const requestGenerations = new WeakMap<Request, number>();
  let generation = 0;
  let stopped = false;
  let frozen = false;
  let pendingDocumentNavigation = false;
  const currentRoute = (): URL | null => {
    try {
      return new URL(page.url());
    } catch {
      return null;
    }
  };
  let route = currentRoute();
  const invalidate = () => {
    generation += 1;
    sources.clear();
  };
  const onNavigation = (frame: unknown) => {
    if (frame !== page.mainFrame()) return;
    const next = currentRoute();
    // Initial hydration may select a book with history.replaceState. It keeps the
    // document's already started GETs; this exception ends before the first replay.
    const bootstrapQueryChange =
      !frozen &&
      !pendingDocumentNavigation &&
      route !== null &&
      next !== null &&
      route.origin === next.origin &&
      route.pathname === next.pathname &&
      route.search !== next.search;
    if (!bootstrapQueryChange) invalidate();
    pendingDocumentNavigation = false;
    route = next;
  };
  const onRequest = (request: Request) => {
    if (stopped || page.isClosed()) return;
    if (request.isNavigationRequest()) {
      // Navigation requests also identify a real same-URL reload, independently
      // of whether the URL changes at commit. Child-frame navigation is ignored.
      try {
        if (request.frame() === page.mainFrame()) {
          pendingDocumentNavigation = true;
          invalidate();
        }
      } catch {
        /* Requests without a frame cannot identify a mainframe navigation. */
      }
    }
    if (request.method() === 'GET') requestGenerations.set(request, generation);
  };
  const accepts = (response: Response): boolean =>
    !stopped &&
    !page.isClosed() &&
    response.request().method() === 'GET' &&
    requestGenerations.get(response.request()) === generation &&
    matches(response.url());
  const onResponse = (response: Response) => {
    if (accepts(response)) sources.add(response.url());
  };
  page.on('framenavigated', onNavigation);
  page.on('request', onRequest);
  page.on('response', onResponse);
  const guard = (freeze = true): (() => void) => {
    if (freeze) frozen = true;
    const documentGeneration = generation;
    return () => {
      if (stopped || page.isClosed() || documentGeneration !== generation)
        throw new PlatformReadError(
          'read_document_changed',
          'The platform read document changed during collection',
        );
    };
  };
  const stop = () => {
    stopped = true;
    sources.clear();
    page.off('framenavigated', onNavigation);
    page.off('request', onRequest);
    page.off('response', onResponse);
  };
  return { sources, accepts, guard, stop };
}

export async function checkedDocumentRead<T>(
  guard: () => void,
  read: () => Promise<T>,
): Promise<T> {
  guard();
  try {
    const value = await read();
    guard();
    return value;
  } catch (error) {
    guard();
    throw error;
  }
}
