import test from 'node:test';

import { contextVolumeProbeFixture } from './helpers/platform-reads-context-volume-probe-fixture.js';

import {
  CONTEXT_PROBE_REF,
  CONTEXT_PROBE_TARGET,
  CONTEXT_PROBE_SOURCE,
} from './helpers/platform-reads-legacy-chapter-application-fixture.js';

import assert from 'node:assert/strict';

import { assertContextProbeSafe } from './helpers/platform-reads-assert-context-probe-safe.js';

test('context navigation telemetry distinguishes pending commits from an unpaired same-URL bootstrap commit without changing the failure', async () => {
  const ordinary = contextVolumeProbeFixture();
  const accepted = await ordinary.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  const normal = accepted.chapterVolumeContext!.navigationTelemetry!;
  assert.equal(accepted.status, 'success');
  assert.equal(ordinary.getCount, 1);
  assert.deepEqual(
    normal.events.map((event) => [event.kind, event.frame, event.phase]),
    [
      ['nav_request', 'main', 'bootstrap'],
      ['commit', 'main', 'bootstrap'],
    ],
  );
  assert.equal(normal.events[0]!.before.pendingNavigation, false);
  assert.equal(normal.events[0]!.after.pendingNavigation, false);
  const commit = normal.events[1]!;
  assert.equal(commit.kind, 'commit');
  if (commit.kind === 'commit') {
    assert.equal(commit.outcome, 'public_observation');
    assert.equal(commit.before.pendingNavigation, false);
    assert.equal(commit.after.pendingNavigation, false);
    assert.equal(commit.after.committed, true);
    assert.equal(commit.permittedRoute, true);
  }
  assert.equal(normal.initial.committed, false);
  assert.equal(normal.bootstrapGate!.violated, false);
  assert.equal(normal.final.frozen, true);
  assert.equal(normal.firstViolation, null);
  assertContextProbeSafe(accepted);
  await ordinary.session.close();

  let fixture: ReturnType<typeof contextVolumeProbeFixture>;
  fixture = contextVolumeProbeFixture({
    duringBootstrap: () => fixture.emit('framenavigated', fixture.page.mainFrame()),
  });
  const rejected = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  const telemetry = rejected.chapterVolumeContext!.navigationTelemetry!;
  assert.equal(rejected.chapterVolumeContext!.reason, null);
  assert.equal(rejected.chapterVolumeContext!.attempts, 1);
  assert.equal(fixture.getCount, 1);
  assert.ok(rejected.chapterVolumeContext!.schema);
  const unpaired = telemetry.events.at(-1)!;
  assert.equal(unpaired.kind, 'commit');
  if (unpaired.kind === 'commit') {
    assert.equal(unpaired.outcome, 'public_observation');
    assert.equal(unpaired.sameOrigin, true);
    assert.equal(unpaired.samePath, true);
    assert.equal(unpaired.sameUrl, true);
    assert.equal(unpaired.queryChanged, false);
    assert.equal(unpaired.before.pendingNavigation, false);
    assert.equal(unpaired.after.violated, false);
  }
  assert.equal(telemetry.firstViolation, null);
  assert.equal(telemetry.bootstrapGate!.violated, false);
  assert.equal(telemetry.bootstrapGate!.frozen, false);
  assert.equal(telemetry.final.frozen, true);
  assertContextProbeSafe(rejected);
  await fixture.session.close();
});

test('public navigation telemetry remains ordered, bounded and value-free without becoming a canonical source', async () => {
  let fixture: ReturnType<typeof contextVolumeProbeFixture>;
  fixture = contextVolumeProbeFixture({
    duringBootstrap: () => {
      for (let index = 0; index < 105; index += 1) {
        fixture.setUrl(`${CONTEXT_PROBE_TARGET}&tab=${index}`);
        fixture.emit('framenavigated', fixture.page.mainFrame());
      }
      fixture.emit('framenavigated', fixture.page.mainFrame());
    },
  });
  const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  const telemetry = result.chapterVolumeContext!.navigationTelemetry!;
  assert.equal(result.chapterVolumeContext!.reason, null);
  assert.equal(fixture.getCount, 1);
  assert.ok(result.chapterVolumeContext!.schema);
  assert.equal(telemetry.count, 100);
  assert.equal(telemetry.events.length, 32);
  assert.equal(telemetry.truncated, true);
  assert.equal(telemetry.firstViolation, null);
  assert.equal(telemetry.events[2]!.kind, 'commit');
  if (telemetry.events[2]!.kind === 'commit') {
    assert.equal(telemetry.events[2]!.outcome, 'public_observation');
    assert.equal(telemetry.events[2]!.queryChanged, true);
  }
  assertContextProbeSafe(result);
  const encoded = JSON.stringify(telemetry);
  assert.equal(encoded.includes('https:'), false);
  assert.equal(encoded.includes('tab='), false);
  assert.equal(encoded.includes('type='), false);
  assert.equal(encoded.includes('book_id'), false);
  await fixture.session.close();
});

