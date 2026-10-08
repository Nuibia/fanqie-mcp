import test from 'node:test';

import {
  currentDirectoryFixture,
  assertCurrentBootstrapMetadataShape,
  assertContextProbeSafe,
  CURRENT_DIRECTORY_BOOK,
  CURRENT_DIRECTORY_CHAPTER,
} from './helpers/platform-reads-assert-context-probe-safe.js';

import assert from 'node:assert/strict';

import { CHAPTER_ENTRY_FIXTURE_TITLE } from './helpers/platform-reads-chapter-entry-fixture-work.js';

import {
  CONTEXT_PROBE_SOURCE,
  CONTEXT_PROBE_REF,
  CONTEXT_PROBE_TARGET,
} from './helpers/platform-reads-legacy-chapter-application-fixture.js';

import { contextVolumeProbeFixture } from './helpers/platform-reads-context-volume-probe-fixture.js';

test('current bootstrap failure metadata remains failure-only and never replaces the original reason or legacy output', async () => {
  const early = currentDirectoryFixture({ ownBefore: { responseStatus: 403 }, detachError: true });
  const failure = await early.call(),
    origin = failure.readDiagnostics!.currentChapterCollection!;
  assert.equal(origin.failedStage, 'fresh_own_before');
  assert.equal(origin.observedReason, 'identity_unverified');
  assert.equal(origin.canonicalBootstrap, null);
  assertCurrentBootstrapMetadataShape(failure.readDiagnostics);
  await early.session.close();
  const callback = currentDirectoryFixture();
  const rejected = await callback.call({
    onVerifiedOwner: () => {
      throw Object.assign(Error('PRIVATE_CALLBACK'), {
        code: 'PRIVATE_CODE',
        reason: 'PRIVATE_REASON',
        canonicalBootstrap: { title: CHAPTER_ENTRY_FIXTURE_TITLE },
      });
    },
  });
  assert.equal(rejected.readDiagnostics!.currentChapterCollection!.failedStage, 'owner_callback');
  assert.equal(
    rejected.readDiagnostics!.currentChapterCollection!.observedReason,
    'identity_unverified',
  );
  assert.equal(rejected.readDiagnostics!.currentChapterCollection!.canonicalBootstrap, null);
  assertCurrentBootstrapMetadataShape(rejected.readDiagnostics);
  await callback.session.close();
  const cleanup = currentDirectoryFixture({ detachError: true });
  const discarded = await cleanup.call();
  assert.equal(discarded.readDiagnostics!.currentChapterCollection!.failedStage, 'cleanup');
  assert.equal(
    discarded.readDiagnostics!.currentChapterCollection!.observedReason,
    'document_changed',
  );
  assert.equal(discarded.readDiagnostics!.currentChapterCollection!.canonicalBootstrap, null);
  assertCurrentBootstrapMetadataShape(discarded.readDiagnostics);
  await cleanup.session.close();
  const disposal = currentDirectoryFixture({ detachError: true }),
    context = disposal.page.context(),
    get = context.request.get.bind(context.request);
  let volumes = 0;
  context.request.get = (async (url, options) => {
    const response = await get(url, options);
    if (url === CONTEXT_PROBE_SOURCE && ++volumes === 1)
      response.dispose = async () => {
        throw Error('PRIVATE_FIRST_CLEANUP_FAILURE');
      };
    return response;
  }) as typeof context.request.get;
  const twice = await disposal.call();
  assert.equal(twice.readDiagnostics!.currentChapterCollection!.failedStage, 'cleanup');
  assert.equal(
    twice.readDiagnostics!.currentChapterCollection!.observedReason,
    'response_disposal_failed',
  );
  assert.equal(twice.readDiagnostics!.currentChapterCollection!.canonicalBootstrap, null);
  assert.deepEqual(twice.records, []);
  assertCurrentBootstrapMetadataShape(twice.readDiagnostics);
  await disposal.session.close();
  const current = currentDirectoryFixture();
  const partial = await current.call();
  assert.equal(partial.status, 'partial');
  assert.equal(partial.coverage.complete, false);
  assert.equal(partial.readDiagnostics, undefined);
  await current.session.close();
  const legacy = contextVolumeProbeFixture({ cdpUnavailable: true });
  const diagnostic = await legacy.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(diagnostic.chapterVolumeContext!.reason, 'context_unavailable');
  assert.equal(JSON.stringify(diagnostic).includes('canonicalBootstrap'), false);
  assert.equal(JSON.stringify(diagnostic).includes('observedReason'), false);
  assertContextProbeSafe(diagnostic);
  await legacy.session.close();
});

