import test from 'node:test';

import { chapterEntryFixture } from './helpers/platform-reads-chapter-entry-fixture.js';

import {
  CHAPTER_ENTRY_FIXTURE_WORK,
  CHAPTER_ENTRY_FIXTURE_TITLE,
} from './helpers/platform-reads-chapter-entry-fixture-work.js';

import assert from 'node:assert/strict';

import { CHAPTER_SCHEMA_FIXTURE_SOURCES } from './helpers/platform-reads-chapter-core-row.js';

test('chapter static pagination and volume option projection exposes only bounded structure independently of generic elements', async () => {
  const fixture = chapterEntryFixture({
    chapterUi: {
      volumeLabels: ['全部'],
      genericElementCount: 350,
      pagerRoots: [
        {
          controls: [
            {
              tag: 'BUTTON',
              text: 'PRIVATE_PREVIOUS_TITLE',
              attributes: {
                'aria-label': 'Previous page',
                disabled: '',
                class: 'PRIVATE_PAGER_CLASS',
                value: 'PRIVATE_PAGER_VALUE',
              },
            },
            {
              tag: 'A',
              text: '2',
              attributes: {
                'aria-current': 'page',
                'aria-disabled': 'false',
                href: 'https://private.invalid/PRIVATE_LINK_NONCE',
              },
            },
            { tag: 'BUTTON', attributes: { 'aria-label': '下一页', 'aria-disabled': 'true' } },
            {
              tag: 'INPUT',
              attributes: { value: 'PRIVATE_INPUT_VALUE', title: 'PRIVATE_INPUT_TITLE' },
            },
            { tag: 'SPAN', text: '0002', attributes: { 'aria-label': 'PRIVATE_DIRECTION_LABEL' } },
            { tag: 'DIV', text: '3', attributes: { 'aria-current': 'false' }, hidden: true },
          ],
        },
      ],
      volumeOptions: [
        [
          {
            tag: 'OPTION',
            text: 'PRIVATE_NATIVE_VOLUME_NAME',
            selected: false,
            attributes: { selected: '', disabled: '', value: 'PRIVATE_VOLUME_ID' },
          },
          { tag: 'OPTION', text: 'PRIVATE_ATTRIBUTE_ONLY_VOLUME', attributes: { selected: '' } },
          {
            text: 'PRIVATE_ARIA_VOLUME_NAME',
            attributes: {
              role: 'option',
              'aria-selected': 'false',
              'aria-disabled': 'false',
              title: 'PRIVATE_VOLUME_TITLE',
              class: 'PRIVATE_VOLUME_CLASS',
            },
          },
          {
            text: 'PRIVATE_HIDDEN_VOLUME',
            attributes: { role: 'option', 'aria-selected': 'true' },
            hidden: true,
          },
        ],
      ],
    },
  });
  const result = await fixture.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
    { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
  );
  assert.equal(result.status, 'success');
  assert.equal(result.truncated.elements, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.chapterUi?.pagination)), {
    state: 'observed',
    rootCount: 1,
    rootCountTruncated: false,
    controlCount: 5,
    controls: [
      { type: 'button', direction: 'previous', pageNumber: null, current: null, disabled: true },
      { type: 'link', direction: 'unknown', pageNumber: 2, current: true, disabled: false },
      { type: 'button', direction: 'next', pageNumber: null, current: null, disabled: true },
      { type: 'input', direction: 'unknown', pageNumber: null, current: null, disabled: false },
      { type: 'span', direction: 'unknown', pageNumber: null, current: null, disabled: null },
    ],
    truncated: false,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.chapterUi?.volumeOptions)), {
    state: 'visible_options',
    controlCount: 1,
    controlCountTruncated: false,
    selectionScope: 'all_label',
    optionCount: 3,
    options: [
      { type: 'native_option', selected: false, disabled: true },
      { type: 'native_option', selected: null, disabled: false },
      { type: 'aria_option', selected: false, disabled: false },
    ],
    truncated: false,
  });
  assert.equal(fixture.clickCount, 1);
  assert.equal(fixture.directoryFetchCount, 0);
  for (const secret of ['PRIVATE_', CHAPTER_ENTRY_FIXTURE_TITLE, CHAPTER_ENTRY_FIXTURE_WORK])
    assert.equal(JSON.stringify(result).includes(secret), false);
  await fixture.session.close();
  const privateCaption = chapterEntryFixture({
    rows: [{ book_id: CHAPTER_ENTRY_FIXTURE_WORK, book_name: '3' }],
    titles: ['3'],
    chapterUi: { pagerRoots: [{ controls: [{ text: '3' }] }] },
  });
  const redacted = await privateCaption.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
    { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
  );
  assert.equal(redacted.chapterUi?.pagination?.controls[0]?.pageNumber, null);
  assert.equal(privateCaption.directoryFetchCount, 0);
  await privateCaption.session.close();
});

