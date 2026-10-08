import test from 'node:test';

import {
  CHAPTER_SCHEMA_FIXTURE_SOURCES,
  chapterCoreRow,
  chapterCoreEnvelope,
  CHAPTER_CORE_WORK,
  CHAPTER_CORE_VOLUME_A,
  CHAPTER_CORE_VOLUME_B,
  chapterCoreFixture,
} from './helpers/platform-reads-chapter-core-row.js';

import { chapterEntryFixture } from './helpers/platform-reads-chapter-entry-fixture.js';

import { CHAPTER_ENTRY_FIXTURE_WORK } from './helpers/platform-reads-chapter-entry-fixture-work.js';

import assert from 'node:assert/strict';

import { parseChapterPage, parseCandidateChapterVolumes } from '../src/platform/reads.js';

test('POST, external, unknown and prior-document directory responses cannot become replayable schema sources', async () => {
  for (const source of [
    { ...CHAPTER_SCHEMA_FIXTURE_SOURCES[1]!, method: 'POST' },
    { ...CHAPTER_SCHEMA_FIXTURE_SOURCES[1]!, oldRequest: true },
    {
      ...CHAPTER_SCHEMA_FIXTURE_SOURCES[1]!,
      url: 'https://external.invalid/api/author/chapter/chapter_list/v1',
    },
    {
      ...CHAPTER_SCHEMA_FIXTURE_SOURCES[1]!,
      url: 'https://fanqienovel.com/api/author/chapter/unknown_list/v1',
    },
  ]) {
    const fixture = chapterEntryFixture({ directorySources: [source] });
    const entry = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
    );
    const result = await fixture.session.diagnoseReadPage(
      `diagnostic:${entry.chapterEntry!.targetRef}`,
    );
    assert.equal(result.status, 'success');
    assert.equal(fixture.directoryFetchCount, 0);
    assert.equal(
      result.readResponseStructure!.some((row) =>
        row.pathTemplate.startsWith('/api/author/chapter/'),
      ),
      false,
    );
    await fixture.session.close();
  }
});

test('directory schema fresh replay fails closed across a navigation and never emits raw replay errors', async () => {
  const stale = chapterEntryFixture({
    directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[1]!],
    navigateDuringDirectoryReplay: true,
  });
  const entered = await stale.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
    { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
  );
  await assert.rejects(
    stale.session.diagnoseReadPage(`diagnostic:${entered.chapterEntry!.targetRef}`),
    { code: 'read_diagnostic_stale' },
  );
  assert.equal(stale.directoryFetchCount, 1);
  await stale.session.close();
  const failed = chapterEntryFixture({
    directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[1]!],
    directoryReplayError: true,
  });
  const entry = await failed.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
    { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
  );
  const result = await failed.session.diagnoseReadPage(
    `diagnostic:${entry.chapterEntry!.targetRef}`,
  );
  assert.equal(
    result.readResponseStructure!.some((row) =>
      row.pathTemplate.startsWith('/api/author/chapter/'),
    ),
    false,
  );
  assert.equal(JSON.stringify(result).includes('PRIVATE_REPLAY_NONCE'), false);
  assert.ok(result.limitations.some((value) => value.includes('could not be refreshed safely')));
  await failed.session.close();
});

test('chapter mapping preserves raw unknown codes/times and exact string IDs without body or guessed publication labels', () => {
  const row = chapterCoreRow('7600000000000000301');
  const result = parseChapterPage(
    chapterCoreEnvelope([row], 1),
    CHAPTER_CORE_WORK,
    CHAPTER_CORE_VOLUME_A,
  );
  assert.deepEqual(result, {
    total: 1,
    records: [
      {
        workId: CHAPTER_CORE_WORK,
        chapterId: '7600000000000000301',
        volumeId: CHAPTER_CORE_VOLUME_A,
        title: 'SYNTHETIC_CHAPTER_TITLE',
        index: 0,
        wordCount: 0,
        articleStatusCode: -8,
        displayStatusCode: 917,
        createdAtRaw: 'PRIVATE_RAW_CREATE_TIME',
        scheduledAtRaw: '',
      },
    ],
  });
  assert.equal(JSON.stringify(result).includes('PRIVATE_BODY'), false);
  assert.equal('publicationStatus' in result.records[0]!, false);
});

