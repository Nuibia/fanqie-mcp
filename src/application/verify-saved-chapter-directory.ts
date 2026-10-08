import { type Store, type Manifest } from '../runtime/store.js';
import { record } from './shared.js';
export function verifySavedChapterDirectory(store: Store, manifest: Manifest): boolean {
  if (
    manifest.operation !== 'list_chapters' ||
    !/^chapters\.[1-9]\d{9,29}$/.test(manifest.scope) ||
    manifest.datasets.length !== 1 ||
    manifest.datasets[0] !== 'chapters' ||
    manifest.evidence.length !== 1 ||
    manifest.evidence[0]?.dataset !== 'chapters'
  )
    return false;
  try {
    const document = store.readEvidence(manifest.evidence[0]);
    const payload = record(document.payload),
      coverage = record(payload.coverage),
      scope = record(payload.directoryCoverage);
    const management = record(scope.management),
      drafts = record(scope.drafts),
      source = record(payload.source);
    const completePhase = (phase: Record<string, unknown>, namespace: string, fieldCount: number) =>
      phase.namespace === namespace &&
      phase.complete === true &&
      typeof phase.capturedAt === 'string' &&
      Number.isFinite(Date.parse(phase.capturedAt)) &&
      new Date(phase.capturedAt).toISOString() === phase.capturedAt &&
      typeof phase.pagesFetched === 'number' &&
      Number.isSafeInteger(phase.pagesFetched) &&
      phase.pagesFetched >= 1 &&
      phase.pagesFetched <= 64 &&
      typeof phase.recordsFetched === 'number' &&
      Number.isSafeInteger(phase.recordsFetched) &&
      phase.recordsFetched >= 0 &&
      phase.recordsFetched <= 100_000 &&
      phase.totalRecords === phase.recordsFetched &&
      Array.isArray(phase.fields) &&
      phase.fields.length === fieldCount;
    return (
      document.collectionMode === 'live' &&
      document.evidenceKind === 'observation' &&
      payload.dataset === 'chapters' &&
      payload.status === 'success' &&
      source.mode === 'live' &&
      source.origin === 'https://fanqienovel.com' &&
      payload.sourceUrl === 'https://fanqienovel.com/main/writer/chapter-manage/{workId}&{title}' &&
      scope.scope === 'management_and_drafts' &&
      scope.method === 'same_job_sequential' &&
      scope.atomicRevision === false &&
      completePhase(management, 'management', 10) &&
      completePhase(drafts, 'draft_list', 6) &&
      (drafts.capturedAt as string) >= (management.capturedAt as string) &&
      payload.capturedAt === drafts.capturedAt &&
      Array.isArray(payload.records) &&
      coverage.complete === true &&
      coverage.paginationComplete === true &&
      coverage.recordsFetched === payload.records.length &&
      coverage.totalRecords === payload.records.length &&
      payload.records.length ===
        (management.recordsFetched as number) + (drafts.recordsFetched as number) &&
      coverage.pagesFetched ===
        (management.pagesFetched as number) + (drafts.pagesFetched as number) &&
      coverage.pagesDiscovered === coverage.pagesFetched &&
      Array.isArray(payload.errors) &&
      payload.errors.length === 0
    );
  } catch {
    return false;
  } // A missing/corrupt reference cannot verify this new capability.
}
