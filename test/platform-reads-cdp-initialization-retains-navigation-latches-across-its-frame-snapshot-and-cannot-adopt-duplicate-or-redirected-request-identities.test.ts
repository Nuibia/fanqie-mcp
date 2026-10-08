import test from 'node:test';

import { contextVolumeProbeFixture } from './helpers/platform-reads-context-volume-probe-fixture.js';

import {
  CONTEXT_PROBE_TARGET,
  CONTEXT_PROBE_REF,
  CONTEXT_PROBE_SOURCE,
  type ContextOwnFixture,
} from './helpers/platform-reads-legacy-chapter-application-fixture.js';

import assert from 'node:assert/strict';

import { assertContextProbeSafe } from './helpers/platform-reads-assert-context-probe-safe.js';

import { CANONICAL_OWN_USER_URL } from '../src/platform/browser.js';

test('CDP initialization retains navigation latches across its frame snapshot and cannot adopt duplicate or redirected request identities', async () => {
  let early: ReturnType<typeof contextVolumeProbeFixture>;
  early = contextVolumeProbeFixture({
    duringCdpInitialize: () =>
      early.emitCdp('Page.frameStartedNavigating', {
        frameId: early.cdpRoot,
        loaderId: early.currentLoader,
        url: CONTEXT_PROBE_TARGET,
        navigationType: 'differentDocument',
      }),
  });
  const initialization = await early.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(initialization.chapterVolumeContext!.reason, 'document_changed');
  assert.equal(early.gotos, 0);
  assert.equal(early.getCount, 0);
  assert.equal(initialization.chapterVolumeContext!.schema, null);
  assert.equal(initialization.chapterVolumeContext!.cdpSource!.failure, 'source_unverified');
  await early.session.close();
  for (const redirected of [false, true]) {
    let fixture: ReturnType<typeof contextVolumeProbeFixture>;
    fixture = contextVolumeProbeFixture({
      duringBootstrap: () =>
        fixture.emitCdp('Network.requestWillBeSent', {
          frameId: fixture.cdpRoot,
          loaderId: fixture.currentLoader,
          type: 'XHR',
          requestId: 'SYNTHETIC_REQUEST_2',
          request: { url: CONTEXT_PROBE_SOURCE, method: 'GET' },
          ...(redirected ? { redirectResponse: { status: 302 } } : {}),
        }),
    });
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.chapterVolumeContext!.reason, 'document_changed');
    assert.equal(fixture.getCount, 0);
    assert.equal(result.chapterVolumeContext!.schema, null);
    assertContextProbeSafe(result);
    await fixture.session.close();
  }
});

test('CDP close, failed detach and observed late detach navigation withhold schema; successful cleanup reports only the earlier canonical cutoff', async () => {
  let closed: ReturnType<typeof contextVolumeProbeFixture>;
  closed = contextVolumeProbeFixture({ duringBootstrap: () => closed.emitCdp('close', undefined) });
  const disconnected = await closed.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(disconnected.chapterVolumeContext!.reason, 'document_changed');
  assert.equal(closed.getCount, 0);
  assert.equal(disconnected.chapterVolumeContext!.cdpSource!.failure, 'disconnected');
  assert.equal(disconnected.chapterVolumeContext!.schema, null);
  await closed.session.close();
  const failed = contextVolumeProbeFixture({ detachError: true });
  const discarded = await failed.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(discarded.status, 'capability_unavailable');
  assert.equal(failed.getCount, 1);
  assert.equal(discarded.chapterVolumeContext!.schema, null);
  assert.equal(discarded.chapterVolumeContext!.cdpSource!.proofCapturedAt, null);
  assert.equal(discarded.chapterVolumeContext!.cdpSource!.failure, 'cleanup_failed');
  assertContextProbeSafe(discarded);
  await failed.session.close();
  let late: ReturnType<typeof contextVolumeProbeFixture>;
  late = contextVolumeProbeFixture({
    duringDetach: () => late.emit('request', late.request(CONTEXT_PROBE_TARGET, 'GET', true)),
  });
  const stale = await late.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(stale.chapterVolumeContext!.reason, 'document_changed');
  assert.equal(late.getCount, 1);
  assert.equal(stale.chapterVolumeContext!.schema, null);
  assert.equal(stale.chapterVolumeContext!.cdpSource!.proofCapturedAt, null);
  await late.session.close();
  const history = contextVolumeProbeFixture({
    afterCdpClose: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    },
  });
  const valid = await history.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(valid.status, 'success');
  assert.equal(history.getCount, 1);
  assert.equal(valid.capturedAt, valid.chapterVolumeContext!.cdpSource!.proofCapturedAt);
  assert.ok(Date.parse(valid.capturedAt) < Date.parse(valid.chapterVolumeContext!.checkedAt));
  assert.equal(valid.chapterVolumeContext!.cdpSource!.connected, false);
  assert.equal(valid.chapterVolumeContext!.cdpSource!.detached, true);
  assert.ok(
    valid.limitations.some((value) =>
      value.includes('interval after detach is not document proof'),
    ),
  );
  assertContextProbeSafe(valid);
  await history.session.close();
});

