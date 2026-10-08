import test from 'node:test';

import { type Page } from 'playwright';

import {
  collectShortWorks,
  parseVisibleStatistics,
  numberOrNull,
  identifierOrNull,
  normalizeShortStatus,
  collectChapters,
  type CollectionEvidenceProfile,
  validateReadProfile,
  collectShortMetrics,
} from '../src/platform/reads.js';

import assert from 'node:assert/strict';

import { findOwnIdentity, parseOwnIdentity } from '../src/platform/browser.js';

import { metricsPage } from './helpers/platform-reads-metrics-page.js';

test('short management fresh pagination keeps original tags and exact official publication labels', async () => {
  let index = 1,
    navigations = 0;
  const tags = [
    ['已签约', '审核不通过', '审核不通过'],
    ['待发表', '已停止推荐/分发'],
  ];
  const page = {
    goto: async () => {
      navigations++;
    },
    waitForLoadState: async () => {},
    waitForFunction: async () => {},
    locator: (selector: string) => ({
      count: async () => 1,
      click: async () => {
        index = Number(selector.match(/第 (\d+) 页/)![1]);
      },
    }),
    evaluate: async (fn: () => unknown) =>
      fn.toString().includes('loginRequired')
        ? { text: 'synthetic management', loginRequired: false }
        : {
            cards: [
              {
                workId: String(1234567890120 + index),
                title: 'synthetic ' + index,
                managementUrl:
                  'https://fanqienovel.com/main/writer/preview-short/' +
                  String(1234567890120 + index),
                statusTags: tags[index - 1],
                readCountRaw: '0阅读',
                wordCountRaw: '100字',
                updatedAtRaw: '平台原时间',
              },
            ],
            pageNumbers: [1, 2],
            activePage: index,
            emptyVisible: false,
          },
  } as unknown as Page;
  const output = await collectShortWorks(page);
  assert.equal(output.status, 'success');
  assert.equal(navigations, 1);
  assert.equal(output.coverage.pagesFetched, 2);
  assert.equal(output.coverage.recordsFetched, 2);
  assert.equal(output.records[0]!.publicationStatus, 'rejected');
  assert.equal(output.records[0]!.signingStatus, 'signed');
  assert.deepEqual(output.records[0]!.statusTags, tags[0]);
  assert.equal(output.records[0]!.readCount, 0);
  assert.equal(output.records[1]!.publicationStatus, 'unknown');
  assert.equal(output.records[1]!.statusFacts.conflict, true);
  assert.equal(output.records[0]!.statusFacts.management.raw, null);
});

test('cutoff preserves visible month-day and update schedule without resolving a missing year', () => {
  assert.deepEqual(
    parseVisibleStatistics('统计周期：截止至09-29 24:00；每天12:00更新', '2026-10-02T10:00:00Z'),
    {
      statisticsThrough: null,
      statisticsThroughBasis: 'platform-visible-month-day;year-not-provided',
      statisticsCutoffRaw: '截止至09-29 24:00',
      platformUpdateSchedule: '每天12:00更新',
    },
  );
  assert.equal(
    parseVisibleStatistics('截至12-31 24:00', '2027-01-01T10:00:00Z').statisticsThrough,
    null,
  );
  assert.equal(
    parseVisibleStatistics('截止至2026-10-03 24:00', '2026-10-02T10:00:00Z').statisticsThrough,
    null,
  );
  assert.equal(
    parseVisibleStatistics('截止至02-30 24:00', '2026-10-02T10:00:00Z').statisticsThrough,
    null,
  );
  assert.equal(
    parseVisibleStatistics('核心数据；每天12:00更新', '2026-10-02T10:00:00Z').statisticsThrough,
    null,
  );
});

