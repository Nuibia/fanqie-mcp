import test from 'node:test';

import { deferred } from './helpers/platform-reads-metrics-page.js';

import {
  currentDirectoryFixture,
  CURRENT_DIRECTORY_BOOK,
  CURRENT_DIRECTORY_CHAPTER,
  CURRENT_CHAPTER_ITEM,
  currentVolumeJson,
  currentChapterJson,
} from './helpers/platform-reads-assert-context-probe-safe.js';

import {
  CONTEXT_PROBE_SOURCE,
  CONTEXT_PROBE_REF,
  CONTEXT_PROBE_TARGET,
} from './helpers/platform-reads-legacy-chapter-application-fixture.js';

import assert from 'node:assert/strict';

import {
  CHAPTER_ENTRY_FIXTURE_WORK,
  CHAPTER_ENTRY_FIXTURE_TITLE,
} from './helpers/platform-reads-chapter-entry-fixture-work.js';

import { contextVolumeProbeFixture } from './helpers/platform-reads-context-volume-probe-fixture.js';

import { verifyCurrentChapterBook } from '../src/platform/reads.js';

// Source acquisition deadlines below are local fixture budgets, not platform sleeps.
test('collection source window accepts delayed natural GETs only after canonical freeze and consumes them after fresh typed owner disposal', async () => {
  const ownerDisposed = deferred();
  let fixture: ReturnType<typeof currentDirectoryFixture>;
  fixture = currentDirectoryFixture({
    sources: [],
    ownBefore: {
      duringGet: () => {
        fixture.emitSource({ url: CONTEXT_PROBE_SOURCE });
        fixture.emitSource({ url: CURRENT_DIRECTORY_BOOK });
      },
      duringDispose: () => {
        ownerDisposed.resolve();
      },
    },
  });
  const reading = fixture.call({ timeoutMs: 200 });
  await ownerDisposed.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fixture.getCount, 0);
  assert.equal(fixture.ownGetCount, 1);
  assert.equal(fixture.ownDisposals, 1);
  assert.equal(fixture.identities.length, 0);
  fixture.emitSource({ url: CURRENT_DIRECTORY_CHAPTER });
  const result = await reading;
  assert.equal(result.status, 'partial');
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.paginationComplete, false);
  assert.equal(result.coverage.pagesFetched, 1);
  assert.equal(result.records[0]!.chapterId, CURRENT_CHAPTER_ITEM);
  assert.equal(result.readDiagnostics, undefined);
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
  assert.deepEqual(fixture.apiOrder.slice(0, 3), ['own_get', 'own_dispose', 'volume_get']);
  assert.equal(fixture.ownGetCount, 2);
  assert.equal(fixture.ownDisposals, 2);
  assert.equal(fixture.identities.length, 1);
  assert.equal(fixture.listenerCount('close'), 0);
  assert.equal(fixture.cdpListenerCount('Network.requestWillBeSent'), 0);
  await fixture.session.close();
});

