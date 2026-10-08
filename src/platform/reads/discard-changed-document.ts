import { type DatasetResult } from './is-metrics-dataset.js';

import { type Page } from 'playwright';

import {
  observeCurrentGetSources,
  type ShortMetric,
  checkedDocumentRead,
  loadedJson,
  responseRequiresLogin,
  loginRequired,
  successData,
  object,
} from './collect-short-works.js';

import {
  allowedUrl,
  navigate,
  inspectPageAccess,
  pageLimit,
} from './project-read-response-fields.js';

import {
  type ReadOptions,
  makeDataset,
  parseVisibleStatistics,
  identifierOrNull,
  numberOrNull,
  PlatformReadError,
} from './make-dataset.js';

import { SHORT_METRICS_URL } from './fanqie-origin.js';

export function discardChangedDocument<T>(
  result: DatasetResult<T>,
  scope: string,
): DatasetResult<T> {
  result.records = [];
  result.status = 'capability_unavailable';
  result.coverage.recordsFetched = 0;
  result.coverage.complete = result.coverage.paginationComplete = false;
  result.coverage.totalRecords = result.coverage.pagesDiscovered = null;
  result.statisticsThrough =
    result.statisticsThroughBasis =
    result.statisticsCutoffRaw =
    result.platformUpdateSchedule =
      null;
  result.errors.push({ code: 'read_document_changed', scope });
  result.limitations.push(
    'Navigation or page closure invalidated this collection; no old-document records or freshness metadata are returned.',
  );
  return result;
}

/** A Performance resource entry has no HTTP method; only observed GET responses establish replay sources. */
async function waitForStatisticsSource(
  page: Page,
  capture: ReturnType<typeof observeCurrentGetSources>,
  endpoint: 'book_list' | 'single_common',
  timeoutMs: number,
): Promise<string | undefined> {
  const matches = (raw: string): boolean => {
    try {
      const url = allowedUrl(raw);
      return (
        url.pathname === `/api/author/sa_stats/${endpoint}/v0/` &&
        url.searchParams.has(endpoint === 'book_list' ? 'page_index' : 'book_id')
      );
    } catch {
      return false;
    }
  };
  const existing = [...capture.sources].find(matches);
  if (existing) return existing;
  try {
    // The response listener is installed before navigation, so an already completed GET cannot be missed.
    await page.waitForResponse((response) => capture.accepts(response) && matches(response.url()), {
      timeout: timeoutMs,
    });
  } catch {
    /* Unobserved or interrupted sources remain unavailable; no URL is synthesized. */
  }
  return [...capture.sources].find(matches);
}

