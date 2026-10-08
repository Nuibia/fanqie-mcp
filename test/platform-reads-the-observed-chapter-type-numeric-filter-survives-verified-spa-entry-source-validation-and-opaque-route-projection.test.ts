import test from 'node:test';

import {
  CHAPTER_ENTRY_FIXTURE_WORK,
  CHAPTER_ENTRY_FIXTURE_TITLE,
} from './helpers/platform-reads-chapter-entry-fixture-work.js';

import { chapterEntryFixture } from './helpers/platform-reads-chapter-entry-fixture.js';

import assert from 'node:assert/strict';

import { validateDiagnosticSource, diagnosticRouteTemplate } from '../src/platform/browser.js';

import { CHAPTER_SCHEMA_FIXTURE_SOURCES } from './helpers/platform-reads-chapter-core-row.js';

import {
  isChapterReadSchemaSource,
  isReadSchemaSource,
  projectReadResponseFields,
} from '../src/platform/reads.js';

test('the observed chapter type numeric filter survives verified SPA entry, source validation and opaque route projection', async () => {
  const title = '合成类型目录';
  const path = `/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}&${encodeURIComponent(title)}`;
  for (const [spa, type] of [
    [false, '0'],
    [true, '17'],
    [true, '1'.repeat(30)],
  ] as const) {
    const destination = `https://fanqienovel.com${path}?type=${type}`;
    const fixture = chapterEntryFixture({
      rows: [{ book_id: CHAPTER_ENTRY_FIXTURE_WORK, book_name: title }],
      titles: [title],
      destination,
      spa,
    });
    const result = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
    );
    assert.equal(result.status, 'success');
    assert.equal(result.chapterEntry?.status, 'opened');
    assert.match(result.chapterEntry!.targetRef!, /^[a-f0-9]{24}$/);
    assert.equal(
      result.sourceUrl,
      'https://fanqienovel.com/main/writer/chapter-manage/{workId}&{title}?type={numeric}',
    );
    assert.deepEqual(result.chapterEntry?.querySchema, {
      entries: [{ key: 'type', valueShape: 'numeric', allowedReadKey: true, rejection: null }],
      truncated: false,
    });
    assert.equal(
      validateDiagnosticSource(
        destination,
        new Set([`https://fanqienovel.com${path}`]),
      ).searchParams.get('type'),
      type,
    );
    assert.equal(diagnosticRouteTemplate(destination), result.sourceUrl);
    const next = await fixture.session.diagnoseReadPage(
      `diagnostic:${result.chapterEntry!.targetRef}`,
    );
    assert.equal(next.status, 'success');
    assert.equal(next.sourceUrl, result.sourceUrl);
    for (const secret of [
      title,
      encodeURIComponent(title),
      CHAPTER_ENTRY_FIXTURE_WORK,
      ...(type.length >= 10 ? [type] : []),
    ])
      assert.equal(JSON.stringify(result).includes(secret), false);
    await fixture.session.close();
  }
  for (const source of [
    'https://fanqienovel.com/main/writer/book-manage?type=1',
    'https://fanqienovel.com/main/writer/data?type=1',
    'https://fanqienovel.com/main/writer/short-manage?type=1',
  ])
    assert.throws(() => validateDiagnosticSource(source), { code: 'invalid_diagnostic_route' });
  assert.throws(() => validateDiagnosticSource(`https://fanqienovel.com${path}?type=1`), {
    code: 'invalid_diagnostic_route',
  });
});

