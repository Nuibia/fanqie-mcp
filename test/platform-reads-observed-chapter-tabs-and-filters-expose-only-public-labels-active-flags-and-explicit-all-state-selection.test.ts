import test from 'node:test';

import { chapterEntryFixture } from './helpers/platform-reads-chapter-entry-fixture.js';

import {
  CHAPTER_ENTRY_FIXTURE_WORK,
  CHAPTER_ENTRY_FIXTURE_TITLE,
} from './helpers/platform-reads-chapter-entry-fixture-work.js';

import assert from 'node:assert/strict';

import { CHAPTER_SCHEMA_FIXTURE_SOURCES } from './helpers/platform-reads-chapter-core-row.js';

import { type Page } from 'playwright';

test('observed chapter tabs and filters expose only public labels, active flags and explicit all-state selection', async () => {
  const fixture = chapterEntryFixture({
    chapterUi: {
      tabs: [
        { label: '已发布章节', active: true },
        { label: '草稿箱' },
        { label: 'PRIVATE_CHAPTER_TAB' },
      ],
      statusLabels: ['全部状态'],
      volumeLabels: ['PRIVATE_VOLUME_NAME'],
      table: true,
    },
  });
  const result = await fixture.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
    { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
  );
  assert.equal(result.chapterUi?.tabs.length, 3);
  assert.equal(result.chapterUi?.tabs[0]?.label, '已发布章节');
  assert.equal(result.chapterUi?.tabs[0]?.active, true);
  assert.equal(result.chapterUi?.tabs[1]?.label, '草稿箱');
  assert.equal(result.chapterUi?.tabs[1]?.active, false);
  assert.equal(result.chapterUi?.tabs[2]?.label, null);
  assert.equal(result.chapterUi?.statusFilter.label, '全部状态');
  assert.equal(result.chapterUi?.statusFilter.all, true);
  assert.equal(result.chapterUi?.statusFilter.matches, 1);
  assert.equal(result.chapterUi?.volumeFilter.present, true);
  assert.equal(result.chapterUi?.volumeFilter.matches, 1);
  assert.equal(result.chapterUi?.volumeFilter.label, null);
  assert.equal(result.chapterUi?.volumeFilter.all, false);
  assert.equal(result.chapterUi?.tablePresent, true);
  for (const secret of [
    'PRIVATE_VOLUME_NAME',
    'PRIVATE_CHAPTER_TAB',
    'PRIVATE_CHAPTER_BODY',
    CHAPTER_ENTRY_FIXTURE_TITLE,
    CHAPTER_ENTRY_FIXTURE_WORK,
  ])
    assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(fixture.clickCount, 1);
  await fixture.session.close();
});

test('chapter UI diagnostics bound tab cardinality and refuse ambiguous all-state controls or unknown active-label text', async () => {
  const fixture = chapterEntryFixture({
    chapterUi: {
      tabs: [
        { label: 'PRIVATE_TITLE 已发布', ariaSelected: 'true' },
        ...Array.from({ length: 12 }, () => ({ label: '草稿箱' })),
      ],
      statusLabels: ['全部', '全部状态'],
      volumeLabels: ['全部章节'],
      table: false,
    },
  });
  const result = await fixture.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
    { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
  );
  assert.equal(result.chapterUi?.tabs.length, 8);
  assert.equal(result.chapterUi?.tabsTruncated, true);
  assert.equal(result.chapterUi?.tabs[0]?.active, true);
  assert.equal(result.chapterUi?.tabs[0]?.label, null);
  assert.equal(result.chapterUi?.statusFilter.matches, 2);
  assert.equal(result.chapterUi?.statusFilter.label, null);
  assert.equal(result.chapterUi?.statusFilter.all, false);
  assert.equal(result.chapterUi?.volumeFilter.all, true);
  assert.equal(result.chapterUi?.tablePresent, false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_TITLE'), false);
  await fixture.session.close();
});

test('chapter UI projection is absent on management or changed-owner pages and fails closed during navigation', async () => {
  const options = {
    chapterUi: { tabs: [{ label: '草稿箱', active: true }], statusLabels: ['全部状态'] },
    navigateDuringDiagnosticDom: false,
  };
  const fixture = chapterEntryFixture(options);
  const management = await fixture.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
  );
  assert.equal(management.chapterUi, undefined);
  const entered = await fixture.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
    { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
  );
  options.navigateDuringDiagnosticDom = true;
  await assert.rejects(
    fixture.session.diagnoseReadPage(`diagnostic:${entered.chapterEntry!.targetRef}`),
    { code: 'read_diagnostic_stale' },
  );
  await fixture.session.close();
  const changed = chapterEntryFixture({ changedOwner: true, chapterUi: options.chapterUi });
  const refused = await changed.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
    { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
  );
  assert.equal(refused.chapterUi, undefined);
  assert.equal(refused.chapterEntry?.status, 'unavailable');
  await changed.session.close();
});

