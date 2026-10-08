import test from 'node:test';

import {
  metricsPage,
  ssr,
  article,
  fakeBrowser,
  deferred,
} from './helpers/platform-reads-metrics-page.js';

import { collectShortMetrics } from '../src/platform/reads.js';

import assert from 'node:assert/strict';

import {
  parseRouterPage,
  parseActivitiesPage,
  type PublicFetch,
  collectPublicActivities,
  collectWriterClasses,
  htmlToText,
} from '../src/platform/public.js';

test('API authentication expiration clears prior records rather than reporting them as current', async () => {
  const { page } = metricsPage([
    { loginRequired: false, text: '' },
    ['https://fanqienovel.com/api/author/sa_stats/book_list/v0/?page_index=0'],
    { ok: false, status: 401, json: { message: '未登录' } },
  ]);
  const result = await collectShortMetrics(page);
  assert.equal(result.status, 'login_required');
  assert.equal(result.records.length, 0);
  assert.equal(result.coverage.complete, false);
});

test('missing metric fields are partial and stay null', async () => {
  const { page } = metricsPage([
    { loginRequired: false, text: '' },
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
    { ok: true, status: 200, json: { code: 0, data: { show_count: 0 } } },
    { loginRequired: false, text: '' },
  ]);
  const result = await collectShortMetrics(page);
  assert.equal(result.status, 'partial');
  assert.equal(result.records[0]?.readCount, null);
  assert.ok(result.errors.some((error) => error.code === 'metric_fields_missing'));
});

test('repeated statistics pages remain partial instead of certifying complete coverage', async () => {
  const row = { book_id: '1001', book_name: '测试作品' };
  const response = { ok: true, status: 200, json: { code: 0, data: { stats_book_list: [row] } } };
  const { page } = metricsPage([
    { loginRequired: false, text: '' },
    [
      'https://fanqienovel.com/api/author/sa_stats/book_list/v0/?page_index=0',
      'https://fanqienovel.com/api/author/sa_stats/single_common/v0/?book_id=1001',
    ],
    response,
    response,
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
  const result = await collectShortMetrics(page);
  assert.equal(result.status, 'partial');
  assert.equal(result.coverage.paginationComplete, false);
  assert.ok(result.errors.some((error) => error.code === 'pagination_not_advancing'));
});

test('SSR data is parsed as JSON without executing scripts and malformed schemas remain unavailable', () => {
  assert.equal(
    parseRouterPage('<script>window._ROUTER_DATA = alert(1);</script>', 'tutorial'),
    null,
  );
  assert.equal(
    parseActivitiesPage(ssr('solicit-activity', { total_count: 1, activity_list: null })),
    null,
  );
  const parsed = parseActivitiesPage(
    ssr('solicit-activity', {
      total_count: 1,
      activity_list: [
        {
          title: '长期活动',
          link: '/writer/zone/article/7600000000000000001',
          introduction: ['官方活动'],
          start_time: '2026-01-01',
          end_time: '2026-01-02',
          is_permanent: true,
        },
      ],
    }),
  );
  assert.equal(parsed?.records[0]?.isPermanent, true);
  assert.equal(parsed?.records[0]?.endTimeRaw, '2026-01-02');
});

test('public activity cardinality mismatch is partial, without cookie headers', async () => {
  const fetchImpl: PublicFetch = async (_url, init) => {
    assert.equal(init?.method, 'GET');
    assert.equal((init?.headers as Record<string, string>).Cookie, undefined);
    return new Response(
      ssr('solicit-activity', {
        total_count: 2,
        activity_list: [
          {
            title: '征文活动',
            link: '/writer/zone/article/7600000000000000001',
            is_permanent: false,
          },
        ],
      }),
    );
  };
  const result = await collectPublicActivities(undefined, { fetchImpl });
  assert.equal(result.status, 'partial');
  assert.equal(result.coverage.complete, false);
  assert.equal(result.statisticsThrough, null);
});

test('classes merge pinned SSR with canonical API by ID and detect total mismatch', async () => {
  const id = '7600000000000000001';
  const urls: string[] = [];
  const fetchImpl: PublicFetch = async (input) => {
    const url = String(input);
    urls.push(url);
    return url.includes('/api/node/tutorial/list')
      ? Response.json({ code: 0, data: { tutorial_list: [article(id, '源标题')] } })
      : new Response(ssr('tutorial', { total_count: 1, tutorial_list: [article(id, '置顶标题')] }));
  };
  const result = await collectWriterClasses(undefined, { fetchImpl, tab: 3 });
  assert.equal(result.status, 'success');
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0]?.title, '源标题');
  assert.ok(urls[0]?.endsWith('?tab=3'));
  assert.ok(urls[1]?.includes('?type=3&page_index=1&page_count=15'));
  const incomplete = await collectWriterClasses(undefined, {
    tab: 3,
    fetchImpl: async (input) =>
      String(input).includes('/api/')
        ? Response.json({ data: { tutorial_list: [] } })
        : new Response(ssr('tutorial', { total_count: 2, tutorial_list: [article(id)] })),
  });
  assert.equal(incomplete.status, 'partial');
  assert.equal(incomplete.coverage.complete, false);
});

