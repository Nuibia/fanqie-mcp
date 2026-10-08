import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateChapterDirectory,
  isCompleteManagementDirectory,
} from '../src/platform/chapter-directory.js';
import { makeDataset, type ChapterRecord, type ChapterDraftRecord } from '../src/platform/reads.js';

const workId = '7600000000000000001',
  sharedId = '7800000000000000001';
const source = 'https://fanqienovel.com/main/writer/chapter-manage/{workId}&{title}';
function phases() {
  const management = makeDataset<ChapterRecord>('chapters', source, [
    {
      workId,
      chapterId: sharedId,
      volumeId: '7700000000000000001',
      title: 'Synthetic management entry',
      index: 1,
      wordCount: 20,
      articleStatusCode: 99,
      displayStatusCode: 98,
      createdAtRaw: 'RAW_CREATED',
      scheduledAtRaw: '',
    },
  ]);
  management.status = 'partial';
  management.capturedAt = '2026-10-03T00:00:00.000Z';
  management.coverage = {
    complete: false,
    paginationComplete: false,
    pagesFetched: 1,
    pagesDiscovered: null,
    recordsFetched: 1,
    totalRecords: null,
    fields: Object.keys(management.records[0]!),
  };
  management.managementCoverage = {
    scope: 'management_all_statuses',
    status: 'complete',
    draftsCovered: false,
    inventoryVolumes: 1,
    matchedVolumes: 1,
    completedVolumes: 1,
    pagesFetched: 1,
    recordsFetched: 1,
    allStatusObserved: true,
    inventoryReconciled: true,
    reasons: [],
  };
  management.errors = [{ code: 'chapter_scope_coverage_unverified', scope: 'chapters' }];
  const drafts = makeDataset<ChapterDraftRecord>('chapter_drafts', source, [
    {
      workId,
      draftId: sharedId,
      title: 'Synthetic draft entry',
      wordCount: 10,
      modifiedAtRaw: 0,
      sourceScope: 'draft_list',
    },
  ]);
  drafts.status = 'success';
  drafts.capturedAt = '2026-10-03T00:00:01.000Z';
  drafts.coverage = {
    complete: true,
    paginationComplete: true,
    pagesFetched: 1,
    pagesDiscovered: 1,
    recordsFetched: 1,
    totalRecords: 1,
    fields: ['workId', 'draftId', 'title', 'wordCount', 'modifiedAtRaw', 'sourceScope'],
  };
  return { management, drafts };
}

test('generic directory retains colliding native IDs in separate namespaces and distinct phase cutoffs', () => {
  const { management, drafts } = phases();
  const result = aggregateChapterDirectory(workId, management, drafts);
  assert.equal(result.status, 'success');
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.paginationComplete, true);
  assert.equal(result.coverage.totalRecords, 2);
  assert.equal(result.coverage.pagesFetched, 2);
  assert.equal(result.coverage.pagesDiscovered, 2);
  assert.deepEqual(
    result.records.map((row) => row.namespace),
    ['management', 'draft_list'],
  );
  assert.equal(Object.hasOwn(result.records[0]!, 'draftId'), false);
  assert.equal(Object.hasOwn(result.records[1]!, 'chapterId'), false);
  assert.equal(Object.keys(result.records[0]!).length, 11);
  assert.equal(Object.keys(result.records[1]!).length, 7);
  assert.equal(result.directoryCoverage.atomicRevision, false);
  assert.equal(result.directoryCoverage.management.capturedAt, management.capturedAt);
  assert.equal(result.directoryCoverage.drafts!.capturedAt, drafts.capturedAt);
  assert.equal(result.capturedAt, drafts.capturedAt);
  drafts.records[0]!.title = 'Changed only after aggregation';
  assert.equal(result.records[1]!.title === drafts.records[0]!.title, false);
});