test('hidden all-state controls and a hidden active tab cannot establish the visible chapter scope', async () => {
  const fixture = chapterEntryFixture({
    chapterUi: {
      tabs: [
        { label: '已发布章节', active: true, hidden: true },
        { label: '草稿箱', active: true },
      ],
      statusLabels: ['全部状态'],
      volumeLabels: ['全部章节'],
      hiddenFilters: true,
    },
  });
  const result = await fixture.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
    { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
  );
  assert.equal(result.chapterUi?.tabs.length, 1);
  assert.equal(result.chapterUi?.tabs[0]?.label, '草稿箱');
  assert.equal(result.chapterUi?.statusFilter.present, false);
  assert.equal(result.chapterUi?.statusFilter.all, false);
  assert.equal(result.chapterUi?.volumeFilter.present, false);
  assert.equal(result.chapterUi?.volumeFilter.all, false);
  await fixture.session.close();
});

test('cold chapter entry uses a pre-navigation request only as a local template and establishes evidence with exactly one new current GET', async () => {
  const volume = {
    ...CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!,
    oldRequest: true,
    json: { code: 0, data: { total_count: 'PRIVATE_OLD_BODY' } },
    replayJson: {
      code: 0,
      data: { volume_list: [{ volume_id: '7600000000000000101', item_count: 1 }] },
    },
  };
  const fixture = chapterEntryFixture({ directorySources: [volume] });
  const result = await fixture.session.withPage((page) =>
    fixture.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK),
  );
  assert.equal(fixture.directoryFetchCount, 1);
  assert.equal(fixture.directoryFetchedSources[0], volume.url);
  assert.equal(fixture.clickCount, 1);
  assert.equal(fixture.routeInstalled, false);
  const structures = (
    fixture.session as unknown as {
      pageReadStructures: WeakMap<
        Page,
        Map<string, { fields: Array<{ path: string; type: string }> }>
      >;
    }
  ).pageReadStructures.get(fixture.page);
  const schema = [...(structures?.entries() ?? [])].find(([path]) =>
    path.startsWith('/api/author/volume/volume_list/v1'),
  )?.[1];
  assert.ok(
    schema?.fields.some(
      (field) => field.path === 'data.volume_list[].volume_id' && field.type === 'string',
    ),
  );
  assert.equal(
    schema?.fields.some((field) => field.path === 'data.total_count'),
    false,
  );
  for (const secret of [
    CHAPTER_ENTRY_FIXTURE_WORK,
    CHAPTER_ENTRY_FIXTURE_TITLE,
    'PRIVATE_VOLUME_NONCE',
    'PRIVATE_OLD_BODY',
  ])
    assert.equal(JSON.stringify(result).includes(secret), false);
  await fixture.session.close();
});

