import test from 'node:test';

import assert from 'node:assert/strict';

import {
  shortMetadataApiListUrl,
  safeShortMetadataApiResult,
} from '../src/platform/short-metadata-api-schema.js';

import {
  metadataApiSchema_fixture,
  metadataApiSchema_WORK,
} from './helpers/platform-reads-metadata-api-schema-api-schema-deferred.js';

import { metricsPage } from './helpers/platform-reads-metrics-page.js';

import {
  longMetricListUrl,
  longMetricCommonUrl,
  longMetricList,
  longMetricBook,
  longMetricCommon,
} from './helpers/platform-reads-fake-qr-browser.js';

import {
  collectShortMetrics,
  collectLongMetrics,
  makeDataset,
  projectMetricTimeContext,
  parseVisibleStatistics,
} from '../src/platform/reads.js';

test('short metadata API schema: fixed descriptor and whole SAFE projection reject inconsistent types/counts and fabricated browser proof', async () => {
  for (const index of [-1, 10, 0.5, NaN]) assert.throws(() => shortMetadataApiListUrl(index));
  const f = metadataApiSchema_fixture();
  try {
    const result = await f.call();
    for (const mutate of [
      (x: any) => {
        x.fields[1].present = false;
      },
      (x: any) => {
        x.fields[1].arrayCount = 1;
      },
      (x: any) => {
        x.fields[2].arrayCount = null;
      },
      (x: any) => {
        x.fields[0].categorySamples = [];
      },
      (x: any) => {
        x.list.pagesRead = 1;
      },
      (x: any) => {
        x.proof.atomicRevision = true;
      },
      (x: any) => {
        x.fields[0].type = 'PRIVATE';
      },
    ]) {
      const raw = structuredClone(result);
      mutate(raw);
      assert.throws(() => safeShortMetadataApiResult(raw));
    }
    assert.deepEqual(
      safeShortMetadataApiResult({
        ...result,
        rootCommitted: true,
        naturalResponse: 'PRIVATE',
        target: metadataApiSchema_WORK,
      }),
      result,
    );
  } finally {
    await f.close();
  }
});

