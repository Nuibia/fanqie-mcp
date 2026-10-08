import test from 'node:test';

import { chapterEntryFixture } from './helpers/platform-reads-chapter-entry-fixture.js';

import { CHAPTER_SCHEMA_FIXTURE_SOURCES } from './helpers/platform-reads-chapter-core-row.js';

import {
  CHAPTER_ENTRY_FIXTURE_WORK,
  CHAPTER_ENTRY_FIXTURE_TITLE,
} from './helpers/platform-reads-chapter-entry-fixture-work.js';

import assert from 'node:assert/strict';

test('chapter diagnostic cannot treat a writer shell or missing old and foreign natural requests as ready directory data', async () => {
  for (const scenario of [
    { render: 'missing', source: 'during_render' },
    { source: 'missing' },
    { source: 'old_request' },
    { source: 'subframe' },
  ] as const) {
    const fixture = chapterEntryFixture({
      directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[1]!],
      chapterUi: { tabs: [{ label: '章节管理', active: true }], table: true },
      realChapterReadiness: scenario,
    });
    const initialListeners = fixture.listenerCount;
    // The DOM/source deadline is shorter than the independent FIFO operation deadline.
    (fixture.session as unknown as { config: { timeoutMs: number } }).config.timeoutMs = 15;
    const result = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
    );
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.chapterEntry?.status, 'opened');
    assert.equal(
      result.readResponseStructure?.some((row) =>
        row.pathTemplate.startsWith('/api/author/chapter/'),
      ),
      false,
    );
    assert.equal(fixture.directoryFetchCount, 0);
    assert.equal(fixture.routeInstalled, false);
    assert.equal(fixture.listenerCount, initialListeners);
    assert.equal(JSON.stringify(result).includes('PRIVATE_CHAPTER_RENDER_TIMEOUT'), false);
    await fixture.session.close();
  }
});

test('chapter diagnostic render bracket rejects wrong routes parents owner changes and late cleanup navigation without changing legacy collector guards', async () => {
  for (const scenario of [
    { fatalRequest: 'wrong_route' },
    { fatalRequest: 'wrong_parent' },
    { fatalRequest: 'write_route' },
    { changedOwner: true },
    { cleanupNavigation: true },
  ] as const) {
    const fixture = chapterEntryFixture({
      directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[1]!],
      chapterUi: { tabs: [{ label: '章节管理', active: true }], table: true },
      realChapterReadiness: { ...scenario, source: 'during_render' },
    });
    const initialListeners = fixture.listenerCount;
    await assert.rejects(
      fixture.session.diagnoseReadPage('https://fanqienovel.com/main/writer/book-manage', {
        openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK,
        timeoutMs: 100,
      }),
      { code: 'read_diagnostic_stale' },
    );
    assert.equal(fixture.routeInstalled, false);
    assert.equal(fixture.listenerCount, initialListeners);
    if ('fatalRequest' in scenario) assert.equal(fixture.directoryFetchCount, 0);
    await fixture.session.close();
  }
});

test('chapter diagnostic drains actual delayed route handlers after unroute failure before releasing its FIFO and listeners', async () => {
  const fixture = chapterEntryFixture({
    directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[1]!],
    chapterUi: { tabs: [{ label: '章节管理', active: true }], table: true },
    realChapterReadiness: {
      source: 'during_render',
      cleanupUnrouteFailure: true,
      deferredCleanupRoute: true,
    },
  });
  const initialListeners = fixture.listenerCount;
  const run = fixture.session.diagnoseReadPage('https://fanqienovel.com/main/writer/book-manage', {
    openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK,
  });
  let settled = false;
  const rejected = assert.rejects(run, { code: 'read_diagnostic_stale' }).then(() => {
    settled = true;
  });
  let queuedRan = false;
  const queued = fixture.session.withPage(async () => {
    queuedRan = true;
  });
  await fixture.cleanupFailure;
  assert.equal(fixture.deferredRouteStarted, true);
  assert.equal(fixture.deferredRouteSettled, false);
  assert.equal(settled, false);
  assert.equal(queuedRan, false);
  assert.ok(fixture.listenerCount > initialListeners);
  fixture.releaseDeferredRoute();
  await rejected;
  await queued;
  assert.equal(fixture.deferredRouteSettled, true);
  assert.equal(settled, true);
  assert.equal(queuedRan, true);
  assert.equal(fixture.listenerCount, initialListeners);
  assert.equal(fixture.routeInstalled, false);
  await fixture.session.close();
});