test('chapter static pagination absence and hidden or unassociated volume options remain unknown rather than complete', async () => {
  for (const hiddenFilters of [false, true]) {
    const fixture = chapterEntryFixture({
      chapterUi: {
        volumeLabels: ['PRIVATE_SELECTED_VOLUME'],
        hiddenFilters,
        pagerRoots: [
          { hidden: true, controls: [{ text: '1' }] },
          { className: 'PRIVATE_UNKNOWN_PAGER', controls: [{ text: '1' }] },
        ],
      },
    });
    const result = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
    );
    assert.equal(result.chapterUi?.pagination?.state, 'not_observed');
    assert.equal(result.chapterUi?.pagination?.rootCount, 0);
    assert.equal(result.chapterUi?.pagination?.controlCount, 0);
    assert.equal(result.chapterUi?.pagination?.truncated, false);
    assert.equal(
      result.chapterUi?.volumeOptions?.state,
      hiddenFilters ? 'not_observed' : 'no_visible_options',
    );
    assert.equal(
      result.chapterUi?.volumeOptions?.selectionScope,
      hiddenFilters ? 'not_observed' : 'other_or_unknown',
    );
    assert.equal(result.chapterUi?.volumeOptions?.optionCount, 0);
    assert.equal(result.chapterUi?.volumeOptions?.options.length, 0);
    assert.equal(JSON.stringify(result.chapterUi).includes('complete'), false);
    assert.equal(JSON.stringify(result.chapterUi).includes('PRIVATE_'), false);
    assert.equal(fixture.clickCount, 1);
    await fixture.session.close();
  }
  // A status control and unrelated global option nodes are not a volume-control association.
  const fixture = chapterEntryFixture({
    chapterUi: {
      statusLabels: ['全部状态'],
      unboundOptions: [
        {
          text: 'PRIVATE_UNBOUND_PORTAL_OPTION',
          attributes: {
            role: 'option',
            class: 'PRIVATE_PORTAL_CLASS',
            value: 'PRIVATE_PORTAL_VALUE',
          },
        },
      ],
    },
  });
  const result = await fixture.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
    { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
  );
  assert.equal(result.chapterUi?.volumeOptions?.state, 'not_observed');
  assert.equal(result.chapterUi?.volumeOptions?.controlCount, 0);
  assert.equal(result.chapterUi?.volumeOptions?.optionCount, 0);
  assert.equal(
    result.elements.some((row) => row.attributes.role === 'option'),
    true,
  );
  assert.equal(JSON.stringify(result).includes('PRIVATE_UNBOUND_PORTAL_OPTION'), false);
  assert.equal(fixture.directoryFetchCount, 0);
  await fixture.session.close();
});

