import test from 'node:test';

import {
  CHAPTER_SCHEMA_FIXTURE_SOURCES,
  chapterCoreFixture,
} from './helpers/platform-reads-chapter-core-row.js';

import { chapterEntryFixture } from './helpers/platform-reads-chapter-entry-fixture.js';

import assert from 'node:assert/strict';

import {
  CHAPTER_ENTRY_FIXTURE_WORK,
  CHAPTER_ENTRY_FIXTURE_TITLE,
} from './helpers/platform-reads-chapter-entry-fixture-work.js';

import { BrowserSessionError } from '../src/platform/browser.js';

import { draftsDiagnosticFixture } from './helpers/platform-reads-drafts-diagnostic-fixture.js';

import { type Page } from 'playwright';

test('distinct phase-local templates and unobserved or duplicate fresh requests fail closed without blind retry', async () => {
  const volume = CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!;
  const ambiguous = chapterEntryFixture({
    directorySources: [volume, { ...volume, url: volume.url + '&page_index=1' }],
  });
  await assert.rejects(
    ambiguous.session.withPage((page) =>
      ambiguous.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK),
    ),
    { code: 'chapter_volume_template_unavailable' },
  );
  assert.equal(ambiguous.directoryFetchCount, 0);
  await ambiguous.session.close();
  for (const [options, code] of [
    [{ suppressFreshVolumeEvents: true }, 'chapter_volume_refresh_request_unobserved'],
    [{ duplicateFreshVolumeRequest: true }, 'chapter_volume_refresh_request_ambiguous'],
    [{ replayVolumeStatus: 401 }, 'chapter_volume_refresh_http_failed'],
    [{ directoryReplayError: true }, 'chapter_volume_refresh_transport_failed'],
  ] as const) {
    const fixture = chapterEntryFixture({ ...options, directorySources: [volume] });
    let error: unknown;
    try {
      await fixture.session.withPage((page) =>
        fixture.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK),
      );
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof BrowserSessionError);
    assert.equal(error.code, code);
    assert.equal(error.message.includes('PRIVATE_'), false);
    assert.equal(fixture.directoryFetchCount, 1);
    await fixture.session.close();
  }
});

test('volume replay preserves strict epoch, active-slot, cancellation and same-own checks before returning', async () => {
  for (const [options, code] of [
    [{ navigateDuringDirectoryReplay: true }, 'read_document_changed'],
    [{ loseSlotDuringDirectoryReplay: true }, 'chapter_directory_slot_required'],
    [{ ownerAfterDirectoryReplay: true }, 'account_mismatch'],
  ] as const) {
    const fixture = chapterEntryFixture({
      ...options,
      directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!],
    });
    await assert.rejects(
      fixture.session.withPage((page) =>
        fixture.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK),
      ),
      { code },
    );
    assert.equal(fixture.directoryFetchCount, 1);
    await fixture.session.close();
  }
  const controller = new AbortController();
  const cancelled = chapterEntryFixture({
    cancelDuringDirectoryReplay: controller,
    directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!],
  });
  await assert.rejects(
    cancelled.session.withPage((page) =>
      cancelled.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK, {
        signal: controller.signal,
      }),
    ),
    { code: 'cancelled' },
  );
  assert.equal(cancelled.directoryFetchCount, 1);
  await cancelled.session.close();
});

test('chapter entry exposes only the fifteen fixed browser error codes without raw message, source, account or body values', async () => {
  for (const code of [
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
  ]) {
    const fixture = chapterCoreFixture();
    const error = Object.assign(
      new Error('PRIVATE_MESSAGE https://fanqienovel.com/private?token=PRIVATE_TOKEN'),
      { code, accountId: 'PRIVATE_ACCOUNT', body: 'PRIVATE_BODY' },
    );
    const result = await fixture.collect({
      enterDirectory: async () => {
        throw error;
      },
    });
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]?.code, code);
    assert.equal(result.records.length, 0);
    assert.equal(result.coverage.pagesFetched, 0);
    assert.equal(fixture.calls.length, 0);
    for (const secret of [
      'PRIVATE_MESSAGE',
      'PRIVATE_TOKEN',
      'PRIVATE_ACCOUNT',
      'PRIVATE_BODY',
      '/private?',
    ])
      assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test('chapter entry unknown, inherited, accessor or nonstring codes remain generic and never evaluate or leak private fields', async () => {
  let accessed = false;
  const getter = Object.defineProperty({}, 'code', {
    get() {
      accessed = true;
      throw new Error('PRIVATE_GETTER_VALUE');
    },
  });
  const unreadable = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        throw new Error('PRIVATE_REFLECTION_VALUE');
      },
    },
  );
  for (const error of [
    new Error('PRIVATE_ERROR_URL?token=PRIVATE_TOKEN'),
    { code: 'PRIVATE_CODE_URL?token=PRIVATE_TOKEN', message: 'PRIVATE_MESSAGE' },
    { code: 401 },
    { code: null },
    Object.create({ code: 'read_document_changed' }),
    getter,
    unreadable,
    ['read_document_changed'],
    'PRIVATE_STRING',
    null,
  ]) {
    const fixture = chapterCoreFixture();
    const result = await fixture.collect({
      enterDirectory: async () => {
        throw error;
      },
    });
    assert.equal(result.errors[0]?.code, 'chapter_read_failed');
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(fixture.calls.length, 0);
    for (const secret of ['PRIVATE_', '?token='])
      assert.equal(JSON.stringify(result).includes(secret), false);
  }
  assert.equal(accessed, false);
});

