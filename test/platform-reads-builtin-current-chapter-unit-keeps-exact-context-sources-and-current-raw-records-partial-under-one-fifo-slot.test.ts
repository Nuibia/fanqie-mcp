import test from 'node:test';

import {
  currentDirectoryFixture,
  CURRENT_CHAPTER_ITEM,
  CURRENT_CHAPTER_VOLUME,
  CURRENT_DIRECTORY_BOOK,
  CURRENT_DIRECTORY_CHAPTER,
  currentVolumeJson,
  currentChapterJson,
  currentBookJson,
} from './helpers/platform-reads-assert-context-probe-safe.js';

import assert from 'node:assert/strict';

import { CHAPTER_ENTRY_FIXTURE_WORK } from './helpers/platform-reads-chapter-entry-fixture-work.js';

import {
  CONTEXT_PROBE_SOURCE,
  CONTEXT_PROBE_TARGET,
} from './helpers/platform-reads-legacy-chapter-application-fixture.js';

import { type Page } from 'playwright';

test('builtin current chapter unit keeps exact context sources and current raw records partial under one FIFO slot', async () => {
  const fixture = currentDirectoryFixture();
  const result = await fixture.call();
  assert.equal(result.status, 'partial', JSON.stringify(result.errors));
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.paginationComplete, false);
  assert.equal(result.coverage.pagesFetched, 1);
  assert.equal(result.coverage.totalRecords, null);
  assert.equal(result.coverage.pagesDiscovered, null);
  assert.deepEqual(result.records, [
    {
      workId: CHAPTER_ENTRY_FIXTURE_WORK,
      chapterId: CURRENT_CHAPTER_ITEM,
      volumeId: CURRENT_CHAPTER_VOLUME,
      title: 'Synthetic current chapter',
      index: 1,
      wordCount: 1000,
      articleStatusCode: 99,
      displayStatusCode: 88,
      createdAtRaw: 'UNKNOWN_RAW_TIME',
      scheduledAtRaw: '',
    },
  ]);
  assert.deepEqual(
    fixture.calls.map((call) => call.url),
    [
      CONTEXT_PROBE_SOURCE,
      CURRENT_DIRECTORY_BOOK,
      CURRENT_DIRECTORY_CHAPTER,
      CONTEXT_PROBE_SOURCE,
      CURRENT_DIRECTORY_BOOK,
    ],
  );
  assert.equal(fixture.identities.length, 1);
  assert.equal(fixture.identities[0]!.identity?.accountId, '1001');
  assert.equal(fixture.identities[0]!.identity?.authorId, null);
  assert.ok(Date.parse(result.capturedAt) >= Date.parse(fixture.identities[0]!.checkedAt));
  assert.equal(fixture.detachCount, 1);
  assert.equal(result.statisticsThrough, null);
  assert.equal(fixture.entryCalls, 1);
  assert.equal(JSON.stringify(result).includes('PRIVATE_CHAPTER_BODY'), false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_BOOK_TOKEN'), false);
  assert.equal(JSON.stringify(result).includes('opaque_fixture'), false);
  assert.equal(result.readDiagnostics, undefined);
  await fixture.session.close();
});

test('current directory requires unique observed same-parent book and chapter sources without changing opaque query values', async () => {
  for (const sources of [
    [{ url: CONTEXT_PROBE_SOURCE }, { url: CURRENT_DIRECTORY_BOOK }],
    [
      { url: CONTEXT_PROBE_SOURCE },
      { url: CURRENT_DIRECTORY_BOOK },
      { url: CURRENT_DIRECTORY_CHAPTER },
      { url: CURRENT_DIRECTORY_CHAPTER + '&different=1' },
    ],
    [
      { url: CONTEXT_PROBE_SOURCE },
      { url: CURRENT_DIRECTORY_BOOK },
      { url: CURRENT_DIRECTORY_CHAPTER + '&bookId=7600000000000000002' },
    ],
    [
      { url: CONTEXT_PROBE_SOURCE },
      { url: CURRENT_DIRECTORY_BOOK },
      { url: CURRENT_DIRECTORY_CHAPTER, cdp: { loaderId: 'OLD_LOADER' } },
    ],
  ]) {
    const fixture = currentDirectoryFixture({ sources });
    const result = await fixture.call();
    assert.equal(result.status, 'capability_unavailable');
    assert.deepEqual(result.records, []);
    assert.equal(result.coverage.pagesFetched, 0);
    assert.equal(fixture.identities.length, 0);
    assert.equal(
      fixture.calls.some((call) => call.url === CURRENT_DIRECTORY_CHAPTER),
      false,
    );
    await fixture.session.close();
  }
});

test('current directory clears value-level parent, chapter and count failures without saving a partial unverified payload', async () => {
  for (const [source, json] of [
    [
      CONTEXT_PROBE_SOURCE,
      {
        code: 0,
        data: {
          volume_list: [
            { ...currentVolumeJson().data.volume_list[0]!, book_id: '7600000000000000002' },
          ],
        },
      },
    ],
    [
      CURRENT_DIRECTORY_BOOK,
      { code: 0, data: { book_id: CHAPTER_ENTRY_FIXTURE_WORK, book_name: 'Other exact title' } },
    ],
    [
      CURRENT_DIRECTORY_CHAPTER,
      { code: 0, data: { total_count: 0, item_list: currentChapterJson().data.item_list } },
    ],
  ]) {
    const replies = {
      [CONTEXT_PROBE_SOURCE]: currentVolumeJson(),
      [CURRENT_DIRECTORY_BOOK]: currentBookJson(),
      [CURRENT_DIRECTORY_CHAPTER]: currentChapterJson(),
      [String(source)]: json,
    };
    const fixture = currentDirectoryFixture({ directoryReplies: replies });
    const result = await fixture.call();
    assert.equal(result.status, 'capability_unavailable');
    assert.deepEqual(result.records, []);
    assert.equal(result.coverage.recordsFetched, 0);
    assert.equal(fixture.identities.length, 0);
    await fixture.session.close();
  }
});

