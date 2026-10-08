import { type Page } from 'playwright';

import {
  type ChapterReadOptions,
  chapterIdentifier,
  CANDIDATE_CHAPTER_API_PLAN,
  validateChapterPlan,
  boundChapterTemplate,
  integer,
  parseChapterPage,
} from './parse-chapter-draft-page.js';

import { type DatasetResult } from './is-metrics-dataset.js';

import {
  type ChapterRecord,
  type ChapterVolumeInventory,
  type ChapterVolume,
} from './collect-long-works-api.js';

import { makeDataset, isChapterReadSchemaSource, PlatformReadError } from './make-dataset.js';

import {
  observeCurrentGetSources,
  checkedDocumentRead,
  loginRequired,
  responseRequiresLogin,
  object,
} from './collect-short-works.js';

import { chapterEntryErrorCode } from './chapter-entry-error-code.js';

import { inspectPageAccess, pageLimit } from './project-read-response-fields.js';

import { discardChangedDocument } from './discard-changed-document.js';

import { collectWithProfile } from './collect-with-profile.js';

async function collectChaptersApi(
  page: Page,
  options: ChapterReadOptions,
): Promise<DatasetResult<ChapterRecord>> {
  const result = makeDataset<ChapterRecord>('chapters', null);
  if (!chapterIdentifier(options.workId)) {
    result.errors.push({ code: 'invalid_work_id', scope: 'chapters' });
    return result;
  }
  const workId = options.workId!;
  const plan = options.apiPlan ?? CANDIDATE_CHAPTER_API_PLAN;
  if (!options.enterDirectory) {
    result.limitations.push(
      'The built-in chapter reader is awaiting current volume/query/all-state evidence and a service-owned verified directory entry.',
    );
    return result;
  }
  const capture = observeCurrentGetSources(page, isChapterReadSchemaSource);
  let guard = () => undefined as void;
  let totalRecords = 0;
  let allVolumesComplete = true;
  const seen = new Set<string>();
  try {
    validateChapterPlan(plan);
    let entry: Awaited<ReturnType<NonNullable<ChapterReadOptions['enterDirectory']>>>;
    try {
      entry = await options.enterDirectory(page, workId);
    } catch (error) {
      throw new PlatformReadError(
        chapterEntryErrorCode(error),
        'The current existing-work chapter directory entry did not complete',
      );
    }
    result.sourceUrl = entry.sourceUrl;
    // Directory entry owns the bounded initialization window; once it returns,
    // source discovery must retain the same verified document as every replay.
    guard = capture.guard();
    if ((await checkedDocumentRead(guard, () => inspectPageAccess(page))).loginRequired)
      return loginRequired(result);
    const paths = {
      volumes: '/api/author/volume/volume_list/v1',
      chapters: '/api/author/chapter/chapter_list/v1',
      book: '/api/author/book/book_detail/v0/',
    };
    const loaded = async (path: string): Promise<string | undefined> => {
      const find = () => [...capture.sources].find((raw) => new URL(raw).pathname === path);
      if (!find())
        try {
          await checkedDocumentRead(guard, () =>
            page.waitForResponse(
              (response) => capture.accepts(response) && new URL(response.url()).pathname === path,
              { timeout: Math.max(1, Math.min(12_000, options.timeoutMs ?? 12_000)) },
            ),
          );
        } catch (error) {
          if (error instanceof PlatformReadError && error.code === 'read_document_changed')
            throw error;
        }
      return find();
    };
    const volumeSource = await loaded(paths.volumes);
    const bookSource = await loaded(paths.book);
    if (!volumeSource || !bookSource) {
      result.errors.push({ code: 'loaded_chapter_inventory_missing', scope: 'bootstrap' });
      return result;
    }
    guard = capture.guard();
    const read = async (url: URL) => {
      const response = await checkedDocumentRead(guard, () =>
        page.evaluate(async (sourceUrl) => {
          const response = await fetch(sourceUrl, {
            method: 'GET',
            credentials: 'same-origin',
            redirect: 'error',
          });
          return {
            status: response.status,
            ok: response.ok,
            json: await response.json().catch(() => null),
          };
        }, url.toString()),
      );
      if (responseRequiresLogin(response))
        throw new PlatformReadError(
          'chapter_login_required',
          'The platform session expired during chapter collection',
        );
      if (!response.ok)
        throw new PlatformReadError(
          'chapter_get_failed',
          'An actually loaded chapter GET did not succeed',
        );
      return response.json;
    };
    const volumeUrl = boundChapterTemplate(volumeSource, plan.parentQueryKeys.volumes, workId);
    const bookUrl = boundChapterTemplate(bookSource, plan.parentQueryKeys.book, workId);
    const verifyBook = async () => {
      const payload = object(await read(bookUrl));
      const data = object(payload?.data);
      if (
        payload?.code !== 0 ||
        data?.book_id !== workId ||
        typeof data.book_name !== 'string' ||
        !data.book_name.trim()
      )
        throw new PlatformReadError(
          'chapter_book_parent_mismatch',
          'The loaded book detail does not identify the requested work',
        );
    };
    await verifyBook();
    const inventory = plan.parseVolumes(await read(volumeUrl));
    const verifyInventory = (value: ChapterVolumeInventory) => {
      if (
        !value ||
        value.complete !== true ||
        !Array.isArray(value.volumes) ||
        value.volumes.some(
          (volume) => !volume || !chapterIdentifier(volume.volumeId) || !integer(volume.itemCount),
        ) ||
        new Set(value.volumes.map((volume) => volume.volumeId)).size !== value.volumes.length
      )
        throw new PlatformReadError(
          'chapter_volume_inventory_incomplete',
          'The complete current volume inventory was not established',
        );
    };
    verifyInventory(inventory);
    const expectedTotal = inventory.volumes.reduce((sum, volume) => sum + volume.itemCount, 0);
    if (!Number.isSafeInteger(expectedTotal))
      throw new PlatformReadError(
        'chapter_volume_total_invalid',
        'The volume count sum is not a supported exact integer',
      );
    const chapterSource = await loaded(paths.chapters);
    if (!chapterSource) {
      result.errors.push({ code: 'loaded_chapter_list_missing', scope: 'bootstrap' });
      return result;
    }
    let template: URL | undefined;
    if (chapterSource) {
      template = boundChapterTemplate(chapterSource, plan.parentQueryKeys.chapters, workId);
      if (!inventory.volumes.length) {
        const payload = object(await read(template));
        const data = object(payload?.data);
        if (
          payload?.code !== 0 ||
          data?.total_count !== 0 ||
          !Array.isArray(data.item_list) ||
          data.item_list.length !== 0
        )
          throw new PlatformReadError(
            'chapter_empty_inventory_contradicted',
            'The current chapter response contradicts an empty volume inventory',
          );
        result.coverage.pagesFetched += 1;
      } else if (
        !template.searchParams.has('page_count') ||
        !/^[1-9]\d{0,5}$/.test(template.searchParams.get('page_count') ?? '') ||
        !template.searchParams.has(plan.volumeQueryKey) ||
        !template.searchParams.has(plan.pageIndexQueryKey) ||
        !/^\d{1,6}$/.test(template.searchParams.get(plan.pageIndexQueryKey) ?? '') ||
        !inventory.volumes.some(
          (volume) => template!.searchParams.get(plan.volumeQueryKey) === volume.volumeId,
        )
      )
        throw new PlatformReadError(
          'chapter_query_template_unverified',
          'The actual loaded chapter template lacks verified parent, volume or page fields',
        );
    }
    for (const volume of inventory.volumes) {
      let volumeTotal: number | null = null;
      let volumeFetched = 0;
      let complete = false;
      for (
        let index = plan.firstPageIndex;
        result.coverage.pagesFetched < pageLimit(options);
        index += 1
      ) {
        const url = new URL(template!.href);
        url.searchParams.set(plan.volumeQueryKey, volume.volumeId);
        url.searchParams.set(plan.pageIndexQueryKey, String(index));
        const snapshot = parseChapterPage(await read(url), workId, volume.volumeId);
        result.coverage.pagesFetched += 1;
        if (volumeTotal === null) {
          volumeTotal = snapshot.total;
          totalRecords += snapshot.total;
        }
        if (volumeTotal !== snapshot.total || snapshot.total !== volume.itemCount)
          throw new PlatformReadError(
            'chapter_total_count_changed',
            'The chapter total changed or differs from its verified volume count',
          );
        if (!snapshot.records.length && volumeFetched < snapshot.total)
          throw new PlatformReadError(
            'chapter_pagination_early_empty',
            'A chapter page was empty before its declared total was covered',
          );
        for (const chapter of snapshot.records) {
          if (seen.has(chapter.chapterId))
            throw new PlatformReadError(
              'chapter_pagination_duplicate',
              'A chapter identifier appeared on more than one page or volume',
            );
          seen.add(chapter.chapterId);
          result.records.push(chapter);
          volumeFetched += 1;
        }
        if (volumeFetched > snapshot.total)
          throw new PlatformReadError(
            'chapter_total_count_mismatch',
            'Collected chapters exceed the declared volume total',
          );
        if (volumeFetched === snapshot.total) {
          complete = true;
          break;
        }
      }
      if (!complete) {
        allVolumesComplete = false;
        result.errors.push({ code: 'chapter_pagination_limit_reached', scope: 'chapters' });
        break;
      }
    }
    const finalInventory = plan.parseVolumes(await read(volumeUrl));
    verifyInventory(finalInventory);
    const signature = (volumes: ChapterVolume[]) =>
      volumes
        .map((volume) => `${volume.volumeId}:${volume.itemCount}`)
        .sort()
        .join(',');
    if (signature(inventory.volumes) !== signature(finalInventory.volumes))
      throw new PlatformReadError(
        'chapter_inventory_changed',
        'Volume membership or counts changed during collection',
      );
    await verifyBook();
    if ((await checkedDocumentRead(guard, () => inspectPageAccess(page))).loginRequired)
      return loginRequired(result);
    result.coverage.totalRecords = expectedTotal;
    const allStatesVerified = Boolean(
      plan.allStatesEvidence.trim() || entry.allStatesEvidence?.trim(),
    );
    if (!allStatesVerified)
      result.errors.push({ code: 'chapter_all_states_unverified', scope: 'chapters' });
    result.coverage.paginationComplete =
      allStatesVerified &&
      allVolumesComplete &&
      totalRecords === expectedTotal &&
      result.records.length === expectedTotal;
    result.coverage.complete = result.coverage.paginationComplete && result.errors.length === 0;
    result.coverage.pagesDiscovered = result.coverage.paginationComplete
      ? result.coverage.pagesFetched
      : null;
    result.status = result.coverage.complete
      ? 'success'
      : result.records.length
        ? 'partial'
        : 'capability_unavailable';
  } catch (error) {
    if (error instanceof PlatformReadError && error.code === 'read_document_changed') {
      const discarded = discardChangedDocument(result, 'chapters');
      discarded.coverage.pagesFetched = 0;
      discarded.coverage.fields = [];
      discarded.sourceUrl = null;
      return discarded;
    }
    if (error instanceof PlatformReadError && error.code === 'chapter_login_required')
      return loginRequired(result);
    result.errors.push({
      code: error instanceof PlatformReadError ? error.code : 'chapter_read_failed',
      scope: 'chapters',
    });
    result.status = result.records.length ? 'partial' : 'capability_unavailable';
  } finally {
    capture.stop();
  }
  result.coverage.recordsFetched = result.records.length;
  result.coverage.fields = [
    'workId',
    'chapterId',
    'volumeId',
    'title',
    'index',
    'wordCount',
    'articleStatusCode',
    'displayStatusCode',
    'createdAtRaw',
    'scheduledAtRaw',
  ];
  result.limitations.push(
    'The default volume/query plan is a historical read-only candidate, not verified current support; an actual compatible response and current all-state evidence are required for complete coverage.',
    'Directory status codes and time strings are retained without inferring publication state or dates. No chapter body or existing editor URL is collected.',
    'Collection spans multiple live GETs; this API has not established an atomic platform revision.',
  );
  return result;
}

export function collectChapters(
  page: Page,
  options: ChapterReadOptions = {},
): Promise<DatasetResult> {
  return options.profile
    ? collectWithProfile(page, 'chapters', options)
    : collectChaptersApi(page, options);
}