test('isolated context probe uses two fresh canonical account checks without page fetch, cache fallback or author-ID reinterpretation', async () => {
  const controller = new AbortController();
  const fixture = contextVolumeProbeFixture();
  const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
    signal: controller.signal,
  });
  assert.equal(result.status, 'success');
  assert.equal(fixture.ownCalls, 1);
  assert.equal(fixture.ownGetCount, 2);
  assert.equal(fixture.ownDisposals, 2);
  assert.equal(fixture.getCount, 1);
  assert.equal(fixture.disposals, 1);
  assert.deepEqual(result.chapterVolumeContext!.ownAccountContext, {
    transport: 'browser_context_get',
    attempts: 2,
    disposed: 2,
    responseStatusBefore: 200,
    responseStatusAfter: 200,
  });
  assert.deepEqual(fixture.apiOrder, [
    'own_get',
    'own_dispose',
    'volume_get',
    'own_get',
    'own_dispose',
    'volume_dispose',
  ]);
  for (const call of fixture.ownContextCalls) {
    assert.equal(call.url, CANONICAL_OWN_USER_URL);
    assert.equal((call.options as { signal: AbortSignal }).signal, controller.signal);
  }
  assert.equal(result.chapterVolumeContext!.attempts, 1);
  assert.equal(result.chapterVolumeContext!.collectionProof, false);
  assert.ok(
    result.limitations.some((value) =>
      value.includes('one volume GET plus two sequential fresh own-account GET checks'),
    ),
  );
  assertContextProbeSafe(result);
  await fixture.session.close();
  const author = contextVolumeProbeFixture({ ownerKind: 'author' });
  const unknown = await author.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(unknown.chapterVolumeContext!.reason, 'identity_unverified');
  assert.equal(author.ownGetCount, 0);
  assert.equal(author.getCount, 0);
  assert.equal(unknown.chapterVolumeContext!.schema, null);
  assertContextProbeSafe(unknown);
  await author.session.close();
});

test('fresh context owner mismatches and unverifiable canonical responses fail closed independently of volume attempts', async () => {
  for (const phase of ['before', 'after'] as const) {
    const fixture = contextVolumeProbeFixture({
      [phase === 'before' ? 'ownBefore' : 'ownAfter']: {
        json: { code: 0, data: { id: '1002', name: 'PRIVATE_PROBE_OWNER' } },
      },
    });
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.chapterVolumeContext!.reason, 'owner_changed');
    assert.equal(fixture.getCount, phase === 'before' ? 0 : 1);
    assert.equal(fixture.ownGetCount, phase === 'before' ? 1 : 2);
    assert.equal(fixture.ownDisposals, fixture.ownGetCount);
    assert.equal(result.chapterVolumeContext!.schema, null);
    assertContextProbeSafe(result);
    await fixture.session.close();
  }
  for (const ownBefore of [
    { responseStatus: 403 },
    { responseUrl: 'https://external.invalid/?PRIVATE_PROBE_TOKEN' },
    { json: { code: 1, data: { id: '1001' }, message: 'PRIVATE_OWN_BODY' } },
    { json: { code: 0, data: { name: 'PRIVATE_PROBE_OWNER' } } },
    { jsonError: true },
    { transportError: true },
  ] satisfies ContextOwnFixture[]) {
    const fixture = contextVolumeProbeFixture({ ownBefore });
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.chapterVolumeContext!.reason, 'identity_unverified');
    assert.equal(fixture.ownGetCount, 1);
    assert.equal(fixture.getCount, 0);
    assert.equal(
      result.chapterVolumeContext!.ownAccountContext.disposed,
      ownBefore.transportError ? 0 : 1,
    );
    assert.equal(result.chapterVolumeContext!.checks.sameOwnerBefore, false);
    assert.equal(result.chapterVolumeContext!.schema, null);
    assertContextProbeSafe(result);
    await fixture.session.close();
  }
});

test('fresh context identity is adopted only after successful disposal and retains canonical navigation fences across owner awaits', async () => {
  for (const phase of ['before', 'after'] as const) {
    const fixture = contextVolumeProbeFixture({
      [phase === 'before' ? 'ownBefore' : 'ownAfter']: { disposeError: true },
    });
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.chapterVolumeContext!.reason, 'identity_unverified');
    assert.equal(fixture.ownGetCount, phase === 'before' ? 1 : 2);
    assert.equal(fixture.getCount, phase === 'before' ? 0 : 1);
    assert.equal(
      result.chapterVolumeContext!.ownAccountContext.disposed,
      phase === 'before' ? 0 : 1,
    );
    assert.equal(
      result.chapterVolumeContext!.checks[
        phase === 'before' ? 'sameOwnerBefore' : 'sameOwnerAfter'
      ],
      false,
    );
    assert.equal(result.chapterVolumeContext!.schema, null);
    assertContextProbeSafe(result);
    await fixture.session.close();
  }
  for (const hook of ['duringGet', 'duringJson', 'duringDispose'] as const) {
    let fixture: ReturnType<typeof contextVolumeProbeFixture>;
    fixture = contextVolumeProbeFixture({
      ownAfter: {
        [hook]: () =>
          fixture.emitCdp('Page.frameStartedNavigating', {
            frameId: fixture.cdpRoot,
            loaderId: fixture.currentLoader,
            url: CONTEXT_PROBE_TARGET,
            navigationType: 'restore',
          }),
      },
    });
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(result.chapterVolumeContext!.reason, 'document_changed');
    assert.equal(fixture.ownGetCount, 2);
    assert.equal(fixture.ownDisposals, 2);
    assert.equal(fixture.getCount, 1);
    assert.equal(fixture.disposals, 1);
    assert.equal(result.chapterVolumeContext!.schema, null);
    assert.equal(result.chapterVolumeContext!.cdpSource!.proofCapturedAt, null);
    assert.equal(result.chapterVolumeContext!.checks.sameOwnerAfter, false);
    assertContextProbeSafe(result);
    await fixture.session.close();
  }
});
