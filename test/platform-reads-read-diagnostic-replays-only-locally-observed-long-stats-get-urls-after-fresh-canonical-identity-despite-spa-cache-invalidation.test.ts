import test from 'node:test';

import {
  localStatsDiagnosticFixture,
  longMetricListUrl,
  longMetricCommonUrl,
  longMetricList,
  longMetricBook,
  longMetricCommon,
} from './helpers/platform-reads-fake-qr-browser.js';

import assert from 'node:assert/strict';

import { CANONICAL_OWN_USER_URL } from '../src/platform/browser.js';

import { deferred, metricsPage } from './helpers/platform-reads-metrics-page.js';

import { type Page } from 'playwright';

import { collectLongMetrics } from '../src/platform/reads.js';

test('read diagnostic replays only locally observed long stats GET URLs after fresh canonical identity despite SPA cache invalidation', async () => {
  const source =
    'https://fanqienovel.com/api/author/stats/book_common_v1/v0/?book_id=7680000000000000001&nonce=PRIVATE_NONCE';
  const fixture = localStatsDiagnosticFixture([source]);
  const result = await fixture.session.diagnoseReadPage('https://fanqienovel.com/main/writer/data');
  assert.equal(result.status, 'success');
  assert.equal(result.identityObserved.accountId, true);
  assert.deepEqual(fixture.calls, [CANONICAL_OWN_USER_URL, source]);
  assert.equal(result.readResponseStructure?.length, 1);
  assert.equal(
    result.readResponseStructure?.[0]?.pathTemplate,
    '/api/author/stats/book_common_v1/v0/?book_id={workId}',
  );
  assert.ok(
    result.readResponseStructure?.[0]?.fields.some(
      (field) => field.path === 'data.BookCommonData.CurrentReaderUV',
    ),
  );
  for (const secret of ['PRIVATE_', '7680000000000000001', '1001', 'CurrentReadingUserCount'])
    assert.equal(JSON.stringify(result).includes(secret), false);
});

test('fresh long stats schema finishing across navigation fails closed without returning or caching the old response', async () => {
  const source = 'https://fanqienovel.com/api/author/stats/book_increase_v2/v0/?book_id=1001';
  const fixture = localStatsDiagnosticFixture([source]);
  const pending = deferred<unknown>();
  const started = deferred();
  const original = fixture.page.evaluate.bind(fixture.page);
  fixture.page.evaluate = (async (...args: unknown[]) => {
    if (args[1] === source) {
      started.resolve();
      return pending.promise;
    }
    return (original as (...args: unknown[]) => Promise<unknown>)(...args);
  }) as Page['evaluate'];
  const diagnosis = fixture.session.diagnoseReadPage('https://fanqienovel.com/main/writer/data');
  const rejected = assert.rejects(diagnosis, { code: 'read_diagnostic_stale' });
  await started.promise;
  fixture.emit('framenavigated', null);
  pending.resolve({ status: 200, ok: true, json: fixture.schema });
  await rejected;
  assert.equal(
    (
      fixture.session as unknown as { pageReadStructures: WeakMap<Page, Map<string, unknown>> }
    ).pageReadStructures.get(fixture.page)?.size,
    0,
  );
});

test('long stats refresh errors expose fixed limitations without raw URL/error content, and unverified accounts cannot replay', async () => {
  const source =
    'https://fanqienovel.com/api/author/stats/book_common_v1/v0/?book_id=1001&nonce=PRIVATE_NONCE';
  const fixture = localStatsDiagnosticFixture([source]);
  const original = fixture.page.evaluate.bind(fixture.page);
  fixture.page.evaluate = (async (...args: unknown[]) => {
    if (args[1] === source) throw new Error('PRIVATE_NONCE PRIVATE_HEADER PRIVATE_BODY');
    return (original as (...args: unknown[]) => Promise<unknown>)(...args);
  }) as Page['evaluate'];
  const result = await fixture.session.diagnoseReadPage('https://fanqienovel.com/main/writer/data');
  assert.equal(result.status, 'success');
  assert.ok(
    result.limitations.some((limitation) => limitation.includes('could not be refreshed safely')),
  );
  assert.equal(result.readResponseStructure?.length, 0);
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
  const unknown = localStatsDiagnosticFixture([source]);
  const replayed: string[] = [];
  unknown.page.waitForResponse = (async () => {
    throw new Error('No further own response');
  }) as Page['waitForResponse'];
  unknown.page.evaluate = (async (_callback: unknown, arg: unknown) => {
    if (typeof arg === 'string') {
      replayed.push(arg);
      return { status: 200, ok: true, json: { code: 0, data: {} } };
    }
    return arg && typeof arg === 'object'
      ? { elements: [], links: [], truncated: false }
      : { loginRequired: false, managementVisible: true, ownAccount: null };
  }) as Page['evaluate'];
  assert.equal(
    (await unknown.session.diagnoseReadPage('https://fanqienovel.com/main/writer/data')).status,
    'capability_unavailable',
  );
  assert.equal(
    replayed.some((raw) => raw === source),
    false,
  );
});