test('chapter static pagination and volume option bounds retain ambiguity and reject private numeric captions', async () => {
  const controls = Array.from({ length: 120 }, (_, index) => ({
    tag: 'DIV',
    text: index === 0 ? CHAPTER_ENTRY_FIXTURE_WORK : index === 1 ? '10000' : String(index + 1),
    attributes: {
      'aria-current': 'unknown',
      'aria-disabled': 'unknown',
      class: 'PRIVATE_CONTROL_CLASS',
    },
  }));
  for (const volumeLabels of [['全部'], Array.from({ length: 9 }, () => '全部')]) {
    const fixture = chapterEntryFixture({
      chapterUi: {
        volumeLabels,
        pagerRoots: Array.from({ length: 9 }, () => ({ className: 'byte-pagination', controls })),
        volumeOptions: volumeLabels.map(() =>
          Array.from({ length: 120 }, () => ({
            attributes: {
              role: 'option',
              value: 'PRIVATE_VOLUME_VALUE',
              title: 'PRIVATE_VOLUME_TITLE',
            },
            text: 'PRIVATE_VOLUME_OPTION',
          })),
        ),
      },
    });
    const result = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
    );
    const pager = result.chapterUi!.pagination!;
    assert.equal(pager.state, 'ambiguous');
    assert.equal(pager.rootCount, 8);
    assert.equal(pager.rootCountTruncated, true);
    assert.equal(pager.controlCount, 100);
    assert.equal(pager.controls.length, 32);
    assert.equal(pager.truncated, true);
    assert.equal(pager.controls[0]?.pageNumber, null);
    assert.equal(pager.controls[1]?.pageNumber, null);
    assert.equal(pager.controls[2]?.pageNumber, 3);
    assert.equal(pager.controls[2]?.current, null);
    assert.equal(pager.controls[2]?.disabled, null);
    const options = result.chapterUi!.volumeOptions!;
    assert.equal(
      options.state,
      volumeLabels.length === 1 ? 'visible_options' : 'ambiguous_control',
    );
    assert.equal(options.controlCount, Math.min(volumeLabels.length, 8));
    assert.equal(options.controlCountTruncated, volumeLabels.length > 8);
    assert.equal(options.optionCount, volumeLabels.length === 1 ? 100 : 0);
    assert.equal(options.options.length, volumeLabels.length === 1 ? 32 : 0);
    assert.equal(options.truncated, volumeLabels.length === 1);
    assert.equal(
      options.selectionScope,
      volumeLabels.length === 1 ? 'all_label' : 'other_or_unknown',
    );
    assert.equal(JSON.stringify(result.chapterUi).includes('PRIVATE_'), false);
    assert.equal(JSON.stringify(result.chapterUi).includes(CHAPTER_ENTRY_FIXTURE_WORK), false);
    assert.equal(fixture.directoryFetchCount, 0);
    await fixture.session.close();
  }
});

test('chapter diagnostic waits through the real registered-target full navigation and delayed render plus natural current GET', async () => {
  for (const source of ['during_render', 'after_render'] as const) {
    const fixture = chapterEntryFixture({
      destination: `https://fanqienovel.com/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}&${encodeURIComponent(CHAPTER_ENTRY_FIXTURE_TITLE)}?type=1`,
      directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[1]!],
      chapterUi: { tabs: [{ label: '章节管理', active: true }, { label: '草稿箱' }], table: true },
      realChapterReadiness: { render: 'delayed', source, analyticsPost: true },
    });
    const initialListeners = fixture.listenerCount;
    const result = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK, timeoutMs: 100 },
    );
    assert.equal(result.status, 'success');
    assert.equal(result.chapterEntry?.status, 'opened');
    assert.equal(result.chapterUi?.tablePresent, true);
    assert.equal(result.chapterUi?.tabs[0]?.active, true);
    assert.equal(fixture.readinessChecks, 1);
    assert.equal(fixture.readinessWasInitiallyBlank, true);
    assert.equal(fixture.directoryGotoCount, 1);
    assert.equal(fixture.clickCount, 1);
    assert.ok(fixture.blockedCount >= 1);
    assert.equal(fixture.routeInstalled, false);
    assert.equal(fixture.listenerCount, initialListeners);
    assert.ok(
      result.chapterGetRequests?.some(
        (item) =>
          item.pathTemplate === '/api/author/chapter/chapter_list/v1' &&
          item.sourceState === 'current_source',
      ),
    );
    for (const value of [
      CHAPTER_ENTRY_FIXTURE_WORK,
      CHAPTER_ENTRY_FIXTURE_TITLE,
      'PRIVATE_DIRECTORY_NONCE',
      'PRIVATE_CHAPTER_BODY',
    ])
      assert.equal(JSON.stringify(result).includes(value), false);
    await fixture.session.close();
  }
});
