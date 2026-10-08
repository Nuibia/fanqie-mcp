import test from 'node:test';

import { CHAPTER_ENTRY_FIXTURE_WORK } from './helpers/platform-reads-chapter-entry-fixture-work.js';

import {
  projectChapterVolumeRefreshEvent,
  CANONICAL_OWN_USER_URL,
} from '../src/platform/browser.js';

import {
  volumeEventContext,
  assertSafeVolumeMetadata,
  legacyChapterApplicationFixture,
} from './helpers/platform-reads-legacy-chapter-application-fixture.js';

import assert from 'node:assert/strict';

import { CHAPTER_SCHEMA_FIXTURE_SOURCES } from './helpers/platform-reads-chapter-core-row.js';

import { chapterEntryFixture } from './helpers/platform-reads-chapter-entry-fixture.js';

import { type ChapterVolumeRefreshDiagnostic } from '../src/platform/reads.js';

import { mkdtemp, readFile, rm } from 'node:fs/promises';

import { join } from 'node:path';

import { tmpdir } from 'node:os';

import { loadConfig } from '../src/config.js';

import { createApplication } from '../src/application.js';

test('volume metadata projects fixed keys and opaque/duplicate/parent facts without URL or any query value', () => {
  const raw = `https://fanqienovel.com/api/author/volume/volume_list/v1?book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&page_index=0&nonce=PRIVATE_NONCE&nonce=PRIVATE_NONCE_TWO&PRIVATE_DYNAMIC_QUERY=PRIVATE_VALUE&owner_id=PRIVATE_OWNER`;
  const request = {
    url: () => raw,
    method: () => 'GET',
    resourceType: () => 'fetch',
    frame: () => null,
  };
  const event = projectChapterVolumeRefreshEvent(
    request,
    volumeEventContext({ strictSourceMatch: false }),
  );
  assert(event);
  assert.deepEqual(event.query.knownKeys, ['book_id', 'page_index']);
  assert.equal(event.query.opaqueKeyCount, 4);
  assert.equal(event.query.duplicateKeys, true);
  assert.equal(event.query.identityFilter, true);
  assert.equal(event.query.parentBinding, 'current_work');
  assert.equal(event.exactUrl, false);
  assert.equal(event.strictSourceMatch, false);
  assertSafeVolumeMetadata(event);
  for (const [query, binding] of [
    ['page_index=0', 'missing_work'],
    ['book_id=7600000000000000002', 'other_work'],
    ['book_id=1', 'invalid_work'],
    [
      `book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&work_id=${CHAPTER_ENTRY_FIXTURE_WORK}`,
      'ambiguous_work',
    ],
  ] as const)
    assert.equal(
      projectChapterVolumeRefreshEvent(
        { ...request, url: () => raw.split('?')[0]! + '?' + query },
        volumeEventContext(),
      )!.query.parentBinding,
      binding,
    );
});

test('volume metadata classifies method/resource/frame and generation relations while ignoring other origins/paths', () => {
  const request = {
    url: () => CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!.url,
    method: () => 'PRIVATE_METHOD',
    resourceType: () => 'PRIVATE_RESOURCE',
    frame: () => {
      throw new Error('PRIVATE_FRAME');
    },
  };
  const event = projectChapterVolumeRefreshEvent(
    request,
    volumeEventContext({
      event: 'response',
      requestEpoch: 6,
      currentEpoch: 8,
      samePage: false,
      activeSlot: false,
      pageOpen: false,
      signalAborted: true,
      strictSourceMatch: false,
      status: 200,
    }),
  );
  assert(event);
  assert.equal(event.method, 'other');
  assert.equal(event.resourceType, 'other');
  assert.equal(event.frame, 'unavailable');
  assert.equal(event.requestEpoch, 'other_generation');
  assert.equal(event.refreshEpochCurrent, false);
  assert.equal(event.samePage, false);
  assert.equal(event.activeSlot, false);
  assert.equal(event.pageOpen, false);
  assert.equal(event.signalAborted, true);
  assert.equal(event.status, 200);
  assertSafeVolumeMetadata(event);
  const unobserved = projectChapterVolumeRefreshEvent(
    {
      ...request,
      method: () => 'POST',
      frame: () => 'SYNTHETIC_OTHER_FRAME',
      resourceType: () => 'document',
    },
    volumeEventContext({ requestEpoch: undefined, status: 700 }),
  );
  assert.equal(unobserved!.method, 'POST');
  assert.equal(unobserved!.frame, 'other_frame');
  assert.equal(unobserved!.resourceType, 'document');
  assert.equal(unobserved!.requestEpoch, 'unobserved');
  assert.equal(unobserved!.status, null);
  for (const url of [
    'https://external.invalid/api/author/volume/volume_list/v1',
    'https://fanqienovel.com/api/author/chapter/chapter_list/v1',
    'PRIVATE_INVALID_URL',
  ])
    assert.equal(
      projectChapterVolumeRefreshEvent({ ...request, url: () => url }, volumeEventContext()),
      null,
    );
});