test('navigation telemetry uses unknown URL or frame observations and retains frozen and cleanup document failures', async () => {
  let malformed: ReturnType<typeof contextVolumeProbeFixture>;
  malformed = contextVolumeProbeFixture({
    duringBootstrap: () => {
      malformed.setUrl('PRIVATE_INVALID_URL?PRIVATE_PROBE_TOKEN');
      malformed.emit('framenavigated', malformed.page.mainFrame());
    },
  });
  const invalid = await malformed.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  const badCommit = invalid.chapterVolumeContext!.navigationTelemetry!.events.at(-1)!;
  assert.equal(invalid.chapterVolumeContext!.reason, 'document_changed');
  assert.equal(malformed.getCount, 0);
  assert.equal(badCommit.kind, 'commit');
  if (badCommit.kind === 'commit') {
    assert.equal(badCommit.outcome, 'invalid_url');
    for (const key of [
      'sameOrigin',
      'samePath',
      'sameUrl',
      'queryChanged',
      'permittedRoute',
    ] as const)
      assert.equal(badCommit[key], null);
  }
  assertContextProbeSafe(invalid);
  assert.equal(JSON.stringify(invalid).includes('PRIVATE_INVALID_URL'), false);
  await malformed.session.close();

  let unavailable: ReturnType<typeof contextVolumeProbeFixture>;
  unavailable = contextVolumeProbeFixture({
    duringBootstrap: () => {
      const source = unavailable.request(CONTEXT_PROBE_TARGET, 'GET', true);
      source.frame = () => {
        throw Error('PRIVATE_PROBE_TOKEN');
      };
      unavailable.emit('request', source);
      unavailable.emit('framenavigated', undefined);
    },
  });
  const unknown = await unavailable.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  const unknownEvents = unknown.chapterVolumeContext!.navigationTelemetry!.events.slice(-2);
  assert.equal(unknown.status, 'capability_unavailable');
  assert.equal(unknown.chapterVolumeContext!.reason, 'document_changed');
  assert.equal(unavailable.getCount, 0);
  assert.deepEqual(
    unknownEvents.map((event) => [event.kind, event.frame]),
    [
      ['nav_request', 'unavailable'],
      ['commit', 'unavailable'],
    ],
  );
  if (unknownEvents[1]!.kind === 'commit')
    for (const key of [
      'sameOrigin',
      'samePath',
      'sameUrl',
      'queryChanged',
      'permittedRoute',
    ] as const)
      assert.equal(unknownEvents[1]![key], null);
  assertContextProbeSafe(unknown);
  await unavailable.session.close();

  for (const phase of ['frozen', 'cleanup'] as const) {
    let changed: ReturnType<typeof contextVolumeProbeFixture>;
    changed = contextVolumeProbeFixture(
      phase === 'cleanup'
        ? { cleanupNavigation: 'dispose' }
        : {
            duringGet: () =>
              changed.emit('request', changed.request(CONTEXT_PROBE_TARGET, 'GET', true)),
          },
    );
    const result = await changed.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    const telemetry = result.chapterVolumeContext!.navigationTelemetry!;
    assert.equal(result.chapterVolumeContext!.reason, 'document_changed');
    assert.equal(result.chapterVolumeContext!.schema, null);
    assert.equal(changed.getCount, 1);
    assert.equal(changed.disposals, 1);
    assert.deepEqual(telemetry.firstViolation, { phase, reason: 'frozen_navigation_request' });
    assert.equal(telemetry.events.at(-1)!.phase, phase);
    assert.equal(telemetry.final.violated, true);
    assertContextProbeSafe(result);
    await changed.session.close();
  }
});