test('unknown and zero metrics differ; identifiers do not lose precision', () => {
  assert.equal(numberOrNull('0'), 0);
  assert.equal(numberOrNull(undefined), null);
  assert.equal(numberOrNull(''), null);
  assert.equal(numberOrNull('1.2万'), null);
  assert.equal(numberOrNull(-1), null);
  assert.equal(identifierOrNull('7680000000000000001'), '7680000000000000001');
  assert.equal(identifierOrNull(7680000000000000001), null);
  assert.equal(normalizeShortStatus(['已签约', '审核未通过']).publicationStatus, 'rejected');
  assert.equal(normalizeShortStatus(['未签约', '未发布']).publicationStatus, 'unpublished');
});

test('own identity parser excludes authors of arbitrary works and unsafe numeric IDs', () => {
  assert.equal(
    findOwnIdentity({ works: [{ author_id: '1001', nickname: '外部作者' }] }, 'fixture'),
    null,
  );
  assert.equal(parseOwnIdentity({ user_id: 7680000000000000001 }, 'fixture'), null);
  const identity = findOwnIdentity(
    {
      loaderData: {
        ownRoute: { userInfo: { user_id: '1001', author_id: '2001', nickname: '测试笔名' } },
      },
    },
    'fixture',
  );
  assert.equal(identity?.accountId, '1001');
  assert.equal(identity?.authorId, '2001');
});

test('unverified chapter pages fail before any browser navigation', async () => {
  const page = {
    goto: () => {
      throw new Error('must not navigate');
    },
  } as unknown as Page;
  const result = await collectChapters(page);
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.sourceUrl, null);
  assert.equal(result.coverage.complete, false);
  const profile = {
    sourceUrl: 'https://evil.test/main/writer/book-manage',
    readOnly: true,
    verifiedAt: '2026-10-02',
    evidence: 'fixture',
    rowSelector: '.row',
    idField: 'workId',
    fields: { workId: { type: 'identifier' } },
  } as CollectionEvidenceProfile;
  assert.throws(() => validateReadProfile(profile), { code: 'invalid_source_url' });
  assert.throws(
    () =>
      validateReadProfile({
        ...profile,
        sourceUrl: 'https://fanqienovel.com/main/writer/publish-short/1001',
      }),
    { code: 'unsafe_read_route' },
  );
});

test('metrics replay only observed read endpoints and verify pagination with an empty page', async () => {
  const { page, remaining } = metricsPage([
    { loginRequired: false, text: '截止至2026-09-29 24:00；每天12:00更新' },
    [
      'https://fanqienovel.com/api/author/sa_stats/book_list/v0/?page_index=0',
      'https://fanqienovel.com/api/author/sa_stats/single_common/v0/?book_id=1001',
    ],
    {
      ok: true,
      status: 200,
      json: { code: 0, data: { stats_book_list: [{ book_id: '1001', book_name: '测试作品' }] } },
    },
    { ok: true, status: 200, json: { code: 0, data: { stats_book_list: [] } } },
    {
      ok: true,
      status: 200,
      json: {
        code: 0,
        data: {
          show_count: 0,
          read_count: 0,
          click_rate: '0%',
          comment_count: 0,
          digg_count: 0,
          shelf_count: 0,
        },
      },
    },
    { loginRequired: false, text: '' },
  ]);
  const result = await collectShortMetrics(page);
  assert.equal(result.status, 'success');
  assert.equal(result.coverage.pagesFetched, 2);
  assert.equal(result.statisticsThrough, '2026-09-29');
  assert.equal(result.records[0]?.showCount, 0);
  assert.equal(result.records[0]?.statisticsBookId, '1001');
  assert.equal(remaining.length, 0);
});

test('missing bootstrap endpoints do not invent URLs, deadlines or metrics', async () => {
  const { page, remaining } = metricsPage([{ loginRequired: false, text: '核心数据' }, []]);
  const result = await collectShortMetrics(page);
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.statisticsThrough, null);
  assert.equal(result.records.length, 0);
  assert.equal(remaining.length, 0);
});