test('HTTP-success without volume request events yields one safe zero-event callback and keeps request_unobserved', async () => {
  const fixture = chapterEntryFixture({
    directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!],
    suppressFreshVolumeEvents: true,
  });
  const diagnostics: ChapterVolumeRefreshDiagnostic[] = [];
  await assert.rejects(
    fixture.session.withPage((page) =>
      fixture.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK, {
        onVolumeRefreshDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }),
    ),
    { code: 'chapter_volume_refresh_request_unobserved' },
  );
  assert.equal(diagnostics.length, 1);
  const current = diagnostics[0]!;
  assert.equal(current.outcome, 'unverified');
  assert.equal(current.fetchResult, 'http_success');
  assert.deepEqual(current.observedEvents, { requests: 0, responses: 0 });
  assert.deepEqual(current.candidateEvents, { requests: 0, responses: 0 });
  assert.deepEqual(current.events, []);
  assert.equal(current.proof.requestObserved, false);
  assertSafeVolumeMetadata(current);
  assert.equal(fixture.directoryFetchCount, 1);
  await fixture.session.close();
});

test('volume refresh metadata distinguishes present rejected frame/resource/duplicate/parent events without adopting them', async () => {
  for (const [override, field, expected] of [
    [{ subframe: true }, 'frame', 'other_frame'],
    [{ frameUnavailable: true }, 'frame', 'unavailable'],
    [{ resourceType: 'image' }, 'resourceType', 'other'],
    [
      { query: `book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&book_id=${CHAPTER_ENTRY_FIXTURE_WORK}` },
      'duplicateKeys',
      true,
    ],
    [{ query: 'book_id=7600000000000000002' }, 'parentBinding', 'other_work'],
    [
      { query: `book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&owner_id=PRIVATE_OWNER` },
      'identityFilter',
      true,
    ],
  ] as const) {
    const fixture = chapterEntryFixture({
      directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!],
      freshVolumeOverride: override,
    });
    let diagnostic: ChapterVolumeRefreshDiagnostic | undefined;
    await assert.rejects(
      fixture.session.withPage((page) =>
        fixture.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK, {
          onVolumeRefreshDiagnostic: (value) => {
            diagnostic = value;
          },
        }),
      ),
      { code: 'chapter_volume_refresh_request_unobserved' },
    );
    assert(diagnostic);
    assert.deepEqual(diagnostic.candidateEvents, { requests: 1, responses: 1 });
    const event = diagnostic.events[0]!;
    assert.equal(
      field in event.query
        ? event.query[field as keyof typeof event.query]
        : event[field as keyof typeof event],
      expected,
    );
    assert.equal(event.strictSourceMatch, false);
    assert.equal(diagnostic.proof.requestObserved, false);
    assertSafeVolumeMetadata(diagnostic);
    assert.equal(fixture.directoryFetchCount, 1);
    await fixture.session.close();
  }
});

