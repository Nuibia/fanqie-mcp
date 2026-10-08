import test from 'node:test';

import {
  currentDirectoryFixture,
  assertCurrentChapterFailureMetadataSafe,
  assertContextProbeSafe,
  guardCurrentCollectionPagePhase,
} from './helpers/platform-reads-assert-context-probe-safe.js';

import assert from 'node:assert/strict';

import { contextVolumeProbeFixture } from './helpers/platform-reads-context-volume-probe-fixture.js';

import { type LoginState, CANONICAL_OWN_USER_URL } from '../src/platform/browser.js';

import { CONTEXT_PROBE_REF } from './helpers/platform-reads-legacy-chapter-application-fixture.js';

test('current chapter failure metadata distinguishes each identity rejection stage using only local type observations', async () => {
  // The removed collection page precheck is tested through the legacy branch below.
  for (const stage of [
    'target_owner_binding',
    'fresh_own_before',
    'fresh_own_after',
    'owner_callback',
  ] as const) {
    const fixture = currentDirectoryFixture({
      ...(stage === 'target_owner_binding' ? { ownerKind: 'author' as const } : {}),
      ...(stage === 'fresh_own_before' ? { ownBefore: { responseStatus: 401 } } : {}),
      ...(stage === 'fresh_own_after'
        ? { ownAfter: { json: { code: 0, data: { name: 'PRIVATE_MISSING_ACCOUNT' } } } }
        : {}),
    });
    const result = await fixture.call(
      stage === 'target_owner_binding'
        ? { expectedOwner: { kind: 'author', id: '1001' } }
        : stage === 'owner_callback'
          ? {
              onVerifiedOwner: () => {
                throw Object.assign(Error('PRIVATE_CALLBACK?token=PRIVATE_VALUE'), {
                  diagnostic: { failedStage: 'PRIVATE_FORGED_STAGE', headers: 'PRIVATE_HEADERS' },
                });
              },
            }
          : {},
    );
    const metadata = result.readDiagnostics?.currentChapterCollection;
    assert.equal(result.status, 'capability_unavailable');
    assert.deepEqual(result.records, []);
    assert.ok(metadata);
    assert.equal(metadata.kind, 'current_chapter_collection_failure');
    assert.equal(metadata.failedStage, stage);
    assert.equal(result.errors[0]?.code, 'identity_unverified');
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.paginationComplete, false);
    assert.equal(result.coverage.pagesFetched, 0);
    assert.deepEqual(result.coverage.fields, []);
    const expectedAttempts =
      stage === 'target_owner_binding' ? 0 : stage === 'fresh_own_before' ? 1 : 2;
    assert.equal(metadata.ownAccountContext.attempts, expectedAttempts);
    assert.equal(metadata.ownAccountContext.disposed, expectedAttempts);
    assert.equal(metadata.callback.entered, stage === 'owner_callback');
    assert.equal(metadata.callback.succeeded, false);
    assert.equal(metadata.initialState, null);
    assert.equal(metadata.identityTypes.initialAuthenticated, null);
    assert.equal(metadata.identityTypes.initialAccountIdPresent, null);
    assert.equal(metadata.identityTypes.initialAuthorIdPresent, null);
    if (stage === 'target_owner_binding') {
      assert.equal(metadata.identityTypes.bindingAccountKind, false);
      assert.equal(metadata.identityTypes.bindingAuthorKind, true);
      assert.equal(metadata.identityTypes.expectedAuthorKind, true);
    }
    if (stage === 'fresh_own_before') {
      assert.equal(metadata.ownAccountContext.responseBefore, 'unauthorized');
      assert.equal(metadata.identityTypes.beforeAccepted, false);
      assert.equal(metadata.identityTypes.afterAccepted, null);
    }
    if (stage === 'fresh_own_after') {
      assert.equal(metadata.identityTypes.beforeAccepted, true);
      assert.equal(metadata.identityTypes.afterParsedAccountIdPresent, false);
      assert.equal(metadata.identityTypes.afterAccepted, false);
    }
    assertCurrentChapterFailureMetadataSafe(metadata);
    await fixture.session.close();
  }
});