test('controlled bootstrap supports repeated protocol starts, same-document escalation and explicit initial within-document completion', async () => {
  for (const options of [
    {
      initialStarts: [
        { navigationType: 'sameDocument' },
        { navigationType: 'historySameDocument' },
        {
          navigationType: 'differentDocument',
          loaderId: 'SYNTHETIC_CANCELLED_LOADER',
          url: CONTEXT_PROBE_TARGET + '&tab=0',
        },
      ],
      repeatInitialStart: true,
    },
    {
      initialDocumentBeforeStart: true,
      repeatInitialStart: true,
      initialStartOverride: { url: CONTEXT_PROBE_TARGET + '&tab=0' },
    },
    { initialSameDocument: true },
  ]) {
    const fixture = contextVolumeProbeFixture(options);
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.status, 'success');
    assert.equal(fixture.getCount, 1);
    assert.equal(fixture.ownGetCount, 2);
    assert.equal(fixture.ownDisposals, 2);
    assert.equal(result.chapterVolumeContext!.checks.currentDocumentRequest, true);
    assert.equal(result.chapterVolumeContext!.checks.sameOwnerBefore, true);
    assert.equal(result.chapterVolumeContext!.collectionProof, false);
    assertContextProbeSafe(result);
    await fixture.session.close();
  }
});

test('bootstrap replacement clears every family and request identity before retaining only the latest committed loader', async () => {
  for (const latestSource of [false, true]) {
    let fixture: ReturnType<typeof contextVolumeProbeFixture>;
    fixture = contextVolumeProbeFixture({
      duringBootstrap: () => {
        const oldLoader = fixture.currentLoader;
        fixture.emitNewDocument(CONTEXT_PROBE_TARGET + '&tab=0', 'SYNTHETIC_LATEST_LOADER');
        fixture.emitSource({
          url: CONTEXT_PROBE_SOURCE + '&stale_candidate=PRIVATE_OPAQUE',
          cdp: { loaderId: oldLoader },
        });
        if (latestSource)
          fixture.emitSource({
            url: CONTEXT_PROBE_SOURCE,
            cdp: { requestId: 'SYNTHETIC_REQUEST_2' },
          });
      },
    });
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.status, latestSource ? 'success' : 'capability_unavailable');
    assert.equal(result.chapterVolumeContext!.reason, latestSource ? null : 'template_missing');
    assert.equal(fixture.getCount, latestSource ? 1 : 0);
    if (latestSource) assert.equal(fixture.calls[0]!.url, CONTEXT_PROBE_SOURCE);
    else assert.equal(result.chapterVolumeContext!.schema, null);
    assertContextProbeSafe(result);
    await fixture.session.close();
  }
  let fixture: ReturnType<typeof currentDirectoryFixture>;
  fixture = currentDirectoryFixture({
    duringBootstrap: () => {
      if (!fixture.gotos) return;
      fixture.emitNewDocument(CONTEXT_PROBE_TARGET, 'SYNTHETIC_LATEST_DIRECTORY_LOADER');
      fixture.emitSource({ url: CONTEXT_PROBE_SOURCE });
    },
  });
  const result = await fixture.call();
  assert.equal(result.status, 'capability_unavailable');
  assert.deepEqual(result.records, []);
  assert.equal(result.errors[0]!.code, 'chapter_current_sources_unverified');
  assert.equal(fixture.getCount, 0);
  assert.equal(result.coverage.paginationComplete, false);
  assert.equal(fixture.identities.length, 0);
  await fixture.session.close();
  let completeCurrent: ReturnType<typeof currentDirectoryFixture>;
  completeCurrent = currentDirectoryFixture({
    duringBootstrap: () => {
      if (!completeCurrent.gotos) return;
      completeCurrent.emitNewDocument(CONTEXT_PROBE_TARGET, 'SYNTHETIC_LATEST_DIRECTORY_LOADER');
      completeCurrent.emitSource({ url: CONTEXT_PROBE_SOURCE });
      completeCurrent.emitSource({ url: CURRENT_DIRECTORY_BOOK });
      completeCurrent.emitSource({ url: CURRENT_DIRECTORY_CHAPTER });
    },
  });
  const current = await completeCurrent.call();
  assert.equal(current.status, 'partial');
  assert.equal(current.records.length, 1);
  assert.equal(current.coverage.complete, false);
  assert.equal(current.coverage.paginationComplete, false);
  assert.equal(completeCurrent.identities.length, 1);
  assert.equal(completeCurrent.getCount, 5);
  await completeCurrent.session.close();
});

