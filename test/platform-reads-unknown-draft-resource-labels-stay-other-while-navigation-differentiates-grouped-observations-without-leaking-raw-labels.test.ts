import test from 'node:test';

import { draftsDiagnosticFixture } from './helpers/platform-reads-drafts-diagnostic-fixture.js';

import assert from 'node:assert/strict';

import { contextVolumeProbeFixture } from './helpers/platform-reads-context-volume-probe-fixture.js';

import {
  CONTEXT_PROBE_REF,
  CONTEXT_PROBE_SOURCE,
  CONTEXT_PROBE_TARGET,
} from './helpers/platform-reads-legacy-chapter-application-fixture.js';

import { assertContextProbeSafe } from './helpers/platform-reads-assert-context-probe-safe.js';

import { CHAPTER_ENTRY_FIXTURE_WORK } from './helpers/platform-reads-chapter-entry-fixture-work.js';

import { deferred } from './helpers/platform-reads-metrics-page.js';

test('unknown draft resource labels stay other while navigation differentiates grouped observations without leaking raw labels', async () => {
  const fixture = draftsDiagnosticFixture({
    blockedRequests: [
      {
        method: 'GET',
        resourceType: 'PRIVATE_RESOURCE_TYPE',
        navigation: false,
        url: 'https://fanqienovel.com/private/edit/private_title/private_token',
      },
      {
        method: 'GET',
        resourceType: 'PRIVATE_RESOURCE_TYPE',
        navigation: true,
        url: 'https://fanqienovel.com/private/edit/private_title/private_token',
      },
      { method: 'POST', resourceType: 'script', navigation: false, url: 'PRIVATE_INVALID_URL' },
    ],
  });
  const result = await fixture.diagnose();
  const entries = result.chapterTab?.blockedRequests?.entries ?? [];
  assert.deepEqual(
    entries.map((entry) => [entry.resourceType, entry.navigation, entry.pathClass, entry.count]),
    [
      ['other', false, 'unknown', 1],
      ['other', true, 'unknown', 1],
      ['script', false, 'invalid', 1],
    ],
  );
  assert.equal(result.chapterTab?.blockedRequests?.count, 3);
  assert.equal(fixture.blocked, 3);
  assert.equal(fixture.forwarded, 1);
  assert.equal(fixture.clicked, 1);
  assert.equal(fixture.privateRequestFieldReads, 0);
  assert.equal(fixture.unknownBodyReads, 0);
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(JSON.stringify(result.chapterTab).includes('PRIVATE_'), false);
  await fixture.session.close();
});

test('the fixed context volume experiment preserves the complete observed template and has independent provenance', async () => {
  const fixture = contextVolumeProbeFixture();
  const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(result.status, 'success');
  const diagnostic = result.chapterVolumeContext!;
  assert.equal(result.capturedAt, diagnostic.cdpSource!.proofCapturedAt);
  assert.ok(Date.parse(diagnostic.checkedAt) >= Date.parse(result.capturedAt));
  assert.ok(Date.parse(diagnostic.checkedAt) >= fixture.disposedAt);
  assert.equal(diagnostic.transport, 'browser_context_get');
  assert.equal(diagnostic.collectionProof, false);
  assert.equal(diagnostic.attempts, 1);
  assert.equal(diagnostic.reason, null);
  assert.equal(diagnostic.responseStatus, 200);
  assert.equal(fixture.calls[0]!.url, CONTEXT_PROBE_SOURCE);
  assert.equal(fixture.getCount, 1);
  assert.equal(fixture.disposals, 1);
  assert.equal(fixture.gotos, 1);
  assert.equal(fixture.guarded, false);
  assert.equal(diagnostic.checks.currentDocumentRequest, true);
  assert.equal(diagnostic.checks.sameContext, true);
  assert.equal(diagnostic.checks.sameOwnerBefore, true);
  assert.equal(diagnostic.checks.sameOwnerAfter, true);
  assert.equal(diagnostic.checks.responseDisposed, true);
  assert.deepEqual(result.getResponses, []);
  assert.deepEqual(result.readResponseStructure, []);
  assert.ok(
    diagnostic.schema?.fields.some(
      (field) => field.path === 'data.volume_list[].volume_id' && field.type === 'string',
    ),
  );
  assertContextProbeSafe(result);
  await fixture.session.close();
});