test('cold bootstrap freezes its epoch after bounded initialization of the canonical same-work/title read route', async () => {
  const target = `https://fanqienovel.com/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}&${encodeURIComponent(CHAPTER_ENTRY_FIXTURE_TITLE)}?type=1`;
  const current = target.replace('type=1', 'type=2');
  const fixture = chapterEntryFixture({
    destination: target,
    spa: true,
    directorySources: [{ ...CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!, oldRequest: true }],
    bootstrapNavigation: [current],
  });
  const result = await fixture.session.withPage((page) =>
    fixture.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK),
  );
  assert.equal(
    result.sourceUrl,
    'https://fanqienovel.com/main/writer/chapter-manage/{workId}&{title}?type={numeric}',
  );
  assert.equal(fixture.directoryFetchCount, 1);
  assert.equal(fixture.page.url(), current);
  await fixture.session.close();
});

test('cold bootstrap rejects other-work/title, unsafe query or origin transitions even if the page later returns to its original target', async () => {
  const target = `https://fanqienovel.com/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}&${encodeURIComponent(CHAPTER_ENTRY_FIXTURE_TITLE)}?type=1`;
  for (const changed of [
    target.replace(CHAPTER_ENTRY_FIXTURE_WORK, '7600000000000000002'),
    target.replace(CHAPTER_ENTRY_FIXTURE_TITLE, 'PRIVATE_OTHER_TITLE'),
    target + '&owner_id=PRIVATE_OTHER_OWNER',
    target + '&book_id=7600000000000000002',
    target + '&type=1',
    target.replace('https://fanqienovel.com', 'https://external.invalid'),
    target + '#PRIVATE_FRAGMENT',
  ]) {
    const fixture = chapterEntryFixture({
      destination: target,
      spa: true,
      directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!],
      bootstrapNavigation: [changed, target],
    });
    await assert.rejects(
      fixture.session.withPage((page) =>
        fixture.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK),
      ),
      { code: 'read_document_changed' },
    );
    assert.equal(fixture.directoryFetchCount, 0);
    await fixture.session.close();
  }
});

test('volume templates require actual main-frame fetch/XHR GET request starts with exact source and a single current parent', async () => {
  const base = CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!;
  for (const source of [
    { ...base, method: 'POST' },
    { ...base, resourceType: 'document' },
    { ...base, subframe: true },
    { ...base, url: base.url.replace('fanqienovel.com', 'external.invalid') },
    { ...base, url: base.url.replace('https://', 'https://user:password@') },
    { ...base, url: base.url + '#PRIVATE_HASH' },
    { ...base, url: base.url.replace(CHAPTER_ENTRY_FIXTURE_WORK, '7600000000000000002') },
    { ...base, url: base.url + `&book_id=${CHAPTER_ENTRY_FIXTURE_WORK}` },
    { ...base, url: base.url + '&owner_id=PRIVATE_OTHER_OWNER' },
    { ...base, url: base.url + '&target=PRIVATE_OTHER_OWNER' },
    { ...base, url: base.url + '&work_id=7600000000000000002' },
    { ...base, url: base.url.replace('/volume_list/v1', '/volume_list/v2') },
  ]) {
    const fixture = chapterEntryFixture({ directorySources: [source] });
    await assert.rejects(
      fixture.session.withPage((page) =>
        fixture.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK),
      ),
      { code: 'chapter_volume_template_unavailable' },
    );
    assert.equal(fixture.directoryFetchCount, 0);
    await fixture.session.close();
  }
});

test('a response without a phase-local request, a button-stage source or a previous-call template cannot authorize fresh volume GET', async () => {
  const volume = CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!;
  const outside = chapterEntryFixture({
    apiDestination: volume.url,
    directorySources: [{ ...volume, responseOnly: true }],
  });
  await assert.rejects(
    outside.session.withPage((page) =>
      outside.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK),
    ),
    { code: 'chapter_volume_template_unavailable' },
  );
  assert.equal(outside.directoryFetchCount, 0);
  await outside.session.close();
  const options = { directorySources: [volume] };
  const fixture = chapterEntryFixture(options);
  await fixture.session.withPage((page) =>
    fixture.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK),
  );
  options.directorySources = [];
  await assert.rejects(
    fixture.session.withPage((page) =>
      fixture.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK),
    ),
    { code: 'chapter_volume_template_unavailable' },
  );
  assert.equal(fixture.directoryFetchCount, 1);
  await fixture.session.close();
});