test('generic directory accepts proved empty draft JSON but cannot substitute absence or zero pages for it', () => {
  const { management, drafts } = phases();
  drafts.records = [];
  drafts.coverage.recordsFetched = drafts.coverage.totalRecords = 0;
  assert.equal(aggregateChapterDirectory(workId, management, drafts).status, 'success');
  const missing = aggregateChapterDirectory(workId, management, null);
  assert.equal(missing.status, 'partial');
  assert.equal(missing.directoryCoverage.drafts, null);
  assert.equal(missing.coverage.complete, false);
  drafts.coverage.pagesFetched = drafts.coverage.pagesDiscovered = 0;
  assert.equal(aggregateChapterDirectory(workId, management, drafts).coverage.complete, false);
});

test('generic directory refuses false named completeness, inconsistent extents, parents and unknown record properties', () => {
  const mutations: Array<(value: ReturnType<typeof phases>) => void> = [
    ({ management }) => {
      management.status = 'success';
    },
    ({ management }) => {
      management.coverage.complete = true;
    },
    ({ management }) => {
      management.errors.push({ code: 'OTHER_ERROR', scope: 'chapters' });
    },
    ({ management }) => {
      management.errors[0]!.scope = 'other';
    },
    ({ management }) => {
      management.errors[0] = Object.assign(
        Object.create({ code: 'chapter_scope_coverage_unverified', scope: 'chapters' }),
        { unrelatedOne: true, unrelatedTwo: true },
      );
    },
    ({ management }) => {
      management.managementCoverage!.inventoryVolumes = 0;
    },
    ({ management }) => {
      management.managementCoverage!.matchedVolumes = 0;
    },
    ({ management }) => {
      management.managementCoverage!.recordsFetched = 2;
    },
    ({ management }) => {
      management.coverage.pagesFetched = 2;
    },
    ({ management }) => {
      management.records[0]!.workId = '7600000000000000002';
    },
    ({ management }) => {
      management.records.push({ ...management.records[0]! });
    },
    ({ management }) => {
      management.records[0]!.extra = 'PRIVATE_UNKNOWN_FIELD_SENTINEL';
    },
    ({ management }) => {
      management.managementCoverage!.reasons.push('next_unavailable');
    },
    ({ drafts }) => {
      drafts.coverage.totalRecords = 2;
    },
    ({ drafts }) => {
      drafts.coverage.fields.push('unknown');
    },
    ({ drafts }) => {
      drafts.coverage.pagesFetched = drafts.coverage.pagesDiscovered = 65;
    },
    ({ drafts }) => {
      drafts.errors.push({ code: 'OTHER_ERROR', scope: 'chapter_drafts' });
    },
    ({ drafts }) => {
      drafts.records[0]!.sourceScope = 'other' as 'draft_list';
    },
    ({ drafts }) => {
      drafts.records.push({ ...drafts.records[0]! });
    },
    ({ drafts }) => {
      drafts.capturedAt = '2026-10-02T00:00:00.000Z';
    },
  ];
  for (const mutate of mutations) {
    const input = phases();
    mutate(input);
    const result = aggregateChapterDirectory(workId, input.management, input.drafts);
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.paginationComplete, false);
    assert.equal(result.coverage.totalRecords, null);
    assert.equal(result.errors.length, 1);
    assert.equal(JSON.stringify(result).includes('PRIVATE_UNKNOWN_FIELD_SENTINEL'), false);
  }
});

test('generic directory cannot certify cleanup-failed returned phases or rely on mutable profile rows', () => {
  const input = phases();
  input.drafts.status = 'capability_unavailable';
  input.drafts.records = [];
  const failed = aggregateChapterDirectory(workId, input.management, input.drafts);
  assert.equal(failed.status, 'capability_unavailable');
  assert.equal(failed.records.length, 0);
  assert.equal(failed.coverage.pagesFetched, 0);
  assert.equal(failed.coverage.fields.length, 0);
  input.management = makeDataset<ChapterRecord>('chapters', source, [
    { chapterId: sharedId, title: 'Profile-only synthetic row' } as ChapterRecord,
  ]);
  input.management.status = 'success';
  input.management.coverage.complete = input.management.coverage.paginationComplete = true;
  assert.equal(isCompleteManagementDirectory(workId, input.management), false);
  assert.equal(aggregateChapterDirectory(workId, input.management, null).records.length, 0);
});

