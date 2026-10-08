import {
  type ChapterDraftRecord,
  type ChapterApiEvidencePlan,
  type ChapterRecord,
  type ChapterVolume,
  type ChapterVolumeInventory,
} from './collect-long-works-api.js';

import { object } from './collect-short-works.js';

import { PlatformReadError } from './make-dataset.js';

import { type ProfileReadOptions } from './discard-changed-document.js';

import { type Page } from 'playwright';

import { allowedUrl } from './project-read-response-fields.js';

export function parseChapterDraftPage(
  json: unknown,
  workId: string,
): { records: ChapterDraftRecord[]; total: number } {
  const payload = object(json),
    data = object(payload?.data);
  if (
    !chapterIdentifier(workId) ||
    payload?.code !== 0 ||
    !data ||
    !integer(data.total_count) ||
    !Array.isArray(data.draft_list)
  )
    throw new PlatformReadError(
      'chapter_draft_page_unrecognized',
      'The draft list envelope or total changed',
    );
  const seen = new Set<string>(),
    records: ChapterDraftRecord[] = [];
  for (const value of data.draft_list) {
    const row = object(value),
      id = chapterIdentifier(row?.item_id);
    if (!row || !id || seen.has(id))
      throw new PlatformReadError(
        'chapter_draft_id_missing_or_duplicate',
        'Draft identifiers must be unique stable strings',
      );
    if (row.book_id !== undefined && row.book_id !== workId)
      throw new PlatformReadError(
        'chapter_draft_parent_mismatch',
        'The draft list does not match its verified parent',
      );
    if (
      typeof row.title !== 'string' ||
      !row.title.trim() ||
      !integer(row.word_number) ||
      !(typeof row.modify_time === 'string' || integer(row.modify_time))
    )
      throw new PlatformReadError(
        'chapter_draft_fields_unrecognized',
        'A required draft directory field changed type or is missing',
      );
    seen.add(id);
    records.push({
      workId,
      draftId: id,
      title: row.title,
      wordCount: row.word_number,
      modifiedAtRaw: row.modify_time,
      sourceScope: 'draft_list',
    });
  }
  if (records.length > data.total_count || records.length > 100_000)
    throw new PlatformReadError(
      'chapter_draft_total_mismatch',
      'The draft page extent exceeds its declared total or read budget',
    );
  return { records, total: data.total_count };
}

export interface ChapterReadOptions extends ProfileReadOptions {
  enterDirectory?: (
    page: Page,
    workId: string,
  ) => Promise<{ sourceUrl: string; allStatesEvidence?: string }>;
  /** Remains unavailable until the current volume envelope and query rules are actually verified. */
  apiPlan?: ChapterApiEvidencePlan;
}

export function chapterIdentifier(value: unknown): string | null {
  return typeof value === 'string' && /^[1-9]\d{9,29}$/.test(value) ? value : null;
}

export function integer(value: unknown, nonnegative = true): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && (!nonnegative || value >= 0);
}

/** Mapping verified in the current operator schema; no status or timestamp semantics are inferred. */
export function parseChapterPage(
  json: unknown,
  workId: string,
  volumeId: string,
): { records: ChapterRecord[]; total: number } {
  const payload = object(json);
  const data = object(payload?.data);
  if (payload?.code !== 0 || !data || !integer(data.total_count) || !Array.isArray(data.item_list))
    throw new PlatformReadError(
      'chapter_page_unrecognized',
      'The chapter list envelope or total count changed',
    );
  const seen = new Set<string>();
  const records: ChapterRecord[] = [];
  for (const value of data.item_list) {
    const row = object(value);
    const id = chapterIdentifier(row?.item_id);
    if (!row || !id || seen.has(id))
      throw new PlatformReadError(
        'chapter_id_missing_or_duplicate',
        'Chapter identifiers must be unique stable strings',
      );
    if (
      typeof row.volume_id !== 'string' ||
      row.volume_id !== volumeId ||
      (row.book_id !== undefined && row.book_id !== workId)
    )
      throw new PlatformReadError(
        'chapter_parent_mismatch',
        'The chapter response does not match its verified parent',
      );
    if (
      typeof row.title !== 'string' ||
      !row.title.trim() ||
      !integer(row.index) ||
      !integer(row.word_number) ||
      !integer(row.article_status, false) ||
      !integer(row.display_status, false) ||
      typeof row.create_time !== 'string' ||
      typeof row.timer_time !== 'string'
    )
      throw new PlatformReadError(
        'chapter_fields_unrecognized',
        'A required chapter directory field changed type or is missing',
      );
    seen.add(id);
    records.push({
      workId,
      chapterId: id,
      volumeId,
      title: row.title,
      index: row.index,
      wordCount: row.word_number,
      articleStatusCode: row.article_status,
      displayStatusCode: row.display_status,
      createdAtRaw: row.create_time,
      scheduledAtRaw: row.timer_time,
    });
  }
  if (records.length > data.total_count)
    throw new PlatformReadError(
      'chapter_total_count_mismatch',
      'The chapter page contains more records than its declared total',
    );
  return { records, total: data.total_count };
}

