import test from 'node:test';

import {
  chapterCoreFixture,
  CHAPTER_CORE_VOLUME_A,
  CHAPTER_CORE_VOLUME_B,
  chapterCoreEnvelope,
  chapterCoreRow,
  CHAPTER_SCHEMA_FIXTURE_SOURCES,
} from './helpers/platform-reads-chapter-core-row.js';

import assert from 'node:assert/strict';

import { chapterEntryFixture } from './helpers/platform-reads-chapter-entry-fixture.js';

import {
  CHAPTER_ENTRY_FIXTURE_WORK,
  CHAPTER_ENTRY_FIXTURE_TITLE,
} from './helpers/platform-reads-chapter-entry-fixture-work.js';

import { projectChapterGetQuerySchema } from '../src/platform/browser.js';

import { isChapterReadSchemaSource } from '../src/platform/reads.js';

test('chapter changed parent/inventory or cross-volume duplicate cannot report complete and login/navigation clears rows', async () => {
  const wrongBook = chapterCoreFixture({
    book: { code: 0, data: { book_id: '7600000000000000999', book_name: 'SYNTHETIC_OTHER_TITLE' } },
  });
  assert.ok(
    (await wrongBook.collect()).errors.some(
      (error) => error.code === 'chapter_book_parent_mismatch',
    ),
  );
  const changed = chapterCoreFixture({
    finalVolumes: {
      code: 0,
      data: { volume_list: [{ volume_id: CHAPTER_CORE_VOLUME_A, item_count: 2 }] },
    },
  });
  const partial = await changed.collect();
  assert.equal(partial.status, 'partial');
  assert.equal(partial.coverage.complete, false);
  assert.ok(partial.errors.some((error) => error.code === 'chapter_inventory_changed'));
  const repeated = chapterCoreFixture({
    volumes: [
      { volume_id: CHAPTER_CORE_VOLUME_A, item_count: 1 },
      { volume_id: CHAPTER_CORE_VOLUME_B, item_count: 1 },
    ],
    pages: {
      [CHAPTER_CORE_VOLUME_B]: [
        chapterCoreEnvelope([chapterCoreRow('7600000000000000301', CHAPTER_CORE_VOLUME_B)], 1),
      ],
    },
  });
  assert.ok(
    (await repeated.collect()).errors.some(
      (error) => error.code === 'chapter_pagination_duplicate',
    ),
  );
  for (const mode of ['loginAt', 'navigateAt'] as const) {
    const result = await chapterCoreFixture({ [mode]: 4 }).collect();
    assert.equal(result.records.length, 0);
    assert.equal(result.coverage.complete, false);
    assert.equal(result.status, mode === 'loginAt' ? 'login_required' : 'capability_unavailable');
  }
});

test('slot-local chapter entry does not reacquire FIFO and returns only a masked actual directory route', async () => {
  const fixture = chapterEntryFixture({
    destination: `https://fanqienovel.com/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}&${encodeURIComponent(CHAPTER_ENTRY_FIXTURE_TITLE)}?type=1`,
    spa: true,
    directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!],
  });
  await assert.rejects(
    fixture.session.enterCurrentChapterDirectory(fixture.page, CHAPTER_ENTRY_FIXTURE_WORK),
    { code: 'chapter_directory_slot_required' },
  );
  const entered = await fixture.session.withPage((page) =>
    fixture.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK),
  );
  assert.equal(
    entered.sourceUrl,
    'https://fanqienovel.com/main/writer/chapter-manage/{workId}&{title}?type={numeric}',
  );
  assert.equal(fixture.clickCount, 1);
  assert.equal(fixture.routeInstalled, false);
  for (const value of [CHAPTER_ENTRY_FIXTURE_WORK, CHAPTER_ENTRY_FIXTURE_TITLE, 'PRIVATE_OWNER'])
    assert.equal(JSON.stringify(entered).includes(value), false);
  await fixture.session.close();
});

test('slot-local chapter entry refuses changed owners and unsafe directory buttons/routes before collecting', async () => {
  for (const options of [
    { changedOwner: true },
    { buttons: [{ label: '编辑' }] },
    {
      destination: `https://fanqienovel.com/main/writer/publish-chapter/${CHAPTER_ENTRY_FIXTURE_WORK}`,
    },
  ]) {
    const fixture = chapterEntryFixture(options);
    await assert.rejects(
      fixture.session.withPage((page) =>
        fixture.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK),
      ),
      { code: 'capability_unavailable' },
    );
    assert.equal(fixture.routeInstalled, false);
    await fixture.session.close();
  }
});

