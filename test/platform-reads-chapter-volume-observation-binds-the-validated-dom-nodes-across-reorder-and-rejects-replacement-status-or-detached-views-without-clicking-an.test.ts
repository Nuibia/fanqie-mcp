import test from 'node:test';

import { chapterEntryFixture } from './helpers/platform-reads-chapter-entry-fixture.js';

import { CHAPTER_SCHEMA_FIXTURE_SOURCES } from './helpers/platform-reads-chapter-core-row.js';

import { CHAPTER_ENTRY_FIXTURE_WORK } from './helpers/platform-reads-chapter-entry-fixture-work.js';

import assert from 'node:assert/strict';

import { managementDirectoryFixture } from './helpers/platform-reads-management-directory-fixture.js';

import { CONTEXT_PROBE_SOURCE } from './helpers/platform-reads-legacy-chapter-application-fixture.js';

import { CURRENT_DIRECTORY_BOOK } from './helpers/platform-reads-assert-context-probe-safe.js';

test('chapter volume observation binds the validated DOM nodes across reorder and rejects replacement status or detached views without clicking another control', async () => {
  for (const change of [
    'reorder_status',
    'replace_control',
    'status_change',
    'detach_view',
  ] as const) {
    const fixture = chapterEntryFixture({
      directorySources: [CHAPTER_SCHEMA_FIXTURE_SOURCES[1]!],
      chapterUi: {
        tabs: [{ label: '章节管理', active: true }],
        table: true,
        volumeLabels: ['PRIVATE_VOLUME_TITLE'],
        volumeOptions: [[{ attributes: { role: 'option' }, text: 'PRIVATE_OPTION' }]],
      },
      realChapterReadiness: {
        source: 'during_render',
        volumeExpansion: 'descendant',
        volumeBindingChange: change,
      },
    });
    if (change === 'reorder_status') {
      const result = await fixture.session.diagnoseReadPage(
        'https://fanqienovel.com/main/writer/book-manage',
        { openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK, chapterVolumeOptions: true },
      );
      assert.equal(result.status, 'success');
      assert.equal(fixture.volumeClickCount, 1);
    } else {
      await assert.rejects(
        fixture.session.diagnoseReadPage('https://fanqienovel.com/main/writer/book-manage', {
          openChaptersForWorkId: CHAPTER_ENTRY_FIXTURE_WORK,
          chapterVolumeOptions: true,
        }),
        { code: 'capability_unavailable' },
      );
      assert.equal(fixture.volumeClickCount, 0);
    }
    assert.equal(fixture.replacementClickCount, 0);
    assert.equal(fixture.volumeHandleDisposals, 3);
    assert.equal(fixture.routeInstalled, false);
    assert.equal(fixture.directoryGotoCount, 1);
    assert.equal(fixture.clickCount, 1);
    await fixture.session.close();
  }
});

test('management collector reconciles two bound volumes and follows only natural exact chapter pages under the original canonical proof', async () => {
  for (const variant of [{ portal: false }, { portal: true, delayedView: true }]) {
    const fixture = managementDirectoryFixture(variant);
    const result = await fixture.call();
    assert.equal(result.status, 'partial', JSON.stringify(result.errors));
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.paginationComplete, false);
    assert.deepEqual(result.managementCoverage, {
      scope: 'management_all_statuses',
      status: 'complete',
      draftsCovered: false,
      inventoryVolumes: 2,
      matchedVolumes: 2,
      completedVolumes: 2,
      pagesFetched: 3,
      recordsFetched: 3,
      allStatusObserved: true,
      inventoryReconciled: true,
      reasons: [],
    });
    assert.equal(result.records.length, 3);
    assert.equal(new Set(result.records.map((row) => row.chapterId)).size, 3);
    assert.equal(result.coverage.pagesFetched, 3);
    assert.deepEqual(
      fixture.calls.map((call) => call.url),
      [
        CONTEXT_PROBE_SOURCE,
        CURRENT_DIRECTORY_BOOK,
        fixture.initial,
        fixture.next,
        fixture.second,
        CONTEXT_PROBE_SOURCE,
        CURRENT_DIRECTORY_BOOK,
      ],
    );
    assert.equal(fixture.identities.length, 1);
    assert.equal(fixture.clicks, 3);
    assert.ok(fixture.handleDisposals > 0);
    assert.equal(result.readDiagnostics, undefined);
    assert.equal(result.statisticsThrough, null);
    assert.equal(JSON.stringify(result.managementCoverage).includes('PRIVATE_'), false);
    await fixture.session.close();
  }
});