test('generic directory preserves only incomplete manager internal unverified volume and fixed failure DTOs without turning them into proof', () => {
  const input = phases();
  const volume: import('../src/platform/reads.js').ChapterVolumeRefreshDiagnostic = {
    kind: 'chapter_volume_refresh',
    outcome: 'unverified',
    observedEvents: { requests: 2, responses: 1 },
    candidateEvents: { requests: 0, responses: 1 },
    events: [],
    truncated: false,
    fetchResult: 'http_success',
    proof: {
      requestObserved: false,
      requestAmbiguous: false,
      templateChanged: false,
      responseStatusMatched: false,
    },
  };
  const failure: import('../src/platform/reads.js').CurrentChapterCollectionFailureDiagnostic = {
    kind: 'current_chapter_collection_failure',
    failedStage: 'volume_get',
    initialState: null,
    identityTypes: {
      initialAuthenticated: null,
      initialAccountIdPresent: null,
      initialAuthorIdPresent: null,
      bindingAccountKind: true,
      bindingAuthorKind: false,
      expectedAccountKind: true,
      expectedAuthorKind: false,
      beforeParsedAccountIdPresent: true,
      beforeAccepted: true,
      afterParsedAccountIdPresent: null,
      afterAccepted: null,
    },
    ownAccountContext: {
      attempts: 1,
      disposed: 1,
      responseBefore: 'success',
      responseAfter: 'not_observed',
    },
    callback: { entered: false, succeeded: false },
    observedReason: 'template_missing',
    canonicalBootstrap: null,
    sourceObservation: null,
  };
  input.management.status = 'capability_unavailable';
  input.management.records = [];
  delete input.management.managementCoverage;
  input.management.readDiagnostics = Object.assign(
    { chapterVolumeRefresh: volume, currentChapterCollection: failure },
    { outsideError: { diagnostic: 'PRIVATE_OUTSIDE_DIAGNOSTIC_SENTINEL' } },
  );
  Object.assign(input.management, { diagnostic: 'PRIVATE_OUTSIDE_DIAGNOSTIC_SENTINEL' });
  const result = aggregateChapterDirectory(workId, input.management, null);
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.records.length, 0);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.paginationComplete, false);
  assert.deepEqual(Object.keys(result.readDiagnostics!).sort(), [
    'chapterVolumeRefresh',
    'currentChapterCollection',
  ]);
  assert.deepEqual(result.readDiagnostics!.chapterVolumeRefresh, volume);
  assert.deepEqual(result.readDiagnostics!.currentChapterCollection, failure);
  assert.equal(result.readDiagnostics!.chapterVolumeRefresh === volume, false);
  assert.equal(
    result.readDiagnostics!.currentChapterCollection!.identityTypes === failure.identityTypes,
    false,
  );
  assert.equal(JSON.stringify(result).includes('PRIVATE_OUTSIDE_DIAGNOSTIC_SENTINEL'), false);
  failure.identityTypes.beforeAccepted = false;
  volume.proof.requestObserved = true;
  assert.equal(
    result.readDiagnostics!.currentChapterCollection!.identityTypes.beforeAccepted,
    true,
  );
  assert.equal(result.readDiagnostics!.chapterVolumeRefresh!.proof.requestObserved, false);
  input.management.readDiagnostics = { chapterVolumeRefresh: { ...volume, outcome: 'verified' } };
  assert.equal(
    aggregateChapterDirectory(workId, input.management, null).readDiagnostics,
    undefined,
  );
  input.management.readDiagnostics = {
    currentChapterCollection: { ...failure, kind: 'other' as 'current_chapter_collection_failure' },
  };
  assert.equal(
    aggregateChapterDirectory(workId, input.management, null).readDiagnostics,
    undefined,
  );
  const complete = phases();
  complete.management.readDiagnostics = {
    chapterVolumeRefresh: { ...volume, outcome: 'unverified' },
    currentChapterCollection: failure,
  };
  const successful = aggregateChapterDirectory(workId, complete.management, complete.drafts);
  assert.equal(successful.status, 'success');
  assert.equal(successful.readDiagnostics, undefined);
  complete.management.status = 'success';
  assert.equal(
    aggregateChapterDirectory(workId, complete.management, null).readDiagnostics,
    undefined,
  );
});
