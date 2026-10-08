import test from 'node:test';

import {
  longApi,
  longFixture,
  longLoadedUrl,
  identityEvents,
} from './helpers/platform-reads-fake-qr-browser.js';

import { metricsPage, deferred } from './helpers/platform-reads-metrics-page.js';

import {
  collectLongWorks,
  type CollectionEvidenceProfile,
  collectShortMetrics,
} from '../src/platform/reads.js';

import assert from 'node:assert/strict';

import {
  validateDiagnosticSource,
  diagnosticRouteTemplate,
  parseOwnResponseIdentity,
  isLongStatsSchemaSource,
  projectLongStatsResponseFields,
} from '../src/platform/browser.js';

import { type Page } from 'playwright';

test('long totals, duplicates, missing string IDs and capped pagination cannot certify complete coverage', async () => {
  const cases = [
    {
      pages: [longApi([longFixture('1001')], 2), longApi([], 2)],
      code: 'long_total_count_mismatch',
    },
    {
      pages: [longApi([longFixture('1001')], 1), longApi([], 2)],
      code: 'long_total_count_changed',
    },
    {
      pages: [longApi([longFixture('1001')], 1), longApi([longFixture('1001')], 1)],
      code: 'missing_or_duplicate_work_id',
    },
    {
      pages: [longApi([{ ...longFixture('1001'), book_id: 1001 }], 1)],
      code: 'missing_or_duplicate_work_id',
    },
    {
      pages: [longApi([longFixture('1001')], null), longApi([], null)],
      code: 'long_total_count_unrecognized',
    },
  ];
  for (const item of cases) {
    const fixture = metricsPage([
      { loginRequired: false, text: '' },
      [longLoadedUrl],
      ...item.pages,
      { loginRequired: false, text: '' },
    ]);
    const result = await collectLongWorks(fixture.page);
    assert.notEqual(result.status, 'success');
    assert.equal(result.coverage.complete, false);
    assert.ok(
      result.errors.some((error) => error.code === item.code),
      item.code,
    );
  }
  const capped = metricsPage([
    { loginRequired: false, text: '' },
    [longLoadedUrl],
    longApi([longFixture('1001')], 1),
    { loginRequired: false, text: '' },
  ]);
  const result = await collectLongWorks(capped.page, { maxPages: 1 });
  assert.equal(result.status, 'partial');
  assert.equal(result.coverage.paginationComplete, false);
});

test('long API login expiration clears partially collected works and missing numbers remain null', async () => {
  const expired = metricsPage([
    { loginRequired: false, text: '' },
    [longLoadedUrl],
    longApi([longFixture('1001')], 2),
    { status: 401, ok: false, json: { message: '未登录' } },
  ]);
  const result = await collectLongWorks(expired.page);
  assert.equal(result.status, 'login_required');
  assert.equal(result.records.length, 0);
  const missing = metricsPage([
    { loginRequired: false, text: '' },
    [longLoadedUrl],
    longApi([{ ...longFixture('1001'), read_count: undefined }], 1),
    longApi([], 1),
    { loginRequired: false, text: '' },
  ]);
  const partial = await collectLongWorks(missing.page);
  assert.equal(partial.status, 'partial');
  assert.equal(partial.records[0]?.managementReadCount, null);
});

test('operator-verified long profile override remains available without a loaded API source', async () => {
  const fixture = metricsPage([
    { loginRequired: false, text: '' },
    [],
    {
      rows: [{ workId: '1001', title: 'FIXTURE_TITLE' }],
      empty: false,
      hasNext: true,
      nextDisabled: true,
    },
  ]);
  const profile: CollectionEvidenceProfile = {
    sourceUrl: 'https://fanqienovel.com/main/writer/book-manage',
    verifiedAt: '2026-10-03',
    evidence: 'fixture',
    readOnly: true,
    rowSelector: '.verified-row',
    idField: 'workId',
    fields: { workId: { type: 'identifier' }, title: { type: 'text' } },
    pagination: { nextSelector: '.next', disabledSelector: '.next.disabled' },
  };
  const result = await collectLongWorks(fixture.page, { profile });
  assert.equal(result.status, 'success');
  assert.equal(result.records[0]?.workId, '1001');
  assert.equal('managementReadCount' in result.records[0]!, false);
});