test('canonical CDP same-document start plus explicit within-document event preserves a current-loader template and ignores bootstrap public duplicates', async () => {
  let fixture: ReturnType<typeof contextVolumeProbeFixture>;
  fixture = contextVolumeProbeFixture({
    duringBootstrap: () => {
      fixture.emitWithinDocument(CONTEXT_PROBE_TARGET);
      fixture.emit('framenavigated', fixture.page.mainFrame());
    },
  });
  const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(result.status, 'success');
  assert.equal(fixture.getCount, 1);
  assert.equal(result.chapterVolumeContext!.collectionProof, false);
  assert.deepEqual(result.chapterVolumeContext!.cdpSource, {
    kind: 'owned_cdp_root_loader',
    epochBasis: 'owned_cdp_root_loader',
    publicFrameNavigatedMetadataOnly: true,
    frozenSameDocumentEvents: 0,
    initialized: true,
    rootFrameObserved: true,
    committedLoaderObserved: true,
    connected: false,
    detached: true,
    proofCapturedAt: result.capturedAt,
    failure: null,
  });
  assert.equal(result.chapterVolumeContext!.navigationTelemetry!.firstViolation, null);
  assertContextProbeSafe(result);
  await fixture.session.close();
  let pending: ReturnType<typeof contextVolumeProbeFixture>;
  pending = contextVolumeProbeFixture({
    duringBootstrap: () =>
      pending.emitCdp('Page.frameStartedNavigating', {
        frameId: pending.cdpRoot,
        loaderId: pending.currentLoader,
        url: CONTEXT_PROBE_TARGET,
        navigationType: 'historySameDocument',
      }),
  });
  const blocked = await pending.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(blocked.chapterVolumeContext!.reason, 'document_changed');
  assert.equal(pending.getCount, 0);
  assert.equal(blocked.chapterVolumeContext!.schema, null);
  await pending.session.close();
});

test('a bootstrap same-URL new-document commit clears sources even with a reused loader, and unknown worker or old-loader GETs never register', async () => {
  let changed: ReturnType<typeof contextVolumeProbeFixture>;
  changed = contextVolumeProbeFixture({
    duringBootstrap: () => changed.emitNewDocument(CONTEXT_PROBE_TARGET, changed.currentLoader),
  });
  const result = await changed.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(result.chapterVolumeContext!.reason, 'template_missing');
  assert.equal(changed.getCount, 0);
  assert.equal(result.chapterVolumeContext!.schema, null);
  await changed.session.close();
  for (const cdp of [
    { loaderId: '' },
    { loaderId: 'SYNTHETIC_OLD_LOADER' },
    { frameId: undefined },
    { type: undefined },
    { redirectResponse: { status: 302 } },
  ]) {
    const fixture = contextVolumeProbeFixture({ sources: [{ url: CONTEXT_PROBE_SOURCE, cdp }] });
    const unavailable = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(unavailable.chapterVolumeContext!.reason, 'template_missing');
    assert.equal(fixture.getCount, 0);
    assert.equal(unavailable.chapterVolumeContext!.schema, null);
    assertContextProbeSafe(unavailable);
    await fixture.session.close();
  }
});

test('canonical non-HTTP mainframe navigation-start invalidates frozen proof without a public request or commit', async () => {
  let fixture: ReturnType<typeof contextVolumeProbeFixture>;
  fixture = contextVolumeProbeFixture({
    duringGet: () =>
      fixture.emitCdp('Page.frameStartedNavigating', {
        frameId: fixture.cdpRoot,
        loaderId: fixture.currentLoader,
        url: CONTEXT_PROBE_TARGET,
        navigationType: 'restore',
      }),
  });
  const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(result.chapterVolumeContext!.reason, 'document_changed');
  assert.equal(fixture.getCount, 1);
  assert.equal(result.chapterVolumeContext!.schema, null);
  assert.equal(result.chapterVolumeContext!.cdpSource!.proofCapturedAt, null);
  assert.equal(result.chapterVolumeContext!.navigationTelemetry!.events.length, 2);
  assertContextProbeSafe(result);
  await fixture.session.close();
});
