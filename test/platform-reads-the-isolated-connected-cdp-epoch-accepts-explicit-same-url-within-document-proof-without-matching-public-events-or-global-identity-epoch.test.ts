import test from 'node:test';

import { contextVolumeProbeFixture } from './helpers/platform-reads-context-volume-probe-fixture.js';

import {
  CONTEXT_PROBE_TARGET,
  CONTEXT_PROBE_REF,
} from './helpers/platform-reads-legacy-chapter-application-fixture.js';

import assert from 'node:assert/strict';

import {
  assertContextProbeSafe,
  currentVolumeJson,
  CURRENT_CHAPTER_VOLUME,
  currentBookJson,
} from './helpers/platform-reads-assert-context-probe-safe.js';

import {
  CHAPTER_ENTRY_FIXTURE_WORK,
  CHAPTER_ENTRY_FIXTURE_TITLE,
} from './helpers/platform-reads-chapter-entry-fixture-work.js';

import { parseCurrentChapterVolumes, verifyCurrentChapterBook } from '../src/platform/reads.js';

test('the isolated connected CDP epoch accepts explicit same-URL within-document proof without matching public events or global identity epoch', async () => {
  for (const navigationType of ['sameDocument', 'historySameDocument']) {
    let fixture: ReturnType<typeof contextVolumeProbeFixture>;
    fixture = contextVolumeProbeFixture({
      ownBefore: {
        duringGet: () => {
          fixture.emitCdp('Page.frameStartedNavigating', {
            frameId: fixture.cdpRoot,
            loaderId: fixture.currentLoader,
            url: CONTEXT_PROBE_TARGET,
            navigationType,
          });
          fixture.emitCdp('Page.navigatedWithinDocument', {
            frameId: fixture.cdpRoot,
            url: CONTEXT_PROBE_TARGET,
          });
        },
      },
      ownAfter: { duringJson: () => fixture.emit('framenavigated', fixture.page.mainFrame()) },
    });
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.status, 'success');
    assert.equal(result.chapterVolumeContext!.checks.epochStable, true);
    assert.equal(result.chapterVolumeContext!.cdpSource!.epochBasis, 'owned_cdp_root_loader');
    assert.equal(result.chapterVolumeContext!.cdpSource!.publicFrameNavigatedMetadataOnly, true);
    assert.equal(result.chapterVolumeContext!.cdpSource!.frozenSameDocumentEvents, 1);
    assert.equal(
      result.chapterVolumeContext!.navigationTelemetry!.final.identityEpochChanged,
      true,
    );
    assert.equal(result.chapterVolumeContext!.navigationTelemetry!.firstViolation, null);
    assert.equal(result.chapterVolumeContext!.checks.sameOwnerBefore, true);
    assert.equal(result.chapterVolumeContext!.checks.sameOwnerAfter, true);
    assert.equal(fixture.ownGetCount, 2);
    assert.equal(fixture.getCount, 1);
    assertContextProbeSafe(result);
    await fixture.session.close();
  }
  let unpaired: ReturnType<typeof contextVolumeProbeFixture>;
  unpaired = contextVolumeProbeFixture({
    duringGet: () =>
      unpaired.emitCdp('Page.navigatedWithinDocument', {
        frameId: unpaired.cdpRoot,
        url: CONTEXT_PROBE_TARGET,
      }),
  });
  const observed = await unpaired.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(observed.status, 'success');
  assert.equal(observed.chapterVolumeContext!.cdpSource!.frozenSameDocumentEvents, 1);
  assert.equal(observed.chapterVolumeContext!.navigationTelemetry!.events.length, 2);
  assertContextProbeSafe(observed);
  await unpaired.session.close();
});

