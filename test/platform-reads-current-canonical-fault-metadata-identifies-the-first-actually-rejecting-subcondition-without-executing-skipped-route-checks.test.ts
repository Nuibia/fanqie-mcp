import test from 'node:test';

import {
  currentDirectoryFixture,
  assertCurrentBootstrapMetadataShape,
  assertContextProbeSafe,
  CURRENT_DIRECTORY_BOOK,
  CURRENT_DIRECTORY_CHAPTER,
} from './helpers/platform-reads-assert-context-probe-safe.js';

import {
  CONTEXT_PROBE_TARGET,
  CONTEXT_PROBE_REF,
  CONTEXT_PROBE_SOURCE,
} from './helpers/platform-reads-legacy-chapter-application-fixture.js';

import assert from 'node:assert/strict';

import { contextVolumeProbeFixture } from './helpers/platform-reads-context-volume-probe-fixture.js';

test('current canonical fault metadata identifies the first actually rejecting subcondition without executing skipped route checks', async () => {
  for (const mode of [
    'start_loader',
    'unknown_start',
    'unpaired_commit',
    'within_pending',
    'document_loader',
    'missing_detach_frame',
    'other_root_commit',
  ] as const) {
    let fixture: ReturnType<typeof currentDirectoryFixture>;
    let skippedRouteCoercions = 0;
    fixture = currentDirectoryFixture({
      duringBootstrap: () => {
        if (!fixture.gotos) return;
        const start = {
          frameId: fixture.cdpRoot,
          loaderId: fixture.currentLoader,
          url: CONTEXT_PROBE_TARGET,
          navigationType: 'differentDocument',
        };
        if (mode === 'start_loader')
          fixture.emitCdp('Page.frameStartedNavigating', {
            ...start,
            loaderId: '',
            url: {
              [Symbol.toPrimitive]() {
                skippedRouteCoercions += 1;
                throw Error('PRIVATE_SKIPPED_ROUTE');
              },
            },
          });
        if (mode === 'unknown_start')
          fixture.emitCdp('Page.frameStartedNavigating', {
            ...start,
            navigationType: 'PRIVATE_UNKNOWN_TYPE',
          });
        if (mode === 'unpaired_commit')
          fixture.commitDocument(CONTEXT_PROBE_TARGET, fixture.currentLoader);
        if (mode === 'within_pending') {
          fixture.emitCdp('Page.frameStartedNavigating', {
            ...start,
            loaderId: 'SYNTHETIC_PENDING',
          });
          fixture.emitCdp('Page.navigatedWithinDocument', {
            frameId: fixture.cdpRoot,
            url: CONTEXT_PROBE_TARGET,
          });
        }
        if (mode === 'document_loader') {
          fixture.emitCdp('Page.frameStartedNavigating', {
            ...start,
            loaderId: 'SYNTHETIC_PENDING',
          });
          fixture.emitDocument(CONTEXT_PROBE_TARGET, 'SYNTHETIC_OTHER_LOADER');
        }
        if (mode === 'missing_detach_frame') fixture.emitCdp('Page.frameDetached', { frameId: '' });
        if (mode === 'other_root_commit')
          fixture.emitCdp('Page.frameNavigated', {
            frame: {
              id: 'SYNTHETIC_OTHER_ROOT',
              loaderId: fixture.currentLoader,
              url: CONTEXT_PROBE_TARGET,
            },
          });
      },
    });
    const result = await fixture.call(),
      metadata = result.readDiagnostics!.currentChapterCollection!;
    const expected = {
      start_loader: { site: 'start_base', predicate: 'loader_missing' },
      unknown_start: { site: 'start_new_document', predicate: 'unknown_navigation_type' },
      unpaired_commit: { site: 'commit_controlled', predicate: 'no_pending_new_document' },
      within_pending: null,
      document_loader: { site: 'document_base', predicate: 'pending_loader_mismatch' },
      missing_detach_frame: { site: 'frame_detach', predicate: 'frame_missing' },
      other_root_commit: { site: 'commit_frame', predicate: 'other_root_without_parent' },
    }[mode];
    assert.deepEqual(metadata.canonicalBootstrap!.firstCdpFaultCheck, expected);
    assert.equal(skippedRouteCoercions, 0);
    assert.equal(metadata.failedStage, 'canonical_bootstrap');
    assert.equal(metadata.observedReason, 'document_changed');
    assert.equal(result.status, 'capability_unavailable');
    assert.deepEqual(result.records, []);
    assert.equal(result.coverage.pagesFetched, 0);
    assert.equal(fixture.ownGetCount, 0);
    assert.equal(fixture.getCount, 0);
    assert.equal(fixture.identities.length, 0);
    assertCurrentBootstrapMetadataShape(result.readDiagnostics);
    await fixture.session.close();
  }
});

