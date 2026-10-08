import test from 'node:test';

import {
  longMetricList,
  longMetricBook,
  longMetricListUrl,
  longMetricCommonUrl,
  longMetricCommon,
  apiCollectorCases,
} from './helpers/platform-reads-fake-qr-browser.js';

import { metricsPage } from './helpers/platform-reads-metrics-page.js';

import {
  collectLongMetrics,
  type CollectionEvidenceProfile,
  parsePlatformUpdateTime,
} from '../src/platform/reads.js';

import assert from 'node:assert/strict';

import { type Page } from 'playwright';

test('long metric pagination rejects totals, duplicate/non-string IDs, and missing or changed list field types', async () => {
  const cases = [
    {
      pages: [longMetricList([longMetricBook('1001')], 2), longMetricList([], 2)],
      code: 'long_statistics_total_mismatch',
    },
    {
      pages: [longMetricList([longMetricBook('1001')], 2), longMetricList([], 3)],
      code: 'long_statistics_total_changed',
    },
    {
      pages: [longMetricList([longMetricBook('1001')], '1'), longMetricList([], '1')],
      code: 'long_statistics_total_unrecognized',
    },
    {
      pages: [
        longMetricList([longMetricBook('1001')], 2),
        longMetricList([longMetricBook('1001')], 2),
      ],
      code: 'missing_or_duplicate_statistics_id',
    },
    {
      pages: [longMetricList([{ ...longMetricBook('1001'), book_id: 1001 }], 1)],
      code: 'missing_or_duplicate_statistics_id',
      validBook: false,
    },
    {
      pages: [longMetricList([{ ...longMetricBook('1001'), word_number: '0', read_count: 0 }], 1)],
      code: 'long_statistics_list_fields_missing',
    },
  ];
  for (const item of cases) {
    const fixture = metricsPage([
      { loginRequired: false, text: '' },
      [longMetricListUrl, longMetricCommonUrl],
      ...item.pages,
      ...(item.validBook === false ? [] : [longMetricCommon('1001')]),
      { loginRequired: false, text: '' },
    ]);
    const result = await collectLongMetrics(fixture.page);
    assert.notEqual(result.status, 'success');
    assert.equal(result.coverage.complete, false);
    assert.ok(
      result.errors.some((error) => error.code === item.code),
      item.code,
    );
    if (item.code === 'long_statistics_list_fields_missing') {
      assert.equal(result.records[0]?.wordCount, null);
      assert.equal(result.records[0]?.reportedListReadCount, null);
    }
  }
  const capped = metricsPage([
    { loginRequired: false, text: '' },
    [longMetricListUrl, longMetricCommonUrl],
    longMetricList([longMetricBook('1001')], 2),
    longMetricCommon('1001'),
    { loginRequired: false, text: '' },
  ]);
  assert.equal((await collectLongMetrics(capped.page, { maxPages: 1 })).status, 'partial');
});

test('long metric missing/numeric common strings stay null/partial and wrong-book responses are rejected', async () => {
  const changed = metricsPage([
    { loginRequired: false, text: '' },
    [longMetricListUrl, longMetricCommonUrl],
    longMetricList([longMetricBook('1001')], 1),
    longMetricCommon('1001', {
      reader_uv_daily: 0,
      pursue_read_rate: undefined,
      update_time: 1001,
    }),
    { loginRequired: false, text: '' },
  ]);
  const partial = await collectLongMetrics(changed.page);
  assert.equal(partial.status, 'partial');
  assert.equal(partial.records[0]?.reportedReaderUvDaily, null);
  assert.equal(partial.records[0]?.reportedPursueReadRate, null);
  assert.equal(partial.records[0]?.updateTimeRaw, null);
  const wrong = metricsPage([
    { loginRequired: false, text: '' },
    [longMetricListUrl, longMetricCommonUrl],
    longMetricList([longMetricBook('1001')], 1),
    longMetricCommon('1002'),
    { loginRequired: false, text: '' },
  ]);
  const rejected = await collectLongMetrics(wrong.page);
  assert.equal(rejected.status, 'capability_unavailable');
  assert.equal(rejected.records.length, 0);
  assert.ok(rejected.errors.some((error) => error.code === 'long_statistics_title_mismatch'));
});

