import test from 'node:test';

import { CURRENT_DIRECTORY_BOOK } from './helpers/platform-reads-assert-context-probe-safe.js';

import {
  CHAPTER_ENTRY_FIXTURE_TITLE,
  CHAPTER_ENTRY_FIXTURE_WORK,
} from './helpers/platform-reads-chapter-entry-fixture-work.js';

import { chapterDraftDirectoryFixture } from './helpers/platform-reads-chapter-draft-directory-fixture.js';

import assert from 'node:assert/strict';

import { deferred } from './helpers/platform-reads-metrics-page.js';

import { CONTEXT_PROBE_TARGET } from './helpers/platform-reads-legacy-chapter-application-fixture.js';

import { currentChapterBodyFixture } from './helpers/platform-reads-current-chapter-body-fixture.js';

test('chapter drafts clear all records on parent, response-disposal, callback or late cleanup failure and hold FIFO until response settles', async () => {
  for (const options of [
    {
      directoryReplies: {
        [CURRENT_DIRECTORY_BOOK]: {
          code: 0,
          data: { book_id: '7600000000000000002', book_name: CHAPTER_ENTRY_FIXTURE_TITLE },
        },
      },
    },
    { disposeError: true },
    { detachError: true },
    { cleanupNavigation: 'unroute' as const },
    { handleDisposeError: true },
  ]) {
    const fixture = chapterDraftDirectoryFixture(options);
    const result = await fixture.call();
    assert.equal(result.status, 'capability_unavailable');
    assert.deepEqual(result.records, []);
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.pagesFetched, 0);
    await fixture.session.close();
  }
  const callback = chapterDraftDirectoryFixture();
  const failed = await callback.call({
    onVerifiedOwner: () => {
      throw Error('PRIVATE_CALLBACK');
    },
  });
  assert.equal(failed.status, 'capability_unavailable');
  assert.deepEqual(failed.records, []);
  assert.equal(failed.coverage.complete, false);
  await callback.session.close();
  const started = deferred(),
    release = deferred(),
    controller = new AbortController();
  const pending = chapterDraftDirectoryFixture({
    duringGet: async () => {
      started.resolve();
      await release.promise;
    },
  });
  const operation = pending.call({ signal: controller.signal });
  await started.promise;
  let advanced = false;
  const next = pending.session.withPage(async () => {
    advanced = true;
    return 'next';
  });
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(advanced, false);
  release.resolve();
  await assert.rejects(operation, { code: 'cancelled' });
  assert.equal(await next, 'next');
  assert.equal(pending.disposals, 1);
  await pending.session.close();
});

