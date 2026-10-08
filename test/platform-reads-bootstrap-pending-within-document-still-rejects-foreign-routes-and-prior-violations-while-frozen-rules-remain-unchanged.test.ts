import test from 'node:test';

import {
  currentDirectoryFixture,
  CURRENT_DIRECTORY_BOOK,
  CURRENT_DIRECTORY_CHAPTER,
  assertCurrentBootstrapMetadataShape,
} from './helpers/platform-reads-assert-context-probe-safe.js';

import {
  CONTEXT_PROBE_TARGET,
  CONTEXT_PROBE_SOURCE,
  CONTEXT_PROBE_REF,
} from './helpers/platform-reads-legacy-chapter-application-fixture.js';

import { CHAPTER_ENTRY_FIXTURE_WORK } from './helpers/platform-reads-chapter-entry-fixture-work.js';

import assert from 'node:assert/strict';

import { assertCurrentSourceObservationSafe } from './helpers/platform-reads-assert-current-source-observation-safe.js';

import { contextVolumeProbeFixture } from './helpers/platform-reads-context-volume-probe-fixture.js';

test('bootstrap pending WithinDocument still rejects foreign routes and prior violations while frozen rules remain unchanged', async () => {
  for (const mode of ['foreign_work', 'external', 'prior_violation', 'frozen'] as const) {
    let fixture: ReturnType<typeof currentDirectoryFixture>;
    const progress = () => {
      if (!fixture.gotos) return;
      const start = {
        frameId: fixture.cdpRoot,
        loaderId: 'SYNTHETIC_PENDING_WITHIN_LOADER',
        url: CONTEXT_PROBE_TARGET,
        navigationType: 'differentDocument',
      };
      fixture.emitCdp('Page.frameStartedNavigating', start);
      if (mode === 'prior_violation')
        fixture.emitCdp('Page.frameDetached', { frameId: fixture.cdpRoot });
      fixture.emitCdp('Page.navigatedWithinDocument', {
        frameId: fixture.cdpRoot,
        url:
          mode === 'foreign_work'
            ? CONTEXT_PROBE_TARGET.replace(CHAPTER_ENTRY_FIXTURE_WORK, '7600000000000000002')
            : mode === 'external'
              ? 'https://external.invalid/PRIVATE_ROUTE'
              : CONTEXT_PROBE_TARGET,
      });
      fixture.commitDocument(CONTEXT_PROBE_TARGET, start.loaderId);
      fixture.emitSource({ url: CONTEXT_PROBE_SOURCE });
      fixture.emitSource({ url: CURRENT_DIRECTORY_BOOK });
      fixture.emitSource({ url: CURRENT_DIRECTORY_CHAPTER });
    };
    fixture = currentDirectoryFixture(
      mode === 'frozen' ? { ownBefore: { duringGet: progress } } : { duringBootstrap: progress },
    );
    const result = await fixture.call(),
      metadata = result.readDiagnostics!.currentChapterCollection!;
    assert.equal(result.status, 'capability_unavailable');
    assert.deepEqual(result.records, []);
    assert.equal(result.coverage.pagesFetched, 0);
    assert.deepEqual(result.coverage.fields, []);
    assert.equal(result.coverage.complete, false);
    assert.equal(fixture.getCount, 0);
    assert.equal(fixture.identities.length, 0);
    assert.equal(fixture.ownGetCount, mode === 'frozen' ? 1 : 0);
    assert.equal(fixture.ownDisposals, mode === 'frozen' ? 1 : 0);
    if (mode !== 'frozen')
      assert.equal(
        metadata.canonicalBootstrap!.firstCdpFaultCheck?.predicate,
        mode === 'prior_violation' ? 'root_detached' : 'route_not_permitted',
      );
    assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
    assertCurrentBootstrapMetadataShape(result.readDiagnostics);
    await fixture.session.close();
  }
});

