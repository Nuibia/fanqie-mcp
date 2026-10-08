import test from 'node:test';

import { managementDirectoryFixture } from './helpers/platform-reads-management-directory-fixture.js';

import assert from 'node:assert/strict';

import { parseChapterDraftPage } from '../src/platform/reads.js';

import { CHAPTER_ENTRY_FIXTURE_WORK } from './helpers/platform-reads-chapter-entry-fixture-work.js';

import { chapterDraftDirectoryFixture } from './helpers/platform-reads-chapter-draft-directory-fixture.js';

import { CURRENT_DIRECTORY_BOOK } from './helpers/platform-reads-assert-context-probe-safe.js';

import {
  DRAFT_DIRECTORY_SOURCE,
  DRAFT_DIRECTORY_NEXT,
} from './helpers/platform-reads-draft-directory-source.js';

test('management next waits cannot cross scope deadlines or click replaced nodes and their observations are revoked by late failure', async () => {
  const expired = managementDirectoryFixture({
    onePage: true,
    secondPaged: true,
    pagerDelayMs: 300,
  });
  const timeout = await expired.call({ timeoutMs: 180 });
  assert.equal(timeout.status, 'partial');
  assert.equal(expired.clicks, 2);
  assert.ok(timeout.managementCoverage?.reasons.includes('read_budget_exceeded'));
  assert.notEqual(timeout.managementCoverage?.status, 'complete');
  assert.equal(timeout.managementControlObservation, undefined);
  assert.equal(
    expired.calls.some((call) => call.url === expired.secondNext),
    false,
  );
  await expired.session.close();
  const replaced = managementDirectoryFixture({
    onePage: true,
    secondPaged: true,
    pagerDelayMs: 80,
    nextReplaced: true,
  });
  const changed = await replaced.call();
  assert.equal(changed.status, 'capability_unavailable');
  assert.deepEqual(changed.records, []);
  assert.equal(changed.managementCoverage, undefined);
  assert.equal(changed.managementControlObservation, undefined);
  assert.equal(replaced.clicks, 2);
  assert.equal(
    replaced.calls.some((call) => call.url === replaced.secondNext),
    false,
  );
  await replaced.session.close();
  const navigation = managementDirectoryFixture({
    onePage: true,
    secondPaged: true,
    pagerDelayMs: 300,
    navigationWhileWaiting: true,
  });
  const stale = await navigation.call();
  assert.equal(stale.status, 'capability_unavailable');
  assert.deepEqual(stale.records, []);
  assert.equal(stale.managementControlObservation, undefined);
  assert.equal(navigation.clicks, 2);
  await navigation.session.close();
  const owner = managementDirectoryFixture({
    onePage: true,
    secondPaged: true,
    unsupportedNextTag: true,
    ownerAfter: true,
  });
  const denied = await owner.call();
  assert.equal(owner.observations, 1);
  assert.equal(denied.status, 'capability_unavailable');
  assert.deepEqual(denied.records, []);
  assert.equal(denied.managementCoverage, undefined);
  assert.equal(denied.managementControlObservation, undefined);
  assert.equal(owner.identities.length, 0);
  await owner.session.close();
});