test('class API failure keeps the verified SSR subset with incomplete coverage', async () => {
  const result = await collectWriterClasses(undefined, {
    tab: 3,
    fetchImpl: async (input) =>
      String(input).includes('/api/')
        ? new Response('unavailable', { status: 503 })
        : new Response(
            ssr('tutorial', { total_count: 2, tutorial_list: [article('7600000000000000001')] }),
          ),
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.records.length, 1);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.totalRecords, 2);
  assert.equal(result.coverage.pagesFetched, 1);
});

test('article text drops scripts/styles while keeping visible text and Unicode entities', () => {
  assert.equal(
    htmlToText(
      '<style>.x{}</style><p>章节 &amp; 钩子</p><script>alert(1)</script><p>&#x4e2d;&#25991;</p>',
    ),
    '章节 & 钩子\n中文',
  );
});

test('active cancellation closes the page and retains FIFO until the real reader settles', async () => {
  const { session, pages } = fakeBrowser();
  const started = deferred();
  const finish = deferred();
  const controller = new AbortController();
  let nextStarted = false;
  const first = session.withPage(
    async () => {
      started.resolve();
      await finish.promise;
      return 'finished';
    },
    { signal: controller.signal },
  );
  const rejected = assert.rejects(first, { code: 'cancelled' });
  await started.promise;
  const second = session.withPage(async (page) => {
    nextStarted = true;
    return page;
  });
  controller.abort();
  await Promise.resolve();
  assert.equal(pages[0]?.closed, true);
  assert.equal(nextStarted, false);
  finish.resolve();
  await rejected;
  const restored = await second;
  assert.equal(nextStarted, true);
  assert.notEqual(restored, pages[0]);
  assert.equal(restored.isClosed(), false);
});

test('timeout closes the active page before resolving the job failure', async () => {
  const { session, pages } = fakeBrowser();
  const pageClosed = deferred();
  pages[0]!.onClose = () => pageClosed.resolve();
  await assert.rejects(
    session.withPage(
      async () => {
        await pageClosed.promise;
        return 'late';
      },
      { timeoutMs: 5 },
    ),
    { code: 'timeout' },
  );
  assert.equal(pages[0]?.closed, true);
});

test('a cancelled queued browser call never enters its callback or overtakes the active one', async () => {
  const { session, pages } = fakeBrowser();
  const started = deferred();
  const finish = deferred();
  const first = session.withPage(async () => {
    started.resolve();
    await finish.promise;
  });
  await started.promise;
  const controller = new AbortController();
  controller.abort();
  let queuedEntered = false;
  let laterEntered = false;
  const queued = session.withPage(
    async () => {
      queuedEntered = true;
    },
    { signal: controller.signal },
  );
  const rejected = assert.rejects(queued, { code: 'cancelled' });
  const later = session.withPage(async () => {
    laterEntered = true;
  });
  await Promise.resolve();
  assert.equal(pages[0]?.closed, false);
  assert.equal(laterEntered, false);
  finish.resolve();
  await first;
  await rejected;
  await later;
  assert.equal(queuedEntered, false);
  assert.equal(laterEntered, true);
});

test('fresh current-account verification does not accept an old cached identity', async () => {
  const { session, pages, internal } = fakeBrowser();
  internal.identity = {
    accountId: 'old',
    authorId: 'old',
    displayName: 'old',
    evidenceSource: 'stale',
  };
  pages[0]!.evaluations.push({ loginRequired: false, managementVisible: true, ownAccount: null });
  const result = await session.verifyCurrentAccount(pages[0]!);
  assert.equal(result.status, 'unknown');
  assert.equal(result.identity, null);
});