test('current source observation distinguishes retained candidates cleared by navigation from ignored pending requests and locks the first failure', async () => {
  let fixture: ReturnType<typeof currentDirectoryFixture>;
  fixture = currentDirectoryFixture({
    duringBootstrap: () => {
      if (!fixture.gotos) return;
      fixture.emitCdp('Page.frameStartedNavigating', {
        frameId: fixture.cdpRoot,
        loaderId: 'SYNTHETIC_SOURCE_PENDING',
        url: CONTEXT_PROBE_TARGET,
        navigationType: 'differentDocument',
      });
      fixture.emitSource({
        url: CONTEXT_PROBE_SOURCE,
        cdp: { loaderId: 'SYNTHETIC_SOURCE_PENDING' },
      });
      fixture.emitSource({
        url: CURRENT_DIRECTORY_BOOK,
        cdp: { loaderId: 'SYNTHETIC_SOURCE_PENDING' },
      });
      fixture.emitSource({
        url: CURRENT_DIRECTORY_CHAPTER,
        cdp: { loaderId: 'SYNTHETIC_SOURCE_PENDING' },
      });
      fixture.commitDocument(CONTEXT_PROBE_TARGET, 'SYNTHETIC_SOURCE_PENDING');
    },
    duringDetach: () => fixture.emitSource({ url: CONTEXT_PROBE_SOURCE }),
  });
  const result = await fixture.call(),
    metadata = result.readDiagnostics!.currentChapterCollection!,
    source = metadata.sourceObservation!;
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(metadata.failedStage, 'volume_get');
  assert.equal(metadata.observedReason, 'template_missing');
  assert.equal(fixture.ownGetCount, 1);
  assert.equal(fixture.getCount, 0);
  assert.equal(fixture.identities.length, 0);
  assert.deepEqual(source.retainedAttempts, { volume: 1, book: 1, chapter: 1 });
  assert.deepEqual(source.currentSizes, { volume: 0, book: 0, chapter: 0 });
  assert.deepEqual(source.removedTotals, { volume: 1, book: 1, chapter: 1 });
  assert.equal(source.clearCounts.new_document_start, 2);
  assert.equal(source.clearCounts.new_document_request, 1);
  assert.equal(source.clearCounts.new_document_commit, 2);
  assert.equal(source.clearCounts.cleanup, 0);
  const pending = source.events.filter(
    (event) => event.kind === 'request' && event.outcome === 'state_filtered',
  );
  assert.equal(pending.length, 3);
  assert.ok(
    pending.every(
      (event) =>
        event.kind === 'request' &&
        event.loader === 'pending' &&
        event.frame === 'root' &&
        event.state.pendingNewDocument &&
        !event.state.committed,
    ),
  );
  assert.equal(
    source.events.some((event) => event.phase === 'cleanup'),
    false,
  );
  assert.deepEqual(result.records, []);
  assert.equal(result.coverage.complete, false);
  assertCurrentSourceObservationSafe(source);
  await fixture.session.close();
});

test('current source observation classifies rejected query, frame, loader and redirect facts without replaying an unverified template', async () => {
  for (const mode of [
    'duplicate_parent',
    'identity_filter',
    'foreign_parent',
    'external',
    'other_frame',
    'old_loader',
    'redirected',
  ] as const) {
    const url =
      mode === 'duplicate_parent'
        ? CONTEXT_PROBE_SOURCE + `&book_id=${CHAPTER_ENTRY_FIXTURE_WORK}`
        : mode === 'identity_filter'
          ? CONTEXT_PROBE_SOURCE + '&author_id=PRIVATE_ACCOUNT_TOKEN'
          : mode === 'foreign_parent'
            ? CONTEXT_PROBE_SOURCE.replace(CHAPTER_ENTRY_FIXTURE_WORK, '7600000000000000002')
            : mode === 'external'
              ? CONTEXT_PROBE_SOURCE.replace('fanqienovel.com', 'PRIVATE_EXTERNAL.invalid')
              : CONTEXT_PROBE_SOURCE;
    const cdp =
      mode === 'other_frame'
        ? { frameId: 'SYNTHETIC_OTHER_FRAME' }
        : mode === 'old_loader'
          ? { loaderId: 'SYNTHETIC_OLD_LOADER' }
          : mode === 'redirected'
            ? { redirectResponse: { PRIVATE_HEADER: 'PRIVATE_TOKEN' } }
            : {};
    const fixture = currentDirectoryFixture({
      sources: [{ url, cdp }, { url: CURRENT_DIRECTORY_BOOK }, { url: CURRENT_DIRECTORY_CHAPTER }],
    });
    const result = await fixture.call(),
      source = result.readDiagnostics!.currentChapterCollection!.sourceObservation!;
    const event = source.events.find(
      (event) => event.kind === 'request' && event.familyHint === 'volume',
    );
    assert(event && event.kind === 'request');
    assert.equal(
      event.outcome,
      mode === 'other_frame' || mode === 'old_loader'
        ? 'request_filtered'
        : mode === 'redirected'
          ? 'redirected'
          : 'url_filtered',
    );
    if (mode === 'duplicate_parent') {
      assert.equal(event.filters.duplicateQueryKeys, true);
      assert.equal(event.filters.parentBinding, 'ambiguous_work');
    }
    if (mode === 'identity_filter') assert.equal(event.filters.identityFilter, true);
    if (mode === 'foreign_parent') assert.equal(event.filters.parentBinding, 'other_work');
    if (mode === 'external') assert.equal(event.filters.origin, 'external');
    if (mode === 'other_frame') assert.equal(event.frame, 'other');
    if (mode === 'old_loader') assert.equal(event.loader, 'other');
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.errors[0]!.code, 'template_missing');
    assert.equal(fixture.getCount, 0);
    assert.equal(fixture.identities.length, 0);
    assert.deepEqual(result.records, []);
    assertCurrentSourceObservationSafe(source);
    await fixture.session.close();
  }
});