/** Fixed current directory fields verified by the 2026-10-03 schema probe. No inventory completeness is inferred. */
export function parseCurrentChapterVolumes(
  json: unknown,
  workId: string,
): Array<ChapterVolume & { index: number; name: string }> {
  const payload = object(json);
  const data = object(payload?.data);
  if (payload?.code !== 0 || !data || !Array.isArray(data.volume_list))
    throw new PlatformReadError(
      'chapter_volume_schema_unverified',
      'The current volume envelope changed',
    );
  const seen = new Set<string>();
  return data.volume_list.map((value: unknown) => {
    const row = object(value);
    const volumeId = chapterIdentifier(row?.volume_id);
    if (
      !row ||
      !volumeId ||
      seen.has(volumeId) ||
      row.book_id !== workId ||
      !integer(row.index) ||
      !integer(row.item_count) ||
      typeof row.volume_name !== 'string'
    )
      throw new PlatformReadError(
        'chapter_volume_fields_unverified',
        'Current volume parents, IDs or fields could not be verified',
      );
    seen.add(volumeId);
    return { volumeId, itemCount: row.item_count, index: row.index, name: row.volume_name };
  });
}

/** The observed book_detail endpoint uses book_name; no title alias is accepted. */
export function verifyCurrentChapterBook(json: unknown, workId: string, title: string): void {
  const payload = object(json);
  const data = object(payload?.data);
  if (
    payload?.code !== 0 ||
    !data ||
    data.book_id !== workId ||
    typeof data.book_name !== 'string' ||
    data.book_name !== title
  )
    throw new PlatformReadError(
      'chapter_book_parent_mismatch',
      'The current book detail does not match its verified parent and title',
    );
}

export function validateChapterPlan(plan: ChapterApiEvidencePlan): void {
  if (
    !plan.evidence.trim() ||
    !Number.isFinite(Date.parse(plan.verifiedAt)) ||
    !integer(plan.firstPageIndex) ||
    typeof plan.parseVolumes !== 'function'
  )
    throw new PlatformReadError(
      'chapter_plan_unverified',
      'Current volume, query and all-state coverage evidence is required',
    );
  const names = [
    ...Object.values(plan.parentQueryKeys),
    plan.volumeQueryKey,
    plan.pageIndexQueryKey,
  ];
  if (
    names.some((key) => !/^[a-z][A-Za-z_]{0,47}$/.test(key)) ||
    new Set([plan.parentQueryKeys.chapters, plan.volumeQueryKey, plan.pageIndexQueryKey]).size !== 3
  )
    throw new PlatformReadError(
      'chapter_plan_unverified',
      'Chapter query fields must be distinct verified static names',
    );
}

/** Historical candidate only: each run must establish the actual current GET/schema and complete coverage. */
export function parseCandidateChapterVolumes(json: unknown): ChapterVolumeInventory {
  const payload = object(json);
  const data = object(payload?.data);
  if (payload?.code !== 0 || !data || !Array.isArray(data.volume_list))
    throw new PlatformReadError(
      'chapter_volume_schema_unverified',
      'The current volume envelope does not match the read-only candidate',
    );
  const volumes: ChapterVolume[] = [];
  const seen = new Set<string>();
  for (const value of data.volume_list) {
    const row = object(value);
    const id = chapterIdentifier(row?.volume_id);
    if (!row || !id || seen.has(id) || !integer(row.item_count))
      throw new PlatformReadError(
        'chapter_volume_schema_unverified',
        'The current volume identifiers or counts do not match the read-only candidate',
      );
    seen.add(id);
    volumes.push({ volumeId: id, itemCount: row.item_count });
  }
  return { volumes, complete: true };
}

export const CANDIDATE_CHAPTER_API_PLAN: ChapterApiEvidencePlan = {
  verifiedAt: '2026-10-03',
  evidence:
    'Historical volume shape candidate; current chapter item schema observed on 2026-10-03. Actual loaded query keys are required for every run.',
  allStatesEvidence: '',
  parentQueryKeys: { volumes: 'book_id', chapters: 'book_id', book: 'book_id' },
  volumeQueryKey: 'volume_id',
  pageIndexQueryKey: 'page_index',
  firstPageIndex: 0,
  parseVolumes: parseCandidateChapterVolumes,
};

export function boundChapterTemplate(raw: string, parentKey: string, workId: string): URL {
  const url = allowedUrl(raw);
  const parentKeys = new Set([parentKey, 'book_id', 'bookId', 'work_id', 'workId']);
  const parents = [...url.searchParams].filter(([key]) => parentKeys.has(key));
  const identityFilter = [...url.searchParams.keys()].some((key) =>
    /^(?:author|writer|user|target|account|owner)(?:_?id)?$|^(?:uid|id)$/i.test(key),
  );
  if (
    new Set(url.searchParams.keys()).size !== url.searchParams.size ||
    parents.length !== 1 ||
    parents[0]![0] !== parentKey ||
    parents[0]![1] !== workId ||
    identityFilter
  )
    throw new PlatformReadError(
      'chapter_source_parent_mismatch',
      'An actually loaded directory GET does not match the requested work',
    );
  return url;
}

export const CHAPTER_ENTRY_ERROR_CODES = new Set([
  'chapter_volume_template_unavailable',
  'chapter_volume_refresh_unavailable',
  'chapter_volume_refresh_transport_failed',
  'chapter_volume_refresh_http_failed',
  'chapter_volume_refresh_request_unobserved',
  'chapter_volume_refresh_request_ambiguous',
  'chapter_volume_refresh_response_unobserved',
  'chapter_volume_refresh_request_template_changed',
  'read_document_changed',
  'account_mismatch',
  'chapter_directory_slot_required',
  'chapter_directory_unavailable',
  'cancelled',
  'capability_unavailable',
  'invalid_work_id',
]);
