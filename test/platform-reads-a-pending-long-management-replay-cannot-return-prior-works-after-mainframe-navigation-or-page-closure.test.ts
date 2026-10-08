import test from 'node:test';

import { metricsPage, deferred } from './helpers/platform-reads-metrics-page.js';

import {
  longLoadedUrl,
  longApi,
  longFixture,
  longMetricListUrl,
  longMetricCommonUrl,
  longMetricList,
  longMetricBook,
  longMetricCommon,
  apiCollectorCases,
} from './helpers/platform-reads-fake-qr-browser.js';

import { type Page } from 'playwright';

import {
  collectLongWorks,
  collectShortMetrics,
  collectLongMetrics,
} from '../src/platform/reads.js';

import assert from 'node:assert/strict';

test('a pending long-management replay cannot return prior works after mainframe navigation or page closure', async () => {
  for (const change of ['navigation', 'close'] as const) {
    const fixture = metricsPage([
      { loginRequired: false, text: '' },
      [longLoadedUrl],
      longApi([longFixture('1001')], 2),
    ]);
    const pending = deferred<unknown>();
    const started = deferred();
    const original = fixture.page.evaluate.bind(fixture.page);
    let evaluations = 0;
    let closed = false;
    fixture.page.isClosed = () => closed;
    fixture.page.evaluate = (async (...args: unknown[]) => {
      if (++evaluations === 3) {
        started.resolve();
        return pending.promise;
      }
      return (original as (...args: unknown[]) => Promise<unknown>)(...args);
    }) as Page['evaluate'];
    const operation = collectLongWorks(fixture.page);
    await started.promise;
    if (change === 'navigation') fixture.emitEvent('framenavigated', null);
    else closed = true;
    pending.resolve(longApi([longFixture('1002')], 2));
    const result = await operation;
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.records.length, 0);
    assert.equal(result.coverage.totalRecords, null);
    assert.equal(result.coverage.complete, false);
    assert.equal(evaluations, 3);
    assert.ok(result.errors.some((error) => error.code === 'read_document_changed'));
  }
});

test('short and long metric detail replay across navigation clears all previously read records and cutoff metadata', async () => {
  const cases = [
    {
      collect: collectShortMetrics,
      list: 'https://fanqienovel.com/api/author/sa_stats/book_list/v0/?page_index=0',
      common: 'https://fanqienovel.com/api/author/sa_stats/single_common/v0/?book_id=1001',
      page: {
        status: 200,
        ok: true,
        json: {
          code: 0,
          data: {
            stats_book_list: [
              { book_id: '1001', book_name: 'FIXTURE_ONE' },
              { book_id: '1002', book_name: 'FIXTURE_TWO' },
            ],
          },
        },
      },
      empty: { status: 200, ok: true, json: { code: 0, data: { stats_book_list: [] } } },
      first: {
        status: 200,
        ok: true,
        json: {
          code: 0,
          data: {
            read_count: 1,
            show_count: 1,
            click_rate: '100%',
            comment_count: 0,
            digg_count: 0,
            shelf_count: 0,
          },
        },
      },
    },
    {
      collect: collectLongMetrics,
      list: longMetricListUrl,
      common: longMetricCommonUrl,
      page: longMetricList([longMetricBook('1001'), longMetricBook('1002')], 2),
      empty: longMetricList([], 2),
      first: longMetricCommon('1001'),
    },
  ];
  for (const item of cases) {
    const fixture = metricsPage([
      { loginRequired: false, text: '截至2026-10-01 24:00' },
      [item.list, item.common],
      item.page,
      ...(item.collect === collectLongMetrics ? [] : [item.empty]),
      item.first,
    ]);
    const pendingEvaluation = item.collect === collectLongMetrics ? 4 : 5;
    const pending = deferred<unknown>();
    const started = deferred();
    const original = fixture.page.evaluate.bind(fixture.page);
    let evaluations = 0;
    fixture.page.evaluate = (async (...args: unknown[]) => {
      if (++evaluations === pendingEvaluation) {
        started.resolve();
        return pending.promise;
      }
      return (original as (...args: unknown[]) => Promise<unknown>)(...args);
    }) as Page['evaluate'];
    const operation = item.collect(fixture.page);
    await started.promise;
    fixture.emitEvent('framenavigated', null);
    pending.resolve(item.first);
    const result = await operation;
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.records.length, 0);
    assert.equal(result.coverage.recordsFetched, 0);
    assert.equal(result.statisticsThrough, null);
    assert.equal(result.statisticsThroughBasis, null);
    assert.equal(result.statisticsCutoffRaw, null);
    assert.equal(evaluations, pendingEvaluation);
    assert.ok(result.errors.some((error) => error.code === 'read_document_changed'));
  }
});

test('child-frame navigation cannot clear the current mainframe source generation', async () => {
  for (const item of apiCollectorCases) {
    const fixture = metricsPage([
      { loginRequired: false, text: '' },
      [item.source],
      item.empty,
      { loginRequired: false, text: '' },
    ]);
    const original = fixture.page.evaluate.bind(fixture.page);
    let calls = 0;
    fixture.page.evaluate = (async (...args: unknown[]) => {
      if (++calls === 1) fixture.emitEvent('framenavigated', { childFrame: true });
      return (original as (...args: unknown[]) => Promise<unknown>)(...args);
    }) as Page['evaluate'];
    assert.equal((await item.collect(fixture.page)).status, 'success');
  }
});