test('context probe accepts current-document query initialization but clears pre-reload and old-request candidates', async () => {
  const current = contextVolumeProbeFixture({ bootstrapQuery: true });
  const accepted = await current.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(accepted.status, 'success');
  assert.equal(current.getCount, 1);
  assert.equal(accepted.chapterVolumeContext!.checks.epochStable, true);
  await current.session.close();
  for (const options of [
    { reloadSameUrl: true },
    { sources: [{ url: CONTEXT_PROBE_SOURCE, old: true }] },
  ]) {
    const stale = contextVolumeProbeFixture(options);
    const result = await stale.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.chapterVolumeContext!.reason, 'template_missing');
    assert.equal(stale.getCount, 0);
    assert.equal(result.chapterVolumeContext!.schema, null);
    await stale.session.close();
  }
});

test('context volume source must be a unique mainframe GET with strict current parent and unmodified query semantics', async () => {
  const cases = [
    [],
    [{ url: CONTEXT_PROBE_SOURCE + '&opaque_fixture=PRIVATE_SECOND_VALUE' }],
    [{ url: CONTEXT_PROBE_SOURCE.replace(CHAPTER_ENTRY_FIXTURE_WORK, '7600000000000000002') }],
    [{ url: CONTEXT_PROBE_SOURCE + '&owner_id=1001' }],
    [{ url: CONTEXT_PROBE_SOURCE + '&bookId=' + CHAPTER_ENTRY_FIXTURE_WORK }],
    [{ url: CONTEXT_PROBE_SOURCE, subframe: true }],
    [{ url: CONTEXT_PROBE_SOURCE, method: 'POST' }],
    [
      {
        url:
          'https://external.invalid/api/author/volume/volume_list/v1?book_id=' +
          CHAPTER_ENTRY_FIXTURE_WORK,
      },
    ],
  ];
  for (const sources of cases) {
    const fixture = contextVolumeProbeFixture({ sources });
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.chapterVolumeContext!.reason, 'template_missing');
    assert.equal(fixture.getCount, 0);
    assertContextProbeSafe(result);
    await fixture.session.close();
  }
  const ambiguous = contextVolumeProbeFixture({
    sources: [
      { url: CONTEXT_PROBE_SOURCE },
      { url: CONTEXT_PROBE_SOURCE + '&second_opaque=PRIVATE_SECOND_VALUE' },
    ],
  });
  const result = await ambiguous.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(result.chapterVolumeContext!.reason, 'template_ambiguous');
  assert.equal(ambiguous.getCount, 0);
  await ambiguous.session.close();
});

test('context diagnostic dispatch requires only a registered opaque target and its original own-account binding', async () => {
  const fixture = contextVolumeProbeFixture();
  for (const [source, options] of [
    [CONTEXT_PROBE_TARGET, { chapterVolumeContext: true }],
    [`diagnostic:${'cd'.repeat(12)}`, { chapterVolumeContext: true }],
    [`diagnostic:${CONTEXT_PROBE_REF}`, { chapterVolumeContext: true, chapterTab: 'drafts' }],
    [
      `diagnostic:${CONTEXT_PROBE_REF}`,
      { chapterVolumeContext: true, openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK },
    ],
  ] as const)
    await assert.rejects(fixture.session.diagnoseReadPage(source, options), {
      code: 'invalid_chapter_context_target',
    });
  assert.equal(fixture.gotos, 0);
  assert.equal(fixture.getCount, 0);
  await fixture.session.close();
  const otherOwner = contextVolumeProbeFixture({ ownerMismatch: true });
  const result = await otherOwner.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(result.chapterVolumeContext!.reason, 'target_owner_mismatch');
  assert.equal(otherOwner.gotos, 0);
  assert.equal(otherOwner.getCount, 0);
  await otherOwner.session.close();
});

test('context probe rejects redirects, HTTP challenges, HTML and unsuccessful envelopes without exposing response values', async () => {
  for (const [options, reason] of [
    [{ responseUrl: 'https://external.invalid/?PRIVATE_PROBE_TOKEN' }, 'response_url_changed'],
    [{ responseStatus: 302 }, 'http_failed'],
    [{ responseStatus: 403 }, 'http_failed'],
    [{ jsonError: true }, 'json_unavailable'],
    [{ json: { code: 1, message: 'PRIVATE_API_BODY' } }, 'code_not_zero'],
  ] as const) {
    const fixture = contextVolumeProbeFixture(options);
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.chapterVolumeContext!.reason, reason);
    assert.equal(result.chapterVolumeContext!.schema, null);
    assert.equal(fixture.getCount, 1);
    assert.equal(fixture.disposals, 1);
    assertContextProbeSafe(result);
    await fixture.session.close();
  }
});