test('current chapter failure metadata normalizes known identity states and legal HTTP categories without response or error values', async () => {
  // Page-state rejection still belongs to the unchanged legacy diagnostic.
  // The collection no longer calls or copies this redundant page observation.
  for (const state of [
    'authenticated',
    'login_required',
    'challenge_required',
    'unknown',
    'PRIVATE_UNKNOWN_STATE',
  ] as const) {
    const fixture = contextVolumeProbeFixture();
    fixture.session.verifyCurrentAccount = async () =>
      ({
        status: state,
        identity: null,
        sourceUrl: 'PRIVATE_SOURCE',
        checkedAt: new Date().toISOString(),
        reason: 'PRIVATE_REASON',
      }) as LoginState;
    const result = await fixture.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
      chapterVolumeContext: true,
    });
    assert.equal(
      result.status,
      state === 'login_required' ? 'login_required' : 'capability_unavailable',
    );
    assert.equal(result.chapterVolumeContext!.reason, 'identity_unverified');
    assert.deepEqual(result.identityObserved, {
      accountId: false,
      authorId: false,
      displayName: false,
    });
    assert.equal(result.chapterVolumeContext!.ownAccountContext.attempts, 0);
    assert.equal(fixture.getCount, 0);
    assert.equal(JSON.stringify(result).includes('currentChapterCollection'), false);
    assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
    assertContextProbeSafe(result);
    await fixture.session.close();
  }
  for (const [status, category] of [
    [200, 'success'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [302, 'redirect'],
    [404, 'client_error'],
    [503, 'server_error'],
    [100, 'other'],
    [99, 'not_observed'],
    [600, 'not_observed'],
    [200.5, 'not_observed'],
    [NaN, 'not_observed'],
  ] as const) {
    const fixture = currentDirectoryFixture({
      ownBefore: {
        responseStatus: status,
        json: { code: 0, data: { name: 'PRIVATE_RESPONSE_METADATA' } },
      },
    });
    const result = await fixture.call();
    const metadata = result.readDiagnostics!.currentChapterCollection!;
    assert.equal(metadata.failedStage, 'fresh_own_before');
    assert.equal(metadata.ownAccountContext.responseBefore, category);
    assert.equal(metadata.ownAccountContext.responseAfter, 'not_observed');
    assert.equal(metadata.ownAccountContext.attempts, 1);
    assert.equal(metadata.ownAccountContext.disposed, 1);
    assert.equal(fixture.calls.length, 0);
    assert.equal(metadata.identityTypes.beforeAccepted, false);
    assertCurrentChapterFailureMetadataSafe(metadata);
    await fixture.session.close();
  }
  const transport = currentDirectoryFixture({ ownBefore: { transportError: true } });
  const result = await transport.call();
  assert.deepEqual(result.readDiagnostics!.currentChapterCollection!.ownAccountContext, {
    attempts: 1,
    disposed: 0,
    responseBefore: 'not_observed',
    responseAfter: 'not_observed',
  });
  assertCurrentChapterFailureMetadataSafe(result.readDiagnostics!.currentChapterCollection);
  await transport.session.close();
});