test('current source observation is bounded without consuming unknown traffic or coercing skipped objects and remains failure-only', async () => {
  let fixture: ReturnType<typeof currentDirectoryFixture>,
    coercions = 0;
  fixture = currentDirectoryFixture({
    ownBefore: { json: { code: 0, data: { id: '1002' } } },
    duringBootstrap: () => {
      if (!fixture.gotos) return;
      for (let i = 0; i < 150; i += 1)
        fixture.emitSource({
          url: 'https://fanqienovel.com/PRIVATE_UNKNOWN/PRIVATE_QUERY?PRIVATE_KEY=PRIVATE_TOKEN',
          method: 'POST',
        });
      for (let i = 0; i < 150; i += 1)
        fixture.emitSource({ url: CONTEXT_PROBE_SOURCE, method: 'POST' });
    },
  });
  const result = await fixture.call(),
    source = result.readDiagnostics!.currentChapterCollection!.sourceObservation!;
  assert.equal(source.count, 100);
  assert.equal(source.unclassifiedRequests, 100);
  assert.equal(source.truncated, true);
  assert.equal(source.events.length, 32);
  assert.ok(
    source.events.some(
      (event) =>
        event.kind === 'request' &&
        event.familyHint === 'volume' &&
        event.outcome === 'request_filtered',
    ),
  );
  assert.equal(source.retainedAttempts.volume, 1);
  assert.equal(source.currentSizes.volume, 1);
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(fixture.getCount, 0);
  assert.equal(fixture.identities.length, 0);
  assertCurrentSourceObservationSafe(source);
  await fixture.session.close();
  let skipped: ReturnType<typeof currentDirectoryFixture>;
  skipped = currentDirectoryFixture({
    duringBootstrap: () => {
      if (!skipped.gotos) return;
      skipped.emitCdp('Page.frameStartedNavigating', {
        frameId: skipped.cdpRoot,
        loaderId: 'SYNTHETIC_PENDING_SKIP',
        url: CONTEXT_PROBE_TARGET,
        navigationType: 'differentDocument',
      });
      const rawUrl = {
        [Symbol.toPrimitive]() {
          coercions += 1;
          throw Error('PRIVATE_COERCION');
        },
      };
      skipped.emitCdp('Network.requestWillBeSent', {
        requestId: 'SYNTHETIC_PENDING_REQUEST',
        loaderId: 'SYNTHETIC_PENDING_SKIP',
        frameId: skipped.cdpRoot,
        type: 'XHR',
        request: { url: rawUrl, method: 'GET' },
      });
    },
  });
  const rejected = await skipped.call();
  assert.equal(coercions, 0);
  assert.equal(rejected.status, 'capability_unavailable');
  assert.equal(skipped.ownGetCount, 0);
  assert.equal(skipped.getCount, 0);
  assert.equal(
    rejected.readDiagnostics!.currentChapterCollection!.sourceObservation!.unclassifiedRequests,
    1,
  );
  assertCurrentSourceObservationSafe(
    rejected.readDiagnostics!.currentChapterCollection!.sourceObservation!,
  );
  await skipped.session.close();
  const valid = currentDirectoryFixture();
  const partial = await valid.call();
  assert.equal(partial.status, 'partial');
  assert.equal(partial.readDiagnostics, undefined);
  await valid.session.close();
  const legacy = contextVolumeProbeFixture({ sources: [] });
  const diagnostic = await legacy.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(diagnostic.status, 'capability_unavailable');
  assert.equal(JSON.stringify(diagnostic).includes('sourceObservation'), false);
  assert.equal(legacy.getCount, 0);
  await legacy.session.close();
});