test('chapter type filters still reject empty, nonnumeric, oversized, unknown and duplicate queries before reading or registering', async () => {
  const path = `/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}&${encodeURIComponent(CHAPTER_ENTRY_FIXTURE_TITLE)}`;
  for (const [query, reason] of [
    ['type=', 'chapter_manager_route_query_invalid'],
    ['type=PRIVATE_TYPE', 'chapter_manager_route_query_invalid'],
    ['type=-1', 'chapter_manager_route_query_invalid'],
    [`type=${'1'.repeat(31)}`, 'chapter_manager_route_query_invalid'],
    ['type=1&unknown_filter=1', 'chapter_manager_route_query_invalid'],
    ['type=1&type=2', 'chapter_manager_route_query_ambiguous'],
    ['type=1&type=1', 'chapter_manager_route_query_ambiguous'],
    [
      `type=1&bookId=${CHAPTER_ENTRY_FIXTURE_WORK}&bookId=7600000000000000002`,
      'chapter_manager_route_query_ambiguous',
    ],
  ] as const) {
    const destination = `https://fanqienovel.com${path}?${query}`;
    const fixture = chapterEntryFixture({ destination, spa: true });
    const result = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
    );
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.chapterEntry?.reason, reason);
    assert.equal(result.chapterEntry?.targetRef, null);
    assert.equal(fixture.diagnosticDomReads, 0);
    assert.throws(
      () => validateDiagnosticSource(destination, new Set([`https://fanqienovel.com${path}`])),
      { code: 'invalid_diagnostic_route' },
    );
    if (reason.endsWith('ambiguous'))
      assert.ok(
        result.chapterEntry!.querySchema!.entries.some((row) => row.rejection === 'duplicate_key'),
      );
    for (const secret of [
      CHAPTER_ENTRY_FIXTURE_TITLE,
      CHAPTER_ENTRY_FIXTURE_WORK,
      'PRIVATE_TYPE',
      '7600000000000000002',
      '1'.repeat(31),
    ])
      assert.equal(JSON.stringify(result).includes(secret), false);
    await fixture.session.close();
  }
});

test('an admitted chapter type filter cannot bypass the real parent ID/title or fresh owner binding', async () => {
  for (const options of [
    {
      destination: `https://fanqienovel.com/main/writer/chapter-manage/7600000000000000002&${CHAPTER_ENTRY_FIXTURE_TITLE}?type=1`,
      reason: 'chapter_manager_route_id_mismatch',
    },
    {
      destination: `https://fanqienovel.com/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}&PRIVATE_OTHER_TITLE?type=1`,
      reason: 'chapter_manager_route_title_mismatch',
    },
    {
      destination: `https://fanqienovel.com/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}&${CHAPTER_ENTRY_FIXTURE_TITLE}?type=1`,
      changedOwner: true,
      reason: 'chapter_manager_identity_changed',
    },
  ]) {
    const fixture = chapterEntryFixture({ ...options, spa: true });
    const result = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
    );
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.chapterEntry?.reason, options.reason);
    assert.equal(result.chapterEntry?.targetRef, null);
    assert.equal(fixture.diagnosticDomReads, 0);
    await fixture.session.close();
  }
});