test('historical data read route and numeric camel-case filters are diagnostics only and mask stable IDs', () => {
  const source = 'https://fanqienovel.com/main/writer/data?bookId=7680000000000000001';
  assert.equal(validateDiagnosticSource(source).pathname, '/main/writer/data');
  assert.equal(
    diagnosticRouteTemplate(source),
    'https://fanqienovel.com/main/writer/data?bookId={workId}',
  );
  assert.throws(
    () => validateDiagnosticSource('https://fanqienovel.com/main/writer/data?bookId=PRIVATE_VALUE'),
    { code: 'invalid_diagnostic_route' },
  );
  assert.equal(
    parseOwnResponseIdentity(
      { code: 0, data: { id: '1001', name: 'FIXTURE_OWNER' } },
      'https://fanqienovel.com/api/user/info/v2?bookId=1001',
    ),
    null,
  );
});

test('a platform-visible statistics deadline appearing after API reads is recaptured without inferring yesterday', async () => {
  const fixture = metricsPage([
    { loginRequired: false, text: '核心数据' },
    ['https://fanqienovel.com/api/author/sa_stats/book_list/v0/?page_index=0'],
    { status: 200, ok: true, json: { code: 0, data: { stats_book_list: [] } } },
    { loginRequired: false, text: '截止至2026-10-01 24:00；每天12:00更新' },
  ]);
  const result = await collectShortMetrics(fixture.page);
  assert.equal(result.statisticsThrough, '2026-10-01');
  assert.equal(result.statisticsThroughBasis, 'platform-visible-cutoff');
});

test('long metric schema sources are restricted to the three actually observed official GET paths', () => {
  for (const path of ['book_list', 'book_common_v1', 'book_increase_v2'])
    assert.equal(
      isLongStatsSchemaSource(`https://fanqienovel.com/api/author/stats/${path}/v0/?book_id=1001`),
      true,
    );
  for (const raw of [
    'https://external.example/api/author/stats/book_list/v0/',
    'https://user:secret@fanqienovel.com/api/author/stats/book_list/v0/',
    'https://fanqienovel.com/api/author/stats/book_common_v2/v0/',
    'https://fanqienovel.com/api/author/stats/chapter_list/v0/',
    'https://fanqienovel.com/api/author/stats/book_create/v0/',
  ])
    assert.equal(isLongStatsSchemaSource(raw), false);
});

test('long metric schema projects only fixed candidate field paths/types, excluding values, dynamic keys, credentials and prose', () => {
  const stats = Object.defineProperty(
    {
      book_id: 'PRIVATE_ID',
      book_name: 'PRIVATE_TITLE',
      read_uv: 'PRIVATE_METRIC_VALUE',
      in_read_count: 'PRIVATE_METRIC_VALUE',
      chase_count: 2,
      remind_count: 0,
      rating: 'PRIVATE_RATING_VALUE',
      shelf_count: 1,
      comment_count: 0,
      PRIVATE_ASCII_PROSE_KEY: 'PRIVATE_VALUE',
      12345: 'PRIVATE_VALUE',
    },
    'token',
    {
      enumerable: true,
      get() {
        throw new Error('Credential field must not be visited');
      },
    },
  );
  const projected = projectLongStatsResponseFields({
    code: 0,
    data: {
      total_count: 1,
      book_list: [stats],
      metrics: stats,
      body: 'PRIVATE_BODY',
      headers: { token: 'PRIVATE_TOKEN' },
      cookies: 'PRIVATE_COOKIE',
    },
  });
  for (const path of [
    'data.book_list[].book_id',
    'data.book_list[].book_name',
    'data.book_list[].read_uv',
    'data.metrics.in_read_count',
    'data.metrics.chase_count',
    'data.metrics.remind_count',
    'data.metrics.rating',
    'data.metrics.shelf_count',
    'data.metrics.comment_count',
  ])
    assert.ok(
      projected.fields.some((field) => field.path === path),
      path,
    );
  for (const secret of ['PRIVATE_', '12345', 'body', 'headers', 'cookies', 'token'])
    assert.equal(JSON.stringify(projected).includes(secret), false);
});

