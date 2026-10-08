import test from 'node:test';

import { fakeBrowser, deferred, ssr, article } from './helpers/platform-reads-metrics-page.js';

import assert from 'node:assert/strict';

import {
  validateDiagnosticSource,
  diagnosticRouteTemplate,
  CANONICAL_OWN_USER_URL,
} from '../src/platform/browser.js';

import {
  type PublicFetch,
  collectPublicActivities,
  collectWriterClasses,
} from '../src/platform/public.js';

import { type Page } from 'playwright';

import { runInNewContext } from 'node:vm';

test('current-account GET replay returns only selected identity and query-free evidence', async () => {
  const { session, pages, internal } = fakeBrowser();
  internal.ownInfoUrls.set(
    pages[0]!,
    new Set(['https://fanqienovel.com/api/author/info/v0/?session_token=PRIVATE_FIXTURE']),
  );
  pages[0]!.evaluations.push(
    { loginRequired: false, managementVisible: false, ownAccount: null },
    {
      ok: true,
      status: 200,
      json: {
        code: 0,
        data: {
          user_id: '1001',
          author_id: '2001',
          nickname: '测试笔名',
          token: 'PRIVATE_FIXTURE',
          cookie: 'PRIVATE_FIXTURE',
        },
      },
    },
  );
  const result = await session.verifyCurrentAccount(pages[0]!);
  assert.equal(result.status, 'authenticated');
  assert.equal(result.identity?.authorId, '2001');
  assert.equal(result.sourceUrl, 'https://fanqienovel.com/api/author/info/v0/');
  assert.equal(JSON.stringify(result).includes('PRIVATE_FIXTURE'), false);
});

test('a current own-account GET takes precedence over an older identity still rendered in the document', async () => {
  const { session, pages, internal } = fakeBrowser();
  internal.ownInfoUrls.set(pages[0]!, new Set(['https://fanqienovel.com/api/author/info/v0/']));
  pages[0]!.evaluations.push(
    {
      loginRequired: false,
      managementVisible: true,
      ownAccount: { user_id: '1001', author_id: '2001' },
    },
    { ok: true, status: 200, json: { code: 0, data: { user_id: '1002', author_id: '2002' } } },
  );
  const result = await session.verifyCurrentAccount(pages[0]!);
  assert.equal(result.status, 'authenticated');
  assert.equal(result.identity?.accountId, '1002');
  assert.equal(result.identity?.authorId, '2002');
});

test('diagnostics refuse new/edit/publish/external routes and undiscovered stable IDs', () => {
  for (const url of [
    'https://evil.test/main/writer/book-manage',
    'https://fanqienovel.com/main/writer/create-book',
    'https://fanqienovel.com/main/writer/publish-short/7600000000000000001',
    'https://fanqienovel.com/main/writer/chapter-manage/7600000000000000001',
  ])
    assert.throws(() => validateDiagnosticSource(url), { code: 'invalid_diagnostic_route' });
  assert.equal(
    validateDiagnosticSource('https://fanqienovel.com/main/writer/book-manage').pathname,
    '/main/writer/book-manage',
  );
  const existing = 'https://fanqienovel.com/main/writer/chapter-manage/7600000000000000001';
  assert.equal(
    validateDiagnosticSource(existing, new Set([existing])).pathname,
    '/main/writer/chapter-manage/7600000000000000001',
  );
  assert.throws(
    () => validateDiagnosticSource('https://fanqienovel.com/main/writer/book-data?token=private'),
    { code: 'invalid_diagnostic_route' },
  );
  assert.equal(
    diagnosticRouteTemplate(`${existing}/7600000000000000002?token=private`),
    'https://fanqienovel.com/main/writer/chapter-manage/{workId}/{chapterId}',
  );
});

test('public abort signal reaches fetch and an interrupted collection remains partial', async () => {
  const controller = new AbortController();
  const started = deferred();
  const fetchImpl: PublicFetch = async (_url, init) => {
    started.resolve();
    return new Promise<Response>((_resolve, reject) =>
      init!.signal!.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      ),
    );
  };
  const collection = collectPublicActivities(undefined, { signal: controller.signal, fetchImpl });
  await started.promise;
  controller.abort();
  const result = await collection;
  assert.equal(result.status, 'partial');
  assert.equal(result.coverage.complete, false);
  assert.ok(result.errors.some((error) => error.code === 'cancelled'));
});

test('one total public deadline aborts a pending API page and preserves the already verified SSR subset', async () => {
  const keepAlive = setTimeout(() => undefined, 100);
  try {
    const fetchImpl: PublicFetch = async (input, init) =>
      String(input).includes('/api/')
        ? new Promise<Response>((_resolve, reject) =>
            init!.signal!.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            ),
          )
        : new Response(
            ssr('tutorial', { total_count: 2, tutorial_list: [article('7600000000000000001')] }),
          );
    const result = await collectWriterClasses(undefined, { tab: 3, timeoutMs: 10, fetchImpl });
    assert.equal(result.status, 'partial');
    assert.equal(result.records.length, 1);
    assert.equal(result.coverage.complete, false);
    assert.ok(result.errors.some((error) => error.code === 'timeout'));
  } finally {
    clearTimeout(keepAlive);
  }
});

test('shutdown closes browser work immediately but drains its real callback before finishing', async () => {
  const { session, pages } = fakeBrowser();
  const started = deferred();
  const finish = deferred();
  const operation = session.withPage(async () => {
    started.resolve();
    await finish.promise;
  });
  const rejected = assert.rejects(operation, { code: 'browser_closed' });
  await started.promise;
  let shutdownFinished = false;
  const shutdown = session.close().then(() => {
    shutdownFinished = true;
  });
  await Promise.resolve();
  assert.equal(pages[0]?.closed, true);
  assert.equal(shutdownFinished, false);
  finish.resolve();
  await rejected;
  await shutdown;
  assert.equal(shutdownFinished, true);
});