test('chapter GET query diagnostics project only fixed names, bounded shapes and opaque unknown keys with no values', () => {
  const raw = `https://fanqienovel.com/api/author/chapter/chapter_list/v1?book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&page_index=0&page_count=20&cursor=PRIVATE_CURSOR&nonce=PRIVATE_NONCE&PRIVATE_QUERY_NAME=secret&empty=&limit=${'8'.repeat(31)}&page_index=1`;
  const result = projectChapterGetQuerySchema(raw, CHAPTER_ENTRY_FIXTURE_WORK);
  assert.equal(result.workBinding, 'current_work');
  assert.equal(result.replayBoundToCurrentWork, true);
  assert.equal(result.entries.find((row) => row.key === 'page_count')?.type, 'string');
  assert.equal(result.entries.find((row) => row.key === 'page_count')?.valueShape, 'numeric');
  assert.equal(
    result.entries.find((row) => row.key === 'limit')?.valueShape,
    'numeric_out_of_range',
  );
  assert.equal(result.entries.find((row) => row.key === 'cursor')?.valueShape, 'other');
  assert.ok(result.entries.filter((row) => row.key === 'page_index').every((row) => row.duplicate));
  assert.equal(result.entries.filter((row) => !row.allowedReadKey).length, 3);
  assert.ok(
    result.entries.filter((row) => !row.allowedReadKey).every((row) => row.key === '{opaque}'),
  );
  for (const secret of [
    CHAPTER_ENTRY_FIXTURE_WORK,
    'PRIVATE_CURSOR',
    'PRIVATE_NONCE',
    'PRIVATE_QUERY_NAME',
    'nonce',
    'secret',
    '8'.repeat(31),
  ])
    assert.equal(JSON.stringify(result).includes(secret), false);
  const bounded = projectChapterGetQuerySchema(
    `https://fanqienovel.com/api/author/chapter/chapter_list/v1?book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&${Array.from({ length: 25 }, (_, index) => `PRIVATE_${index}=secret`).join('&')}`,
    CHAPTER_ENTRY_FIXTURE_WORK,
  );
  assert.equal(bounded.entries.length, 16);
  assert.equal(bounded.truncated, true);
  const external = projectChapterGetQuerySchema(
    'https://external.invalid/api/author/chapter/chapter_list/v1?book_id=PRIVATE_ID',
    CHAPTER_ENTRY_FIXTURE_WORK,
  );
  assert.equal(external.workBinding, 'invalid_source');
  assert.equal(external.entries.length, 0);
});

test('chapter GET replay binding refuses missing, other-work, duplicated, invalid and identity-filter targets', () => {
  const prefix = 'https://fanqienovel.com/api/author/chapter/chapter_list/v1?';
  for (const [query, binding] of [
    ['page_index=0', 'missing_work'],
    ['book_id=7600000000000000002', 'other_work'],
    [
      `book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&work_id=${CHAPTER_ENTRY_FIXTURE_WORK}`,
      'ambiguous_work',
    ],
    [
      `book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&book_id=${CHAPTER_ENTRY_FIXTURE_WORK}`,
      'ambiguous_work',
    ],
    ['book_id=123', 'invalid_work'],
    [`book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&author_id=PRIVATE_AUTHOR`, 'current_work'],
  ]) {
    const result = projectChapterGetQuerySchema(prefix + query, CHAPTER_ENTRY_FIXTURE_WORK);
    assert.equal(result.workBinding, binding);
    assert.equal(result.replayBoundToCurrentWork, false);
    assert.equal(JSON.stringify(result).includes('PRIVATE_AUTHOR'), false);
  }
});