test('collection source window preserves ambiguity and source filters and seals exact URLs before business GETs while legacy remains closed', async () => {
  let ambiguous: ReturnType<typeof currentDirectoryFixture>;
  ambiguous = currentDirectoryFixture({
    sources: [],
    ownBefore: {
      duringGet: () => {
        ambiguous.emitSource({ url: CONTEXT_PROBE_SOURCE });
        ambiguous.emitSource({ url: CURRENT_DIRECTORY_BOOK });
        ambiguous.emitSource({ url: CURRENT_DIRECTORY_CHAPTER });
        ambiguous.emitSource({ url: CONTEXT_PROBE_SOURCE + '&second_opaque=PRIVATE_SECOND_VALUE' });
      },
    },
  });
  const rejected = await ambiguous.call();
  assert.equal(rejected.status, 'capability_unavailable');
  assert.equal(rejected.errors[0]!.code, 'template_ambiguous');
  assert.equal(ambiguous.getCount, 0);
  assert.equal(ambiguous.ownDisposals, 1);
  assert.equal(ambiguous.identities.length, 0);
  assert.deepEqual(rejected.records, []);
  assert.equal(ambiguous.listenerCount('close'), 0);
  await ambiguous.session.close();
  for (const rejectedSource of [
    { url: CONTEXT_PROBE_SOURCE, cdp: { loaderId: 'SYNTHETIC_OLD_LOADER' } },
    { url: CONTEXT_PROBE_SOURCE, subframe: true },
    { url: CONTEXT_PROBE_SOURCE + '&book_id=' + CHAPTER_ENTRY_FIXTURE_WORK },
    { url: CONTEXT_PROBE_SOURCE + '&owner_id=1001' },
  ]) {
    let filtered: ReturnType<typeof currentDirectoryFixture>;
    filtered = currentDirectoryFixture({
      sources: [],
      ownBefore: {
        duringGet: () => {
          filtered.emitSource(rejectedSource);
          filtered.emitSource({ url: CURRENT_DIRECTORY_BOOK });
          filtered.emitSource({ url: CURRENT_DIRECTORY_CHAPTER });
        },
      },
    });
    const result = await filtered.call();
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.errors[0]!.code, 'template_missing');
    assert.equal(filtered.getCount, 0);
    assert.equal(filtered.identities.length, 0);
    assert.deepEqual(result.records, []);
    await filtered.session.close();
  }
  let sealed: ReturnType<typeof currentDirectoryFixture>;
  sealed = currentDirectoryFixture({
    duringGet: () => {
      sealed.emitSource({ url: CONTEXT_PROBE_SOURCE + '&late_volume=PRIVATE_LATE_TOKEN' });
      sealed.emitSource({ url: CURRENT_DIRECTORY_BOOK + '&late_book=PRIVATE_LATE_TOKEN' });
      sealed.emitSource({ url: CURRENT_DIRECTORY_CHAPTER + '&late_chapter=PRIVATE_LATE_TOKEN' });
    },
  });
  const result = await sealed.call();
  assert.equal(result.status, 'partial');
  assert.equal(result.readDiagnostics, undefined);
  assert.deepEqual(
    sealed.calls.map((call) => call.url),
    [
      CONTEXT_PROBE_SOURCE,
      CURRENT_DIRECTORY_BOOK,
      CURRENT_DIRECTORY_CHAPTER,
      CONTEXT_PROBE_SOURCE,
      CURRENT_DIRECTORY_BOOK,
    ],
  );
  assert.equal(sealed.identities.length, 1);
  await sealed.session.close();
  let legacy: ReturnType<typeof contextVolumeProbeFixture>;
  legacy = contextVolumeProbeFixture({
    sources: [],
    ownBefore: { duringGet: () => legacy.emitSource({ url: CONTEXT_PROBE_SOURCE }) },
  });
  const diagnostic = await legacy.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(diagnostic.chapterVolumeContext!.reason, 'template_missing');
  assert.equal(legacy.getCount, 0);
  assert.equal(legacy.ownDisposals, 1);
  assert.equal(legacy.listenerCount('close'), 0);
  await legacy.session.close();
});

test('collection source window deadlines, owner failure and navigation or cancellation settle without reopening sources or releasing FIFO early', async () => {
  let timed: ReturnType<typeof currentDirectoryFixture>;
  timed = currentDirectoryFixture({
    sources: [],
    ownBefore: {
      duringGet: () => {
        timed.emitSource({ url: CONTEXT_PROBE_SOURCE });
        timed.emitSource({ url: CURRENT_DIRECTORY_BOOK });
      },
    },
  });
  const timeout = await timed.call({ timeoutMs: 10 });
  assert.equal(timeout.status, 'capability_unavailable');
  assert.equal(timeout.errors[0]!.code, 'chapter_current_sources_unverified');
  assert.deepEqual(timeout.records, []);
  assert.equal(timed.getCount, 0);
  assert.equal(timed.identities.length, 0);
  assert.equal(timed.listenerCount('close'), 0);
  assert.equal(timed.cdpListenerCount('Network.requestWillBeSent'), 0);
  timed.emitSource({ url: CURRENT_DIRECTORY_CHAPTER });
  assert.equal(timed.getCount, 0);
  assert.equal(await timed.session.withPage(async () => 'next-reader'), 'next-reader');
  await timed.session.close();
  const otherOwner = currentDirectoryFixture({
    sources: [],
    ownBefore: { json: { code: 0, data: { id: '1002' } } },
  });
  const mismatch = await otherOwner.call({ timeoutMs: 200 });
  assert.equal(mismatch.errors[0]!.code, 'owner_changed');
  assert.equal(otherOwner.getCount, 0);
  assert.equal(otherOwner.identities.length, 0);
  assert.equal(otherOwner.listenerCount('close'), 0);
  await otherOwner.session.close();
  for (const mode of ['navigation', 'disconnect', 'cancel'] as const) {
    const ownerDisposed = deferred(),
      controller = new AbortController();
    let fixture: ReturnType<typeof currentDirectoryFixture>;
    fixture = currentDirectoryFixture({
      sources: [],
      ownBefore: {
        duringDispose: () => {
          ownerDisposed.resolve();
        },
      },
    });
    const reading = fixture.call({
      timeoutMs: 500,
      ...(mode === 'cancel' ? { signal: controller.signal } : {}),
    });
    await ownerDisposed.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(fixture.getCount, 0);
    const next = fixture.session.withPage(async () => 'following-reader');
    if (mode === 'navigation') fixture.emitNewDocument(CONTEXT_PROBE_TARGET, fixture.currentLoader);
    else if (mode === 'disconnect') fixture.emitCdp('close', undefined);
    else controller.abort();
    if (mode === 'cancel') await assert.rejects(reading, { code: 'cancelled' });
    else {
      const result = await reading;
      assert.equal(result.status, 'capability_unavailable');
      assert.deepEqual(result.records, []);
      assert.equal(result.coverage.pagesFetched, 0);
    }
    assert.equal(await next, 'following-reader');
    assert.equal(fixture.identities.length, 0);
    assert.equal(fixture.getCount, 0);
    assert.equal(fixture.listenerCount('close'), 0);
    assert.equal(fixture.cdpListenerCount('Network.requestWillBeSent'), 0);
    await fixture.session.close();
  }
});