test('a chapter navigation failure after rows were read discards all row coverage and document freshness rather than retaining partial rows', async () => {
  const fixture = chapterCoreFixture({ navigateAt: 4 });
  const result = await fixture.collect();
  assert.equal(fixture.calls.length, 4);
  assert.equal(result.errors[0]?.code, 'read_document_changed');
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.records.length, 0);
  assert.deepEqual(result.coverage, {
    complete: false,
    paginationComplete: false,
    pagesFetched: 0,
    pagesDiscovered: null,
    recordsFetched: 0,
    totalRecords: null,
    fields: [],
  });
  assert.equal(result.sourceUrl, null);
  assert.equal(result.statisticsThrough, null);
  assert.equal(result.statisticsThroughBasis, null);
  assert.equal(result.statisticsCutoffRaw, null);
  assert.equal(result.platformUpdateSchedule, null);
});

test('draft-tab observation requires an opaque verified directory target and cannot extend generic route access', async () => {
  const fixture = draftsDiagnosticFixture();
  fixture.page.goto = (async () => {
    throw new Error('Must reject before navigation');
  }) as Page['goto'];
  for (const source of [
    'https://fanqienovel.com/main/writer/book-manage',
    fixture.initial,
    'https://fanqienovel.com/main/writer/data',
  ])
    await assert.rejects(fixture.session.diagnoseReadPage(source, { chapterTab: 'drafts' }), {
      code: 'invalid_chapter_tab_target',
    });
  await fixture.session.close();
});

test('one visible draft-list tab is selected on the same verified parent and returns only known metadata, never unknown response bodies', async () => {
  for (const spa of [false, true]) {
    const fixture = draftsDiagnosticFixture({ spa });
    const result = await fixture.diagnose();
    assert.equal(result.status, 'success');
    assert.equal(result.chapterTab?.status, 'opened');
    assert.equal(fixture.clicked, 1);
    assert.ok(result.chapterTab?.targetRef);
    assert.equal(result.chapterUi?.tabs.find((tab) => tab.label === '草稿箱')?.active, true);
    assert.equal(fixture.guardInstalled, false);
    assert.equal(fixture.unknownBodyReads, 0);
    assert.ok(
      result.getResponses.some((row) => row.pathTemplate.includes('/synthetic_draft_directory/')),
    );
    assert.equal(
      result.readResponseStructure?.some((row) =>
        row.pathTemplate.includes('/synthetic_draft_directory/'),
      ),
      false,
    );
    for (const value of [
      CHAPTER_ENTRY_FIXTURE_WORK,
      CHAPTER_ENTRY_FIXTURE_TITLE,
      'PRIVATE_OWNER',
      'PRIVATE_PARENT_NONCE',
      'PRIVATE_DRAFT_TOKEN',
      'PRIVATE_BOOK_BODY',
    ])
      assert.equal(JSON.stringify(result).includes(value), false);
    await fixture.session.close();
  }
});

test('draft-list tab already active is inspected without another click or a guessed draft API', async () => {
  const fixture = draftsDiagnosticFixture({ alreadyActive: true, omitDraftSource: true });
  const result = await fixture.diagnose();
  assert.equal(result.chapterTab?.status, 'opened');
  assert.equal(fixture.clicked, 0);
  assert.equal(fixture.unknownBodyReads, 0);
  await fixture.session.close();
});

test('draft tab missing/ambiguous/hidden/disabled and missing or wrong parent evidence fail before clicking', async () => {
  for (const [options, reason] of [
    [{ tabLabels: ['章节管理'] }, 'chapter_drafts_tab_ambiguous'],
    [{ tabLabels: ['草稿箱', '草稿箱'] }, 'chapter_drafts_tab_ambiguous'],
    [{ hiddenDraft: true }, 'chapter_drafts_tab_unverified'],
    [{ disabledDraft: true }, 'chapter_drafts_tab_unverified'],
    [{ noBookSource: true }, 'chapter_drafts_parent_source_missing'],
    [{ parentSourceOtherWork: true }, 'chapter_drafts_parent_source_missing'],
    [{ wrongBook: true }, 'chapter_drafts_parent_mismatch'],
    [{ wrongTitle: true }, 'chapter_drafts_parent_mismatch'],
  ] as const) {
    const fixture = draftsDiagnosticFixture(options);
    const result = await fixture.diagnose();
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.chapterTab?.reason, reason);
    assert.equal(fixture.clicked, 0);
    assert.equal(fixture.guardInstalled, false);
    await fixture.session.close();
  }
});

test('draft-tab network guard rejects POST, editor/create routes, external and other-parent navigation', async () => {
  for (const options of [
    { post: true },
    {
      destination: `https://fanqienovel.com/main/writer/publish-chapter/${CHAPTER_ENTRY_FIXTURE_WORK}`,
    },
    { destination: 'https://fanqienovel.com/main/writer/create-book' },
    { destination: 'https://external.invalid/PRIVATE_UNSAFE?token=PRIVATE_TOKEN' },
    {
      destination: `https://fanqienovel.com/main/writer/chapter-manage/7600000000000000002&${encodeURIComponent(CHAPTER_ENTRY_FIXTURE_TITLE)}?type=4`,
    },
  ]) {
    const fixture = draftsDiagnosticFixture(options);
    const result = await fixture.diagnose();
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.chapterTab?.status, 'unavailable');
    assert.equal(result.chapterTab?.targetRef, null);
    assert.equal(fixture.blocked, 1);
    assert.equal(fixture.guardInstalled, false);
    assert.equal(fixture.unknownBodyReads, 0);
    for (const value of ['PRIVATE_UNSAFE', 'PRIVATE_TOKEN'])
      assert.equal(JSON.stringify(result).includes(value), false);
    await fixture.session.close();
  }
});