test('pagination URL variants cannot exhaust the three confirmed family slots or suppress a delayed volume schema', async () => {
  const chapter = CHAPTER_SCHEMA_FIXTURE_SOURCES[1]!;
  const chapters = Array.from({ length: 4 }, (_, page) => ({
    ...chapter,
    url: chapter.url.replace('page_index=0', `page_index=${page}`),
  }));
  const fixture = chapterEntryFixture({
    directorySources: [
      ...chapters,
      CHAPTER_SCHEMA_FIXTURE_SOURCES[2]!,
      CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!,
    ],
  });
  const entry = await fixture.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
    { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
  );
  const result = await fixture.session.diagnoseReadPage(
    `diagnostic:${entry.chapterEntry!.targetRef}`,
  );
  assert.equal(fixture.directoryFetchCount, 3);
  assert.ok(fixture.directoryFetchedSources.includes(chapters[3]!.url));
  assert.ok(!fixture.directoryFetchedSources.includes(chapters[0]!.url));
  assert.ok(
    result.readResponseStructure!.some(
      (row) => row.pathTemplate === '/api/author/volume/volume_list/v1',
    ),
  );
  assert.equal(
    result.chapterGetRequests!.filter((row) => row.sourceState === 'superseded_same_family').length,
    3,
  );
  assert.equal(
    result.chapterGetRequests!.filter((row) => row.sourceState === 'current_source').length,
    3,
  );
  assert.ok(result.chapterGetRequests!.every((row) => !row.pathTemplate.includes('?')));
  assert.ok(
    result.getResponses
      .filter((row) => isChapterReadSchemaSource(`https://fanqienovel.com${row.pathTemplate}`))
      .every((row) => !row.pathTemplate.includes('?')),
  );
  assert.ok(entry.limitations.some((value) => value.includes('actually observed GET URLs')));
  assert.ok(
    !entry.limitations.some((value) => value.includes('no chapter API is guessed or replayed')),
  );
  await fixture.session.close();
});

test('a volume source cleared by main-frame navigation is diagnosed but never resurrected for schema replay', async () => {
  const fixture = chapterEntryFixture({
    directorySources: CHAPTER_SCHEMA_FIXTURE_SOURCES,
    directoryNavigationAfterIndex: 0,
  });
  const entry = await fixture.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
    { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
  );
  const result = await fixture.session.diagnoseReadPage(
    `diagnostic:${entry.chapterEntry!.targetRef}`,
  );
  assert.equal(fixture.directoryFetchCount, 2);
  assert.equal(
    result.readResponseStructure!.some(
      (row) => row.pathTemplate === '/api/author/volume/volume_list/v1',
    ),
    false,
  );
  assert.equal(
    result.chapterGetRequests!.find(
      (row) => row.pathTemplate === '/api/author/volume/volume_list/v1',
    )?.sourceState,
    'cleared_by_navigation',
  );
  assert.ok(
    result.limitations.some((value) => value.includes('prior navigation sources are not reused')),
  );
  await fixture.session.close();
});

test('a late prior-request source retains its rejected generation without fetching or cached schema fallback', async () => {
  const fixture = chapterEntryFixture({
    directorySources: [{ ...CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!, oldRequest: true }],
  });
  const entry = await fixture.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
    { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
  );
  const result = await fixture.session.diagnoseReadPage(
    `diagnostic:${entry.chapterEntry!.targetRef}`,
  );
  assert.equal(fixture.directoryFetchCount, 0);
  assert.equal(result.chapterGetRequests![0]?.sourceState, 'prior_request');
  assert.equal(
    result.readResponseStructure!.some(
      (row) => row.pathTemplate === '/api/author/volume/volume_list/v1',
    ),
    false,
  );
  await fixture.session.close();
});

test('an observed other-work or ambiguous directory GET cannot be freshly fetched or emitted from a cached schema', async () => {
  for (const query of [
    'book_id=7600000000000000002',
    `book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&work_id=${CHAPTER_ENTRY_FIXTURE_WORK}`,
    `book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&owner_id=PRIVATE_OTHER_OWNER`,
    'page_index=0',
  ]) {
    const fixture = chapterEntryFixture({
      directorySources: [
        {
          ...CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!,
          url: `https://fanqienovel.com/api/author/volume/volume_list/v1?${query}`,
        },
      ],
    });
    const entry = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
    );
    const result = await fixture.session.diagnoseReadPage(
      `diagnostic:${entry.chapterEntry!.targetRef}`,
    );
    assert.equal(fixture.directoryFetchCount, 0);
    assert.equal(result.chapterGetRequests![0]?.sourceState, 'work_binding_unverified');
    assert.equal(
      result.readResponseStructure!.some(
        (row) => row.pathTemplate === '/api/author/volume/volume_list/v1',
      ),
      false,
    );
    assert.equal(JSON.stringify(result).includes('PRIVATE_OTHER_OWNER'), false);
    await fixture.session.close();
  }
});