test('chapter drafts reject unknown navigation classification and drain allowed route handlers before releasing the owned FIFO', async () => {
  for (const options of [
    { entryUnknownNavigation: true },
    {
      blockedRequest: { url: CONTEXT_PROBE_TARGET, method: 'GET', navigation: 'unknown' as const },
    },
  ]) {
    const fixture = chapterDraftDirectoryFixture(options);
    const result = await fixture.call();
    assert.equal(result.status, 'capability_unavailable');
    assert.deepEqual(result.records, []);
    assert.equal(fixture.getCount, 0);
    assert.equal(fixture.identities.length, 0);
    await fixture.session.close();
  }
  const started = deferred(),
    release = deferred();
  let fixture: ReturnType<typeof chapterDraftDirectoryFixture>, task: Promise<void> | undefined;
  fixture = chapterDraftDirectoryFixture({
    ownBefore: {
      duringGet: () => {
        task = fixture.invokeAllowedRoute(async () => {
          started.resolve();
          await release.promise;
        });
      },
    },
  });
  const reading = fixture.call();
  await started.promise;
  let advanced = false;
  const next = fixture.session.withPage(async () => {
    advanced = true;
    return 'next';
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(advanced, false);
  release.resolve();
  await task;
  const result = await reading;
  assert.equal(result.status, 'success', JSON.stringify(result.errors));
  assert.equal(await next, 'next');
  await fixture.session.close();
});

test('chapter drafts block unverifiable GET URLs before forwarding and withhold completed scope after cleanup exceeds its original deadline', async () => {
  for (const url of [
    'data:text/plain,PRIVATE_DRAFT_URL',
    'https://PRIVATE_USER:PRIVATE_PASSWORD@fanqienovel.com/api/author/chapter/draft_list/v1',
    'https://fanqienovel.com/api/author/chapter/draft_list/v1#PRIVATE_FRAGMENT',
  ]) {
    let fixture: ReturnType<typeof chapterDraftDirectoryFixture>,
      forwarded = 0,
      aborted = 0;
    fixture = chapterDraftDirectoryFixture({
      ownBefore: {
        duringGet: async () => {
          await fixture.invokeGuardedRoute(
            url,
            async () => {
              forwarded++;
            },
            async () => {
              aborted++;
            },
          );
        },
      },
    });
    const result = await fixture.call();
    assert.equal(forwarded, 0);
    assert.equal(aborted, 1);
    assert.equal(result.status, 'capability_unavailable');
    assert.deepEqual(result.records, []);
    assert.equal(result.coverage.complete, false);
    assert.equal(fixture.getCount, 0);
    assert.equal(fixture.identities.length, 0);
    await fixture.session.close();
  }
  const late = chapterDraftDirectoryFixture({
    duringDetach: () => new Promise((resolve) => setTimeout(resolve, 650)),
  });
  const result = await late.call({ timeoutMs: 500 });
  assert.equal(late.getCount, 4);
  assert.equal(late.ownGetCount, 2);
  assert.equal(late.ownDisposals, 2);
  assert.equal(late.identities.length, 1);
  assert.equal(late.detachCount, 1);
  assert.equal(result.status, 'capability_unavailable');
  assert.deepEqual(result.records, []);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.paginationComplete, false);
  assert.equal(result.coverage.recordsFetched, 0);
  assert.equal(result.coverage.pagesFetched, 0);
  assert.equal(result.coverage.totalRecords, null);
  assert.deepEqual(result.coverage.fields, []);
  assert.equal(result.readDiagnostics, undefined);
  assert.equal(late.guarded, false);
  await late.session.close();
});

test('chapter drafts bind the official header path without role and reject same-label nonheaders, duplicates or replacement nodes', async () => {
  const noRole = chapterDraftDirectoryFixture({ noTabRole: true, unrelatedDraftLabel: true });
  const result = await noRole.call();
  assert.equal(result.status, 'success', JSON.stringify(result.errors));
  assert.equal(result.records.length, 2);
  assert.equal(result.coverage.complete, true);
  assert.equal(noRole.tabClicks, 1);
  assert.equal(noRole.nextClicks, 1);
  assert.equal(noRole.identities.length, 1);
  assert.equal(noRole.guarded, false);
  await noRole.session.close();
  for (const options of [
    { roleOnlyTab: true, unrelatedDraftLabel: true },
    { duplicateTab: true, noTabRole: true },
    { disabledTab: true, noTabRole: true },
    { tabChanged: true, noTabRole: true },
  ]) {
    const fixture = chapterDraftDirectoryFixture(options);
    const failed = await fixture.call();
    assert.equal(failed.status, 'capability_unavailable');
    assert.deepEqual(failed.records, []);
    assert.equal(failed.coverage.complete, false);
    assert.equal(fixture.tabClicks, 0);
    assert.equal(fixture.nextClicks, 0);
    assert.equal(fixture.getCount, 0);
    assert.equal(fixture.identities.length, 0);
    assert.equal(fixture.guarded, false);
    await fixture.session.close();
  }
});

test('chapter body single response is authorized by actual same-job directory membership and keeps raw author-edit representation after final cleanup', async () => {
  const { createHash } = await import('node:crypto');
  for (const targetLaterVolume of [false, true]) {
    const fixture = currentChapterBodyFixture({ targetLaterVolume });
    const result = await fixture.call();
    assert.equal(result.status, 'success');
    assert.equal(result.dataset, 'chapter_body');
    assert.equal(result.coverage.complete, true);
    assert.equal(result.coverage.paginationComplete, true);
    assert.equal(result.records.length, 1);
    const row = result.records[0]!;
    assert.equal(row.sourceBoundary, 'public_contract_api');
    assert.equal(row.representation, 'author_edit_current');
    assert.equal(row.publishedVersionVerified, false);
    assert.equal(row.rawContent === fixture.rawContent, true);
    assert.equal(
      row.rawContentSha256,
      createHash('sha256').update(fixture.rawContent, 'utf8').digest('hex'),
    );
    assert.equal(row.rawContentBytes, Buffer.byteLength(fixture.rawContent));
    assert.deepEqual(row.requestedTarget, {
      workId: CHAPTER_ENTRY_FIXTURE_WORK,
      chapterId: fixture.chapterId,
      volumeId: fixture.volumeId,
    });
    assert.deepEqual(
      [row.rawPublishStatus, row.rawCreationStatus, row.rawLatestVersion],
      [2, 0, 7],
    );
    assert.equal(fixture.bodyGets, 1);
    assert.equal(fixture.bodyDisposals, 1);
    assert.equal(fixture.ownGetCount, 2);
    assert.equal(fixture.ownDisposals, 2);
    assert.equal(fixture.identities.length, 1);
    assert.equal(fixture.detachCount, 1);
    const at = fixture.calls.findIndex(
      (call) => new URL(call.url).pathname === '/api/author/edit_article/v0/',
    );
    assert.ok(at > 1);
    assert.deepEqual(
      fixture.calls.slice(at + 1).map((call) => new URL(call.url).pathname),
      ['/api/author/volume/volume_list/v1', '/api/author/book/book_detail/v0/'],
    );
    const url = new URL(fixture.candidates[0]!);
    assert.deepEqual(
      [...url.searchParams.keys()],
      ['aid', 'app_name', 'book_id', 'item_id', 'from_source'],
    );
    assert.equal(
      url.searchParams.get('book_id') === CHAPTER_ENTRY_FIXTURE_WORK &&
        url.searchParams.get('item_id') === fixture.chapterId,
      true,
    );
    assert.equal(fixture.gotos, 1);
    assert.equal(fixture.guarded, false);
    assert.equal(fixture.listenerCount('close'), 0);
    assert.equal(fixture.cdpListenerCount('Network.requestWillBeSent'), 0);
    assert.equal(result.managementCoverage, undefined);
    assert.equal(result.readDiagnostics, undefined);
    assert.equal(result.statisticsThrough, null);
    assert.equal(
      JSON.stringify(result).includes('PRIVATE_BODY_UNKNOWN') ||
        JSON.stringify(result).includes('PRIVATE_BOOK_TOKEN'),
      false,
    );
    await fixture.session.close();
  }
});
