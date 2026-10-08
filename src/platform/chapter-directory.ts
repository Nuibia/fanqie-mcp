import {
  makeDataset,
  type ChapterRecord,
  type ChapterDraftRecord,
  type DatasetResult,
} from './reads.js';

export type GenericChapterRecord =
  | (ChapterRecord & { namespace: 'management' })
  | (ChapterDraftRecord & { namespace: 'draft_list' });
export interface ChapterDirectoryPhase {
  namespace: 'management' | 'draft_list';
  complete: boolean;
  capturedAt: string | null;
  pagesFetched: number;
  recordsFetched: number;
  totalRecords: number | null;
  fields: string[];
}
export interface GenericChapterDirectoryResult extends DatasetResult<GenericChapterRecord> {
  directoryCoverage: {
    scope: 'management_and_drafts';
    method: 'same_job_sequential';
    atomicRevision: false;
    management: ChapterDirectoryPhase;
    drafts: ChapterDirectoryPhase | null;
  };
}
const source = 'https://fanqienovel.com/main/writer/chapter-manage/{workId}&{title}';
const managementFields = [
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
const draftFields = ['workId', 'draftId', 'title', 'wordCount', 'modifiedAtRaw', 'sourceScope'];
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9]\d{9,29}$/.test(value);
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const signedInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);
const timestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const exactKeys = (value: unknown, fields: string[]): boolean =>
  object(value) &&
  Object.keys(value).length === fields.length &&
  fields.every((field) => Object.hasOwn(value, field));
const exactFields = (value: unknown, fields: string[]): boolean =>
  Array.isArray(value) &&
  value.length === fields.length &&
  new Set(value).size === fields.length &&
  fields.every((field) => value.includes(field));
