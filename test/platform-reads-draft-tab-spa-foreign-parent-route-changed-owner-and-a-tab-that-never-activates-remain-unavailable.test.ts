import test from 'node:test';

import {
  CHAPTER_ENTRY_FIXTURE_TITLE,
  CHAPTER_ENTRY_FIXTURE_WORK,
} from './helpers/platform-reads-chapter-entry-fixture-work.js';

import { draftsDiagnosticFixture } from './helpers/platform-reads-drafts-diagnostic-fixture.js';

import assert from 'node:assert/strict';

import { chapterEntryFixture } from './helpers/platform-reads-chapter-entry-fixture.js';

import { CHAPTER_SCHEMA_FIXTURE_SOURCES } from './helpers/platform-reads-chapter-core-row.js';

import { BrowserSessionError } from '../src/platform/browser.js';

test('draft-tab SPA foreign-parent route, changed owner and a tab that never activates remain unavailable', async () => {
  for (const [options, reason] of [
    [
      {
        spa: true,
        destination: `https://fanqienovel.com/main/writer/chapter-manage/7600000000000000002&${encodeURIComponent(CHAPTER_ENTRY_FIXTURE_TITLE)}?type=4`,
      },
      'chapter_drafts_parent_route_changed',
    ],
    [{ changeOwner: true }, 'chapter_drafts_identity_changed'],
    [{ stayInactive: true }, 'chapter_drafts_observation_failed'],
  ] as const) {
    const fixture = draftsDiagnosticFixture(options);
    const result = await fixture.diagnose();
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.chapterTab?.reason, reason);
    assert.equal(result.elements.length, 0);
    assert.equal(fixture.guardInstalled, false);
    await fixture.session.close();
  }
});

test('fresh draft-parent GET resolving across navigation cannot establish the old work or release a live guard', async () => {
  for (const staleBookFetch of [1, 2]) {
    const fixture = draftsDiagnosticFixture({ staleBookFetch });
    await assert.rejects(fixture.diagnose(), { code: 'read_diagnostic_stale' });
    assert.equal(fixture.guardInstalled, false);
    assert.equal(fixture.unknownBodyReads, 0);
    await fixture.session.close();
  }
});

test('draft route and actual list GET queries cannot bind another work or multiple parent keys', async () => {
  const base = draftsDiagnosticFixture();
  const cases = [
    { destination: `${base.initial}&book_id=7600000000000000002` },
    { destination: `${base.initial}&bookId=7600000000000000002` },
    {
      destination: `${base.initial}&book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&work_id=${CHAPTER_ENTRY_FIXTURE_WORK}`,
    },
    { draftSourceWorkId: '7600000000000000002' },
    { duplicateDraftParent: true },
  ];
  await base.session.close();
  for (const options of cases) {
    const fixture = draftsDiagnosticFixture(options);
    const result = await fixture.diagnose();
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.chapterTab?.status, 'unavailable');
    assert.equal(result.chapterTab?.targetRef, null);
    assert.equal(fixture.blocked, 1);
    assert.equal(fixture.unknownBodyReads, 0);
    assert.equal(fixture.guardInstalled, false);
    await fixture.session.close();
  }
});

test('a draft-tab SPA leaving the owned read route and returning before click settles retains the navigation violation', async () => {
  const fixture = draftsDiagnosticFixture({ spa: true, leaveAndReturn: true });
  const result = await fixture.diagnose();
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.chapterTab?.reason, 'chapter_drafts_parent_route_changed');
  assert.equal(result.chapterTab?.targetRef, null);
  assert.equal(result.elements.length, 0);
  assert.equal(fixture.guardInstalled, false);
  assert.equal(fixture.unknownBodyReads, 0);
  await fixture.session.close();
});

for (const [options, code, waits] of [
  [{ directoryReplayError: true }, 'chapter_volume_refresh_transport_failed', 0],
  [{ replayVolumeStatus: 503 }, 'chapter_volume_refresh_http_failed', 0],
  [{ suppressFreshVolumeEvents: true }, 'chapter_volume_refresh_request_unobserved', 0],
  [{ duplicateFreshVolumeRequest: true }, 'chapter_volume_refresh_request_ambiguous', 0],
  [{ suppressFreshVolumeResponse: true }, 'chapter_volume_refresh_response_unobserved', 1],
] as const)
  test(`volume refresh classifies only ${code} without a blind retry or private failure details`, async () => {
    const fixture = chapterEntryFixture({
      ...options,
      directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!],
    });
    let failure: unknown;
    try {
      await fixture.session.withPage((page) =>
        fixture.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK),
      );
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof BrowserSessionError);
    assert.equal(failure.code, code);
    assert.equal(fixture.directoryFetchCount, 1);
    assert.equal(fixture.volumeResponseWaits, waits);
    assert.equal(failure.message.includes('PRIVATE_'), false);
    await fixture.session.close();
  });

test('a current volume response delivered after evaluate resolves is accepted only through its exact already-observed request', async () => {
  const fixture = chapterEntryFixture({
    directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!],
    delayedFreshVolumeResponse: true,
  });
  const result = await fixture.session.withPage((page) =>
    fixture.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK),
  );
  assert.ok(result.sourceUrl.includes('{workId}'));
  assert.equal(fixture.directoryFetchCount, 1);
  assert.equal(fixture.volumeResponseWaits, 1);
  await fixture.session.close();
});