test('built-in long metrics proves the full inventory and preserves reported strings without promoting update_time to statistics cutoff', async () => {
  const fixture = metricsPage([
    { loginRequired: false, text: '小说数据' },
    [longMetricListUrl, longMetricCommonUrl],
    longMetricList([longMetricBook('1001')], 2),
    longMetricList([longMetricBook('1002')], 2),
    longMetricCommon('1001'),
    longMetricCommon('1002', { reader_uv_daily: '--', pursue_read_rate: '未知' }),
    { loginRequired: false, text: '小说数据' },
  ]);
  const urls: string[] = [];
  const original = fixture.page.evaluate.bind(fixture.page);
  fixture.page.evaluate = (async (...args: unknown[]) => {
    if (typeof args[1] === 'string') urls.push(args[1]);
    return (original as (...args: unknown[]) => Promise<unknown>)(...args);
  }) as Page['evaluate'];
  const result = await collectLongMetrics(fixture.page);
  assert.equal(result.status, 'success');
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.pagesFetched, 2);
  assert.equal(result.coverage.totalRecords, 2);
  assert.equal(result.records.length, 2);
  assert.deepEqual(
    urls.slice(0, 2).map((url) => new URL(url).searchParams.get('page_index')),
    ['0', '1'],
  );
  assert.deepEqual(
    urls.slice(2).map((url) => new URL(url).searchParams.get('book_id')),
    ['1001', '1002'],
  );
  assert.equal(result.records[0]?.reportedReaderUvDaily, '0');
  assert.equal(result.records[0]?.reportedPursueReadRate, '0%');
  assert.equal(result.records[0]?.reportedListReadCount, '--');
  assert.equal(result.records[1]?.reportedReaderUvDaily, '--');
  assert.equal(result.records[1]?.reportedPursueReadRate, '未知');
  assert.equal(result.records[0]?.updateTimeRaw, '2026-10-01');
  assert.equal(result.records[0]?.platformUpdatedDate, '2026-10-01');
  assert.equal(result.statisticsThrough, null);
  assert.equal(result.statisticsThroughBasis, null);
  assert.equal(result.statisticsCutoffRaw, null);
  assert.ok(
    result.limitations.some((limitation) =>
      limitation.includes('not evidence of a statistics cutoff'),
    ),
  );
  assert.equal(fixture.remaining.length, 0);
});

test('a long stats list covering its declared total finishes without a speculative empty-page request', async () => {
  const fixture = metricsPage([
    { loginRequired: false, text: '小说数据' },
    [longMetricListUrl, longMetricCommonUrl],
    longMetricList([longMetricBook('1001')], 1),
    longMetricCommon('1001'),
    { loginRequired: false, text: '小说数据' },
  ]);
  const urls: string[] = [];
  const original = fixture.page.evaluate.bind(fixture.page);
  fixture.page.evaluate = (async (...args: unknown[]) => {
    if (typeof args[1] === 'string') urls.push(args[1]);
    return (original as (...args: unknown[]) => Promise<unknown>)(...args);
  }) as Page['evaluate'];
  const result = await collectLongMetrics(fixture.page, { maxPages: 1 });
  assert.equal(result.status, 'success');
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.paginationComplete, true);
  assert.equal(result.coverage.pagesFetched, 1);
  assert.equal(result.coverage.totalRecords, 1);
  assert.equal(result.records.length, 1);
  assert.deepEqual(
    urls
      .filter((url) => new URL(url).pathname.includes('/book_list/'))
      .map((url) => new URL(url).searchParams.get('page_index')),
    ['0'],
  );
  assert.equal(urls.length, 2);
  assert.equal(result.statisticsThrough, null);
  assert.equal(result.records[0]?.reportedListReadCount, '--');
  assert.equal(fixture.remaining.length, 0);
});