test('long metrics validates the complete list before a single target and explicitly fails not found or login expiration', async () => {
  const selected = metricsPage([
    { loginRequired: false, text: '' },
    [longMetricListUrl, longMetricCommonUrl],
    longMetricList([longMetricBook('1001'), longMetricBook('1002')], 2),
    longMetricCommon('1002'),
    { loginRequired: false, text: '' },
  ]);
  const one = await collectLongMetrics(selected.page, { workId: '1002' });
  assert.equal(one.status, 'success');
  assert.equal(one.records.length, 1);
  assert.equal(one.records[0]?.statisticsBookId, '1002');
  assert.equal(one.coverage.totalRecords, 2);
  const absent = metricsPage([
    { loginRequired: false, text: '' },
    [longMetricListUrl],
    longMetricList([longMetricBook('1001')], 1),
  ]);
  const missing = await collectLongMetrics(absent.page, { workId: '1002' });
  assert.equal(missing.status, 'capability_unavailable');
  assert.ok(missing.errors.some((error) => error.code === 'statistics_book_not_found'));
  const expired = metricsPage([
    { loginRequired: false, text: '' },
    [longMetricListUrl, longMetricCommonUrl],
    longMetricList([longMetricBook('1001'), longMetricBook('1002')], 2),
    longMetricCommon('1001'),
    { status: 401, ok: false, json: { message: '未登录' } },
  ]);
  const login = await collectLongMetrics(expired.page);
  assert.equal(login.status, 'login_required');
  assert.equal(login.records.length, 0);
  assert.equal(login.coverage.recordsFetched, 0);
});

test('long metrics empty account is certified only by successful zero total/list and profile override remains explicit', async () => {
  const empty = metricsPage([
    { loginRequired: false, text: '' },
    [longMetricListUrl],
    longMetricList([], 0),
    { loginRequired: false, text: '' },
  ]);
  const result = await collectLongMetrics(empty.page);
  assert.equal(result.status, 'success');
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.totalRecords, 0);
  const override = metricsPage([
    { loginRequired: false, text: '' },
    [],
    {
      rows: [{ statisticsBookId: '1001', custom: 'FIXTURE_RAW' }],
      empty: false,
      hasNext: true,
      nextDisabled: true,
    },
  ]);
  const profile: CollectionEvidenceProfile = {
    sourceUrl: 'https://fanqienovel.com/main/writer/data',
    verifiedAt: '2026-10-03',
    evidence: 'fixture',
    readOnly: true,
    rowSelector: '.verified-row',
    idField: 'statisticsBookId',
    fields: { statisticsBookId: { type: 'identifier' }, custom: { type: 'text' } },
    pagination: { nextSelector: '.next', disabledSelector: '.next.disabled' },
  };
  const custom = await collectLongMetrics(override.page, { profile });
  assert.equal(custom.status, 'success');
  assert.equal(custom.records[0]?.custom, 'FIXTURE_RAW');
  assert.equal('reportedReaderUvDaily' in custom.records[0]!, false);
});

test('API platform update dates/times are parsed only when explicit, with unknown timezone/epochs/future never becoming statistics deadlines', () => {
  const captured = '2026-10-03T02:00:00Z';
  assert.deepEqual(parsePlatformUpdateTime('2026-10-01', captured), {
    platformUpdatedAt: null,
    platformUpdatedDate: '2026-10-01',
    platformUpdateTimeBasis: 'platform-api-update_time;explicit-date;not-statistics-cutoff',
  });
  assert.equal(parsePlatformUpdateTime('2026-10-01 12:30:00', captured).platformUpdatedAt, null);
  assert.equal(
    parsePlatformUpdateTime('2026-10-01 12:30:00', captured).platformUpdatedDate,
    '2026-10-01',
  );
  assert.equal(
    parsePlatformUpdateTime('2026-10-01T12:30:00+08:00', captured).platformUpdatedAt,
    '2026-10-01T04:30:00.000Z',
  );
  for (const raw of [
    '1788672000',
    '10月1日',
    '昨日',
    '2026-02-30',
    '2026-10-04',
    '2026-10-01 24:00:00',
    '2026-10-01T12:30:00+14:30',
    '2026-10-03T12:30:00Z',
    'PRIVATE_RAW_TIME',
  ])
    assert.deepEqual(
      parsePlatformUpdateTime(raw, captured),
      { platformUpdatedAt: null, platformUpdatedDate: null, platformUpdateTimeBasis: null },
      raw,
    );
});