test('new-document reuse, unresolved or overlapping same-document starts and unknown loaders never yield isolated schema', async () => {
  for (const change of [
    'new_document_reused_loader',
    'pending',
    'overlap',
    'foreign_loader',
    'unknown_start',
  ] as const) {
    let fixture: ReturnType<typeof contextVolumeProbeFixture>;
    fixture = contextVolumeProbeFixture({
      ownBefore: {
        duringGet: () => {
          if (change === 'new_document_reused_loader') {
            fixture.emitCdp('Page.frameNavigated', {
              frame: {
                id: fixture.cdpRoot,
                loaderId: fixture.currentLoader,
                url: CONTEXT_PROBE_TARGET,
              },
            });
            fixture.emitCdp('Page.navigatedWithinDocument', {
              frameId: fixture.cdpRoot,
              url: CONTEXT_PROBE_TARGET,
            });
            return;
          }
          const start = {
            frameId: fixture.cdpRoot,
            loaderId:
              change === 'foreign_loader' ? 'SYNTHETIC_OTHER_LOADER' : fixture.currentLoader,
            url: CONTEXT_PROBE_TARGET,
            navigationType:
              change === 'unknown_start' ? 'UNKNOWN_SYNTHETIC_NAVIGATION' : 'historySameDocument',
          };
          fixture.emitCdp('Page.frameStartedNavigating', start);
          if (change === 'overlap') {
            fixture.emitCdp('Page.frameStartedNavigating', start);
            fixture.emitCdp('Page.navigatedWithinDocument', {
              frameId: fixture.cdpRoot,
              url: CONTEXT_PROBE_TARGET,
            });
          }
        },
      },
    });
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.chapterVolumeContext!.reason, 'document_changed');
    assert.equal(result.chapterVolumeContext!.schema, null);
    assert.equal(result.chapterVolumeContext!.cdpSource!.proofCapturedAt, null);
    assert.equal(result.chapterVolumeContext!.checks.epochStable, false);
    assert.equal(fixture.ownGetCount, 1);
    assert.equal(fixture.ownDisposals, 1);
    assert.equal(fixture.getCount, 0);
    assertContextProbeSafe(result);
    await fixture.session.close();
  }
});

test('frozen same-document events are bounded and cleanup retains the connected cutoff with late canonical vetoes', async () => {
  for (const count of [32, 33]) {
    let fixture: ReturnType<typeof contextVolumeProbeFixture>;
    fixture = contextVolumeProbeFixture({
      duringGet: () => {
        for (let index = 0; index < count; index += 1)
          fixture.emitCdp('Page.navigatedWithinDocument', {
            frameId: fixture.cdpRoot,
            url: CONTEXT_PROBE_TARGET,
          });
      },
    });
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.status, count === 32 ? 'success' : 'capability_unavailable');
    assert.equal(result.chapterVolumeContext!.cdpSource!.frozenSameDocumentEvents, 32);
    assert.equal(fixture.getCount, 1);
    assert.equal(fixture.disposals, 1);
    assertContextProbeSafe(result);
    await fixture.session.close();
  }
  let metadata: ReturnType<typeof contextVolumeProbeFixture>;
  metadata = contextVolumeProbeFixture({
    duringDetach: () => metadata.emit('framenavigated', metadata.page.mainFrame()),
    afterCdpClose: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    },
  });
  const historical = await metadata.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(historical.status, 'success');
  assert.equal(historical.capturedAt, historical.chapterVolumeContext!.cdpSource!.proofCapturedAt);
  assert.ok(
    Date.parse(historical.capturedAt) < Date.parse(historical.chapterVolumeContext!.checkedAt),
  );
  assert.equal(historical.chapterVolumeContext!.checks.epochStable, true);
  assert.equal(historical.chapterVolumeContext!.cdpSource!.connected, false);
  assertContextProbeSafe(historical);
  await metadata.session.close();
  for (const afterClose of [false, true]) {
    let late: ReturnType<typeof contextVolumeProbeFixture>;
    const invalidate = () =>
      late.emitCdp(
        afterClose ? 'Page.navigatedWithinDocument' : 'Page.frameStartedNavigating',
        afterClose
          ? { frameId: late.cdpRoot, url: CONTEXT_PROBE_TARGET }
          : {
              frameId: late.cdpRoot,
              loaderId: late.currentLoader,
              url: CONTEXT_PROBE_TARGET,
              navigationType: 'restore',
            },
      );
    late = contextVolumeProbeFixture(
      afterClose ? { afterCdpClose: invalidate } : { duringDetach: invalidate },
    );
    const result = await late.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.chapterVolumeContext!.reason, 'document_changed');
    assert.equal(result.chapterVolumeContext!.schema, null);
    assert.equal(result.chapterVolumeContext!.cdpSource!.proofCapturedAt, null);
    assert.equal(result.capturedAt, result.chapterVolumeContext!.checkedAt);
    assert.equal(late.getCount, 1);
    assertContextProbeSafe(result);
    await late.session.close();
  }
});