test('current canonical fault metadata commits only an actual fault and preserves the first classification across later callbacks and cleanup', async () => {
  let fixture: ReturnType<typeof currentDirectoryFixture>;
  let errorPropertyReads = 0;
  fixture = currentDirectoryFixture({
    duringBootstrap: () => {
      if (!fixture.gotos) return;
      const request = fixture.request(CONTEXT_PROBE_TARGET, 'GET', true);
      const error = new Error('PRIVATE_REQUEST_ERROR');
      Object.defineProperty(error, 'code', {
        get() {
          errorPropertyReads += 1;
          return 'PRIVATE_CODE';
        },
      });
      request.frame = () => {
        throw error;
      };
      fixture.emit('request', request);
      fixture.emitCdp('Page.frameStartedNavigating', {
        frameId: fixture.cdpRoot,
        loaderId: '',
        url: CONTEXT_PROBE_TARGET,
        navigationType: 'differentDocument',
      });
    },
    duringDetach: () => fixture.emitCdp('Page.frameDetached', { frameId: fixture.cdpRoot }),
  });
  const result = await fixture.call(),
    metadata = result.readDiagnostics!.currentChapterCollection!;
  assert.deepEqual(metadata.canonicalBootstrap!.firstCdpFaultCheck, {
    site: 'public_request_frame',
    predicate: 'frame_unavailable',
  });
  assert.equal(errorPropertyReads, 0);
  assert.equal(JSON.stringify(metadata).includes('PRIVATE_'), false);
  assert.equal(metadata.failedStage, 'canonical_bootstrap');
  assert.deepEqual(result.records, []);
  assert.equal(fixture.ownGetCount, 0);
  await fixture.session.close();
  const direct = currentDirectoryFixture({
    blockedRequest: { url: CONTEXT_PROBE_TARGET, method: 'POST', navigation: true },
  });
  const blocked = await direct.call(),
    first = blocked.readDiagnostics!.currentChapterCollection!.canonicalBootstrap!;
  assert.equal(first.firstCdpFaultCheck, null);
  assert.equal(first.firstViolation!.reason, 'fatal_blocked_request');
  assert.equal(
    blocked.readDiagnostics!.currentChapterCollection!.observedReason,
    'bootstrap_request_blocked',
  );
  assert.equal(blocked.errors[0]!.code, 'read_document_changed');
  assert.deepEqual(blocked.records, []);
  await direct.session.close();
  const unavailable = currentDirectoryFixture({ contextMismatch: true });
  await assert.rejects(unavailable.call(), { code: 'chapter_directory_slot_required' });
  assert.equal(unavailable.ownGetCount, 0);
  assert.equal(unavailable.getCount, 0);
  await unavailable.session.close();
});

test('canonical fault metadata is absent from valid partial and legacy diagnostics and never converts a rejection to coverage', async () => {
  const valid = currentDirectoryFixture();
  const partial = await valid.call();
  assert.equal(partial.status, 'partial');
  assert.equal(partial.readDiagnostics, undefined);
  assert.equal(partial.coverage.complete, false);
  assert.equal(partial.coverage.paginationComplete, false);
  await valid.session.close();
  let legacy: ReturnType<typeof contextVolumeProbeFixture>;
  legacy = contextVolumeProbeFixture({
    duringBootstrap: () =>
      legacy.emitCdp('Page.frameStartedNavigating', {
        frameId: legacy.cdpRoot,
        loaderId: '',
        url: CONTEXT_PROBE_TARGET,
        navigationType: 'differentDocument',
      }),
  });
  const diagnostic = await legacy.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(diagnostic.status, 'capability_unavailable');
  assert.equal(diagnostic.chapterVolumeContext!.reason, 'document_changed');
  assert.equal(diagnostic.chapterVolumeContext!.schema, null);
  assert.equal(JSON.stringify(diagnostic).includes('firstCdpFaultCheck'), false);
  assert.equal(JSON.stringify(diagnostic).includes('canonicalBootstrap'), false);
  assertContextProbeSafe(diagnostic);
  await legacy.session.close();
});

