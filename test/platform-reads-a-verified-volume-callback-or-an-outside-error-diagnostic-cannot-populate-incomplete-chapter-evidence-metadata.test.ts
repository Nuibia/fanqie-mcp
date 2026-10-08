import test from 'node:test';

import { mkdtemp, rm } from 'node:fs/promises';

import { join } from 'node:path';

import { tmpdir } from 'node:os';

import { chapterEntryFixture } from './helpers/platform-reads-chapter-entry-fixture.js';

import { CHAPTER_SCHEMA_FIXTURE_SOURCES } from './helpers/platform-reads-chapter-core-row.js';

import { loadConfig } from '../src/config.js';

import { CANONICAL_OWN_USER_URL, BrowserSessionError } from '../src/platform/browser.js';

import {
  legacyChapterApplicationFixture,
  requestVolumeSource,
  assertSafeVolumeMetadata,
} from './helpers/platform-reads-legacy-chapter-application-fixture.js';

import { createApplication } from '../src/application.js';

import { CHAPTER_ENTRY_FIXTURE_WORK } from './helpers/platform-reads-chapter-entry-fixture-work.js';

import assert from 'node:assert/strict';

import { type ChapterVolumeRefreshDiagnostic } from '../src/platform/reads.js';

import { type Page } from 'playwright';

import { draftsDiagnosticFixture } from './helpers/platform-reads-drafts-diagnostic-fixture.js';