test('navigation during bootstrap discovery is an explicit stale-document failure instead of new-page source mixing', async () => {
  for (const item of apiCollectorCases) {
    const fixture = metricsPage([{ loginRequired: false, text: '' }, []]);
    fixture.page.waitForResponse = (async () => {
      fixture.emitEvent('framenavigated', null);
      return fixture.emitResponse(item.source);
    }) as Page['waitForResponse'];
    const result = await item.collect(fixture.page);
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.records.length, 0);
    assert.equal(result.coverage.pagesFetched, 0);
    assert.ok(result.errors.some((error) => error.code === 'read_document_changed'));
  }
});

test('bootstrap history query normalization retains GETs started in the current document before or after source discovery', async () => {
  for (const item of apiCollectorCases) {
    for (const duringDiscovery of [false, true]) {
      const fixture = metricsPage([
        { loginRequired: false, text: '' },
        duringDiscovery ? [] : [item.source],
        item.empty,
        { loginRequired: false, text: '' },
      ]);
      const normalizeQuery = () => {
        const url = new URL(fixture.page.url());
        url.searchParams.set('bookId', '1001');
        fixture.setUrl(url.toString());
        fixture.emitEvent('framenavigated', null);
      };
      if (duringDiscovery) {
        fixture.page.waitForResponse = (async (predicate: (response: unknown) => boolean) => {
          const request = {
            method: () => 'GET',
            isNavigationRequest: () => false,
            frame: () => null,
          };
          fixture.emitEvent('request', request);
          normalizeQuery();
          const response = { url: () => item.source, request: () => request };
          fixture.emitEvent('response', response);
          assert.equal(predicate(response), true);
          return response;
        }) as unknown as Page['waitForResponse'];
      } else
        fixture.page.waitForLoadState = (async () => {
          normalizeQuery();
        }) as Page['waitForLoadState'];
      const result = await item.collect(fixture.page);
      assert.equal(result.status, 'success');
      assert.equal(result.coverage.pagesFetched, 1);
      assert.equal(fixture.remaining.length, 0);
    }
  }
  // Both list and common evidence survive the data page's initial selected-book query.
  const long = metricsPage([
    { loginRequired: false, text: '' },
    [longMetricListUrl, longMetricCommonUrl],
    longMetricList([longMetricBook('1001')], 1),
    longMetricCommon('1001'),
    { loginRequired: false, text: '' },
  ]);
  long.page.waitForLoadState = (async () => {
    long.setUrl('https://fanqienovel.com/main/writer/data?bookId=1001');
    long.emitEvent('framenavigated', null);
  }) as Page['waitForLoadState'];
  const result = await collectLongMetrics(long.page);
  assert.equal(result.status, 'success');
  assert.equal(result.records.length, 1);
});

test('after the first replay begins even a same-document query change invalidates each collector', async () => {
  for (const item of apiCollectorCases) {
    const fixture = metricsPage([
      { loginRequired: false, text: '截至2026-10-01 24:00' },
      [item.source],
    ]);
    const pending = deferred<unknown>();
    const started = deferred();
    const original = fixture.page.evaluate.bind(fixture.page);
    let evaluations = 0;
    fixture.page.evaluate = (async (...args: unknown[]) => {
      if (++evaluations === 2) {
        started.resolve();
        return pending.promise;
      }
      return (original as (...args: unknown[]) => Promise<unknown>)(...args);
    }) as Page['evaluate'];
    const operation = item.collect(fixture.page);
    await started.promise;
    const url = new URL(fixture.page.url());
    url.searchParams.set('bookId', '1002');
    fixture.setUrl(url.toString());
    fixture.emitEvent('framenavigated', null);
    pending.resolve(item.empty);
    const result = await operation;
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.coverage.pagesFetched, 0);
    assert.equal(result.records.length, 0);
    assert.equal(result.statisticsThrough, null);
    assert.equal(evaluations, 2);
    assert.ok(result.errors.some((error) => error.code === 'read_document_changed'));
  }
});

test('a real same-URL document reload cannot retain a bootstrap source or adopt its late response', async () => {
  for (const item of apiCollectorCases) {
    const fixture = metricsPage([{ loginRequired: false, text: '' }, [item.source]]);
    fixture.page.waitForLoadState = (async () => {
      const oldRequest = {
        method: () => 'GET',
        isNavigationRequest: () => false,
        frame: () => null,
      };
      fixture.emitEvent('request', oldRequest);
      fixture.emitEvent('request', {
        method: () => 'GET',
        isNavigationRequest: () => true,
        frame: () => null,
      });
      fixture.emitEvent('response', { url: () => item.source, request: () => oldRequest });
      fixture.emitEvent('framenavigated', null);
      fixture.emitEvent('response', { url: () => item.source, request: () => oldRequest });
    }) as Page['waitForLoadState'];
    const result = await item.collect(fixture.page);
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.coverage.pagesFetched, 0);
    assert.equal(result.records.length, 0);
    assert.equal(fixture.remaining.length, 0);
  }
});

test('a mainframe document navigation request invalidates a frozen read before its commit', async () => {
  for (const item of apiCollectorCases) {
    const fixture = metricsPage([{ loginRequired: false, text: '' }, [item.source]]);
    const pending = deferred<unknown>();
    const started = deferred();
    const original = fixture.page.evaluate.bind(fixture.page);
    let evaluations = 0;
    fixture.page.evaluate = (async (...args: unknown[]) => {
      if (++evaluations === 2) {
        started.resolve();
        return pending.promise;
      }
      return (original as (...args: unknown[]) => Promise<unknown>)(...args);
    }) as Page['evaluate'];
    const operation = item.collect(fixture.page);
    await started.promise;
    fixture.emitEvent('request', {
      method: () => 'GET',
      isNavigationRequest: () => true,
      frame: () => null,
    });
    pending.resolve(item.empty);
    const result = await operation;
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.records.length, 0);
    assert.equal(result.coverage.pagesFetched, 0);
    assert.ok(result.errors.some((error) => error.code === 'read_document_changed'));
  }
});