test('a prior-generation volume response is diagnostic only and cannot replace a missing current request', async () => {
  const fixture = chapterEntryFixture({
    directorySources: [{ ...CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!, oldRequest: true }],
    suppressFreshVolumeEvents: true,
    oldVolumeResponseDuringFresh: true,
  });
  let diagnostic: ChapterVolumeRefreshDiagnostic | undefined;
  await assert.rejects(
    fixture.session.withPage((page) =>
      fixture.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK, {
        onVolumeRefreshDiagnostic: (value) => {
          diagnostic = value;
        },
      }),
    ),
    { code: 'chapter_volume_refresh_request_unobserved' },
  );
  assert(diagnostic);
  assert.deepEqual(diagnostic.candidateEvents, { requests: 0, responses: 1 });
  assert.equal(diagnostic.events[0]!.event, 'response');
  assert.equal(diagnostic.events[0]!.requestEpoch, 'other_generation');
  assert.equal(diagnostic.proof.requestObserved, false);
  assertSafeVolumeMetadata(diagnostic);
  assert.equal(fixture.directoryFetchCount, 1);
  await fixture.session.close();
});

test('volume metadata is bounded and callback exceptions cannot replace the original fixed read failure', async () => {
  const fixture = chapterEntryFixture({
    directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!],
    suppressFreshVolumeEvents: true,
    extraFreshVolumeEvents: 40,
  });
  let diagnostic: ChapterVolumeRefreshDiagnostic | undefined;
  let callbacks = 0;
  await assert.rejects(
    fixture.session.withPage((page) =>
      fixture.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK, {
        onVolumeRefreshDiagnostic: (value) => {
          diagnostic = value;
          callbacks += 1;
          throw new Error('PRIVATE_CALLBACK_NONCE');
        },
      }),
    ),
    { code: 'chapter_volume_refresh_request_unobserved' },
  );
  assert(diagnostic);
  assert.equal(callbacks, 1);
  assert.equal(diagnostic.events.length, 32);
  assert.equal(diagnostic.truncated, true);
  assert.equal(diagnostic.candidateEvents.requests, 40);
  assert.equal(diagnostic.proof.requestObserved, false);
  assertSafeVolumeMetadata(diagnostic);
  assert.equal(fixture.directoryFetchCount, 1);
  await fixture.session.close();
});

test('incomplete list_chapters persists and returns only this attempt internal volume diagnostic without promoting saved current', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fanqie-volume-diagnostic-app-'));
  const fixture = chapterEntryFixture({
    directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!],
    suppressFreshVolumeEvents: true,
  });
  const config = loadConfig({
    FANQIE_TOKEN: 'synthetic-volume-metadata-fixture-token',
    FANQIE_DATA_DIR: join(directory, 'data'),
    FANQIE_PROFILE_DIR: join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: join(directory, 'runtime'),
  });
  fixture.session.checkLogin = async () => ({
    status: 'authenticated',
    identity: {
      accountId: '1001',
      authorId: null,
      displayName: null,
      evidenceSource: CANONICAL_OWN_USER_URL,
    },
    sourceUrl: 'https://fanqienovel.com/main/writer/book-manage',
    checkedAt: new Date().toISOString(),
  });
  legacyChapterApplicationFixture(fixture.session);
  const application = createApplication(config, { browser: fixture.session });
  try {
    const result = (await application.dispatch(
      'POST',
      '/api/v1/tools/fanqie_list_chapters',
      new URLSearchParams(),
      { workId: CHAPTER_ENTRY_FIXTURE_WORK },
    )) as Record<string, any>;
    assert.equal(result.job.status, 'partial');
    assert.equal(result.evidence.length, 1);
    assert.equal(result.data[0].status, 'capability_unavailable');
    assert.equal(result.data[0].coverage.complete, false);
    assert.equal(result.data[0].coverage.paginationComplete, false);
    const diagnostic = result.data[0].readDiagnostics.chapterVolumeRefresh;
    assert.equal(diagnostic.fetchResult, 'http_success');
    assert.equal(diagnostic.proof.requestObserved, false);
    assertSafeVolumeMetadata(diagnostic);
    const evidence = JSON.parse(
      await readFile(join(config.dataDir, 'evidence', result.evidence[0].path), 'utf8'),
    );
    assert.deepEqual(evidence.payload.readDiagnostics.chapterVolumeRefresh, diagnostic);
    const snapshot = (await application.dispatch(
      'GET',
      '/api/v1/snapshot',
      new URLSearchParams({ scope: `chapters.${CHAPTER_ENTRY_FIXTURE_WORK}` }),
      undefined,
    )) as Record<string, any>;
    assert.equal(snapshot.manifest, null);
    assert.equal(fixture.directoryFetchCount, 1);
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});