test('a verified volume callback or an outside error diagnostic cannot populate incomplete chapter evidence metadata', async () => {
  for (const outsideError of [false, true]) {
    const directory = await mkdtemp(join(tmpdir(), 'fanqie-volume-diagnostic-guard-'));
    const fixture = chapterEntryFixture({ directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!] });
    const config = loadConfig({
      FANQIE_TOKEN: 'synthetic-volume-guard-fixture-token',
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
    if (outsideError)
      fixture.session.enterCurrentChapterDirectory = async () => {
        throw Object.assign(
          new BrowserSessionError(
            'chapter_volume_refresh_request_unobserved',
            'PRIVATE_OUTSIDE_URL?token=PRIVATE_TOKEN',
          ),
          {
            diagnostic: {
              kind: 'chapter_volume_refresh',
              outcome: 'unverified',
              secret: 'PRIVATE_ERROR_PROPERTY',
            },
          },
        );
      };
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
      assert.equal(result.data[0].coverage.complete, false);
      assert.equal(result.data[0].readDiagnostics, undefined);
      assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
      const snapshot = (await application.dispatch(
        'GET',
        '/api/v1/snapshot',
        new URLSearchParams({ scope: `chapters.${CHAPTER_ENTRY_FIXTURE_WORK}` }),
        undefined,
      )) as Record<string, any>;
      assert.equal(snapshot.manifest, null);
      assert.equal(fixture.directoryFetchCount, outsideError ? 0 : 1);
    } finally {
      await application.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test('standard volume Request retains the exact observed opaque URL and GET credentials/redirect/cache semantics with one refresh', async () => {
  const source = requestVolumeSource();
  const fixture = chapterEntryFixture({ directorySources: [source] });
  let diagnostic: ChapterVolumeRefreshDiagnostic | undefined;
  const result = await fixture.session.withPage((page) =>
    fixture.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK, {
      onVolumeRefreshDiagnostic: (value) => {
        diagnostic = value;
      },
    }),
  );
  assert.ok(result.sourceUrl.includes('{workId}'));
  assert.deepEqual(fixture.volumeFetchInputs, [
    {
      kind: 'request',
      url: source.url,
      method: 'GET',
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
    },
  ]);
  assert.equal(fixture.directoryFetchCount, 1);
  assert.deepEqual(fixture.directoryFetchedSources, [source.url]);
  assert(diagnostic);
  assert.equal(diagnostic.outcome, 'verified');
  assert.equal(diagnostic.proof.requestObserved, true);
  assert.equal(diagnostic.proof.responseStatusMatched, true);
  assert.equal(diagnostic.events[0]!.exactUrl, true);
  assert.equal(diagnostic.events[0]!.query.opaqueKeyCount, 3);
  assert.equal(diagnostic.events[0]!.query.duplicateKeys, false);
  assertSafeVolumeMetadata(diagnostic);
  await fixture.session.close();
});

test('a simulated string-only URL rewrite fails strict proof while the same one-shot standard Request preserves it', async () => {
  for (const legacyString of [true, false]) {
    const source = requestVolumeSource();
    const fixture = chapterEntryFixture({
      directorySources: [source],
      volumeInputWrapper: 'strings',
    });
    let diagnostic: ChapterVolumeRefreshDiagnostic | undefined;
    if (legacyString) {
      const evaluate = fixture.page.evaluate.bind(fixture.page);
      fixture.page.evaluate = (async (callback: unknown, arg: unknown) => {
        if (arg === source.url && String(callback).includes('response.arrayBuffer'))
          return evaluate(async (sourceUrl: string) => {
            const response = await fetch(sourceUrl, {
              method: 'GET',
              credentials: 'same-origin',
              redirect: 'error',
            });
            await response.arrayBuffer();
            return { status: response.status, ok: response.ok };
          }, source.url);
        return evaluate(callback as never, arg as never);
      }) as Page['evaluate'];
    }
    const operation = () =>
      fixture.session.withPage((page) =>
        fixture.session.enterCurrentChapterDirectory(page, CHAPTER_ENTRY_FIXTURE_WORK, {
          onVolumeRefreshDiagnostic: (value) => {
            diagnostic = value;
          },
        }),
      );
    if (legacyString)
      await assert.rejects(operation(), { code: 'chapter_volume_refresh_request_unobserved' });
    else assert.ok((await operation()).sourceUrl.includes('{workId}'));
    assert.equal(fixture.directoryFetchCount, 1);
    assert.equal(fixture.volumeFetchInputs.length, 1);
    assert.equal(fixture.volumeFetchInputs[0]!.kind, legacyString ? 'string' : 'request');
    assert.equal(fixture.volumeFetchInputs[0]!.url, source.url);
    assert(diagnostic);
    assert.equal(diagnostic.outcome, legacyString ? 'unverified' : 'verified');
    assert.equal(diagnostic.events[0]!.exactUrl, !legacyString);
    assert.equal(diagnostic.events[0]!.query.duplicateKeys, legacyString);
    assert.equal(diagnostic.proof.requestObserved, !legacyString);
    assertSafeVolumeMetadata(diagnostic);
    await fixture.session.close();
  }
});

test('a standard Request also rewritten by a simulated wrapper remains unavailable with fixed duplicate/exact-URL metadata', async () => {
  const source = requestVolumeSource();
  const fixture = chapterEntryFixture({ directorySources: [source], volumeInputWrapper: 'all' });
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
  assert.equal(fixture.directoryFetchCount, 1);
  assert.equal(fixture.volumeResponseWaits, 0);
  assert.equal(fixture.volumeFetchInputs[0]!.kind, 'request');
  assert.equal(fixture.volumeFetchInputs[0]!.url, source.url);
  assert.equal(diagnostic.fetchResult, 'http_success');
  assert.equal(diagnostic.outcome, 'unverified');
  assert.deepEqual(diagnostic.candidateEvents, { requests: 1, responses: 1 });
  assert.equal(diagnostic.events[0]!.exactUrl, false);
  assert.equal(diagnostic.events[0]!.query.duplicateKeys, true);
  assert.equal(diagnostic.events[0]!.query.opaqueKeyCount, 5);
  assert.equal(diagnostic.events[0]!.strictSourceMatch, false);
  assert.equal(diagnostic.proof.requestObserved, false);
  assertSafeVolumeMetadata(diagnostic);
  await fixture.session.close();
});

test('blocked opaque draft GETs retain fixed resource types and navigation facts without declaring static assets or changing the guard', async () => {
  const resourceTypes = ['script', 'image', 'document', 'xhr', 'fetch'] as const;
  const fixture = draftsDiagnosticFixture({
    blockedRequests: resourceTypes.map((resourceType) => ({
      method: 'GET',
      resourceType,
      navigation: resourceType === 'document',
      url: 'https://fanqienovel.com/private_prefix/edit/private_title/private_token?token=PRIVATE_QUERY',
    })),
  });
  const result = await fixture.diagnose();
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.chapterTab?.reason, 'chapter_drafts_write_route_blocked');
  assert.equal(fixture.blocked, 5);
  assert.equal(fixture.forwarded, 1);
  assert.equal(fixture.clicked, 1);
  assert.equal(fixture.privateRequestFieldReads, 0);
  assert.equal(fixture.unknownBodyReads, 0);
  assert.equal(fixture.guardInstalled, false);
  assert.deepEqual(
    result.chapterTab?.blockedRequests?.entries,
    resourceTypes.map((resourceType) => ({
      method: 'GET',
      resourceType,
      navigation: resourceType === 'document',
      origin: 'platform',
      pathClass: 'unknown',
      pathTemplate: '/{opaque}/{opaque}/{opaque}/{opaque}',
      authorFamily: null,
      count: 1,
    })),
  );
  assert.equal(result.chapterTab?.blockedRequests?.count, 5);
  for (const secret of [
    'private_prefix',
    'private_title',
    'private_token',
    'PRIVATE_QUERY',
    'https://',
    '?',
  ])
    assert.equal(JSON.stringify(result.chapterTab).includes(secret), false);
  assert.equal(JSON.stringify(result.chapterTab).includes('static'), false);
  await fixture.session.close();
});

test('draft blocked path classification uses exact observed author APIs or writer namespace and leaves unknown endpoints unknown', async () => {
  const fixture = draftsDiagnosticFixture({
    blockedRequests: [
      {
        method: 'POST',
        resourceType: 'fetch',
        url: `https://fanqienovel.com/api/author/chapter/chapter_list/v1?book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&token=PRIVATE_TOKEN`,
      },
      {
        method: 'GET',
        resourceType: 'document',
        navigation: true,
        url: `https://fanqienovel.com/main/writer/publish-chapter/${CHAPTER_ENTRY_FIXTURE_WORK}?title=PRIVATE_TITLE`,
      },
      {
        method: 'POST',
        resourceType: 'xhr',
        url: 'https://fanqienovel.com/api/author/chapter/private_endpoint/v99?token=PRIVATE_TOKEN',
      },
      {
        method: 'POST',
        resourceType: 'fetch',
        url: 'https://private-external.invalid/api/author/chapter/chapter_list/v1?token=PRIVATE_TOKEN',
      },
    ],
  });
  const result = await fixture.diagnose();
  const entries = result.chapterTab?.blockedRequests?.entries ?? [];
  assert.deepEqual(
    entries.map((entry) => [entry.pathClass, entry.resourceType, entry.navigation, entry.origin]),
    [
      ['known_author_api', 'fetch', false, 'platform'],
      ['writer_route', 'document', true, 'platform'],
      ['unknown', 'xhr', false, 'platform'],
      ['unknown', 'fetch', false, 'external'],
    ],
  );
  assert.equal(entries[2]?.authorFamily, 'chapter');
  assert.equal(entries[2]?.pathTemplate, '/api/author/chapter/{opaque}/{opaque}');
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.chapterTab?.targetRef, null);
  assert.equal(fixture.blocked, 4);
  assert.equal(fixture.forwarded, 1);
  assert.equal(fixture.clicked, 1);
  assert.equal(fixture.privateRequestFieldReads, 0);
  assert.equal(fixture.unknownBodyReads, 0);
  for (const secret of [
    CHAPTER_ENTRY_FIXTURE_WORK,
    'PRIVATE_',
    'private_endpoint',
    'private-external',
    'publish-chapter',
    'v99',
    'https://',
  ])
    assert.equal(JSON.stringify(result.chapterTab).includes(secret), false);
  await fixture.session.close();
});