test('actual diagnostic callbacks reveal static structure, never values, account identifiers or response secrets', async () => {
  const { session, pages } = fakeBrowser();
  const page = pages[0]!;
  const workId = '7600000000000000001';
  const fullTitle = 'PRIVATE_FULL_TITLE';
  const fullBody = 'PRIVATE_FULL_BODY';
  const owner = 'PRIVATE_ACCOUNT_NAME';
  const token = 'PRIVATE_TOKEN';
  const element = (
    tagName: string,
    attributes: Record<string, string>,
    textContent = '',
    extra: Record<string, unknown> = {},
  ) => ({
    tagName,
    textContent,
    getAttribute: (name: string) => attributes[name] ?? null,
    ...extra,
  });
  const input = element(
    'INPUT',
    {
      class: 'chapter-title',
      type: 'text',
      placeholder: '请输入章节标题',
      'aria-label': fullTitle,
    },
    '',
    { value: fullTitle },
  );
  const textarea = element('TEXTAREA', { id: 'editor', class: 'chapter-body' }, fullBody, {
    value: fullBody,
  });
  const anchor = element('A', { class: 'article-item-title' }, fullTitle, {
    href: `https://fanqienovel.com/main/writer/preview-short/${workId}`,
  });
  const create = element('A', {}, '新建作品', {
    href: 'https://fanqienovel.com/main/writer/create-book',
  });
  const controls = [
    element('BUTTON', { class: 'arco-btn' }, '存草稿'),
    input,
    textarea,
    anchor,
    create,
    element('BUTTON', { id: `owner-${owner}` }, owner),
  ];
  let currentUrl = 'https://fanqienovel.com/main/writer/short-manage';
  const responseListeners: Array<(response: unknown) => void> = [];
  page.on = ((event: string, listener: (response: unknown) => void) => {
    if (event === 'response') responseListeners.push(listener);
    return page;
  }) as typeof page.on;
  page.off = ((event: string, listener: (response: unknown) => void) => {
    if (event === 'response') {
      const index = responseListeners.indexOf(listener);
      if (index >= 0) responseListeners.splice(index, 1);
    }
    return page;
  }) as typeof page.off;
  page.url = () => currentUrl;
  page.goto = (async (url: string) => {
    currentUrl = url;
    const response = (method: string, resourceType: string, source: string) => ({
      url: () => source,
      status: () => 200,
      request: () => ({ method: () => method, resourceType: () => resourceType }),
    });
    for (const listener of responseListeners) {
      listener(
        response('GET', 'xhr', `https://fanqienovel.com/api/author/book_list/v0/?token=${token}`),
      );
      listener(response('POST', 'xhr', 'https://fanqienovel.com/api/author/create/v0/'));
      listener(response('GET', 'script', 'https://fanqienovel.com/assets/app.js'));
    }
    return null;
  }) as Page['goto'];
  page.waitForLoadState = async () => undefined;
  page.evaluate = (async (callback: unknown, arg: unknown) => {
    assert.equal(typeof callback, 'function');
    const source = String(callback);
    const production = new URL('./platform-reads.test.ts', import.meta.url).href.endsWith('.js');
    if (production)
      assert.equal(
        source.includes('__name'),
        false,
        'Production browser callbacks must serialize without a transpiler helper',
      );
    return runInNewContext(`(${source})(arg)`, {
      arg,
      document: {
        body: { innerText: `作品管理 ${owner} ${fullBody}` },
        querySelector: () => anchor,
        querySelectorAll: (selector: string) =>
          selector === 'a[href]' ? [anchor, create] : controls,
      },
      window: {
        _ROUTER_DATA: {
          loaderData: {
            ownRoute: {
              userInfo: { user_id: '1001', author_id: '2001', nickname: owner, cookie: token },
            },
          },
        },
      },
      location: { pathname: new URL(currentUrl).pathname },
      fetch: async (source: string) => {
        assert.equal(source, CANONICAL_OWN_USER_URL);
        return {
          status: 200,
          ok: true,
          json: async () => ({ code: 0, data: { id: '1001', name: owner } }),
        };
      },
      ...(production ? {} : { __name: (value: unknown) => value }),
    });
  }) as Page['evaluate'];
  const result = await session.diagnoseReadPage('https://fanqienovel.com/main/writer/short-manage');
  assert.equal(result.status, 'success');
  assert.equal(result.identityObserved.accountId, true);
  const serialized = JSON.stringify(result);
  for (const secret of [fullTitle, fullBody, owner, token, workId, '1001', '2001'])
    assert.equal(
      serialized.includes(secret),
      false,
      `Diagnostic leaked a fixture secret: ${secret}`,
    );
  assert.equal(
    result.elements.find((record) => record.tag === 'input')?.attributes.placeholder,
    '请输入章节标题',
  );
  assert.equal(result.elements[0]?.label, '存草稿');
  assert.equal(result.links.length, 1);
  assert.equal(
    result.links[0]?.routeTemplate,
    'https://fanqienovel.com/main/writer/preview-short/{workId}',
  );
  assert.deepEqual(result.getResponses, [
    { pathTemplate: '/api/author/book_list/v0/', status: 200, resourceType: 'xhr' },
  ]);
  const followed = await session.diagnoseReadPage(`diagnostic:${result.links[0]!.targetRef}`);
  assert.equal(followed.status, 'success');
  assert.equal(followed.sourceUrl, 'https://fanqienovel.com/main/writer/preview-short/{workId}');
});