test('context GET cannot publish schema after document, route or owner changes during its await', async () => {
  for (const change of ['navigation_start', 'same_query', 'outside_and_back', 'owner'] as const) {
    const options: Parameters<typeof contextVolumeProbeFixture>[0] = {
      ownerAfter: change === 'owner',
    };
    let fixture: ReturnType<typeof contextVolumeProbeFixture>;
    options.duringGet = () => {
      if (change === 'navigation_start')
        fixture.emit('request', fixture.request(CONTEXT_PROBE_TARGET, 'GET', true));
      if (change === 'same_query') {
        fixture.setUrl(CONTEXT_PROBE_TARGET + '&tab=0');
        fixture.emit('framenavigated', fixture.page.mainFrame());
      }
      if (change === 'outside_and_back') {
        fixture.emitWithinDocument('https://external.invalid/PRIVATE_PROBE_TOKEN');
        fixture.emitWithinDocument(CONTEXT_PROBE_TARGET);
      }
    };
    fixture = contextVolumeProbeFixture(options);
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(
      result.chapterVolumeContext!.reason,
      change === 'owner' ? 'owner_changed' : 'document_changed',
    );
    assert.equal(result.chapterVolumeContext!.schema, null);
    assert.equal(fixture.disposals, 1);
    assertContextProbeSafe(result);
    await fixture.session.close();
  }
});

test('context experiment passes AbortSignal, keeps the page slot until its one GET settles and disposes late responses', async () => {
  const started = deferred(),
    release = deferred();
  const controller = new AbortController();
  const fixture = contextVolumeProbeFixture({
    duringGet: async () => {
      started.resolve();
      await release.promise;
    },
  });
  const operation = fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
    signal: controller.signal,
  });
  await started.promise;
  const next = fixture.session.withPage(async () => 'next');
  controller.abort();
  release.resolve();
  await assert.rejects(operation, { code: 'cancelled' });
  assert.equal(await next, 'next');
  assert.equal((fixture.calls[0]!.options as { signal: AbortSignal }).signal, controller.signal);
  assert.equal(fixture.getCount, 1);
  assert.equal(fixture.disposals, 1);
  await fixture.session.close();
});

test('context probe sanitizes transport and disposal exceptions, never retries or disposes the shared API context', async () => {
  for (const [options, reason] of [
    [{ transportError: true }, 'transport_failed'],
    [{ disposeError: true }, 'response_disposal_failed'],
  ] as const) {
    const fixture = contextVolumeProbeFixture(options);
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.chapterVolumeContext!.reason, reason);
    assert.equal(result.chapterVolumeContext!.schema, null);
    assert.equal(fixture.getCount, 1);
    assertContextProbeSafe(result);
    await fixture.session.close();
  }
});

test('context probe refuses a different browser context and blocks non-GET or write-labelled bootstrap requests', async () => {
  const wrong = contextVolumeProbeFixture({ contextMismatch: true });
  const rejected = await wrong.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(rejected.chapterVolumeContext!.reason, 'context_unavailable');
  assert.equal(wrong.getCount, 0);
  await wrong.session.close();
  for (const blockedRequest of [
    { url: 'https://fanqienovel.com/api/author/chapter/save/v0/', method: 'GET' },
    { url: 'https://fanqienovel.com/api/author/chapter/unknown-read/v0/', method: 'POST' },
  ]) {
    const fixture = contextVolumeProbeFixture({ blockedRequest });
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.status, 'success');
    assert.equal(result.chapterVolumeContext!.reason, null);
    assert.equal(result.chapterVolumeContext!.blockedRequests!.summary, 'blocked_non_navigation');
    assert.equal(result.chapterVolumeContext!.blockedRequests!.entries[0]!.abortConfirmed, true);
    assert.equal(fixture.blocked, 1);
    assert.equal(fixture.getCount, 1);
    assert.equal(fixture.guarded, false);
    await fixture.session.close();
  }
});