test('long metrics diagnostic GET schemas are fenced to the request document and never turn POST bodies into read evidence', async () => {
  const fixture = identityEvents();
  let forbiddenReads = 0;
  const source =
    'https://fanqienovel.com/api/author/stats/book_common_v1/v0/?book_id=7680000000000000001&token=PRIVATE_TOKEN';
  const get = { ...fixture.request(), url: () => source };
  fixture.events.get('request')!(get);
  fixture.events.get('response')!(
    fixture.response(get, async () => ({
      code: 0,
      data: { read_uv: 'PRIVATE_VALUE', in_read_count: 1, score: 'PRIVATE_VALUE' },
    })),
  );
  await Promise.resolve();
  await Promise.resolve();
  const cache = (
    fixture.session as unknown as { pageReadStructures: WeakMap<Page, Map<string, unknown>> }
  ).pageReadStructures;
  assert.equal(cache.get(fixture.pages[0]!)?.size, 1);
  assert.equal(
    JSON.stringify([...cache.get(fixture.pages[0]!)!.values()]).includes('PRIVATE_'),
    false,
  );
  const post = { ...get, method: () => 'POST' };
  fixture.events.get('request')!(post);
  fixture.events.get('response')!(
    fixture.response(post, async () => {
      forbiddenReads += 1;
      throw new Error('POST response must not be read');
    }),
  );
  const pending = deferred<unknown>();
  const old = {
    ...fixture.request(),
    url: () => 'https://fanqienovel.com/api/author/stats/book_increase_v2/v0/?book_id=1001',
  };
  fixture.events.get('request')!(old);
  fixture.events.get('response')!(fixture.response(old, () => pending.promise));
  fixture.events.get('framenavigated')!(null);
  pending.resolve({ code: 0, data: { read_uv: 1 } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(cache.get(fixture.pages[0]!)?.size, 0);
  assert.equal(forbiddenReads, 0);
});

test('long metric diagnostic admits strict camel/Pascal statistics compounds while filtering map/title/account/prose keys', () => {
  const value = {
    code: 0,
    data: {
      book_list: [{ book_id: 'PRIVATE_ID', book_name: 'CurrentReadCount' }],
      BookCommonData: {
        TotalReaderUV: 'PRIVATE_VALUE',
        CurrentReadingUserCount: 1,
        FollowReadNumber: 0,
        ReadStatsInfo: { AverageReadTime: 'PRIVATE_VALUE' },
        CurrentReadCount: 'PRIVATE_TITLE_VALUE',
        CommentData: { CommentUserTotal: 0 },
      },
      ByBookMap: { ReadCount: 'PRIVATE_VALUE' },
      ThisIsASentenceAboutAnAccount: 'PRIVATE_PROSE',
      AccessTokenCount: 'PRIVATE_TOKEN',
      aabbccddaabbccdd: 'PRIVATE_OPAQUE',
      1001: 'PRIVATE_ID',
    },
  };
  const result = projectLongStatsResponseFields(value, ['CurrentReadingUserCount']);
  for (const path of [
    'data.BookCommonData.TotalReaderUV',
    'data.BookCommonData.FollowReadNumber',
    'data.BookCommonData.ReadStatsInfo.AverageReadTime',
    'data.BookCommonData.CommentData.CommentUserTotal',
  ])
    assert.ok(
      result.fields.some((field) => field.path === path),
      path,
    );
  for (const secret of [
    'PRIVATE_',
    'CurrentReadCount',
    'CurrentReadingUserCount',
    'ByBookMap',
    'ThisIsASentence',
    'AccessTokenCount',
    'aabbccddaabbccdd',
    '1001',
  ])
    assert.equal(JSON.stringify(result).includes(secret), false);
});