test('directory owner callback uses the fresh typed account and any callback or late cleanup failure discards all records', async () => {
  for (const mode of ['owner', 'callback', 'detach', 'late-navigation'] as const) {
    let fixture: ReturnType<typeof currentDirectoryFixture>;
    fixture = currentDirectoryFixture({
      ...(mode === 'owner'
        ? { ownAfter: { json: { code: 0, data: { id: '1002', name: 'PRIVATE_OTHER_ACCOUNT' } } } }
        : {}),
      ...(mode === 'detach' ? { detachError: true } : {}),
      ...(mode === 'late-navigation'
        ? {
            duringDetach: () =>
              fixture.emitNewDocument(CONTEXT_PROBE_TARGET, fixture.currentLoader),
          }
        : {}),
    });
    const result = await fixture.call(
      mode === 'callback'
        ? {
            onVerifiedOwner: () => {
              throw Error('PRIVATE_BINDING_ERROR?token=PRIVATE_TOKEN');
            },
          }
        : {},
    );
    assert.equal(result.status, 'capability_unavailable');
    assert.deepEqual(result.records, []);
    assert.equal(result.coverage.pagesFetched, 0);
    assert.equal(result.coverage.fields.length, 0);
    assert.equal(result.coverage.complete, false);
    assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
    await fixture.session.close();
  }
});

test('current directory cancels in the owned context await and disposes responses before releasing the browser slot', async () => {
  const controller = new AbortController();
  let fixture: ReturnType<typeof currentDirectoryFixture>;
  fixture = currentDirectoryFixture({
    duringGet: () => {
      controller.abort();
    },
  });
  await assert.rejects(fixture.call({ signal: controller.signal }), { code: 'cancelled' });
  assert.equal(fixture.identities.length, 0);
  assert.equal(fixture.detachCount, 1);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.disposals, 1);
  await fixture.session.close();
});

test('current directory rejects inventory drift and response or route cleanup failures after value parsing', async () => {
  for (const mode of ['inventory', 'book', 'response-disposal', 'unroute'] as const) {
    const fixture = currentDirectoryFixture();
    const context = fixture.page.context();
    const get = context.request.get.bind(context.request);
    let volumes = 0,
      books = 0;
    if (mode === 'unroute') {
      const unroute = fixture.page.unroute.bind(fixture.page);
      fixture.page.unroute = (async (...args: Parameters<Page['unroute']>) => {
        await unroute(...args);
        throw Error('PRIVATE_CLEANUP_ERROR');
      }) as Page['unroute'];
    }
    context.request.get = (async (url: string, options) => {
      const response = await get(url, options);
      if (url === CONTEXT_PROBE_SOURCE) volumes++;
      if (url === CURRENT_DIRECTORY_BOOK) books++;
      if (mode === 'inventory' && url === CONTEXT_PROBE_SOURCE && volumes === 2)
        response.json = async () => ({
          code: 0,
          data: { volume_list: [{ ...currentVolumeJson().data.volume_list[0]!, item_count: 3 }] },
        });
      if (mode === 'book' && url === CURRENT_DIRECTORY_BOOK && books === 2)
        response.json = async () => ({
          code: 0,
          data: { book_id: CHAPTER_ENTRY_FIXTURE_WORK, title: 'Other final title' },
        });
      if (mode === 'response-disposal' && url === CURRENT_DIRECTORY_CHAPTER)
        response.dispose = async () => {
          throw Error('PRIVATE_DIRECTORY_DISPOSAL');
        };
      return response;
    }) as typeof context.request.get;
    const result = await fixture.call();
    assert.equal(result.status, 'capability_unavailable');
    assert.deepEqual(result.records, []);
    assert.equal(result.coverage.pagesFetched, 0);
    assert.equal(result.coverage.fields.length, 0);
    assert.equal(fixture.identities.length, 0);
    assert.equal(result.coverage.complete, false);
    assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
    await fixture.session.close();
  }
});

test('current manager entry blocks write-labelled or non-GET traffic and refuses navigation ambiguity before any context data read', async () => {
  for (const request of [
    { url: 'https://fanqienovel.com/api/author/update/v1', method: 'POST', navigation: false },
    { url: CONTEXT_PROBE_TARGET, method: 'GET', navigation: 'unknown' as const },
    { url: 'https://external.invalid/private_target', method: 'GET', navigation: true },
    {
      url: CONTEXT_PROBE_TARGET,
      method: 'GET',
      navigation: true,
      subframe: true,
      abortError: true,
    },
  ]) {
    const fixture = currentDirectoryFixture({ managerRequest: request });
    const result = await fixture.call();
    assert.equal(fixture.blocked, 1);
    if (request.navigation === false) {
      assert.equal(result.status, 'partial');
      assert.equal(fixture.calls.length, 5);
    } else {
      assert.equal(result.status, 'capability_unavailable');
      assert.deepEqual(result.records, []);
      assert.equal(fixture.calls.length, 0);
      assert.equal(fixture.identities.length, 0);
    }
    assert.equal(result.coverage.complete, false);
    await fixture.session.close();
  }
});
