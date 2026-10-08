import test from 'node:test';

import assert from 'node:assert/strict';

import {
  isReadSchemaSource,
  projectReadResponseFields,
  collectLongWorks,
} from '../src/platform/reads.js';

import {
  identityEvents,
  readDiagnosticFixture,
  longLoadedUrl,
  longApi,
  longFixture,
} from './helpers/platform-reads-fake-qr-browser.js';

import { deferred, fakeBrowser, metricsPage } from './helpers/platform-reads-metrics-page.js';

import { type Page } from 'playwright';

import { CANONICAL_OWN_USER_URL } from '../src/platform/browser.js';

test('read response schema is restricted to observed source paths and emits fixed array-item field types without values', () => {
  for (const raw of [
    'https://fanqienovel.com/api/author/book/book_list/v0/?page_count=10&page_index=0',
    'https://fanqienovel.com/api/author/homepage/book_list/v0/',
    'https://fanqienovel.com/api/author/sa_stats/single_common/v0/?book_id=1001',
  ])
    assert.equal(isReadSchemaSource(raw), true);
  for (const raw of [
    'https://evil.example/api/author/book/book_list/v0/',
    'https://fanqienovel.com/api/author/book/create/v0/',
    'https://fanqienovel.com/api/author/unknown/list/v0/',
    'https://token:secret@fanqienovel.com/api/author/book/book_list/v0/',
  ])
    assert.equal(isReadSchemaSource(raw), false);
  const row = Object.defineProperty(
    {
      book_id: 'PRIVATE_WORK_ID',
      book_name: 'PRIVATE_TITLE',
      word_number: 1,
      chapter_count: 2,
      status: 0,
    },
    'body',
    {
      enumerable: true,
      get() {
        throw new Error('Body must not be visited');
      },
    },
  );
  const result = projectReadResponseFields({
    code: 0,
    data: {
      book_list: [row],
      total_count: 1,
      has_more: false,
      next_cursor: 'PRIVATE_CURSOR',
      PRIVATE_DYNAMIC_TITLE: 'PRIVATE_VALUE',
      12345: 'PRIVATE_VALUE',
    },
  });
  assert.ok(
    result.fields.some(
      (field) => field.path === 'data.book_list[].book_id' && field.type === 'string',
    ),
  );
  assert.ok(
    result.fields.some(
      (field) => field.path === 'data.book_list[].book_name' && field.type === 'string',
    ),
  );
  assert.ok(
    result.fields.some(
      (field) => field.path === 'data.book_list[].word_number' && field.type === 'number',
    ),
  );
  assert.ok(
    result.fields.some((field) => field.path === 'data.total_count' && field.type === 'number'),
  );
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
  assert.equal(JSON.stringify(result).includes('12345'), false);
  assert.equal(JSON.stringify(result).includes('body'), false);
});

test('read response schemas from old-document late JSON cannot populate the new document', async () => {
  const fixture = identityEvents();
  const pending = deferred<unknown>();
  const request = {
    ...fixture.request(),
    url: () => 'https://fanqienovel.com/api/author/book/book_list/v0/?page_index=0&page_count=10',
  };
  fixture.events.get('request')!(request);
  fixture.events.get('response')!(fixture.response(request, () => pending.promise));
  fixture.events.get('framenavigated')!(null);
  pending.resolve({
    code: 0,
    data: { book_list: [{ book_id: 'PRIVATE_WORK_ID', book_name: 'PRIVATE_TITLE' }] },
  });
  await Promise.resolve();
  await Promise.resolve();
  const cache = (
    fixture.session as unknown as { pageReadStructures: WeakMap<Page, Map<string, unknown>> }
  ).pageReadStructures;
  assert.equal(cache.get(fixture.pages[0]!)?.size, 0);
});