test('encoded-title directory GET metadata remains value-free and a changed owner still refuses target registration', async () => {
  const title = '合成私有章书名（测试）';
  const encoded = encodeURIComponent(title);
  const destination = `https://fanqienovel.com/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}&${encoded}`;
  for (const changedOwner of [false, true]) {
    const fixture = chapterEntryFixture({
      rows: [{ book_id: CHAPTER_ENTRY_FIXTURE_WORK, book_name: title }],
      titles: [title],
      destination,
      spa: true,
      changedOwner,
      apiDestination: `https://fanqienovel.com/api/author/chapter/fixture/${CHAPTER_ENTRY_FIXTURE_WORK}&${encoded}/v0/?book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&body=PRIVATE_BODY&nonce=PRIVATE_TOKEN`,
    });
    const result = await fixture.session.diagnoseReadPage(
      'https://fanqienovel.com/main/writer/book-manage',
      { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
    );
    assert.equal(result.status, changedOwner ? 'capability_unavailable' : 'success');
    assert.equal(result.chapterEntry?.status, changedOwner ? 'unavailable' : 'opened');
    if (changedOwner) {
      assert.equal(result.chapterEntry?.reason, 'chapter_manager_identity_changed');
      assert.equal(result.chapterEntry?.targetRef, null);
      assert.equal(fixture.diagnosticDomReads, 0);
    }
    for (const secret of [
      title,
      encoded,
      CHAPTER_ENTRY_FIXTURE_WORK,
      'PRIVATE_BODY',
      'PRIVATE_TOKEN',
      'PRIVATE_CHAPTER_BODY',
    ])
      assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(
      result.readResponseStructure?.some((row) => row.pathTemplate.includes('/chapter/fixture/')),
      false,
    );
    await fixture.session.close();
  }
});

test('only the three actually observed chapter GET families project bounded field types, excluding body/credentials/dynamic keys', () => {
  for (const source of CHAPTER_SCHEMA_FIXTURE_SOURCES) {
    assert.equal(isChapterReadSchemaSource(source.url), true);
    assert.equal(isReadSchemaSource(source.url), true);
  }
  for (const source of [
    'https://external.invalid/api/author/chapter/chapter_list/v1',
    'https://user:password@fanqienovel.com/api/author/chapter/chapter_list/v1',
    'https://fanqienovel.com/api/author/chapter/chapter_list/v2',
    'https://fanqienovel.com/api/author/chapter/chapter_content/v1',
    'https://fanqienovel.com/api/author/chapter/chapter_list/v1/',
  ])
    assert.equal(isChapterReadSchemaSource(source), false);
  const volume = projectReadResponseFields(CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!.json);
  assert.ok(
    volume.fields.some(
      (row) => row.path === 'data.volume_list[].volume_id' && row.type === 'string',
    ),
  );
  assert.ok(
    volume.fields.some(
      (row) => row.path === 'data.volume_list[].item_count' && row.type === 'number',
    ),
  );
  const chapter = projectReadResponseFields(CHAPTER_SCHEMA_FIXTURE_SOURCES[1]!.json);
  for (const field of [
    'item_id',
    'article_id',
    'display_status',
    'article_status',
    'timer_time',
    'create_time',
    'word_number',
  ])
    assert.ok(chapter.fields.some((row) => row.path === `data.item_list[].${field}`));
  assert.ok(
    chapter.fields.some((row) => row.path === 'data.item_list[].item_id' && row.type === 'string'),
  );
  assert.ok(
    chapter.fields.some(
      (row) => row.path === 'data.item_list[].display_status' && row.type === 'number',
    ),
  );
  for (const secret of [
    CHAPTER_ENTRY_FIXTURE_WORK,
    'PRIVATE_VOLUME_NAME',
    'PRIVATE_CHAPTER_NAME',
    'PRIVATE_BODY_ID',
    'PRIVATE_CONTENT_ID',
    'PRIVATE_TOKEN',
    'PRIVATE_DYNAMIC_KEY',
    'PRIVATE_DYNAMIC_VALUE',
    'PRIVATE_MAPPED_TITLE',
    '7600000000000000301',
  ])
    assert.equal(JSON.stringify([volume, chapter]).includes(secret), false);
  assert.ok(chapter.fields.every((row) => !/body|content|token/.test(row.path)));
});

test('complete goto of a registered chapter target refreshes only this operation current-generation observed GET URLs for schema', async () => {
  const fixture = chapterEntryFixture({ directorySources: CHAPTER_SCHEMA_FIXTURE_SOURCES });
  const entry = await fixture.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
    { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
  );
  assert.equal(entry.chapterEntry?.status, 'opened');
  assert.equal(fixture.directoryFetchCount, 0);
  const result = await fixture.session.diagnoseReadPage(
    `diagnostic:${entry.chapterEntry!.targetRef}`,
    { maxResponses: 100 },
  );
  assert.equal(result.status, 'success');
  assert.equal(fixture.directoryFetchCount, 3);
  for (const pathname of [
    '/api/author/volume/volume_list/v1',
    '/api/author/chapter/chapter_list/v1',
    '/api/author/book/book_detail/v0/',
  ])
    assert.ok(result.readResponseStructure!.some((row) => row.pathTemplate.startsWith(pathname)));
  const chapter = result.readResponseStructure!.find((row) =>
    row.pathTemplate.startsWith('/api/author/chapter/chapter_list/v1'),
  )!;
  assert.ok(
    chapter.fields.some((row) => row.path === 'data.item_list[].item_id' && row.type === 'string'),
  );
  for (const secret of [
    CHAPTER_ENTRY_FIXTURE_WORK,
    CHAPTER_ENTRY_FIXTURE_TITLE,
    'PRIVATE_VOLUME_NAME',
    'PRIVATE_CHAPTER_NAME',
    'PRIVATE_VOLUME_NONCE',
    'PRIVATE_CHAPTER_NONCE',
    'PRIVATE_BODY_ID',
    'PRIVATE_TOKEN',
    'PRIVATE_BOOK_CONTENT',
    '7600000000000000101',
    '7600000000000000201',
  ])
    assert.equal(JSON.stringify(result).includes(secret), false);
  await fixture.session.close();
});