test('a selected-book detail GET arriving while list pagination is replayed is discovered after pagination', async () => {
  const fixture = metricsPage([
    { loginRequired: false, text: '' },
    ['https://fanqienovel.com/api/author/sa_stats/book_list/v0/?page_index=0'],
    {
      ok: true,
      status: 200,
      json: {
        code: 0,
        data: { stats_book_list: [{ book_id: '1001', book_name: 'FIXTURE_TITLE' }] },
      },
    },
    { ok: true, status: 200, json: { code: 0, data: { stats_book_list: [] } } },
    {
      ok: true,
      status: 200,
      json: {
        code: 0,
        data: {
          show_count: 1,
          read_count: 1,
          click_rate: '100%',
          comment_count: 0,
          digg_count: 0,
          shelf_count: 0,
        },
      },
    },
    { loginRequired: false, text: '' },
  ]);
  const original = fixture.page.evaluate.bind(fixture.page);
  let evaluations = 0;
  fixture.page.evaluate = (async (...args: unknown[]) => {
    const result = await (original as (...args: unknown[]) => Promise<unknown>)(...args);
    if (++evaluations === 2)
      fixture.emitResponse(
        'https://fanqienovel.com/api/author/sa_stats/single_common/v0/?book_id=1001',
      );
    return result;
  }) as Page['evaluate'];
  const result = await collectShortMetrics(fixture.page);
  assert.equal(result.status, 'success');
  assert.equal(result.records.length, 1);
  assert.equal(
    result.errors.some((error) => error.code === 'loaded_detail_endpoint_missing'),
    false,
  );
});

test('bootstrap discovery waits on actual GET responses and never treats POST/resource-only URLs as replay evidence', async () => {
  const fixture = metricsPage([
    { loginRequired: false, text: '' },
    [],
    { ok: true, status: 200, json: { code: 0, data: { stats_book_list: [] } } },
    { loginRequired: false, text: '' },
  ]);
  let waits = 0;
  fixture.page.waitForResponse = (async (predicate: unknown, options: unknown) => {
    waits += 1;
    assert.equal((options as { timeout: number }).timeout, 7);
    const response = {
      url: () => 'https://fanqienovel.com/api/author/sa_stats/book_list/v0/?page_index=0',
      request: () => ({ method: () => 'GET' }),
    };
    assert.equal(
      (predicate as (response: unknown) => boolean)({
        ...response,
        request: () => ({ method: () => 'POST' }),
      }),
      false,
    );
    fixture.emitResponse(response.url(), 'POST');
    const observed = fixture.emitResponse(response.url());
    assert.equal((predicate as (response: unknown) => boolean)(observed), true);
    return observed;
  }) as Page['waitForResponse'];
  assert.equal((await collectShortMetrics(fixture.page, { timeoutMs: 7 })).status, 'success');
  assert.equal(waits, 1);
});

test('the bounded detail discovery cannot synthesize a source when only the list has been loaded', async () => {
  const fixture = metricsPage([
    { loginRequired: false, text: '' },
    ['https://fanqienovel.com/api/author/sa_stats/book_list/v0/?page_index=0'],
    {
      ok: true,
      status: 200,
      json: {
        code: 0,
        data: { stats_book_list: [{ book_id: '1001', book_name: 'FIXTURE_TITLE' }] },
      },
    },
    { ok: true, status: 200, json: { code: 0, data: { stats_book_list: [] } } },
  ]);
  fixture.page.waitForResponse = (async (_predicate: unknown, options: unknown) => {
    assert.equal((options as { timeout: number }).timeout, 9);
    throw new Error('Fixture deadline');
  }) as Page['waitForResponse'];
  const result = await collectShortMetrics(fixture.page, { timeoutMs: 9 });
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.records.length, 0);
  assert.ok(result.errors.some((error) => error.code === 'loaded_detail_endpoint_missing'));
});