test('read diagnostics retain safe metadata while unknown identity returns capability_unavailable', async () => {
  const fixture = readDiagnosticFixture(true);
  const result = await fixture.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/short-data?tab=2',
  );
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.identityObserved.accountId, false);
  assert.equal(result.elements[0]?.attributes.id, 'app');
  assert.deepEqual(result.readResponseStructure, []);
  assert.ok(result.limitations.some((limitation) => limitation.includes('No stable own-account')));
});

test('an unhydrated blank writer shell cannot be reported as success or as an empty dataset even with router ID', async () => {
  const fixture = readDiagnosticFixture(false, true);
  const result = await fixture.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-data',
  );
  assert.equal(result.status, 'capability_unavailable');
  assert.ok(result.limitations.some((limitation) => limitation.includes('blank shell')));
});

test('read diagnostics freshly verify the confirmed canonical own GET after hydration even when the document cache is empty', async () => {
  const fixture = readDiagnosticFixture(true);
  let waits = 0;
  let freshReads = 0;
  fixture.page.waitForResponse = (async (predicate: unknown) => {
    waits += 1;
    const source = 'https://fanqienovel.com/api/user/info/v2';
    const response = {
      url: () => source,
      ok: () => true,
      request: () => ({ method: () => 'GET' }),
    };
    assert.equal((predicate as (response: unknown) => boolean)(response), true);
    fixture.internal.ownInfoUrls.set(fixture.page, new Set([source]));
    return response;
  }) as Page['waitForResponse'];
  const original = fixture.page.evaluate.bind(fixture.page);
  fixture.page.evaluate = (async (...args: unknown[]) => {
    if (typeof args[1] === 'string') {
      freshReads += 1;
      return {
        status: 200,
        ok: true,
        json: { code: 0, data: { id: '1001', name: 'PRIVATE_OWNER' } },
      };
    }
    return (original as (...args: unknown[]) => Promise<unknown>)(...args);
  }) as Page['evaluate'];
  const result = await fixture.session.diagnoseReadPage(
    'https://fanqienovel.com/main/writer/book-manage',
  );
  assert.equal(waits, 0);
  assert.equal(freshReads, 1);
  assert.equal(result.status, 'success');
  assert.equal(result.identityObserved.accountId, true);
  assert.equal(JSON.stringify(result).includes('PRIVATE_OWNER'), false);
});

test('confirmed canonical own GET authenticates a current writer document with no observer cache and no query replay', async () => {
  const fixture = identityEvents();
  const urls: string[] = [];
  fixture.pages[0]!.evaluate = (async (_callback: unknown, arg: unknown) => {
    if (typeof arg !== 'string') return fixture.neutral;
    urls.push(arg);
    return {
      status: 200,
      ok: true,
      json: { code: 0, data: { id: '7680000000000000001', name: 'PRIVATE_OWNER' } },
    };
  }) as Page['evaluate'];
  const result = await fixture.session.verifyCurrentAccount(fixture.pages[0]!);
  assert.equal(result.status, 'authenticated');
  assert.equal(result.identity?.accountId, '7680000000000000001');
  assert.deepEqual(urls, [CANONICAL_OWN_USER_URL]);
});

test('canonical identity GET crossing navigation remains unknown and cannot restore old stable ID', async () => {
  const fixture = identityEvents();
  const pending = deferred<unknown>();
  const started = deferred();
  fixture.pages[0]!.evaluate = (async (_callback: unknown, arg: unknown) => {
    if (typeof arg !== 'string') return fixture.neutral;
    assert.equal(arg, CANONICAL_OWN_USER_URL);
    started.resolve();
    return pending.promise;
  }) as Page['evaluate'];
  const operation = fixture.session.verifyCurrentAccount(fixture.pages[0]!);
  await started.promise;
  fixture.events.get('framenavigated')!(null);
  pending.resolve({
    status: 200,
    ok: true,
    json: { code: 0, data: { id: '1001', name: 'PRIVATE_OWNER' } },
  });
  const result = await operation;
  assert.equal(result.status, 'unknown');
  assert.equal(result.identity, null);
  assert.equal(fixture.sessionInternal.identity, null);
});

