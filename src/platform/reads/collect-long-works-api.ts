import { type Page } from 'playwright';

import {
  type ReadOptions,
  makeDataset,
  PlatformReadError,
  identifierOrNull,
  numberOrNull,
} from './make-dataset.js';

import { type DatasetResult } from './is-metrics-dataset.js';

import { type LongWork, collectWithProfile } from './collect-with-profile.js';

import { LONG_WORKS_URL } from './fanqie-origin.js';

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

import { discardChangedDocument, type ProfileReadOptions } from './discard-changed-document.js';

/** book/book_list and these fields were verified on the actual authenticated management page on 2026-10-03. */
async function collectLongWorksApi(
  page: Page,
  options: ReadOptions,
): Promise<DatasetResult<LongWork>> {
  const result = makeDataset<LongWork>('long_works', LONG_WORKS_URL);
  const matches = (raw: string): boolean => {
    try {
      const url = allowedUrl(raw);
      return (
        url.pathname === '/api/author/book/book_list/v0/' &&
        url.searchParams.has('page_index') &&
        url.searchParams.has('page_count')
      );
    } catch {
      return false;
    }
  };
  const capture = observeCurrentGetSources(page, matches);
  let guard = () => undefined as void;
  try {
    await navigate(page, LONG_WORKS_URL, options.timeoutMs);
    guard = capture.guard(false);
    if ((await checkedDocumentRead(guard, () => inspectPageAccess(page))).loginRequired)
      return loginRequired(result);
    if (!capture.sources.size) {
      try {
        await checkedDocumentRead(guard, () =>
          page.waitForResponse((response) => capture.accepts(response), {
            timeout: Math.max(1, Math.min(20_000, options.timeoutMs ?? 12_000)),
          }),
        );
      } catch (error) {
        if (error instanceof PlatformReadError && error.code === 'read_document_changed')
          throw error; /* No unobserved list URL is invented. */
      }
    }
    const source = [...capture.sources][0];
    if (!source) {
      result.errors.push({ code: 'loaded_long_list_endpoint_missing', scope: 'bootstrap' });
      return result;
    }
    guard = capture.guard();
    const seen = new Set<string>();
    let total: number | null = null;
    for (let index = 0; index < pageLimit(options); index += 1) {
      const url = new URL(source);
      url.searchParams.set('page_index', String(index));
      const response = await checkedDocumentRead(guard, () =>
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
        }, url.toString()),
      );
      if (responseRequiresLogin(response)) return loginRequired(result);
      const data = successData(response);
      if (!data || !Array.isArray(data.book_list)) {
        result.errors.push({
          code: 'long_list_response_unrecognized',
          scope: 'long-management',
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
      if (pageTotal === null)
        result.errors.push({
          code: 'long_total_count_unrecognized',
          scope: 'long-management',
          page: index,
        });
      else if (total === null) total = pageTotal;
      else if (total !== pageTotal)
        result.errors.push({
          code: 'long_total_count_changed',
          scope: 'long-management',
          page: index,
        });
      if (!data.book_list.length) {
        result.coverage.paginationComplete = true;
        break;
      }
      let added = 0;
      for (const raw of data.book_list) {
        const row = object(raw);
        const id =
          typeof row?.book_id === 'string' && row.book_id !== '0'
            ? identifierOrNull(row.book_id)
            : null;
        const title = typeof row?.book_name === 'string' ? row.book_name : '';
        if (!id || !title || seen.has(id)) {
          result.errors.push({
            code: 'missing_or_duplicate_work_id',
            scope: 'long-management',
            page: index,
          });
          continue;
        }
        seen.add(id);
        added += 1;
        const rawNumber = (key: string): number | null =>
          typeof row?.[key] === 'number' ? numberOrNull(row[key]) : null;
        const rawCode = (key: string): number | null =>
          typeof row?.[key] === 'number' && Number.isFinite(row[key]) ? (row[key] as number) : null;
        const rawText = (key: string): string | null =>
          typeof row?.[key] === 'string' ? (row[key] as string) : null;
        const record: LongWork = {
          workId: id,
          title,
          statusCode: rawCode('status'),
          category: rawText('category'),
          createdAtRaw: rawText('create_time'),
          wordCount: rawNumber('word_count'),
          managementReadCount: rawNumber('read_count'),
          creationStatusCode: rawCode('creation_status'),
          lastChapterAtRaw: rawText('last_chapter_time'),
          lastChapterId:
            typeof row?.last_chapter_id === 'string' && row.last_chapter_id !== '0'
              ? identifierOrNull(row.last_chapter_id)
              : null,
          chapterCount: rawNumber('chapter_number'),
          contractStatusCode: rawCode('contract_status'),
        };
        result.records.push(record);
        if (
          [
            record.statusCode,
            record.category,
            record.createdAtRaw,
            record.wordCount,
            record.managementReadCount,
            record.creationStatusCode,
            record.chapterCount,
            record.contractStatusCode,
          ].some((value) => value === null)
        )
          result.errors.push({
            code: 'long_management_fields_missing',
            scope: 'long-management',
            workId: id,
          });
      }
      if (!added) {
        result.errors.push({
          code: 'pagination_not_advancing',
          scope: 'long-management',
          page: index,
        });
        break;
      }
    }
    if (!result.coverage.paginationComplete)
      result.errors.push({ code: 'long_pagination_incomplete', scope: 'long-management' });
    if (total !== null && result.records.length !== total)
      result.errors.push({ code: 'long_total_count_mismatch', scope: 'long-management' });
    if ((await checkedDocumentRead(guard, () => inspectPageAccess(page))).loginRequired)
      return loginRequired(result);
    result.coverage.totalRecords = total;
    result.coverage.recordsFetched = result.records.length;
    result.coverage.pagesDiscovered = result.coverage.paginationComplete
      ? result.coverage.pagesFetched
      : null;
    result.coverage.fields = [
      'workId',
      'title',
      'statusCode',
      'category',
      'createdAtRaw',
      'wordCount',
      'managementReadCount',
      'creationStatusCode',
      'lastChapterAtRaw',
      'lastChapterId',
      'chapterCount',
      'contractStatusCode',
    ];
    result.coverage.complete =
      result.coverage.paginationComplete &&
      total !== null &&
      result.records.length === total &&
      result.errors.length === 0;
    result.status = result.coverage.complete
      ? 'success'
      : result.records.length
        ? 'partial'
        : 'capability_unavailable';
    result.limitations.push(
      'The built-in schema was verified on 2026-10-03; each collection still requires this page to load the actual book/book_list GET.',
      'Raw platform status codes are preserved without inferring publication or signing labels.',
      'managementReadCount is the management API read_count; its period and unique-reader semantics have not been verified, and it is not a long-metrics dataset.',
      'Platform time strings are retained without inferring publication dates. No existing work editor/management URL is synthesized.',
    );
  } catch (error) {
    if (error instanceof PlatformReadError && error.code === 'read_document_changed')
      return discardChangedDocument(result, 'long-management');
    result.errors.push({ code: 'read_failed', scope: 'long-management' });
    result.status = result.records.length ? 'partial' : 'capability_unavailable';
  } finally {
    capture.stop();
  }
  return result;
}

export function collectLongWorks(
  page: Page,
  options: ProfileReadOptions = {},
): Promise<DatasetResult> {
  return options.profile
    ? collectWithProfile(page, 'long_works', options)
    : collectLongWorksApi(page, options);
}

export interface ChapterRecord extends Record<string, unknown> {
  workId: string;
  chapterId: string;
  volumeId: string;
  title: string;
  index: number;
  wordCount: number;
  articleStatusCode: number;
  displayStatusCode: number;
  createdAtRaw: string;
  scheduledAtRaw: string;
}

export interface ChapterVolume {
  volumeId: string;
  itemCount: number;
}

export interface ChapterVolumeInventory {
  volumes: ChapterVolume[];
  complete: boolean;
}

/** Service-internal evidence plan; MCP callers cannot supply query names or parsers. */
export interface ChapterApiEvidencePlan {
  verifiedAt: string;
  evidence: string;
  allStatesEvidence: string;
  parentQueryKeys: { volumes: string; chapters: string; book: string };
  volumeQueryKey: string;
  pageIndexQueryKey: string;
  firstPageIndex: number;
  parseVolumes(json: unknown): ChapterVolumeInventory;
}

/** Fixed draft-list candidate from the official writer client. Runtime types are verified on every read. */
export interface ChapterDraftRecord {
  workId: string;
  draftId: string;
  title: string;
  wordCount: number;
  modifiedAtRaw: string | number;
  sourceScope: 'draft_list';
}