test('F03 metrics time context: zero values and reported text keep cutoff separate from unknown window and timezone', async () => {
  const short = metricsPage([
    { loginRequired: false, text: '截止至2026-10-01 24:00；每天12:00更新' },
    [
      'https://fanqienovel.com/api/author/sa_stats/book_list/v0/?page_index=0',
      'https://fanqienovel.com/api/author/sa_stats/single_common/v0/?book_id=1001',
    ],
    {
      ok: true,
      status: 200,
      json: { code: 0, data: { stats_book_list: [{ book_id: '1001', book_name: 'Synthetic' }] } },
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
  const long = metricsPage([
    { loginRequired: false, text: '每天12:00更新' },
    [longMetricListUrl, longMetricCommonUrl],
    longMetricList([longMetricBook('1001')], 1),
    longMetricCommon('1001', {
      reader_uv_daily: '--',
      pursue_read_rate: '未知',
      update_time: '2026-10-01T12:30:00+08:00',
    }),
    { loginRequired: false, text: '' },
  ]);
  const a = await collectShortMetrics(short.page),
    b = await collectLongMetrics(long.page);
  assert.equal(a.status, 'success');
  assert.equal(a.records[0]?.showCount, 0);
  assert.equal(a.records[0]?.reportedClickRate, '0%');
  assert.equal(a.statisticsThrough, '2026-10-01');
  assert.equal(b.status, 'success');
  assert.equal(b.records[0]?.reportedReaderUvDaily, '--');
  assert.equal(b.records[0]?.reportedPursueReadRate, '未知');
  assert.equal(b.statisticsThrough, null);
  assert.equal(b.records[0]?.platformUpdatedAt, '2026-10-01T04:30:00.000Z');
  for (const result of [a, b]) {
    assert.deepEqual(result.statisticsWindow, {
      status: 'unknown',
      start: null,
      end: null,
      reason: 'platform_window_unverified',
    });
    assert.deepEqual(result.statisticsTimezone, {
      status: 'unknown',
      value: null,
      reason: 'platform_statistics_timezone_unverified',
    });
    assert(result.limitations.some((value) => value.startsWith('统计窗口未知：')));
    assert(result.limitations.some((value) => value.startsWith('统计时区未知：')));
  }
  assert.equal(makeDataset('short_works', null).statisticsWindow, undefined);
});

test('F03 metrics time context: login, missing source, partial and empty paths retain both unknown reasons', async () => {
  const login = await collectShortMetrics(metricsPage([{ loginRequired: true, text: '' }]).page);
  const unavailable = await collectShortMetrics(
    metricsPage([{ loginRequired: false, text: '' }, []]).page,
  );
  const empty = await collectLongMetrics(
    metricsPage([
      { loginRequired: false, text: '' },
      [longMetricListUrl],
      longMetricList([], 0),
      { loginRequired: false, text: '' },
    ]).page,
  );
  const partial = await collectLongMetrics(
    metricsPage([
      { loginRequired: false, text: '' },
      [longMetricListUrl, longMetricCommonUrl],
      longMetricList([longMetricBook('1001')], 1),
      longMetricCommon('1001', { reader_uv_daily: 0 }),
      { loginRequired: false, text: '' },
    ]).page,
  );
  assert.equal(login.status, 'login_required');
  assert.equal(unavailable.status, 'capability_unavailable');
  assert.equal(empty.status, 'success');
  assert.equal(partial.status, 'partial');
  assert.equal(partial.records[0]?.reportedReaderUvDaily, null);
  for (const result of [login, unavailable, empty, partial]) {
    assert.equal(result.statisticsWindow?.reason, 'platform_window_unverified');
    assert.equal(result.statisticsTimezone?.reason, 'platform_statistics_timezone_unverified');
    assert.equal(projectMetricTimeContext(result, false).statisticsWindow.status, 'unknown');
  }
});

test('F03 metrics time context: new fields cannot be supplied by legacy compatibility or inferred known objects', () => {
  const valid = makeDataset('short_metrics', null);
  const legacy = { ...valid } as Record<string, unknown>;
  delete legacy.statisticsWindow;
  delete legacy.statisticsTimezone;
  assert.throws(() => projectMetricTimeContext(legacy, false), {
    code: 'metric_time_context_unverified',
  });
  const getter = Object.defineProperty({ ...valid }, 'statisticsWindow', {
    get() {
      throw Error('Must not execute accessor');
    },
    enumerable: true,
  });
  const invalid = [
    getter,
    { ...valid, statisticsTimezone: undefined },
    { ...valid, statisticsWindow: { ...valid.statisticsWindow, status: 'known' } },
    { ...valid, statisticsWindow: { ...valid.statisticsWindow, start: '2026-10-01' } },
    { ...valid, statisticsTimezone: { ...valid.statisticsTimezone, value: 'Asia/Shanghai' } },
    {
      ...valid,
      statisticsWindow: { ...valid.statisticsWindow, reason: 'legacy_window_not_recorded' },
    },
    { ...valid, statisticsTimezone: { ...valid.statisticsTimezone, extra: true } },
  ];
  for (const candidate of invalid)
    assert.throws(() => projectMetricTimeContext(candidate, true), {
      code: 'metric_time_context_unverified',
      message: 'Statistics time context is unavailable.',
    });
});

// F03 cutoff facts: public source-only contract; no platform or runtime fixtures.
test('F03 cutoff facts: missing years remain unknown across New Year, leap days and capture offsets', () => {
  const captures = [
    '2027-01-01T00:10:00+14:00',
    '2026-12-31T23:50:00-12:00',
    '2026-03-01T00:00:00Z',
    '2024-03-01T00:00:00Z',
    'invalid-capture',
  ];
  for (const capturedAt of captures)
    for (const raw of ['截至12-31 24:00', '截止至02-29 24:00', '截至01-01 23:59']) {
      const facts = parseVisibleStatistics(`${raw}；每天12:00更新`, capturedAt);
      assert.deepEqual(facts, {
        statisticsThrough: null,
        statisticsThroughBasis: 'platform-visible-month-day;year-not-provided',
        statisticsCutoffRaw: raw,
        platformUpdateSchedule: '每天12:00更新',
      });
    }
  for (const raw of ['截至02-30 24:00', '截至13-01 24:00', '截至04-31 24:00']) {
    const facts = parseVisibleStatistics(raw, '2026-10-06T00:00:00Z');
    assert.equal(facts.statisticsThrough, null);
    assert.equal(facts.statisticsThroughBasis, null);
    assert.equal(facts.statisticsCutoffRaw, raw);
  }
});

test('F03 cutoff facts: explicit valid years retain the platform date and future or invalid dates stay unknown', () => {
  assert.equal(
    parseVisibleStatistics('截至2024-02-29 24:00', '2026-10-06T00:00:00Z').statisticsThrough,
    '2024-02-29',
  );
  assert.equal(
    parseVisibleStatistics('截至2026-10-06 24:00', '2026-10-05T16:01:00Z').statisticsThrough,
    '2026-10-06',
  );
  for (const raw of ['截至2026-02-29 24:00', '截至2026-10-07 24:00', '截至1999-12-31 24:00']) {
    const facts = parseVisibleStatistics(`${raw}；每天12:00更新`, '2026-10-06T00:00:00Z');
    assert.equal(facts.statisticsThrough, null);
    assert.equal(facts.statisticsThroughBasis, null);
    assert.equal(facts.statisticsCutoffRaw, raw);
    assert.equal(facts.platformUpdateSchedule, '每天12:00更新');
  }
});

test('F03 cutoff facts: legacy inferred dates project without mutating records, raw facts or existing time context', () => {
  for (const recordedContext of [false, true]) {
    const source = {
      ...makeDataset('short_metrics', null),
      statisticsThrough: '2026-09-29',
      statisticsThroughBasis: 'platform-visible-month-day;year-resolved-against-capture-date',
      statisticsCutoffRaw: '截止至09-29 24:00',
      platformUpdateSchedule: '每天12:00更新',
      records: [{ readCount: 0, showCount: 0 }],
    };
    if (!recordedContext) {
      delete source.statisticsWindow;
      delete source.statisticsTimezone;
    }
    const before = structuredClone(source),
      projected = projectMetricTimeContext(source, true),
      repeated = projectMetricTimeContext(projected, true);
    assert.deepEqual(source, before);
    assert.strictEqual(projected.records, source.records);
    assert.equal(projected.statisticsThrough, null);
    assert.equal(
      projected.statisticsThroughBasis,
      'platform-visible-month-day;year-not-provided;legacy-inferred-year-discarded',
    );
    assert.equal(projected.statisticsCutoffRaw, source.statisticsCutoffRaw);
    assert.equal(projected.platformUpdateSchedule, source.platformUpdateSchedule);
    assert.equal(projected.capturedAt, source.capturedAt);
    assert.equal(
      projected.statisticsWindow.reason,
      recordedContext ? 'platform_window_unverified' : 'legacy_window_not_recorded',
    );
    assert.deepEqual(repeated, projected);
    assert.equal(
      projected.limitations.filter((value) => value.startsWith('统计截止年份未知：')).length,
      1,
    );
    assert.equal(
      projected.limitations.filter((value) => value.startsWith('历史截止推断已隔离：')).length,
      1,
    );
    assert.throws(() => projectMetricTimeContext(source, false), {
      code: 'metric_time_context_unverified',
    });
  }
});