test('current chapter failure origin survives late cleanup while valid partial and legacy diagnostic output remain unchanged', async () => {
  const early = currentDirectoryFixture({ ownBefore: { responseStatus: 403 }, detachError: true });
  const earlyResult = await early.call();
  assert.equal(
    earlyResult.readDiagnostics!.currentChapterCollection!.failedStage,
    'fresh_own_before',
  );
  assert.equal(
    earlyResult.readDiagnostics!.currentChapterCollection!.ownAccountContext.responseBefore,
    'forbidden',
  );
  assert.deepEqual(earlyResult.records, []);
  assert.equal(earlyResult.coverage.pagesFetched, 0);
  assertCurrentChapterFailureMetadataSafe(earlyResult.readDiagnostics!.currentChapterCollection);
  await early.session.close();
  const late = currentDirectoryFixture({ detachError: true });
  const lateResult = await late.call();
  assert.equal(lateResult.readDiagnostics!.currentChapterCollection!.failedStage, 'cleanup');
  assert.deepEqual(lateResult.readDiagnostics!.currentChapterCollection!.callback, {
    entered: true,
    succeeded: true,
  });
  assert.deepEqual(lateResult.records, []);
  assert.equal(lateResult.coverage.complete, false);
  assertCurrentChapterFailureMetadataSafe(lateResult.readDiagnostics!.currentChapterCollection);
  await late.session.close();
  const accepted = currentDirectoryFixture();
  const acceptedResult = await accepted.call();
  assert.equal(acceptedResult.status, 'partial');
  assert.equal(acceptedResult.readDiagnostics, undefined);
  assert.equal(acceptedResult.coverage.complete, false);
  assert.equal(acceptedResult.coverage.paginationComplete, false);
  assert.equal(accepted.calls.length, 5);
  await accepted.session.close();
  const legacy = contextVolumeProbeFixture({ ownBefore: { responseStatus: 401 } });
  const legacyResult = await legacy.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(legacyResult.status, 'capability_unavailable');
  assert.equal(legacyResult.chapterVolumeContext!.reason, 'identity_unverified');
  assert.deepEqual(legacyResult.chapterVolumeContext!.ownAccountContext, {
    transport: 'browser_context_get',
    attempts: 1,
    disposed: 1,
    responseStatusBefore: 401,
    responseStatusAfter: null,
  });
  assert.equal(JSON.stringify(legacyResult).includes('currentChapterCollection'), false);
  assertContextProbeSafe(legacyResult);
  await legacy.session.close();
});

test('collection canonical identity is selected before a page check and before every business context GET', async () => {
  const fixture = currentDirectoryFixture(),
    phase = guardCurrentCollectionPagePhase(fixture);
  const result = await fixture.call();
  assert.equal(phase.redundantCalls, 0);
  assert.equal(fixture.entryCalls, 1);
  assert.equal(fixture.ownGetCount, 2);
  assert.equal(fixture.ownDisposals, 2);
  assert.equal(result.status, 'partial');
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.paginationComplete, false);
  assert.equal(result.readDiagnostics, undefined);
  const firstBusiness = fixture.apiOrder.indexOf('volume_get');
  assert.ok(firstBusiness > fixture.apiOrder.indexOf('own_dispose'));
  assert.equal(fixture.apiOrder[0], 'own_get');
  assert.ok(fixture.apiOrder.lastIndexOf('own_get') > fixture.apiOrder.lastIndexOf('volume_get'));
  assert.equal(fixture.identities.length, 1);
  assert.equal(fixture.identities[0]!.status, 'authenticated');
  assert.equal(fixture.identities[0]!.identity?.accountId, '1001');
  assert.equal(fixture.identities[0]!.identity?.authorId, null);
  assert.ok(Date.parse(result.capturedAt) >= Date.parse(fixture.identities[0]!.checkedAt));
  await fixture.session.close();
  const legacy = contextVolumeProbeFixture();
  let legacyVerifyCalls = 0;
  legacy.session.verifyCurrentAccount = async () => {
    legacyVerifyCalls += 1;
    return {
      status: 'unknown',
      identity: null,
      sourceUrl: CANONICAL_OWN_USER_URL,
      checkedAt: new Date().toISOString(),
    };
  };
  const rejected = await legacy.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(legacyVerifyCalls, 1);
  assert.equal(rejected.chapterVolumeContext!.reason, 'identity_unverified');
  assert.equal(legacy.ownGetCount, 0);
  assert.equal(legacy.getCount, 0);
  assert.equal(JSON.stringify(rejected).includes('currentChapterCollection'), false);
  await legacy.session.close();
});