test('current book detail fixes the observed book_name field without weakening exact parent, name, envelope or code guards', async () => {
  verifyCurrentChapterBook(
    {
      code: 0,
      data: {
        book_id: CHAPTER_ENTRY_FIXTURE_WORK,
        book_name: CHAPTER_ENTRY_FIXTURE_TITLE,
        title: 'Synthetic unrelated alias',
      },
    },
    CHAPTER_ENTRY_FIXTURE_WORK,
    CHAPTER_ENTRY_FIXTURE_TITLE,
  );
  const invalid = [
    { code: 0, data: { book_id: '7600000000000000002', book_name: CHAPTER_ENTRY_FIXTURE_TITLE } },
    {
      code: 0,
      data: {
        book_id: CHAPTER_ENTRY_FIXTURE_WORK,
        book_name: 'Synthetic other exact name',
        title: CHAPTER_ENTRY_FIXTURE_TITLE,
      },
    },
    {
      code: 0,
      data: { book_id: CHAPTER_ENTRY_FIXTURE_WORK, book_name: ` ${CHAPTER_ENTRY_FIXTURE_TITLE}` },
    },
    { code: 0, data: { book_id: CHAPTER_ENTRY_FIXTURE_WORK, title: CHAPTER_ENTRY_FIXTURE_TITLE } },
    { code: 0, data: { book_name: CHAPTER_ENTRY_FIXTURE_TITLE } },
    { code: 0, data: { book_id: CHAPTER_ENTRY_FIXTURE_WORK, book_name: 1 } },
    {
      code: 1,
      data: { book_id: CHAPTER_ENTRY_FIXTURE_WORK, book_name: CHAPTER_ENTRY_FIXTURE_TITLE },
    },
    {
      code: '0',
      data: { book_id: CHAPTER_ENTRY_FIXTURE_WORK, book_name: CHAPTER_ENTRY_FIXTURE_TITLE },
    },
    { code: 0, data: [] },
    { code: 0, data: null },
    {},
  ];
  for (const payload of invalid)
    assert.throws(
      () =>
        verifyCurrentChapterBook(payload, CHAPTER_ENTRY_FIXTURE_WORK, CHAPTER_ENTRY_FIXTURE_TITLE),
      { code: 'chapter_book_parent_mismatch' },
    );
  for (const payload of invalid.slice(0, 4)) {
    const fixture = currentDirectoryFixture({
      directoryReplies: {
        [CONTEXT_PROBE_SOURCE]: currentVolumeJson(),
        [CURRENT_DIRECTORY_BOOK]: payload,
        [CURRENT_DIRECTORY_CHAPTER]: currentChapterJson(),
      },
    });
    const result = await fixture.call();
    assert.equal(result.status, 'capability_unavailable');
    assert.ok(result.errors.some((error) => error.code === 'chapter_book_parent_mismatch'));
    assert.deepEqual(result.records, []);
    assert.equal(result.coverage.recordsFetched, 0);
    assert.equal(result.coverage.pagesFetched, 0);
    assert.deepEqual(result.coverage.fields, []);
    assert.equal(result.coverage.complete, false);
    assert.equal(
      fixture.calls.some((call) => call.url === CURRENT_DIRECTORY_CHAPTER),
      false,
    );
    assert.equal(fixture.ownGetCount, 1);
    assert.equal(fixture.ownDisposals, 1);
    assert.equal(fixture.identities.length, 0);
    await fixture.session.close();
  }
});