test('chapter parser rejects changed envelopes, unsafe/duplicate IDs, wrong parents and missing typed fields atomically', () => {
  const row = chapterCoreRow('7600000000000000301');
  for (const [payload, code] of [
    [{ code: 1, data: { total_count: 0, item_list: [] } }, 'chapter_page_unrecognized'],
    [chapterCoreEnvelope([], '0'), 'chapter_page_unrecognized'],
    [chapterCoreEnvelope([], Number.MAX_SAFE_INTEGER + 1), 'chapter_page_unrecognized'],
    [
      chapterCoreEnvelope([{ ...row, item_id: 7600000000000000301 }], 1),
      'chapter_id_missing_or_duplicate',
    ],
    [chapterCoreEnvelope([row, row], 2), 'chapter_id_missing_or_duplicate'],
    [
      chapterCoreEnvelope([{ ...row, volume_id: CHAPTER_CORE_VOLUME_B }], 1),
      'chapter_parent_mismatch',
    ],
    [
      chapterCoreEnvelope([{ ...row, book_id: '7600000000000000999' }], 1),
      'chapter_parent_mismatch',
    ],
    [chapterCoreEnvelope([{ ...row, title: '' }], 1), 'chapter_fields_unrecognized'],
    [chapterCoreEnvelope([{ ...row, timer_time: 0 }], 1), 'chapter_fields_unrecognized'],
    [chapterCoreEnvelope([{ ...row, word_number: '0' }], 1), 'chapter_fields_unrecognized'],
    [chapterCoreEnvelope([row], 0), 'chapter_total_count_mismatch'],
  ] as const)
    assert.throws(() => parseChapterPage(payload, CHAPTER_CORE_WORK, CHAPTER_CORE_VOLUME_A), {
      code,
    });
});

test('candidate volume parser fails closed on absent schema, numeric/duplicate IDs and inexact/negative counts', () => {
  assert.deepEqual(parseCandidateChapterVolumes({ code: 0, data: { volume_list: [] } }), {
    volumes: [],
    complete: true,
  });
  for (const payload of [
    { code: 0, data: {} },
    { code: 1, data: { volume_list: [] } },
    ...[0, -1, '1', Number.MAX_SAFE_INTEGER + 1].map((count) => ({
      code: 0,
      data: { volume_list: [{ volume_id: 7600000000000000201, item_count: count }] },
    })),
    {
      code: 0,
      data: {
        volume_list: [
          { volume_id: CHAPTER_CORE_VOLUME_A, item_count: 1 },
          { volume_id: CHAPTER_CORE_VOLUME_A, item_count: 1 },
        ],
      },
    },
  ])
    assert.throws(() => parseCandidateChapterVolumes(payload), {
      code: 'chapter_volume_schema_unverified',
    });
});

test('chapter collection covers every verified volume/page, retains actual query fields and stops at exact totals', async () => {
  const fixture = chapterCoreFixture({
    volumes: [
      { volume_id: CHAPTER_CORE_VOLUME_A, item_count: 2 },
      { volume_id: CHAPTER_CORE_VOLUME_B, item_count: 1 },
    ],
    pages: {
      [CHAPTER_CORE_VOLUME_A]: [
        chapterCoreEnvelope([chapterCoreRow('7600000000000000301')], 2),
        chapterCoreEnvelope([chapterCoreRow('7600000000000000302')], 2),
      ],
      [CHAPTER_CORE_VOLUME_B]: [
        chapterCoreEnvelope([chapterCoreRow('7600000000000000303', CHAPTER_CORE_VOLUME_B)], 1),
      ],
    },
    bootstrapQuery: true,
  });
  const result = await fixture.collect();
  assert.equal(result.status, 'success');
  assert.equal(result.coverage.paginationComplete, true);
  assert.equal(result.coverage.pagesFetched, 3);
  assert.equal(result.coverage.totalRecords, 3);
  assert.equal(result.statisticsThrough, null);
  assert.equal(result.records.length, 3);
  const pages = fixture.calls
    .filter((raw) => raw.includes('/chapter_list/'))
    .map((raw) => new URL(raw));
  assert.deepEqual(
    pages.map((url) => url.searchParams.get('page_index')),
    ['0', '1', '0'],
  );
  assert.deepEqual(
    pages.map((url) => url.searchParams.get('volume_id')),
    [CHAPTER_CORE_VOLUME_A, CHAPTER_CORE_VOLUME_A, CHAPTER_CORE_VOLUME_B],
  );
  assert.ok(
    pages.every(
      (url) =>
        url.searchParams.get('page_count') === '2' &&
        url.searchParams.get('opaque') === 'PRIVATE_ACTUAL_QUERY',
    ),
  );
  assert.equal(fixture.calls.length, 7);
});