test('unproved popup extent and missing actual next control remain partial without inventing pages or volume queries', async () => {
  for (const options of [{ unknownOption: true }, { clipped: true }, { noNext: true }]) {
    const fixture = managementDirectoryFixture(options);
    const result = await fixture.call();
    assert.equal(result.status, 'partial');
    assert.equal(result.managementCoverage?.status, 'partial');
    assert.equal(result.managementCoverage?.draftsCovered, false);
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.paginationComplete, false);
    assert.equal(
      fixture.calls.some((call) => call.url === fixture.second),
      false,
    );
    assert.equal(fixture.identities.length, 1);
    await fixture.session.close();
  }
});

test('volume handle replacement and untrusted action sources never choose replacements or adopt an ambiguous page', async () => {
  const changed = managementDirectoryFixture({ mutateControl: true, onePage: true });
  const partial = await changed.call();
  assert.equal(changed.clicks, 0);
  assert.equal(partial.managementCoverage?.status, 'partial');
  assert.equal(partial.managementCoverage?.inventoryReconciled, false);
  assert.equal(partial.records.length, 1);
  await changed.session.close();
  for (const wrongView of ['old_loader', 'other_work', 'ambiguous'] as const) {
    const fixture = managementDirectoryFixture({ wrongView });
    const result = await fixture.call();
    assert.equal(result.status, 'partial');
    assert.equal(result.records.length, 1);
    assert.equal(
      fixture.calls.some((call) => call.url === fixture.next),
      false,
    );
    assert.equal(result.coverage.complete, false);
    assert.equal(result.managementCoverage?.status, 'partial');
    await fixture.session.close();
  }
});

test('management traversal still discards every record on late navigation, changed final owner, callback failure or detach failure', async () => {
  for (const options of [
    { lateNavigation: true },
    { ownerAfter: true },
    { callbackError: true },
    { detachError: true },
    { cleanupError: true },
    { repeatedChapter: true },
    { totalDrift: true },
  ]) {
    const fixture = managementDirectoryFixture(options);
    const result = await fixture.call();
    assert.equal(result.status, 'capability_unavailable');
    assert.deepEqual(result.records, []);
    assert.equal(result.managementCoverage, undefined);
    assert.equal(result.coverage.recordsFetched, 0);
    assert.equal(result.coverage.pagesFetched, 0);
    assert.equal(result.coverage.complete, false);
    assert.ok(result.readDiagnostics?.currentChapterCollection);
    await fixture.session.close();
  }
});

test('management scope never backfills initial all-state proof, exceeds its deadline or attributes a preopened foreign portal and reused source ID', async () => {
  for (const initialFilterChange of ['before', 'after'] as const) {
    const fixture = managementDirectoryFixture({ initialFilterChange });
    const result = await fixture.call();
    assert.equal(result.status, 'partial');
    assert.equal(result.records.length, 1);
    assert.equal(result.managementCoverage?.status, 'partial');
    assert.equal(result.managementCoverage?.allStatusObserved, false);
    assert.equal(fixture.clicks, 0);
    assert.equal(
      fixture.calls.some((call) => call.url === fixture.next),
      false,
    );
    await fixture.session.close();
  }
  const delayedAction = managementDirectoryFixture({ boundAfterDeadline: true });
  const lateAction = await delayedAction.call();
  assert.equal(lateAction.status, 'partial');
  assert.equal(delayedAction.clicks, 0);
  assert.equal(lateAction.records.length, 1);
  assert.ok(lateAction.managementCoverage?.reasons.includes('read_budget_exceeded'));
  assert.equal(lateAction.managementCoverage?.status, 'partial');
  await delayedAction.session.close();
  const delayedRead = managementDirectoryFixture({ lastReadAfterDeadline: true });
  const lateRead = await delayedRead.call();
  assert.equal(lateRead.status, 'partial');
  assert.notEqual(lateRead.managementCoverage?.status, 'complete');
  assert.ok(lateRead.managementCoverage?.reasons.includes('read_budget_exceeded'));
  assert.equal(lateRead.records.length, 2);
  await delayedRead.session.close();
  const finalOwner = managementDirectoryFixture({ finalOwnerAfterDeadline: true });
  const finalLate = await finalOwner.call();
  assert.equal(finalLate.status, 'partial');
  assert.equal(finalLate.records.length, 3);
  assert.equal(finalLate.managementCoverage?.status, 'partial');
  assert.ok(finalLate.managementCoverage?.reasons.includes('read_budget_exceeded'));
  assert.equal(finalOwner.identities.length, 1);
  await finalOwner.session.close();
  const preopened = managementDirectoryFixture({
    preopenedPortal: true,
    portal: true,
    onePage: true,
  });
  const unrelated = await preopened.call();
  assert.equal(unrelated.status, 'partial');
  assert.equal(preopened.clicks, 0);
  assert.equal(unrelated.managementCoverage?.inventoryReconciled, false);
  assert.notEqual(unrelated.managementCoverage?.status, 'complete');
  await preopened.session.close();
  const reused = managementDirectoryFixture({ reuseViewRequestId: true });
  const stale = await reused.call();
  assert.equal(stale.status, 'capability_unavailable');
  assert.deepEqual(stale.records, []);
  assert.equal(stale.managementCoverage, undefined);
  assert.equal(reused.identities.length, 0);
  assert.equal(
    reused.calls.some((call) => call.url === reused.second),
    false,
  );
  await reused.session.close();
});