test('a late other-request or status-mismatched volume response cannot satisfy the successful refresh proof', async () => {
  for (const options of [
    { delayedFreshVolumeResponse: true, oldResponseDuringVolumeWait: true },
    { mismatchedFreshResponseStatus: 503 },
  ]) {
    const fixture = chapterEntryFixture({
      ...options,
      directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!],
    });
    await assert.rejects(
      fixture.session.withPage((page) =>
        fixture.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK),
      ),
      { code: 'chapter_volume_refresh_response_unobserved' },
    );
    assert.equal(fixture.directoryFetchCount, 1);
    await fixture.session.close();
  }
});

test('an additional request arriving in the bounded response wait is ambiguous even if the original response succeeds', async () => {
  const fixture = chapterEntryFixture({
    directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!],
    delayedFreshVolumeResponse: true,
    duplicateDuringVolumeWait: true,
  });
  await assert.rejects(
    fixture.session.withPage((page) =>
      fixture.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK),
    ),
    { code: 'chapter_volume_refresh_request_ambiguous' },
  );
  assert.equal(fixture.directoryFetchCount, 1);
  assert.equal(fixture.volumeResponseWaits, 1);
  await fixture.session.close();
});

test('navigation and cancellation during the bounded volume response wait retain the document/slot fence', async () => {
  const moved = chapterEntryFixture({
    directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!],
    delayedFreshVolumeResponse: true,
    navigateDuringVolumeWait: true,
  });
  await assert.rejects(
    moved.session.withPage((page) =>
      moved.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK),
    ),
    { code: 'read_document_changed' },
  );
  assert.equal(moved.directoryFetchCount, 1);
  await moved.session.close();
  const controller = new AbortController();
  const cancelled = chapterEntryFixture({
    directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!],
    delayedFreshVolumeResponse: true,
    cancelDuringVolumeWait: controller,
  });
  await assert.rejects(
    cancelled.session.withPage(
      (page) =>
        cancelled.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK, {
          signal: controller.signal,
        }),
      { signal: controller.signal },
    ),
    { code: 'cancelled' },
  );
  assert.equal(cancelled.directoryFetchCount, 1);
  await cancelled.session.close();
});

test('draft initialization can finish a delayed same-parent read query in active or network-idle waits before freezing verification', async () => {
  for (const delayedQueryPhase of ['active', 'networkidle'] as const) {
    const fixture = draftsDiagnosticFixture({ delayedQueryPhase });
    const result = await fixture.diagnose();
    assert.equal(result.status, 'success');
    assert.equal(result.chapterTab?.status, 'opened');
    assert.equal(result.chapterUi?.tabs.find((tab) => tab.label === '草稿箱')?.active, true);
    assert.equal(fixture.clicked, 1);
    assert.equal(fixture.unknownBodyReads, 0);
    assert.equal(fixture.guardInstalled, false);
    await fixture.session.close();
  }
});

test('draft initialization rejects a delayed illegal route and return in either bounded wait while post-freeze parent GET remains strict', async () => {
  for (const delayedQueryPhase of ['active', 'networkidle'] as const) {
    const fixture = draftsDiagnosticFixture({ delayedQueryPhase, delayedQueryInvalidReturn: true });
    const result = await fixture.diagnose();
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.chapterTab?.reason, 'chapter_drafts_parent_route_changed');
    assert.equal(result.elements.length, 0);
    assert.equal(fixture.guardInstalled, false);
    assert.equal(fixture.unknownBodyReads, 0);
    await fixture.session.close();
  }
  const after = draftsDiagnosticFixture({ delayedQueryPhase: 'active', staleBookFetch: 2 });
  await assert.rejects(after.diagnose(), { code: 'read_diagnostic_stale' });
  assert.equal(after.guardInstalled, false);
  await after.session.close();
});

test('blocked draft POST returns fixed observed path metadata while preserving rejection and never inspecting query/body/headers', async () => {
  const fixture = draftsDiagnosticFixture({
    blockedRequests: [
      {
        method: 'POST',
        url: `https://fanqienovel.com/api/author/chapter/chapter_list/v1?book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&title=PRIVATE_TITLE&token=PRIVATE_TOKEN#PRIVATE_HASH`,
      },
    ],
  });
  const result = await fixture.diagnose();
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.chapterTab?.reason, 'chapter_drafts_non_get_blocked');
  assert.equal(result.chapterTab?.targetRef, null);
  assert.deepEqual(result.chapterTab?.blockedRequests, {
    count: 1,
    truncated: false,
    entries: [
      {
        method: 'POST',
        resourceType: 'xhr',
        navigation: false,
        origin: 'platform',
        pathClass: 'known_author_api',
        pathTemplate: '/api/author/chapter/chapter_list/v1',
        authorFamily: 'chapter',
        count: 1,
      },
    ],
  });
  assert.equal(fixture.blocked, 1);
  assert.equal(fixture.forwarded, 1);
  assert.equal(fixture.bookReads, 1);
  assert.equal(fixture.clicked, 1);
  assert.equal(fixture.unknownBodyReads, 0);
  assert.equal(fixture.privateRequestFieldReads, 0);
  assert.equal(fixture.guardInstalled, false);
  for (const secret of [
    CHAPTER_ENTRY_FIXTURE_WORK,
    'PRIVATE_TITLE',
    'PRIVATE_TOKEN',
    'PRIVATE_HASH',
    '?',
    '#',
  ])
    assert.equal(JSON.stringify(result.chapterTab).includes(secret), false);
  await fixture.session.close();
});