test('the controlled CDP Document may precede repeated permitted Starts, but a mismatched final loader still fails closed', async () => {
  const fixture = contextVolumeProbeFixture({ initialDocumentBeforeStart: true });
  const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(result.status, 'success');
  assert.equal(fixture.getCount, 1);
  assert.equal(fixture.ownGetCount, 2);
  assert.equal(result.chapterVolumeContext!.checks.templateObserved, true);
  assert.equal(result.chapterVolumeContext!.checks.currentDocumentRequest, true);
  assert.equal(result.chapterVolumeContext!.checks.epochStable, true);
  assert.equal(result.chapterVolumeContext!.cdpSource!.proofCapturedAt, result.capturedAt);
  assertContextProbeSafe(result);
  await fixture.session.close();
  for (const options of [
    { initialDocumentBeforeStart: true, repeatInitialStart: true },
    {
      initialDocumentBeforeStart: true,
      initialStartOverride: { url: CONTEXT_PROBE_TARGET + '&tab=0' },
    },
  ]) {
    const progress = contextVolumeProbeFixture(options);
    const accepted = await progress.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(accepted.status, 'success');
    assert.equal(progress.getCount, 1);
    assert.equal(progress.ownGetCount, 2);
    assert.equal(accepted.chapterVolumeContext!.checks.currentDocumentRequest, true);
    assertContextProbeSafe(accepted);
    await progress.session.close();
  }
  for (const options of [
    {
      initialDocumentBeforeStart: true,
      initialStartOverride: { loaderId: 'SYNTHETIC_FOREIGN_INITIAL_LOADER' },
    },
    {
      initialDocumentBeforeStart: true,
      initialStartOverride: {
        url: CONTEXT_PROBE_TARGET.replace(CHAPTER_ENTRY_FIXTURE_WORK, '7600000000000000002'),
      },
    },
  ]) {
    const rejected = contextVolumeProbeFixture(options);
    const diagnostic = await rejected.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(diagnostic.chapterVolumeContext!.reason, 'document_changed');
    assert.equal(rejected.getCount, 0);
    assert.equal(rejected.ownGetCount, 0);
    assert.equal(diagnostic.chapterVolumeContext!.schema, null);
    assert.equal(diagnostic.chapterVolumeContext!.cdpSource!.proofCapturedAt, null);
    assertContextProbeSafe(diagnostic);
    await rejected.session.close();
  }
});

test('fixed current directory parsers bind every volume and book to its exact parent without alias or completeness inference', () => {
  assert.deepEqual(parseCurrentChapterVolumes(currentVolumeJson(), CHAPTER_ENTRY_FIXTURE_WORK), [
    { volumeId: CURRENT_CHAPTER_VOLUME, itemCount: 2, index: 0, name: 'Synthetic volume' },
  ]);
  assert.equal(
    'complete' in parseCurrentChapterVolumes(currentVolumeJson(), CHAPTER_ENTRY_FIXTURE_WORK),
    false,
  );
  verifyCurrentChapterBook(
    currentBookJson(),
    CHAPTER_ENTRY_FIXTURE_WORK,
    CHAPTER_ENTRY_FIXTURE_TITLE,
  );
  for (const row of [
    { ...currentVolumeJson().data.volume_list[0]!, book_id: '7600000000000000002' },
    { ...currentVolumeJson().data.volume_list[0]!, item_count: '2' },
    { ...currentVolumeJson().data.volume_list[0]!, volume_id: 7700000000000000001 },
  ])
    assert.throws(
      () =>
        parseCurrentChapterVolumes(
          { code: 0, data: { volume_list: [row] } },
          CHAPTER_ENTRY_FIXTURE_WORK,
        ),
      { code: 'chapter_volume_fields_unverified' },
    );
  const duplicate = currentVolumeJson().data.volume_list[0]!;
  assert.throws(() =>
    parseCurrentChapterVolumes(
      { code: 0, data: { volume_list: [duplicate, duplicate] } },
      CHAPTER_ENTRY_FIXTURE_WORK,
    ),
  );
  assert.throws(
    () =>
      verifyCurrentChapterBook(
        {
          code: 0,
          data: { book_id: CHAPTER_ENTRY_FIXTURE_WORK, title: CHAPTER_ENTRY_FIXTURE_TITLE },
        },
        CHAPTER_ENTRY_FIXTURE_WORK,
        CHAPTER_ENTRY_FIXTURE_TITLE,
      ),
    { code: 'chapter_book_parent_mismatch' },
  );
});