test('management next readiness waits for the existing pager after a natural second-volume request without another GET or changed scope', async () => {
  const fixture = managementDirectoryFixture({
    onePage: true,
    secondPaged: true,
    pagerDelayMs: 120,
  });
  const result = await fixture.call();
  assert.equal(result.status, 'partial');
  assert.equal(result.managementCoverage?.status, 'complete');
  assert.equal(result.managementCoverage?.pagesFetched, 3);
  assert.equal(result.records.length, 3);
  assert.ok(fixture.nextInspections > 1);
  assert.equal(fixture.clicks, 3);
  assert.equal(fixture.calls.filter((call) => call.url === fixture.second).length, 1);
  assert.equal(fixture.calls.filter((call) => call.url === fixture.secondNext).length, 1);
  assert.equal(result.managementControlObservation, undefined);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.paginationComplete, false);
  assert.equal(result.managementCoverage?.draftsCovered, false);
  await fixture.session.close();
});

test('management missing exact next produces bounded historical counts without accepting an unsupported tag or revealing private controls', async () => {
  const unsupported = managementDirectoryFixture({
    onePage: true,
    secondPaged: true,
    unsupportedNextTag: true,
  });
  const partial = await unsupported.call();
  assert.equal(partial.status, 'partial');
  assert.deepEqual(partial.managementCoverage?.reasons, ['next_unavailable']);
  assert.equal(partial.records.length, 2);
  assert.equal(unsupported.clicks, 2);
  assert.equal(
    unsupported.calls.some((call) => call.url === unsupported.secondNext),
    false,
  );
  assert.deepEqual(partial.managementControlObservation, {
    kind: 'management_next_control_observation',
    rootCount: 1,
    rawKnownNextCount: 1,
    eligibleNextCount: 0,
    tags: { button: 0, li: 0, div: 1, a: 0, span: 0, input: 0, other: 0 },
    roleButtonCount: 0,
    disabledCount: 0,
    visibleCount: 1,
    truncated: false,
  });
  assert.equal(partial.coverage.complete, false);
  assert.equal(partial.coverage.paginationComplete, false);
  assert.equal(JSON.stringify(partial.managementControlObservation).includes('PRIVATE_'), false);
  await unsupported.session.close();
  const large = managementDirectoryFixture({
    onePage: true,
    secondPaged: true,
    nextObservationExtent: true,
  });
  const capped = await large.call();
  const observed = capped.managementControlObservation!;
  assert.equal(observed.rawKnownNextCount, 32);
  assert.equal(observed.tags.button, 32);
  assert.equal(observed.roleButtonCount, 32);
  assert.equal(observed.disabledCount, 32);
  assert.equal(observed.visibleCount, 32);
  assert.equal(observed.eligibleNextCount, 0);
  assert.equal(observed.truncated, true);
  assert.equal(large.clicks, 2);
  assert.equal(capped.managementCoverage?.status, 'partial');
  await large.session.close();
});