test('bootstrap pending WithinDocument cannot authorize sources before a matching new-document commit', async () => {
  for (const latestSources of [false, true]) {
    let fixture: ReturnType<typeof currentDirectoryFixture>;
    fixture = currentDirectoryFixture({
      duringBootstrap: () => {
        if (!fixture.gotos) return;
        const oldLoader = fixture.currentLoader,
          nextLoader = 'SYNTHETIC_PENDING_WITHIN_LOADER';
        fixture.emitCdp('Page.frameStartedNavigating', {
          frameId: fixture.cdpRoot,
          loaderId: nextLoader,
          url: CONTEXT_PROBE_TARGET,
          navigationType: 'differentDocument',
        });
        fixture.emitCdp('Page.navigatedWithinDocument', {
          frameId: fixture.cdpRoot,
          url: CONTEXT_PROBE_TARGET,
        });
        fixture.emitSource({ url: CONTEXT_PROBE_SOURCE, cdp: { loaderId: oldLoader } });
        fixture.emitSource({
          url: CONTEXT_PROBE_SOURCE,
          cdp: { loaderId: nextLoader, requestId: 'SYNTHETIC_REQUEST_2' },
        });
        assert.equal(fixture.ownGetCount, 0);
        assert.equal(fixture.getCount, 0);
        assert.equal(fixture.identities.length, 0);
        fixture.commitDocument(CONTEXT_PROBE_TARGET, nextLoader);
        fixture.emitSource({ url: CONTEXT_PROBE_SOURCE, cdp: { loaderId: oldLoader } });
        if (latestSources) {
          fixture.emitSource({
            url: CONTEXT_PROBE_SOURCE,
            cdp: { requestId: 'SYNTHETIC_REQUEST_2' },
          });
          fixture.emitSource({ url: CURRENT_DIRECTORY_BOOK });
          fixture.emitSource({ url: CURRENT_DIRECTORY_CHAPTER });
        }
      },
    });
    const result = await fixture.call();
    assert.equal(result.status, latestSources ? 'partial' : 'capability_unavailable');
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.paginationComplete, false);
    assert.equal(fixture.ownGetCount, latestSources ? 2 : 1);
    assert.equal(fixture.getCount, latestSources ? 5 : 0);
    assert.equal(fixture.identities.length, latestSources ? 1 : 0);
    assert.equal(result.records.length, latestSources ? 1 : 0);
    assert.equal(result.coverage.pagesFetched, latestSources ? 1 : 0);
    if (latestSources) {
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
    } else {
      assert.equal(result.errors[0]!.code, 'template_missing');
      assert.deepEqual(result.records, []);
    }
    assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
    await fixture.session.close();
  }
});

test('bootstrap pending WithinDocument cannot settle a missing or mismatched new-document commit through a frame snapshot', async () => {
  for (const mode of ['no_commit', 'wrong_commit', 'bounded'] as const) {
    let fixture: ReturnType<typeof currentDirectoryFixture>;
    fixture = currentDirectoryFixture({
      duringBootstrap: () => {
        if (!fixture.gotos) return;
        const start = {
          frameId: fixture.cdpRoot,
          loaderId: 'SYNTHETIC_PENDING_WITHIN_LOADER',
          url: CONTEXT_PROBE_TARGET,
          navigationType: 'differentDocument',
        };
        fixture.emitCdp('Page.frameStartedNavigating', start);
        for (let i = 0; i < (mode === 'bounded' ? 33 : 1); i += 1)
          fixture.emitCdp('Page.navigatedWithinDocument', {
            frameId: fixture.cdpRoot,
            url: CONTEXT_PROBE_TARGET,
          });
        if (mode === 'wrong_commit')
          fixture.commitDocument(CONTEXT_PROBE_TARGET, fixture.currentLoader);
        if (mode === 'bounded') fixture.commitDocument(CONTEXT_PROBE_TARGET, start.loaderId);
      },
    });
    const result = await fixture.call(),
      metadata = result.readDiagnostics!.currentChapterCollection!;
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(metadata.failedStage, 'canonical_bootstrap');
    assert.equal(metadata.observedReason, 'document_changed');
    assert.equal(
      metadata.canonicalBootstrap!.firstCdpFaultCheck?.predicate ?? null,
      mode === 'no_commit'
        ? null
        : mode === 'wrong_commit'
          ? 'pending_loader_mismatch'
          : 'event_limit',
    );
    assert.equal(fixture.ownGetCount, 0);
    assert.equal(fixture.getCount, 0);
    assert.equal(fixture.identities.length, 0);
    assert.deepEqual(result.records, []);
    assert.equal(result.coverage.pagesFetched, 0);
    assert.deepEqual(result.coverage.fields, []);
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.paginationComplete, false);
    assertCurrentBootstrapMetadataShape(result.readDiagnostics);
    await fixture.session.close();
  }
});