function managementRows(
  workId: string,
  value: DatasetResult<ChapterRecord>,
): ChapterRecord[] | null {
  if (
    !object(value) ||
    !identifier(workId) ||
    value.dataset !== 'chapters' ||
    !Array.isArray(value.records) ||
    value.records.length > 100_000
  )
    return null;
  const seen = new Set<string>(),
    records: ChapterRecord[] = [];
  for (const row of value.records) {
    if (
      !object(row) ||
      Object.keys(row).length !== managementFields.length ||
      !managementFields.every((field) => Object.hasOwn(row, field)) ||
      row.workId !== workId ||
      !identifier(row.chapterId) ||
      !identifier(row.volumeId) ||
      seen.has(row.chapterId) ||
      typeof row.title !== 'string' ||
      !row.title.trim() ||
      !count(row.index) ||
      !count(row.wordCount) ||
      !signedInteger(row.articleStatusCode) ||
      !signedInteger(row.displayStatusCode) ||
      typeof row.createdAtRaw !== 'string' ||
      typeof row.scheduledAtRaw !== 'string'
    )
      return null;
    seen.add(row.chapterId);
    records.push({
      workId,
      chapterId: row.chapterId,
      volumeId: row.volumeId,
      title: row.title,
      index: row.index,
      wordCount: row.wordCount,
      articleStatusCode: row.articleStatusCode,
      displayStatusCode: row.displayStatusCode,
      createdAtRaw: row.createdAtRaw,
      scheduledAtRaw: row.scheduledAtRaw,
    });
  }
  return records;
}
function draftRows(
  workId: string,
  value: DatasetResult<ChapterDraftRecord>,
): ChapterDraftRecord[] | null {
  if (
    !object(value) ||
    !identifier(workId) ||
    value.dataset !== 'chapter_drafts' ||
    !Array.isArray(value.records) ||
    value.records.length > 100_000
  )
    return null;
  const seen = new Set<string>(),
    records: ChapterDraftRecord[] = [];
  for (const row of value.records) {
    if (
      !object(row) ||
      Object.keys(row).length !== draftFields.length ||
      !draftFields.every((field) => Object.hasOwn(row, field)) ||
      row.workId !== workId ||
      !identifier(row.draftId) ||
      seen.has(row.draftId) ||
      typeof row.title !== 'string' ||
      !row.title.trim() ||
      !count(row.wordCount) ||
      !(typeof row.modifiedAtRaw === 'string' || count(row.modifiedAtRaw)) ||
      row.sourceScope !== 'draft_list'
    )
      return null;
    seen.add(row.draftId);
    records.push({
      workId,
      draftId: row.draftId,
      title: row.title,
      wordCount: row.wordCount,
      modifiedAtRaw: row.modifiedAtRaw,
      sourceScope: 'draft_list',
    });
  }
  return records;
}
export function isCompleteManagementDirectory(
  workId: string,
  value: DatasetResult<ChapterRecord>,
): boolean {
  const records = managementRows(workId, value),
    scope = value.managementCoverage,
    coverage = value.coverage;
  if (
    !records ||
    value.status !== 'partial' ||
    !timestamp(value.capturedAt) ||
    value.sourceUrl !== source ||
    !exactKeys(scope, [
      'scope',
      'status',
      'draftsCovered',
      'inventoryVolumes',
      'matchedVolumes',
      'completedVolumes',
      'pagesFetched',
      'recordsFetched',
      'allStatusObserved',
      'inventoryReconciled',
      'reasons',
    ]) ||
    !scope ||
    scope.scope !== 'management_all_statuses' ||
    scope.status !== 'complete' ||
    scope.draftsCovered !== false ||
    scope.allStatusObserved !== true ||
    scope.inventoryReconciled !== true ||
    !Array.isArray(scope.reasons) ||
    scope.reasons.length !== 0 ||
    !count(scope.inventoryVolumes) ||
    scope.inventoryVolumes < 1 ||
    scope.matchedVolumes !== scope.inventoryVolumes ||
    scope.completedVolumes !== scope.inventoryVolumes ||
    !count(scope.pagesFetched) ||
    scope.pagesFetched < scope.completedVolumes ||
    scope.pagesFetched > 64 ||
    scope.recordsFetched !== records.length ||
    new Set(records.map((row) => row.volumeId)).size > scope.inventoryVolumes
  )
    return false;
  if (
    !exactKeys(coverage, [
      'complete',
      'paginationComplete',
      'pagesFetched',
      'pagesDiscovered',
      'recordsFetched',
      'totalRecords',
      'fields',
    ]) ||
    !coverage ||
    coverage.complete !== false ||
    coverage.paginationComplete !== false ||
    coverage.pagesFetched !== scope.pagesFetched ||
    coverage.recordsFetched !== records.length ||
    coverage.pagesDiscovered !== null ||
    coverage.totalRecords !== null ||
    !exactFields(coverage.fields, managementFields)
  )
    return false;
  return (
    Array.isArray(value.errors) &&
    value.errors.length === 1 &&
    value.errors[0]?.code === 'chapter_scope_coverage_unverified' &&
    value.errors[0]?.scope === 'chapters' &&
    exactKeys(value.errors[0], ['code', 'scope'])
  );
}
function completeDraftDirectory(workId: string, value: DatasetResult<ChapterDraftRecord>): boolean {
  const records = draftRows(workId, value),
    coverage = value.coverage;
  return Boolean(
    records &&
    value.status === 'success' &&
    value.sourceUrl === source &&
    timestamp(value.capturedAt) &&
    coverage &&
    exactKeys(coverage, [
      'complete',
      'paginationComplete',
      'pagesFetched',
      'pagesDiscovered',
      'recordsFetched',
      'totalRecords',
      'fields',
    ]) &&
    coverage.complete === true &&
    coverage.paginationComplete === true &&
    count(coverage.pagesFetched) &&
    coverage.pagesFetched >= 1 &&
    coverage.pagesFetched <= 64 &&
    coverage.pagesDiscovered === coverage.pagesFetched &&
    coverage.recordsFetched === records.length &&
    coverage.totalRecords === records.length &&
    exactFields(coverage.fields, draftFields) &&
    Array.isArray(value.errors) &&
    value.errors.length === 0,
  );
}
/** Pure shape/count validation only. The caller must own this job/slot and verify both actual owner callbacks. */
export function aggregateChapterDirectory(
  workId: string,
  management: DatasetResult<ChapterRecord>,
  drafts: DatasetResult<ChapterDraftRecord> | null,
): GenericChapterDirectoryResult {
  const result = makeDataset<GenericChapterRecord>(
    'chapters',
    source,
  ) as GenericChapterDirectoryResult;
  const managerRecords = managementRows(workId, management),
    draftsRecords = drafts ? draftRows(workId, drafts) : null;
  const managerComplete = isCompleteManagementDirectory(workId, management),
    draftComplete = drafts ? completeDraftDirectory(workId, drafts) : false;
  const phase = (
    namespace: ChapterDirectoryPhase['namespace'],
    input: DatasetResult<unknown>,
    records: unknown[] | null,
    complete: boolean,
    fields: string[],
  ): ChapterDirectoryPhase => ({
    namespace,
    complete,
    capturedAt: timestamp(input.capturedAt) ? input.capturedAt : null,
    pagesFetched:
      count(input.coverage?.pagesFetched) && input.coverage.pagesFetched <= 64
        ? input.coverage.pagesFetched
        : 0,
    recordsFetched: records?.length ?? 0,
    totalRecords: complete ? records!.length : null,
    fields:
      records && Array.isArray(input.coverage?.fields)
        ? fields.filter((field) => input.coverage.fields.includes(field))
        : [],
  });
  result.directoryCoverage = {
    scope: 'management_and_drafts',
    method: 'same_job_sequential',
    atomicRevision: false,
    management: phase('management', management, managerRecords, managerComplete, managementFields),
    drafts: drafts ? phase('draft_list', drafts, draftsRecords, draftComplete, draftFields) : null,
  };
  result.limitations.push(
    'This directory traverses the management-all-statuses namespace followed by the draft-list namespace in one job. Each phase retains its own canonical cutoff; it is not an atomic platform revision.',
    'Namespace plus work ID plus its native chapterId/draftId identifies an entry. Equal IDs across namespaces are retained separately; draft IDs are not chapter IDs.',
    'Raw management status codes and draft-list membership do not establish a published body, write version, deleted directory, or another platform namespace.',
  );
  const hardFailure =
    !managerRecords ||
    !['partial', 'success'].includes(management.status) ||
    (drafts !== null && (!draftsRecords || !['partial', 'success'].includes(drafts.status)));
  if (!hardFailure) {
    result.records = [
      ...managerRecords.map((row) => ({ namespace: 'management' as const, ...row })),
      ...(draftsRecords ?? []).map((row) => ({ namespace: 'draft_list' as const, ...row })),
    ];
    result.status = 'partial';
    result.coverage.recordsFetched = result.records.length;
    result.coverage.pagesFetched =
      result.directoryCoverage.management.pagesFetched +
      (result.directoryCoverage.drafts?.pagesFetched ?? 0);
    result.coverage.fields = ['namespace', 'workId', 'title', 'wordCount'];
  }
  const chronological =
    drafts &&
    timestamp(management.capturedAt) &&
    timestamp(drafts.capturedAt) &&
    drafts.capturedAt >= management.capturedAt;
  if (managerComplete && draftComplete && chronological && !hardFailure) {
    result.status = 'success';
    result.coverage.complete = result.coverage.paginationComplete = true;
    result.coverage.pagesDiscovered = result.coverage.pagesFetched;
    result.coverage.totalRecords = result.records.length;
  } else
    result.errors.push({
      code: !managerComplete
        ? 'chapter_directory_management_incomplete'
        : !draftComplete
          ? 'chapter_directory_drafts_incomplete'
          : 'chapter_directory_cutoff_unverified',
      scope: 'chapters',
    });
  if (timestamp(drafts?.capturedAt)) result.capturedAt = drafts!.capturedAt;
  else if (timestamp(management.capturedAt)) result.capturedAt = management.capturedAt;
  // These two typed DTOs are produced inside the returned manager collector.
  // Never inspect a caught error or grant source/coverage permission from them.
  if (!managerComplete && management.status !== 'success' && result.status !== 'success') {
    try {
      const internal = management.readDiagnostics;
      const volume = internal?.chapterVolumeRefresh;
      if (volume?.kind === 'chapter_volume_refresh' && volume.outcome === 'unverified')
        result.readDiagnostics = { chapterVolumeRefresh: structuredClone(volume) };
      const failure = internal?.currentChapterCollection;
      if (failure?.kind === 'current_chapter_collection_failure') {
        result.readDiagnostics ??= {};
        result.readDiagnostics.currentChapterCollection = structuredClone(failure);
      }
    } catch {
      /* Optional internal metadata cannot change the aggregate result. */
    }
  }
  return result;
}