test('chapter drafts fixed parser preserves its exact list schema and never manufactures management fields or body', () => {
  const json = {
    code: 0,
    data: {
      total_count: 1,
      draft_list: [
        {
          item_id: '7900000000000000001',
          title: 'Draft title',
          word_number: 0,
          modify_time: 0,
          content: 'PRIVATE_DRAFT_BODY',
        },
      ],
    },
  };
  assert.deepEqual(parseChapterDraftPage(json, CHAPTER_ENTRY_FIXTURE_WORK), {
    total: 1,
    records: [
      {
        workId: CHAPTER_ENTRY_FIXTURE_WORK,
        draftId: '7900000000000000001',
        title: 'Draft title',
        wordCount: 0,
        modifiedAtRaw: 0,
        sourceScope: 'draft_list',
      },
    ],
  });
  for (const changed of [
    { item_id: 7900000000000000001 },
    { title: '' },
    { word_number: '0' },
    { modify_time: -1 },
    { modify_time: null },
    { book_id: '7600000000000000002' },
  ])
    assert.throws(() =>
      parseChapterDraftPage(
        {
          code: 0,
          data: { total_count: 1, draft_list: [{ ...json.data.draft_list[0], ...changed }] },
        },
        CHAPTER_ENTRY_FIXTURE_WORK,
      ),
    );
  for (const data of [
    { total_count: 1, item_list: json.data.draft_list },
    { total_count: '1', draft_list: [] },
    { total_count: 0, draft_list: json.data.draft_list },
    { total_count: 2, draft_list: [json.data.draft_list[0], json.data.draft_list[0]] },
  ])
    assert.throws(() => parseChapterDraftPage({ code: 0, data }, CHAPTER_ENTRY_FIXTURE_WORK));
  assert.throws(() => parseChapterDraftPage({ ...json, code: 1 }, CHAPTER_ENTRY_FIXTURE_WORK));
});

test('chapter drafts independently bind the tab handle and complete only its natural two-page draft scope', async () => {
  const fixture = chapterDraftDirectoryFixture({ delayedNext: 50 });
  const result = await fixture.call();
  assert.equal(result.status, 'success', JSON.stringify(result.errors));
  assert.equal(result.dataset, 'chapter_drafts');
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.paginationComplete, true);
  assert.equal(result.coverage.pagesFetched, 2);
  assert.equal(result.coverage.totalRecords, 2);
  assert.equal(result.records.length, 2);
  assert.equal(fixture.identities.length, 1);
  assert.equal(fixture.ownGetCount, 2);
  assert.equal(fixture.ownDisposals, 2);
  assert.equal(fixture.detachCount, 1);
  assert.deepEqual(
    fixture.calls.map((call) => call.url),
    [CURRENT_DIRECTORY_BOOK, DRAFT_DIRECTORY_SOURCE, DRAFT_DIRECTORY_NEXT, CURRENT_DIRECTORY_BOOK],
  );
  assert.deepEqual(fixture.apiOrder.slice(0, 3), ['own_get', 'own_dispose', 'volume_get']);
  assert.equal(result.managementCoverage, undefined);
  assert.equal(result.readDiagnostics, undefined);
  assert.deepEqual(result.errors, []);
  assert.equal(result.statisticsThrough, null);
  for (const secret of [
    'PRIVATE_DRAFT_BODY',
    'PRIVATE_DRAFT_TOKEN',
    'opaque_fixture',
    'volumeId',
    'articleStatusCode',
    'https://fanqienovel.com/api',
  ])
    assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(fixture.guarded, false);
  assert.equal(fixture.listenerCount('close'), 0);
  assert.equal(fixture.cdpListenerCount('Network.requestWillBeSent'), 0);
  await fixture.session.close();
});

test('chapter drafts prove zero only from the actual successful empty list, active draft table and fresh parent/owner', async () => {
  const empty = chapterDraftDirectoryFixture({ empty: true });
  const result = await empty.call();
  assert.equal(result.status, 'success', JSON.stringify(result.errors));
  assert.deepEqual(result.records, []);
  assert.equal(result.coverage.totalRecords, 0);
  assert.equal(result.coverage.pagesFetched, 1);
  assert.equal(empty.ownGetCount, 2);
  assert.equal(empty.identities.length, 1);
  await empty.session.close();
  const blank = chapterDraftDirectoryFixture({ empty: true, noTable: true });
  const failed = await blank.call();
  assert.equal(failed.status, 'capability_unavailable');
  assert.deepEqual(failed.records, []);
  assert.equal(failed.coverage.complete, false);
  assert.equal(blank.identities.length, 0);
  await blank.session.close();
});