export async function collectShortMetrics(
  page: Page,
  options: ReadOptions = {},
): Promise<DatasetResult<ShortMetric>> {
  const result = makeDataset<ShortMetric>('short_metrics', SHORT_METRICS_URL);
  const capture = observeCurrentGetSources(page, (raw) => {
    try {
      return /^\/api\/author\/sa_stats\/(?:book_list|single_common)\/v0\/$/.test(
        allowedUrl(raw).pathname,
      );
    } catch {
      return false;
    }
  });
  let guard = () => undefined as void;
  try {
    await navigate(page, SHORT_METRICS_URL, options.timeoutMs);
    guard = capture.guard(false);
    const access = await checkedDocumentRead(guard, () => inspectPageAccess(page));
    if (access.loginRequired) {
      result.status = 'login_required';
      return result;
    }
    Object.assign(result, parseVisibleStatistics(access.text, result.capturedAt));
    const discoveryTimeoutMs = Math.max(1, Math.min(20_000, options.timeoutMs ?? 12_000));
    const listUrl = await checkedDocumentRead(guard, () =>
      waitForStatisticsSource(page, capture, 'book_list', discoveryTimeoutMs),
    );
    if (!listUrl) {
      result.errors.push({ code: 'loaded_list_endpoint_missing', scope: 'bootstrap' });
      return result;
    }
    guard = capture.guard();
    const books: Array<{ id: string; title: string }> = [];
    const seen = new Set<string>();
    for (let index = 0; index < pageLimit(options); index += 1) {
      const url = new URL(listUrl);
      url.searchParams.set('page_index', String(index));
      const response = await checkedDocumentRead(guard, () => loadedJson(page, url.toString()));
      if (responseRequiresLogin(response)) return loginRequired(result);
      const data = successData(response);
      if (!data || !Array.isArray(data.stats_book_list)) {
        result.errors.push({
          code: 'list_response_unrecognized',
          scope: 'statistics-list',
          page: index,
        });
        break;
      }
      result.coverage.pagesFetched += 1;
      const rows = data.stats_book_list;
      if (!rows.length) {
        result.coverage.paginationComplete = true;
        break;
      }
      let added = 0;
      for (const raw of rows) {
        const row = object(raw);
        const id = identifierOrNull(row?.book_id);
        const title = typeof row?.book_name === 'string' ? row.book_name : '';
        if (!id || !title || seen.has(id)) {
          result.errors.push({
            code: 'missing_or_duplicate_statistics_id',
            scope: 'statistics-list',
            page: index,
          });
          continue;
        }
        seen.add(id);
        books.push({ id, title });
        added += 1;
      }
      if (!added) {
        result.errors.push({
          code: 'pagination_not_advancing',
          scope: 'statistics-list',
          page: index,
        });
        break;
      }
    }
    if (!result.coverage.paginationComplete)
      result.errors.push({ code: 'statistics_pagination_incomplete', scope: 'statistics-list' });
    result.coverage.totalRecords = result.coverage.paginationComplete ? books.length : null;
    // The selected book's detail GET may be loaded after the initial list/hydration and while pagination is replayed.
    const detailUrl = books.length
      ? await checkedDocumentRead(guard, () =>
          waitForStatisticsSource(page, capture, 'single_common', discoveryTimeoutMs),
        )
      : undefined;
    if (books.length && !detailUrl) {
      result.errors.push({ code: 'loaded_detail_endpoint_missing', scope: 'bootstrap' });
      return result;
    }
    const targets = options.workId ? books.filter((book) => book.id === options.workId) : books;
    if (options.workId && !targets.length)
      result.errors.push({
        code: 'statistics_book_not_found',
        scope: 'statistics-detail',
        workId: options.workId,
      });
    for (const book of targets) {
      const url = new URL(detailUrl!);
      url.searchParams.set('book_id', book.id);
      try {
        const response = await checkedDocumentRead(guard, () => loadedJson(page, url.toString()));
        const data = successData(response);
        if (responseRequiresLogin(response)) return loginRequired(result);
        if (!data) {
          result.errors.push({
            code: 'detail_response_unrecognized',
            scope: 'statistics-detail',
            workId: book.id,
          });
          continue;
        }
        result.records.push({
          statisticsBookId: book.id,
          title: book.title,
          showCount: numberOrNull(data.show_count),
          readCount: numberOrNull(data.read_count),
          reportedClickRate:
            typeof data.click_rate === 'string' ||
            (typeof data.click_rate === 'number' && Number.isFinite(data.click_rate))
              ? data.click_rate
              : null,
          commentCount: numberOrNull(data.comment_count),
          likeCount: numberOrNull(data.digg_count),
          shelfCount: numberOrNull(data.shelf_count),
        });
        if (
          Object.values(result.records[result.records.length - 1]!).some((value) => value === null)
        )
          result.errors.push({
            code: 'metric_fields_missing',
            scope: 'statistics-detail',
            workId: book.id,
          });
      } catch (error) {
        if (error instanceof PlatformReadError && error.code === 'read_document_changed')
          throw error;
        result.errors.push({
          code: 'detail_read_failed',
          scope: 'statistics-detail',
          workId: book.id,
        });
      }
    }
    const finalAccess = await checkedDocumentRead(guard, () => inspectPageAccess(page));
    if (finalAccess.loginRequired) return loginRequired(result);
    const finalStatistics = parseVisibleStatistics(finalAccess.text, result.capturedAt);
    if (finalStatistics.statisticsCutoffRaw) Object.assign(result, finalStatistics);
    else if (finalStatistics.platformUpdateSchedule)
      result.platformUpdateSchedule = finalStatistics.platformUpdateSchedule;
    result.coverage.recordsFetched = result.records.length;
    result.coverage.fields = [
      'statisticsBookId',
      'title',
      'showCount',
      'readCount',
      'reportedClickRate',
      'commentCount',
      'likeCount',
      'shelfCount',
    ];
    result.coverage.complete =
      result.coverage.paginationComplete &&
      result.errors.length === 0 &&
      result.records.length === targets.length;
    result.status = result.coverage.complete
      ? 'success'
      : result.records.length
        ? 'partial'
        : 'capability_unavailable';
    result.limitations.push(
      'Statistics period and deduplication semantics are not inferred from numeric field names.',
      'Revenue, chapter retention, completion rate and funnel stages are unavailable in this verified endpoint.',
      'Statistics book IDs must not be silently substituted for management work IDs.',
    );
    if (!result.statisticsThrough)
      result.limitations.push(
        'The platform statistics deadline was not visible; capture time does not establish data freshness.',
      );
    if (result.records.some((row) => Object.values(row).some((value) => value === null)))
      result.limitations.push('Missing or nonnumeric platform metric fields are returned as null.');
  } catch (error) {
    if (error instanceof PlatformReadError && error.code === 'read_document_changed')
      return discardChangedDocument(result, 'statistics');
    result.errors.push({ code: 'read_failed', scope: 'statistics' });
    result.status = result.records.length ? 'partial' : 'capability_unavailable';
  } finally {
    capture.stop();
  }
  return result;
}

export interface EvidenceField {
  selector?: string;
  attribute?: string;
  pattern?: string;
  type?: 'text' | 'number' | 'identifier' | 'url';
}

/** A deployment's operator must verify these selectors on the authenticated platform UI. */
export interface CollectionEvidenceProfile {
  sourceUrl: string;
  verifiedAt: string;
  evidence: string;
  readOnly: true;
  rowSelector: string;
  idField: string;
  fields: Record<string, EvidenceField>;
  emptySelector?: string;
  pagination?: { nextSelector: string; disabledSelector: string; currentPageSelector?: string };
  statisticsSelector?: string;
}

export interface ProfileReadOptions extends ReadOptions {
  profile?: CollectionEvidenceProfile;
}

export function validateReadProfile(profile: CollectionEvidenceProfile): void {
  const url = allowedUrl(profile.sourceUrl);
  if (
    !profile.readOnly ||
    !profile.evidence?.trim() ||
    !Number.isFinite(Date.parse(profile.verifiedAt)) ||
    !profile.rowSelector ||
    !profile.idField ||
    !profile.fields?.[profile.idField]
  )
    throw new PlatformReadError(
      'unverified_profile',
      'Read profile requires explicit page evidence and an identifier field',
    );
  if (
    !url.pathname.startsWith('/main/writer/') ||
    /(?:publish|create|delete|submit|new-book|new-chapter)(?:\/|-|$)/.test(url.pathname)
  )
    throw new PlatformReadError(
      'unsafe_read_route',
      'The configured collection URL is not an established management/data read route',
    );
  for (const field of Object.values(profile.fields)) if (field.pattern) new RegExp(field.pattern);
}
