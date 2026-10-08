import test from 'node:test';

import { mkdtemp, readFile, rm } from 'node:fs/promises';

import { join } from 'node:path';

import { tmpdir } from 'node:os';

import { contextVolumeProbeFixture } from './helpers/platform-reads-context-volume-probe-fixture.js';

import { CANONICAL_OWN_USER_URL } from '../src/platform/browser.js';

import { loadConfig } from '../src/config.js';

import { createApplication } from '../src/application.js';

import assert from 'node:assert/strict';

import {
  CONTEXT_PROBE_REF,
  CONTEXT_PROBE_TARGET,
} from './helpers/platform-reads-legacy-chapter-application-fixture.js';

import { assertContextProbeSafe } from './helpers/platform-reads-assert-context-probe-safe.js';

import { CHAPTER_ENTRY_FIXTURE_WORK } from './helpers/platform-reads-chapter-entry-fixture-work.js';

test('existing diagnostic tool forwards only the fixed context option and persists independent schema metadata without chapter promotion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fanqie-context-probe-app-'));
  const fixture = contextVolumeProbeFixture();
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
  const config = loadConfig({
    FANQIE_TOKEN: 'synthetic-context-probe-fixture-token',
    FANQIE_DATA_DIR: join(directory, 'data'),
    FANQIE_PROFILE_DIR: join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: join(directory, 'runtime'),
  });
  const application = createApplication(config, { browser: fixture.session });
  try {
    assert.equal(application.tools.length, 40);
    await assert.rejects(
      application.dispatch(
        'POST',
        '/api/v1/tools/fanqie_diagnose_read_page',
        new URLSearchParams(),
        { sourceUrl: `diagnostic:${CONTEXT_PROBE_REF}`, chapterVolumeContext: false },
      ),
    );
    assert.equal(fixture.getCount, 0);
    const result = (await application.dispatch(
      'POST',
      '/api/v1/tools/fanqie_diagnose_read_page',
      new URLSearchParams(),
      { sourceUrl: `diagnostic:${CONTEXT_PROBE_REF}`, chapterVolumeContext: true },
    )) as Record<string, any>;
    assert.equal(result.job.status, 'succeeded');
    assert.equal(fixture.getCount, 1);
    assert.equal(result.data[0].chapterVolumeContext.transport, 'browser_context_get');
    assert.equal(result.data[0].chapterVolumeContext.collectionProof, false);
    const evidence = JSON.parse(
      await readFile(join(config.dataDir, 'evidence', result.evidence[0].path), 'utf8'),
    );
    assert.deepEqual(evidence.payload.chapterVolumeContext, result.data[0].chapterVolumeContext);
    assertContextProbeSafe(evidence.payload);
    const snapshot = (await application.dispatch(
      'GET',
      '/api/v1/snapshot',
      new URLSearchParams({ scope: `chapters.${CHAPTER_ENTRY_FIXTURE_WORK}` }),
      undefined,
    )) as Record<string, any>;
    assert.equal(snapshot.manifest, null);
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('context cleanup retains navigation-start fencing through unroute and response disposal without a commit', async () => {
  const outcomes = [];
  for (const cleanupNavigation of ['unroute', 'dispose'] as const) {
    const fixture = contextVolumeProbeFixture({ cleanupNavigation });
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    outcomes.push(result);
    assert.equal(fixture.getCount, 1);
    assert.equal(fixture.disposals, 1);
    assert.equal(fixture.guarded, false);
    assertContextProbeSafe(result);
    await fixture.session.close();
  }
  for (const result of outcomes) {
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.chapterVolumeContext!.reason, 'document_changed');
    assert.equal(result.chapterVolumeContext!.schema, null);
    assert.equal(result.chapterVolumeContext!.checks.epochStable, false);
    // No commit or URL change occurred: the local navigation-request fence must catch it.
    assert.equal(result.chapterVolumeContext!.checks.routeStable, true);
    assert.equal(result.chapterVolumeContext!.checks.sameContext, true);
    assert.equal(result.chapterVolumeContext!.checks.responseDisposed, true);
  }
});