test('default chapter candidate reads compatible rows but never asserts complete all-state coverage without current proof', async () => {
  const fixture = chapterCoreFixture();
  const result = await fixture.collect({ apiPlan: undefined });
  assert.equal(result.status, 'partial');
  assert.equal(result.records.length, 1);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.paginationComplete, false);
  assert.ok(result.errors.some((error) => error.code === 'chapter_all_states_unverified'));
});

test('chapter totals, early empty pages, duplicates and page limits prevent complete/saved promotion', async () => {
  const first = chapterCoreRow('7600000000000000301');
  for (const [pages, code, extra] of [
    [
      [chapterCoreEnvelope([first], 2), chapterCoreEnvelope([], 2)],
      'chapter_pagination_early_empty',
      {},
    ],
    [
      [chapterCoreEnvelope([first], 2), chapterCoreEnvelope([first], 2)],
      'chapter_pagination_duplicate',
      {},
    ],
    [
      [chapterCoreEnvelope([first], 2), chapterCoreEnvelope([], 3)],
      'chapter_total_count_changed',
      {},
    ],
    [[chapterCoreEnvelope([first], 2)], 'chapter_pagination_limit_reached', { maxPages: 1 }],
    [[chapterCoreEnvelope([first], 1)], 'chapter_total_count_changed', {}],
  ] as const) {
    const fixture = chapterCoreFixture({
      volumes: [{ volume_id: CHAPTER_CORE_VOLUME_A, item_count: 2 }],
      pages: { [CHAPTER_CORE_VOLUME_A]: [...pages] },
    });
    const result = await fixture.collect(extra);
    assert.notEqual(result.status, 'success');
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.paginationComplete, false);
    assert.ok(
      result.errors.some((error) => error.code === code),
      code,
    );
  }
});

test('empty chapter results require strict current zero evidence and contradicting observed chapters fail', async () => {
  const zeroVolume = chapterCoreFixture({
    volumes: [{ volume_id: CHAPTER_CORE_VOLUME_A, item_count: 0 }],
    pages: { [CHAPTER_CORE_VOLUME_A]: [chapterCoreEnvelope([], 0)] },
  });
  const zero = await zeroVolume.collect();
  assert.equal(zero.status, 'success');
  assert.equal(zero.records.length, 0);
  assert.equal(zero.coverage.totalRecords, 0);
  assert.equal(zero.coverage.pagesFetched, 1);
  const noVolumes = chapterCoreFixture({
    volumes: [],
    pages: { [CHAPTER_CORE_VOLUME_A]: [chapterCoreEnvelope([], 0)] },
  });
  assert.equal((await noVolumes.collect()).status, 'success');
  const contradicted = chapterCoreFixture({ volumes: [] });
  const invalid = await contradicted.collect();
  assert.equal(invalid.status, 'capability_unavailable');
  assert.ok(invalid.errors.some((error) => error.code === 'chapter_empty_inventory_contradicted'));
});

test('zero volume inventory without this-run successful explicit zero chapter GET never certifies an empty directory', async () => {
  const base = chapterCoreFixture();
  const missing = chapterCoreFixture({ volumes: [], sources: [base.volumeUrl, base.bookUrl] });
  const result = await missing.collect();
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.paginationComplete, false);
  assert.equal(result.coverage.totalRecords, null);
  assert.equal(result.records.length, 0);
  assert.ok(result.errors.some((error) => error.code === 'loaded_chapter_list_missing'));
  assert.equal(
    missing.calls.some((raw) => raw.includes('/chapter_list/')),
    false,
  );
  for (const payload of [
    { code: 1, data: { total_count: 0, item_list: [] } },
    { code: 0, data: { total_count: '0', item_list: [] } },
    { code: 0, data: { total_count: 0 } },
  ]) {
    const invalid = await chapterCoreFixture({
      volumes: [],
      pages: { [CHAPTER_CORE_VOLUME_A]: [payload] },
    }).collect();
    assert.equal(invalid.status, 'capability_unavailable');
    assert.equal(invalid.coverage.complete, false);
    assert.ok(
      invalid.errors.some((error) => error.code === 'chapter_empty_inventory_contradicted'),
    );
  }
});