test('chapter volume observation opens one existing list view and projects only explicitly bound descendant or portal options', async () => {
  for (const association of ['descendant', 'controls', 'owns'] as const) {
    const fixture = chapterEntryFixture({
      directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[1]!],
      chapterUi: {
        tabs: [{ label: '章节管理', active: true }],
        table: true,
        volumeLabels: ['PRIVATE_VOLUME_TITLE'],
        volumeOptions: [
          [
            {
              tag: 'DIV',
              text: 'PRIVATE_VOLUME_OPTION',
              attributes: {
                role: 'option',
                'aria-selected': 'true',
                'aria-disabled': 'false',
                value: 'PRIVATE_VOLUME_VALUE',
              },
            },
          ],
        ],
      },
      realChapterReadiness: { source: 'during_render', volumeExpansion: association },
    });
    const result = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK, chapterVolumeOptions: true },
    );
    assert.equal(result.status, 'success');
    assert.equal(fixture.volumeClickCount, 1);
    assert.equal(fixture.clickCount, 1);
    assert.equal(fixture.directoryGotoCount, 1);
    assert.equal(result.chapterUi?.volumeOptions?.state, 'visible_options');
    assert.equal(result.chapterUi?.volumeOptions?.optionCount, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(result.chapterUi?.volumeOptions?.options)), [
      { type: 'aria_option', selected: true, disabled: false },
    ]);
    assert.equal(result.chapterUi?.volumeOptions?.selectionScope, 'other_or_unknown');
    assert.ok(result.elements.some((element) => element.attributes.class === 'chapter-footer'));
    assert.ok(
      result.elements.some((element) => element.attributes.class === 'byte-pagination-next'),
    );
    assert.equal(
      result.elements.some((element) => element.tag === 'textarea'),
      false,
    );
    assert.equal(fixture.routeInstalled, false);
    for (const value of [
      'PRIVATE_POPUP',
      'PRIVATE_VOLUME',
      'PRIVATE_FOOTER',
      CHAPTER_ENTRY_FIXTURE_WORK,
      CHAPTER_ENTRY_FIXTURE_TITLE,
      'PRIVATE_CHAPTER_BODY',
    ])
      assert.equal(JSON.stringify(result).includes(value), false);
    await fixture.session.close();
  }
});

test('chapter volume observation does not associate global or ambiguous popups and refuses hidden disabled or nonunique controls', async () => {
  for (const association of ['unassociated', 'ambiguous'] as const) {
    const fixture = chapterEntryFixture({
      directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[1]!],
      chapterUi: {
        tabs: [{ label: '章节管理', active: true }],
        table: true,
        volumeLabels: ['PRIVATE_VOLUME_TITLE'],
        volumeOptions: [
          [{ attributes: { role: 'option', 'aria-selected': 'true' }, text: 'PRIVATE_OPTION' }],
        ],
      },
      realChapterReadiness: { source: 'during_render', volumeExpansion: association },
    });
    const result = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK, chapterVolumeOptions: true },
    );
    assert.equal(fixture.volumeClickCount, 1);
    assert.equal(result.chapterUi?.volumeOptions?.state, 'no_visible_options');
    assert.equal(result.chapterUi?.volumeOptions?.optionCount, 0);
    assert.equal(result.chapterUi?.volumeOptions?.selectionScope, 'other_or_unknown');
    assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
    await fixture.session.close();
  }
  for (const scenario of [{ volumeDisabled: true }, { volumeHidden: true }, { duplicate: true }]) {
    const fixture = chapterEntryFixture({
      directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[1]!],
      chapterUi: {
        tabs: [{ label: '章节管理', active: true }],
        table: true,
        volumeLabels: 'duplicate' in scenario ? ['PRIVATE_ONE', 'PRIVATE_TWO'] : ['PRIVATE_ONE'],
      },
      realChapterReadiness: { source: 'during_render', ...scenario },
    });
    await assert.rejects(
      fixture.session.diagnoseReadPage('https://fanqienovel.com/main/writer/book-manage', {
        openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK,
        chapterVolumeOptions: true,
      }),
      { code: 'capability_unavailable' },
    );
    assert.equal(fixture.volumeClickCount, 0);
    assert.equal(fixture.routeInstalled, false);
    await fixture.session.close();
  }
});

test('chapter volume observation preserves ready identity navigation and strict input gates without selecting options or invoking the collector', async () => {
  for (const scenario of [{ volumeNavigate: true }, { volumeOwnerChanged: true }]) {
    const fixture = chapterEntryFixture({
      directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[1]!],
      chapterUi: {
        tabs: [{ label: '章节管理', active: true }],
        table: true,
        volumeLabels: ['PRIVATE_VOLUME'],
      },
      realChapterReadiness: { source: 'during_render', ...scenario },
    });
    await assert.rejects(
      fixture.session.diagnoseReadPage('https://fanqienovel.com/main/writer/book-manage', {
        openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK,
        chapterVolumeOptions: true,
      }),
      { code: 'read_diagnostic_stale' },
    );
    assert.equal(fixture.volumeClickCount, 1);
    assert.equal(fixture.routeInstalled, false);
    await fixture.session.close();
  }
  const fixture = chapterEntryFixture();
  for (const args of [
    { chapterVolumeOptions: true },
    {
      openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK,
      chapterVolumeOptions: true,
      chapterTab: 'drafts' as const,
    },
    {
      openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK,
      chapterVolumeOptions: true,
      chapterVolumeContext: true,
    },
  ])
    await assert.rejects(
      fixture.session.diagnoseReadPage(
        'https://fanqienovel.com/main/writer/book-manage',
        args as never,
      ),
      { code: 'invalid_chapter_volume_options' },
    );
  assert.equal(fixture.clickCount, 0);
  assert.equal(fixture.volumeClickCount, 0);
  await fixture.session.close();
});