test('canonical identity is not queried on external pages, closed pages or visible login-required pages', async () => {
  const external = fakeBrowser();
  external.pages[0]!.url = () => 'https://external.example/main/writer/';
  external.pages[0]!.evaluate = (async () => {
    throw new Error('External page must not be read or fetched');
  }) as Page['evaluate'];
  assert.equal((await external.session.verifyCurrentAccount(external.pages[0]!)).status, 'unknown');
  await external.pages[0]!.close();
  await assert.rejects(external.session.verifyCurrentAccount(external.pages[0]!), {
    code: 'invalid_browser_page',
  });
  const required = fakeBrowser();
  required.pages[0]!.evaluations.push({
    loginRequired: true,
    managementVisible: false,
    ownAccount: null,
  });
  required.pages[0]!.evaluate = (async (_callback: unknown, arg: unknown) => {
    assert.notEqual(typeof arg, 'string');
    return { loginRequired: true, managementVisible: false, ownAccount: null };
  }) as Page['evaluate'];
  assert.equal(
    (await required.session.verifyCurrentAccount(required.pages[0]!)).status,
    'login_required',
  );
});

test('built-in long management collector replays only its loaded list and proves complete pagination plus total_count', async () => {
  const fixture = metricsPage([
    { loginRequired: false, text: '' },
    [longLoadedUrl],
    longApi([longFixture('1001')], 2),
    longApi([{ ...longFixture('1002'), status: -2 }], 2),
    longApi([], 2),
    { loginRequired: false, text: '' },
  ]);
  const urls: string[] = [];
  const original = fixture.page.evaluate.bind(fixture.page);
  fixture.page.evaluate = (async (...args: unknown[]) => {
    if (typeof args[1] === 'string') urls.push(args[1]);
    return (original as (...args: unknown[]) => Promise<unknown>)(...args);
  }) as Page['evaluate'];
  const result = await collectLongWorks(fixture.page);
  assert.equal(result.status, 'success');
  assert.equal(result.coverage.paginationComplete, true);
  assert.equal(result.coverage.pagesFetched, 3);
  assert.equal(result.coverage.totalRecords, 2);
  assert.deepEqual(
    urls.map((url) => new URL(url).searchParams.get('page_index')),
    ['0', '1', '2'],
  );
  assert.equal(fixture.remaining.length, 0);
  assert.equal(result.records[0]?.workId, '1001');
  assert.equal(result.records[0]?.statusCode, 3);
  assert.equal(result.records[0]?.contractStatusCode, 2);
  assert.equal(result.records[0]?.managementReadCount, 0);
  assert.equal(result.records[1]?.statusCode, -2);
  for (const key of ['readCount', 'publicationStatus', 'signingStatus', 'managementUrl'])
    assert.equal(key in result.records[0]!, false);
  assert.equal(result.statisticsThrough, null);
});

test('long management requires its own actual GET; homepage lists and unobserved URLs never establish account inventory', async () => {
  for (const urls of [
    [],
    ['https://fanqienovel.com/api/author/homepage/book_list/v0/?page_count=1&page_index=0'],
  ]) {
    const fixture = metricsPage([{ loginRequired: false, text: '' }, urls]);
    const result = await collectLongWorks(fixture.page);
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.records.length, 0);
    assert.ok(result.errors.some((error) => error.code === 'loaded_long_list_endpoint_missing'));
  }
});

test('long empty inventory needs successful zero total_count and an actual empty API list', async () => {
  const fixture = metricsPage([
    { loginRequired: false, text: '' },
    [longLoadedUrl],
    longApi([], 0),
    { loginRequired: false, text: '' },
  ]);
  const result = await collectLongWorks(fixture.page);
  assert.equal(result.status, 'success');
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.totalRecords, 0);
});
