import { type Page } from 'playwright';

import {
  type ReadOptions,
  makeDataset,
  PlatformReadError,
  parseVisibleStatistics,
  numberOrNull,
} from './make-dataset.js';

import { type DatasetResult } from './is-metrics-dataset.js';

import { type LongMetric, parsePlatformUpdateTime } from './parse-platform-update-time.js';

import { LONG_METRICS_URL } from './fanqie-origin.js';

import {
  allowedUrl,
  navigate,
  inspectPageAccess,
  pageLimit,
} from './project-read-response-fields.js';

import {
  observeCurrentGetSources,
  checkedDocumentRead,
  loginRequired,
  responseRequiresLogin,
  successData,
  object,
} from './collect-short-works.js';

import { discardChangedDocument } from './discard-changed-document.js';

/** Exact GET sources and list/common fields were verified on the authenticated data page on 2026-10-03. */
export async function collectLongMetricsApi(
  page: Page,
  options: ReadOptions,
): Promise<DatasetResult<LongMetric>> {
  const result = makeDataset<LongMetric>('long_metrics', LONG_METRICS_URL);
  const matches = (raw: string, kind: 'book_list' | 'book_common_v1'): boolean => {
    try {
      const url = allowedUrl(raw);
      return (
        url.pathname === `/api/author/stats/${kind}/v0/` &&
        url.searchParams.has(kind === 'book_list' ? 'page_index' : 'book_id')
      );
    } catch {
      return false;
    }
  };
  const capture = observeCurrentGetSources(
    page,
    (raw) => matches(raw, 'book_list') || matches(raw, 'book_common_v1'),
  );
  let guard = () => undefined as void;
  const loaded = async (kind: 'book_list' | 'book_common_v1'): Promise<string | undefined> => {
    const existing = [...capture.sources].find((raw) => matches(raw, kind));
    if (existing) return existing;
    try {
      await page.waitForResponse(
        (response) => capture.accepts(response) && matches(response.url(), kind),
        { timeout: Math.max(1, Math.min(20_000, options.timeoutMs ?? 12_000)) },
      );
    } catch {
      /* Missing GET evidence is not replaced by a guessed route. */
    }
    return [...capture.sources].find((raw) => matches(raw, kind));
  };
  const replay = async (raw: string): Promise<{ ok: boolean; status: number; json: unknown }> => {
    if (!matches(raw, 'book_list') && !matches(raw, 'book_common_v1'))
      throw new PlatformReadError(
        'unverified_api',
        'Long statistics source is not a verified endpoint',
      );
    return checkedDocumentRead(guard, () =>
      page.evaluate(async (sourceUrl) => {
        const response = await fetch(sourceUrl, {
          method: 'GET',
          credentials: 'same-origin',
          redirect: 'error',
        });
        return {
          ok: response.ok,
          status: response.status,
          json: await response.json().catch(() => null),
        };
      }, raw),
    );
  };
  result.limitations.push(
    'Platform reader_uv_daily and pursue_read_rate are returned as reported strings; numeric formatting and values are not inferred.',
    'The statistics list read_count period and unique-reader semantics have not been verified.',
    'API update_time is platform update time, not evidence of a statistics cutoff or window.',
    'Historical increase curves, scores, shelf/comment counts, revenue and chapter retention are not covered by this verified common schema.',
  );
  try {
    await navigate(page, LONG_METRICS_URL, options.timeoutMs);
    guard = capture.guard(false);
    const initialAccess = await checkedDocumentRead(guard, () => inspectPageAccess(page));
    if (initialAccess.loginRequired) return loginRequired(result);
    Object.assign(result, parseVisibleStatistics(initialAccess.text, result.capturedAt));
    const listSource = await checkedDocumentRead(guard, () => loaded('book_list'));
    if (!listSource) {
      result.errors.push({ code: 'loaded_long_statistics_list_missing', scope: 'bootstrap' });
      return result;
    }
    guard = capture.guard();
    const books: Array<{
      id: string;
      title: string;
      wordCount: number | null;
      creationStatusCode: number | null;
      reportedListReadCount: string | null;
    }> = [];
    const seen = new Set<string>();
    let total: number | null = null;
    for (let index = 0; index < pageLimit(options); index += 1) {
      const url = new URL(listSource);
      url.searchParams.set('page_index', String(index));
      const response = await replay(url.toString());
      if (responseRequiresLogin(response)) return loginRequired(result);
      const data = successData(response);
      if (!data || !Array.isArray(data.stats_book_list)) {
        result.errors.push({
          code: 'long_statistics_list_unrecognized',
          scope: 'statistics-list',
          page: index,
        });
        break;
      }
      result.coverage.pagesFetched += 1;
      const pageTotal =
        typeof data.total_count === 'number' &&
        Number.isSafeInteger(data.total_count) &&
        data.total_count >= 0
          ? data.total_count
          : null;
      const pageTotalValid = pageTotal !== null && (total === null || total === pageTotal);
      if (pageTotal === null)
        result.errors.push({
          code: 'long_statistics_total_unrecognized',
          scope: 'statistics-list',
          page: index,
        });
      else if (total === null) total = pageTotal;
      else if (total !== pageTotal)
        result.errors.push({
          code: 'long_statistics_total_changed',
          scope: 'statistics-list',
          page: index,
        });
      if (!data.stats_book_list.length) {
        result.coverage.paginationComplete = pageTotalValid && books.length === total;
        break;
      }
      let added = 0;
      for (const raw of data.stats_book_list) {
        const row = object(raw);
        const id =
          typeof row?.book_id === 'string' && /^[1-9]\d{0,29}$/.test(row.book_id)
            ? row.book_id
            : null;
        const title =
          typeof row?.book_name === 'string' && row.book_name.trim() ? row.book_name : null;
        if (!id || !title || seen.has(id)) {
          result.errors.push({
            code: 'missing_or_duplicate_statistics_id',
            scope: 'statistics-list',
            page: index,
          });
          continue;
        }
        seen.add(id);
        added += 1;
        const book = {
          id,
          title,
          wordCount: typeof row?.word_number === 'number' ? numberOrNull(row.word_number) : null,
          creationStatusCode:
            typeof row?.creation_status === 'number' && Number.isFinite(row.creation_status)
              ? row.creation_status
              : null,
          reportedListReadCount: typeof row?.read_count === 'string' ? row.read_count : null,
        };
        books.push(book);
        if (
          [book.wordCount, book.creationStatusCode, book.reportedListReadCount].some(
            (value) => value === null,
          )
        )
          result.errors.push({
            code: 'long_statistics_list_fields_missing',
            scope: 'statistics-list',
            workId: id,
          });
      }
      // This verified stats endpoint may ignore page_index after the full list.
      // An explicit stable total covered by unique IDs is the completion proof;
      // requesting an extra empty page would misclassify its repeated full list.
      if (pageTotalValid && books.length === total) {
        result.coverage.paginationComplete = true;
        break;
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
      result.errors.push({
        code: 'long_statistics_pagination_incomplete',
        scope: 'statistics-list',
      });
    if (total !== null && books.length !== total)
      result.errors.push({ code: 'long_statistics_total_mismatch', scope: 'statistics-list' });
    result.coverage.totalRecords = total;
    const targets = options.workId ? books.filter((book) => book.id === options.workId) : books;
    if (options.workId && !targets.length) {
      result.errors.push({
        code: 'statistics_book_not_found',
        scope: 'statistics-detail',
        workId: options.workId,
      });
      return result;
    }
    const commonSource = targets.length
      ? await checkedDocumentRead(guard, () => loaded('book_common_v1'))
      : undefined;
    if (targets.length && !commonSource) {
      result.errors.push({ code: 'loaded_long_statistics_common_missing', scope: 'bootstrap' });
      return result;
    }
    for (const book of targets) {
      const url = new URL(commonSource!);
      url.searchParams.set('book_id', book.id);
      try {
        const response = await replay(url.toString());
        if (responseRequiresLogin(response)) return loginRequired(result);
        const data = successData(response);
        if (!data || typeof data.book_name !== 'string') {
          result.errors.push({
            code: 'long_statistics_common_unrecognized',
            scope: 'statistics-detail',
            workId: book.id,
          });
          continue;
        }
        if (data.book_name !== book.title) {
          result.errors.push({
            code: 'long_statistics_title_mismatch',
            scope: 'statistics-detail',
            workId: book.id,
          });
          continue;
        }
        const updateTimeRaw = typeof data.update_time === 'string' ? data.update_time : null;
        const record: LongMetric = {
          statisticsBookId: book.id,
          title: book.title,
          wordCount: book.wordCount,
          creationStatusCode: book.creationStatusCode,
          reportedListReadCount: book.reportedListReadCount,
          reportedReaderUvDaily:
            typeof data.reader_uv_daily === 'string' ? data.reader_uv_daily : null,
          reportedPursueReadRate:
            typeof data.pursue_read_rate === 'string' ? data.pursue_read_rate : null,
          updateTimeRaw,
          ...parsePlatformUpdateTime(updateTimeRaw, result.capturedAt),
        };
        result.records.push(record);
        if (
          [record.reportedReaderUvDaily, record.reportedPursueReadRate, record.updateTimeRaw].some(
            (value) => value === null,
          )
        )
          result.errors.push({
            code: 'long_statistics_common_fields_missing',
            scope: 'statistics-detail',
            workId: book.id,
          });
      } catch (error) {
        if (error instanceof PlatformReadError && error.code === 'read_document_changed')
          throw error;
        result.errors.push({
          code: 'long_statistics_common_read_failed',
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
    result.coverage.pagesDiscovered = result.coverage.paginationComplete
      ? result.coverage.pagesFetched
      : null;
    result.coverage.fields = [
      'statisticsBookId',
      'title',
      'wordCount',
      'creationStatusCode',
      'reportedListReadCount',
      'reportedReaderUvDaily',
      'reportedPursueReadRate',
      'updateTimeRaw',
      'platformUpdatedAt',
      'platformUpdatedDate',
      'platformUpdateTimeBasis',
    ];
    result.coverage.complete =
      result.coverage.paginationComplete &&
      total !== null &&
      books.length === total &&
      result.errors.length === 0 &&
      result.records.length === targets.length;
    result.status = result.coverage.complete
      ? 'success'
      : result.records.length
        ? 'partial'
        : 'capability_unavailable';
    if (!result.statisticsThrough)
      result.limitations.push(
        'No actual visible platform statistics cutoff was established; neither capture time nor API update_time proves a cutoff.',
      );
    if (result.records.some((record) => record.platformUpdateTimeBasis === null))
      result.limitations.push(
        'An API update_time format could not be established safely; its original string is preserved and parsed update time is unknown.',
      );
  } catch (error) {
    if (error instanceof PlatformReadError && error.code === 'read_document_changed')
      return discardChangedDocument(result, 'long-statistics');
    result.errors.push({ code: 'read_failed', scope: 'long-statistics' });
    result.status = result.records.length ? 'partial' : 'capability_unavailable';
  } finally {
    capture.stop();
  }
  return result;
}