test('bootstrap cannot settle a cancelled or stale candidate, infer navigation from a frame snapshot or exceed its fixed event bound', async () => {
  for (const change of [
    'cancelled',
    'stale_commit',
    'unpaired_commit',
    'within_during_newdoc',
    'unknown_start',
    'other_parent',
    'bounded',
  ] as const) {
    let fixture: ReturnType<typeof contextVolumeProbeFixture>;
    fixture = contextVolumeProbeFixture({
      duringBootstrap: () => {
        const start = {
          frameId: fixture.cdpRoot,
          loaderId: 'SYNTHETIC_PENDING_LOADER',
          url: CONTEXT_PROBE_TARGET,
          navigationType: 'differentDocument',
        };
        if (change === 'unpaired_commit') {
          fixture.commitDocument(CONTEXT_PROBE_TARGET, fixture.currentLoader);
          return;
        }
        if (change === 'bounded') {
          for (let i = 0; i < 33; i += 1) fixture.emitCdp('Page.frameStartedNavigating', start);
          fixture.commitDocument(CONTEXT_PROBE_TARGET, start.loaderId);
          return;
        }
        fixture.emitCdp('Page.frameStartedNavigating', {
          ...start,
          navigationType: change === 'unknown_start' ? 'UNKNOWN_NAVIGATION' : start.navigationType,
          url:
            change === 'other_parent'
              ? CONTEXT_PROBE_TARGET + '&book_id=7600000000000000002'
              : start.url,
        });
        if (change === 'stale_commit')
          fixture.commitDocument(CONTEXT_PROBE_TARGET, fixture.currentLoader);
        if (change === 'within_during_newdoc')
          fixture.emitCdp('Page.navigatedWithinDocument', {
            frameId: fixture.cdpRoot,
            url: CONTEXT_PROBE_TARGET,
          });
      },
    });
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.chapterVolumeContext!.reason, 'document_changed');
    assert.equal(result.chapterVolumeContext!.schema, null);
    assert.equal(result.chapterVolumeContext!.cdpSource!.proofCapturedAt, null);
    assert.equal(fixture.ownGetCount, 0);
    assert.equal(fixture.getCount, 0);
    assertContextProbeSafe(result);
    await fixture.session.close();
  }
});

test('initial deferred root commits retain loader-only semantics before controlled bootstrap without authorizing a target', async () => {
  let fixture: ReturnType<typeof contextVolumeProbeFixture>;
  fixture = contextVolumeProbeFixture({
    duringCdpInitialize: () =>
      fixture.emitCdp('Page.frameNavigated', {
        frame: { id: fixture.cdpRoot, loaderId: fixture.currentLoader, url: fixture.page.url() },
      }),
  });
  const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(result.status, 'success');
  assert.equal(fixture.gotos, 1);
  assert.equal(fixture.getCount, 1);
  assert.equal(fixture.ownGetCount, 2);
  assert.equal(result.chapterVolumeContext!.cdpSource!.initialized, true);
  assert.equal(result.chapterVolumeContext!.checks.currentDocumentRequest, true);
  assert.equal(result.chapterVolumeContext!.checks.epochStable, true);
  assert.equal(result.chapterVolumeContext!.navigationTelemetry!.firstViolation, null);
  assert.equal(result.chapterVolumeContext!.collectionProof, false);
  assertContextProbeSafe(result);
  await fixture.session.close();
});