test('long statistics cutoff requires actual visible cutoff text and never comes from a common API update_time', async () => {
  const fixture = metricsPage([
    { loginRequired: false, text: '' },
    [longMetricListUrl, longMetricCommonUrl],
    longMetricList([longMetricBook('1001')], 1),
    longMetricCommon('1001', { update_time: 'PRIVATE_RAW_TIME' }),
    { loginRequired: false, text: '截至2026-10-01 24:00；每天12:00更新' },
  ]);
  const result = await collectLongMetrics(fixture.page);
  assert.equal(result.status, 'success');
  assert.equal(result.statisticsThrough, '2026-10-01');
  assert.equal(result.statisticsThroughBasis, 'platform-visible-cutoff');
  assert.equal(result.records[0]?.updateTimeRaw, 'PRIVATE_RAW_TIME');
  assert.equal(result.records[0]?.platformUpdatedAt, null);
  assert.equal(result.records[0]?.platformUpdatedDate, null);
});

test('all API collectors reject old-request late GET sources and preserve necessary queries from the actual current document', async () => {
  for (const item of apiCollectorCases) {
    const fixture = metricsPage([
      { loginRequired: false, text: '' },
      [],
      item.empty,
      { loginRequired: false, text: '' },
    ]);
    const oldSource = `${item.source}&filter=OLD_SUBSET`;
    const freshSource = `${item.source}&filter=CURRENT_PLATFORM_FILTER&opaque=PRIVATE_NONCE`;
    const oldRequest = { method: () => 'GET', isNavigationRequest: () => false, frame: () => null };
    fixture.page.goto = (async () => {
      fixture.emitEvent('request', oldRequest);
      fixture.emitEvent('framenavigated', null);
      fixture.emitEvent('response', { url: () => oldSource, request: () => oldRequest });
      fixture.emitResponse(freshSource);
      return null;
    }) as Page['goto'];
    const calls: string[] = [];
    const original = fixture.page.evaluate.bind(fixture.page);
    fixture.page.evaluate = (async (...args: unknown[]) => {
      if (typeof args[1] === 'string') calls.push(args[1]);
      return (original as (...args: unknown[]) => Promise<unknown>)(...args);
    }) as Page['evaluate'];
    const result = await item.collect(fixture.page);
    assert.equal(result.status, 'success');
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0]!).searchParams.get('filter'), 'CURRENT_PLATFORM_FILTER');
    assert.equal(new URL(calls[0]!).searchParams.get('opaque'), 'PRIVATE_NONCE');
    assert.equal(
      calls.some((source) => source.includes('OLD_SUBSET')),
      false,
    );
  }
});

test('an unobserved request and a request whose generation was cleared cannot bootstrap any API collector', async () => {
  for (const item of apiCollectorCases) {
    for (const startedBeforeNavigation of [false, true]) {
      const fixture = metricsPage([{ loginRequired: false, text: '' }, []]);
      const request = { method: () => 'GET', isNavigationRequest: () => false, frame: () => null };
      fixture.page.goto = (async () => {
        if (startedBeforeNavigation) fixture.emitEvent('request', request);
        fixture.emitEvent('framenavigated', null);
        fixture.emitEvent('response', {
          url: () => `${item.source}&filter=OLD_SUBSET`,
          request: () => request,
        });
        return null;
      }) as Page['goto'];
      const result = await item.collect(fixture.page);
      assert.equal(result.status, 'capability_unavailable');
      assert.equal(result.coverage.pagesFetched, 0);
      assert.equal(result.records.length, 0);
      assert.equal(fixture.remaining.length, 0);
    }
  }
});