test('context blocked classification treats wrong or ambiguous explicit parent queries as fatal even when abort succeeds', async () => {
  for (const query of [
    `book_id=7600000000000000002`,
    `book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&bookId=${CHAPTER_ENTRY_FIXTURE_WORK}`,
    `workId=${CHAPTER_ENTRY_FIXTURE_WORK}&workId=${CHAPTER_ENTRY_FIXTURE_WORK}`,
  ]) {
    const fixture = contextVolumeProbeFixture({
      blockedRequest: {
        url: 'https://fanqienovel.com/api/opaque/private_fixture/v0/?' + query,
        method: 'POST',
      },
    });
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.chapterVolumeContext!.reason, 'bootstrap_request_blocked');
    assert.equal(fixture.getCount, 0);
    assert.equal(result.chapterVolumeContext!.schema, null);
    const entry = result.chapterVolumeContext!.blockedRequests!.entries[0]!;
    assert.equal(entry.blockReason, 'parent_mismatch');
    assert.equal(entry.navigation, false);
    assert.equal(entry.abortConfirmed, true);
    assert.equal(result.chapterVolumeContext!.blockedRequests!.summary, null);
    assertContextProbeSafe(result);
    await fixture.session.close();
  }
});

test('context blocked navigation true or unknown including child navigation remains fatal', async () => {
  for (const blockedRequest of [
    { url: CONTEXT_PROBE_TARGET, method: 'POST', navigation: true },
    { url: CONTEXT_PROBE_TARGET, method: 'GET', navigation: true, subframe: true },
    {
      url: 'https://fanqienovel.com/api/opaque/private_fixture/v0/',
      method: 'POST',
      navigation: 'unknown' as const,
    },
  ]) {
    const fixture = contextVolumeProbeFixture({ blockedRequest });
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.chapterVolumeContext!.reason, 'bootstrap_request_blocked');
    assert.equal(fixture.getCount, 0);
    assert.equal(
      result.chapterVolumeContext!.blockedRequests!.entries[0]!.navigation,
      blockedRequest.navigation,
    );
    assert.equal(result.chapterVolumeContext!.blockedRequests!.entries[0]!.abortConfirmed, true);
    assertContextProbeSafe(result);
    await fixture.session.close();
  }
});

test('invalid URL classification and abort failure never become non-navigation proof or expose errors', async () => {
  for (const blockedRequest of [
    { url: 'PRIVATE_INVALID_URL?token=PRIVATE_PROBE_TOKEN', method: 'POST' },
    {
      url: 'https://PRIVATE_USERNAME:PRIVATE_PASSWORD@fanqienovel.com/PRIVATE_PATH',
      method: 'POST',
    },
    {
      url: 'https://fanqienovel.com/api/opaque/private_fixture/v0/',
      method: 'POST',
      abortError: true,
    },
  ]) {
    const fixture = contextVolumeProbeFixture({ blockedRequest });
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.chapterVolumeContext!.reason, 'bootstrap_request_blocked');
    assert.equal(fixture.getCount, 0);
    assert.equal(result.chapterVolumeContext!.schema, null);
    const metadata = result.chapterVolumeContext!.blockedRequests!;
    assert.equal(metadata.summary, null);
    assert.equal(metadata.entries[0]!.abortConfirmed, !blockedRequest.abortError);
    assertContextProbeSafe(result);
    assert.equal(JSON.stringify(result).includes('PRIVATE_USERNAME'), false);
    assert.equal(JSON.stringify(result).includes('PRIVATE_PASSWORD'), false);
    assert.equal(JSON.stringify(result).includes('PRIVATE_INVALID_URL'), false);
    await fixture.session.close();
  }
});