test('chapter drafts reject unsafe, ambiguous or old-loader natural sources before any business GET', async () => {
  for (const candidate of [
    { url: DRAFT_DIRECTORY_SOURCE + '&bookId=' + CHAPTER_ENTRY_FIXTURE_WORK },
    { url: DRAFT_DIRECTORY_SOURCE + '&book_id=' + CHAPTER_ENTRY_FIXTURE_WORK },
    { url: DRAFT_DIRECTORY_SOURCE + '&owner_id=1001' },
    { url: DRAFT_DIRECTORY_SOURCE, cdp: { loaderId: 'SYNTHETIC_OLD_LOADER' } },
    { url: DRAFT_DIRECTORY_SOURCE, subframe: true },
    { url: DRAFT_DIRECTORY_SOURCE, method: 'POST' },
  ]) {
    const fixture = chapterDraftDirectoryFixture({
      sources: [{ url: CURRENT_DIRECTORY_BOOK }, candidate],
    });
    const result = await fixture.call({ timeoutMs: 80 });
    assert.equal(result.status, 'capability_unavailable');
    assert.deepEqual(result.records, []);
    assert.equal(fixture.getCount, 0);
    assert.equal(fixture.identities.length, 0);
    await fixture.session.close();
  }
  const ambiguous = chapterDraftDirectoryFixture({
    sources: [
      { url: CURRENT_DIRECTORY_BOOK },
      { url: DRAFT_DIRECTORY_SOURCE },
      { url: DRAFT_DIRECTORY_SOURCE + '&other=PRIVATE_TOKEN' },
    ],
  });
  const rejected = await ambiguous.call();
  assert.equal(rejected.status, 'capability_unavailable');
  assert.equal(ambiguous.getCount, 0);
  await ambiguous.session.close();
});

test('chapter drafts retain a valid incomplete attempt but reject changed totals, duplicate IDs or skipped natural pages', async () => {
  const missing = chapterDraftDirectoryFixture({ noNext: true });
  const partial = await missing.call();
  assert.equal(partial.status, 'partial', JSON.stringify(partial.errors));
  assert.equal(partial.records.length, 1);
  assert.equal(partial.coverage.complete, false);
  assert.equal(partial.errors[0]?.code, 'chapter_draft_next_unavailable');
  assert.equal(missing.identities.length, 1);
  await missing.session.close();
  for (const options of [
    { totalDrift: true },
    { repeatedId: true },
    { initialSource: DRAFT_DIRECTORY_SOURCE.replace('page_index=0', 'page_index=1') },
    { nextSource: DRAFT_DIRECTORY_NEXT.replace('page_index=1', 'page_index=2') },
  ]) {
    const fixture = chapterDraftDirectoryFixture(options);
    const result = await fixture.call();
    assert.equal(result.status, 'capability_unavailable');
    assert.deepEqual(result.records, []);
    assert.equal(result.coverage.pagesFetched, 0);
    assert.equal(fixture.identities.length, 0);
    await fixture.session.close();
  }
});

test('chapter drafts reject tab and next-node replacement, illegal route-and-return, deadline expiry and owner changes', async () => {
  for (const options of [
    { tabChanged: true },
    { leaveAndReturn: true },
    { nextChanged: true },
    { ownBefore: { json: { code: 0, data: { id: '1002' } } } },
    { ownAfter: { json: { code: 0, data: { id: '1002' } } } },
    { pageDelay: 120 },
  ]) {
    const fixture = chapterDraftDirectoryFixture(options);
    const result = await fixture.call(options.pageDelay ? { timeoutMs: 80 } : {});
    assert.equal(result.status, 'capability_unavailable');
    assert.deepEqual(result.records, []);
    assert.equal(result.coverage.complete, false);
    assert.equal(fixture.identities.length, 0);
    await fixture.session.close();
  }
});