test('an index-ignoring repeated long stats list remains partial until the declared total is actually covered', async () => {
  const repeated = longMetricList([longMetricBook('1001')], 2);
  const fixture = metricsPage([
    { loginRequired: false, text: '小说数据' },
    [longMetricListUrl, longMetricCommonUrl],
    repeated,
    repeated,
    longMetricCommon('1001'),
    { loginRequired: false, text: '小说数据' },
  ]);
  const urls: string[] = [];
  const original = fixture.page.evaluate.bind(fixture.page);
  fixture.page.evaluate = (async (...args: unknown[]) => {
    if (typeof args[1] === 'string') urls.push(args[1]);
    return (original as (...args: unknown[]) => Promise<unknown>)(...args);
  }) as Page['evaluate'];
  const result = await collectLongMetrics(fixture.page);
  assert.equal(result.status, 'partial');
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.paginationComplete, false);
  assert.equal(result.coverage.totalRecords, 2);
  assert.equal(result.coverage.pagesFetched, 2);
  assert.equal(result.records.length, 1);
  assert.deepEqual(
    urls
      .filter((url) => new URL(url).pathname.includes('/book_list/'))
      .map((url) => new URL(url).searchParams.get('page_index')),
    ['0', '1'],
  );
  for (const code of [
    'missing_or_duplicate_statistics_id',
    'pagination_not_advancing',
    'long_statistics_pagination_incomplete',
    'long_statistics_total_mismatch',
  ])
    assert.ok(
      result.errors.some((error) => error.code === code),
      code,
    );
  assert.equal(result.statisticsThrough, null);
  assert.equal(fixture.remaining.length, 0);
});

test('long metrics has no synthetic default read source and cannot replay POST or curve-only observations', async () => {
  for (const sources of [
    [],
    ['https://fanqienovel.com/api/author/sa_stats/book_list/v0/?page_index=0'],
    ['https://fanqienovel.com/api/author/stats/book_increase_v2/v0/?book_id=1001'],
  ]) {
    const fixture = metricsPage([{ loginRequired: false, text: '' }, sources]);
    const result = await collectLongMetrics(fixture.page);
    assert.equal(result.status, 'capability_unavailable');
    assert.ok(result.errors.some((error) => error.code === 'loaded_long_statistics_list_missing'));
  }
  const post = metricsPage([{ loginRequired: false, text: '' }, []]);
  post.page.goto = (async () => {
    post.emitResponse(longMetricListUrl, 'POST');
    return null;
  }) as Page['goto'];
  assert.equal((await collectLongMetrics(post.page)).status, 'capability_unavailable');
  const noCommon = metricsPage([
    { loginRequired: false, text: '' },
    [longMetricListUrl],
    longMetricList([longMetricBook('1001')], 1),
  ]);
  const missing = await collectLongMetrics(noCommon.page);
  assert.equal(missing.status, 'capability_unavailable');
  assert.ok(missing.errors.some((error) => error.code === 'loaded_long_statistics_common_missing'));
});

test('long common GET loaded later during list pagination is discovered before detail replay', async () => {
  const fixture = metricsPage([
    { loginRequired: false, text: '' },
    [longMetricListUrl],
    longMetricList([longMetricBook('1001')], 1),
    longMetricCommon('1001'),
    { loginRequired: false, text: '' },
  ]);
  const original = fixture.page.evaluate.bind(fixture.page);
  let calls = 0;
  fixture.page.evaluate = (async (...args: unknown[]) => {
    const result = await (original as (...args: unknown[]) => Promise<unknown>)(...args);
    if (++calls === 2) fixture.emitResponse(longMetricCommonUrl);
    return result;
  }) as Page['evaluate'];
  assert.equal((await collectLongMetrics(fixture.page)).status, 'success');
});