test('a confirmed non-navigation abort cannot rename a later independent transport or HTTP failure', async () => {
  for (const [options, reason] of [
    [{ transportError: true }, 'transport_failed'],
    [{ responseStatus: 403 }, 'http_failed'],
  ] as const) {
    const fixture = contextVolumeProbeFixture({
      ...options,
      blockedRequest: {
        url: 'https://fanqienovel.com/api/opaque/private_fixture/v0/',
        method: 'POST',
      },
    });
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.chapterVolumeContext!.reason, reason);
    assert.equal(result.chapterVolumeContext!.schema, null);
    assert.equal(result.chapterVolumeContext!.blockedRequests!.summary, 'blocked_non_navigation');
    assert.equal(fixture.getCount, 1);
    assertContextProbeSafe(result);
    await fixture.session.close();
  }
});

test('context non-navigation abort metadata is bounded by 100 requests and 16 enum-distinct groups', async () => {
  const resources = [
    'xhr',
    'fetch',
    'image',
    'script',
    'stylesheet',
    'font',
    'media',
    'document',
    'other',
  ];
  const methods = ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'UNKNOWN'];
  const blockedRequests = Array.from({ length: 105 }, (_, index) => ({
    url: 'https://fanqienovel.com/api/opaque/PRIVATE_PATH_TOKEN/v0/?unknown=PRIVATE_PROBE_TOKEN',
    method: methods[Math.floor(index / resources.length) % methods.length]!,
    resourceType: resources[index % resources.length]!,
  }));
  const fixture = contextVolumeProbeFixture({ blockedRequests });
  const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(result.status, 'success');
  assert.equal(fixture.blocked, 105);
  assert.equal(fixture.getCount, 1);
  const metadata = result.chapterVolumeContext!.blockedRequests!;
  assert.equal(metadata.count, 100);
  assert.equal(metadata.entries.length, 16);
  assert.equal(metadata.truncated, true);
  assert.equal(metadata.summary, 'blocked_non_navigation');
  assert.equal(
    metadata.entries.every((entry) => entry.abortConfirmed && entry.navigation === false),
    true,
  );
  assertContextProbeSafe(result);
  assert.equal(JSON.stringify(result).includes('PRIVATE_PATH_TOKEN'), false);
  assert.equal(JSON.stringify(result).includes('unknown='), false);
  await fixture.session.close();
});

test('context blocked metadata phase is frozen or cleanup while all original document fences remain active', async () => {
  for (const phase of ['frozen', 'cleanup'] as const) {
    const blockedRequest = {
      url: `https://fanqienovel.com/api/opaque/private_fixture/v0/?book_id=${CHAPTER_ENTRY_FIXTURE_WORK}`,
      method: 'POST',
    };
    let fixture: ReturnType<typeof contextVolumeProbeFixture>;
    fixture = contextVolumeProbeFixture(
      phase === 'cleanup'
        ? { cleanupBlockedRequest: blockedRequest }
        : {
            duringGet: async () => {
              await fixture.triggerBlocked(blockedRequest);
            },
          },
    );
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.status, 'success');
    assert.equal(result.chapterVolumeContext!.blockedRequests!.entries[0]!.phase, phase);
    assert.equal(result.chapterVolumeContext!.blockedRequests!.summary, 'blocked_non_navigation');
    assert.equal(result.chapterVolumeContext!.checks.epochStable, true);
    assert.equal(fixture.getCount, 1);
    assert.equal(fixture.blocked, 1);
    assertContextProbeSafe(result);
    await fixture.session.close();
  }
  const failed = contextVolumeProbeFixture({
    cleanupBlockedRequest: {
      url: 'https://fanqienovel.com/api/opaque/private_fixture/v0/',
      method: 'POST',
      abortError: true,
    },
  });
  const withheld = await failed.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(withheld.chapterVolumeContext!.reason, 'bootstrap_request_blocked');
  assert.equal(withheld.chapterVolumeContext!.schema, null);
  assert.equal(withheld.chapterVolumeContext!.blockedRequests!.entries[0]!.phase, 'cleanup');
  assert.equal(withheld.chapterVolumeContext!.blockedRequests!.entries[0]!.abortConfirmed, false);
  assert.equal(failed.getCount, 1);
  assert.equal(failed.disposals, 1);
  await failed.session.close();
});
