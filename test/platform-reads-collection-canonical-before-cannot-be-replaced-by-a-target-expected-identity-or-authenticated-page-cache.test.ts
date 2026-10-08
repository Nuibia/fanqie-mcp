import test from 'node:test';

import {
  type ContextOwnFixture,
  CONTEXT_PROBE_REF,
  CONTEXT_PROBE_TARGET,
} from './helpers/platform-reads-legacy-chapter-application-fixture.js';

import {
  currentDirectoryFixture,
  guardCurrentCollectionPagePhase,
  assertCurrentChapterFailureMetadataSafe,
  assertCurrentBootstrapMetadataShape,
  interceptCurrentBootstrapFrameTrees,
} from './helpers/platform-reads-assert-context-probe-safe.js';

import assert from 'node:assert/strict';

import { CHAPTER_ENTRY_FIXTURE_TITLE } from './helpers/platform-reads-chapter-entry-fixture-work.js';

import { type Page } from 'playwright';

test('collection canonical before cannot be replaced by a target, expected identity or authenticated page cache', async () => {
  const cases: Array<{ ownBefore: ContextOwnFixture; reason: string }> = [
    {
      ownBefore: { json: { code: 0, data: { name: 'PRIVATE_NAME_ONLY' } } },
      reason: 'identity_unverified',
    },
    {
      ownBefore: { json: { code: 0, data: { id: '1002', name: 'PRIVATE_OTHER_ACCOUNT' } } },
      reason: 'owner_changed',
    },
    { ownBefore: { json: { code: 1, data: { id: '1001' } } }, reason: 'identity_unverified' },
    {
      ownBefore: { responseUrl: 'https://external.invalid/?PRIVATE_REDIRECT' },
      reason: 'identity_unverified',
    },
    { ownBefore: { disposeError: true }, reason: 'identity_unverified' },
  ];
  for (const scenario of cases) {
    const fixture = currentDirectoryFixture({ ownBefore: scenario.ownBefore }),
      phase = guardCurrentCollectionPagePhase(fixture);
    const result = await fixture.call(),
      metadata = result.readDiagnostics!.currentChapterCollection!;
    assert.equal(phase.redundantCalls, 0);
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.errors[0]!.code, scenario.reason);
    assert.deepEqual(result.records, []);
    assert.deepEqual(result.coverage.fields, []);
    assert.equal(result.coverage.pagesFetched, 0);
    assert.equal(result.coverage.complete, false);
    assert.equal(fixture.getCount, 0);
    assert.equal(fixture.identities.length, 0);
    assert.equal(fixture.ownGetCount, 1);
    assert.equal(fixture.ownDisposals, 1);
    assert.equal(metadata.initialState, null);
    assert.equal(metadata.identityTypes.initialAuthenticated, null);
    assert.equal(metadata.identityTypes.initialAccountIdPresent, null);
    assert.equal(metadata.identityTypes.initialAuthorIdPresent, null);
    assert.equal(metadata.failedStage, 'fresh_own_before');
    assert.equal(metadata.ownAccountContext.disposed, scenario.ownBefore.disposeError ? 0 : 1);
    assertCurrentChapterFailureMetadataSafe(metadata);
    await fixture.session.close();
  }
  for (const binding of [
    null,
    { kind: 'account' as const, id: '1002' },
    { kind: 'author' as const, id: '1001' },
  ]) {
    const fixture = currentDirectoryFixture();
    const internals = fixture.session as unknown as {
      chapterTargetOwners: Map<string, { kind: 'account' | 'author'; id: string }>;
      openExistingChapterDirectory(...args: unknown[]): Promise<unknown>;
    };
    const entry = internals.openExistingChapterDirectory.bind(internals);
    internals.openExistingChapterDirectory = async (...args) => {
      const value = await entry(...args);
      if (binding) internals.chapterTargetOwners.set(CONTEXT_PROBE_REF, binding);
      else internals.chapterTargetOwners.delete(CONTEXT_PROBE_REF);
      return value;
    };
    const result = await fixture.call();
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.errors[0]!.code, 'target_owner_mismatch');
    assert.equal(fixture.ownGetCount, 0);
    assert.equal(fixture.getCount, 0);
    assert.equal(fixture.identities.length, 0);
    assert.deepEqual(result.records, []);
    assert.equal(
      result.readDiagnostics!.currentChapterCollection!.failedStage,
      'target_owner_binding',
    );
    assert.equal(result.coverage.complete, false);
    await fixture.session.close();
  }
});

test('collection canonical before must survive JSON and disposal awaits without accepting changed documents or cancellation', async () => {
  let navigated: ReturnType<typeof currentDirectoryFixture>;
  navigated = currentDirectoryFixture({
    ownBefore: {
      duringJson: () => navigated.emitNewDocument(CONTEXT_PROBE_TARGET, navigated.currentLoader),
    },
  });
  const stale = await navigated.call();
  assert.equal(stale.status, 'capability_unavailable');
  assert.deepEqual(stale.records, []);
  assert.equal(stale.coverage.pagesFetched, 0);
  assert.equal(navigated.ownGetCount, 1);
  assert.equal(navigated.ownDisposals, 1);
  assert.equal(navigated.getCount, 0);
  assert.equal(navigated.identities.length, 0);
  assert.equal(navigated.detachCount, 1);
  assertCurrentChapterFailureMetadataSafe(stale.readDiagnostics!.currentChapterCollection);
  await navigated.session.close();
  const controller = new AbortController();
  const cancelled = currentDirectoryFixture({
    ownBefore: {
      duringDispose: () => {
        controller.abort();
      },
    },
  });
  await assert.rejects(cancelled.call({ signal: controller.signal }), { code: 'cancelled' });
  assert.equal(cancelled.ownGetCount, 1);
  assert.equal(cancelled.ownDisposals, 1);
  assert.equal(cancelled.getCount, 0);
  assert.equal(cancelled.identities.length, 0);
  assert.equal(cancelled.detachCount, 1);
  await cancelled.session.close();
});

test('current bootstrap failure metadata records actual initial checks and never reads skipped frame fields or error properties', async () => {
  const unavailable = currentDirectoryFixture({ cdpUnavailable: true });
  const rejected = await unavailable.call();
  const attach = rejected.readDiagnostics!.currentChapterCollection!;
  assert.equal(attach.failedStage, 'canonical_bootstrap');
  assert.equal(attach.observedReason, 'context_unavailable');
  assert.equal(attach.canonicalBootstrap!.subphase, 'cdp_attach');
  assert.equal(attach.canonicalBootstrap!.cdp.failure, 'initialization_failed');
  assert.equal(attach.canonicalBootstrap!.cdp.initialized, false);
  assert.ok(
    Object.values(attach.canonicalBootstrap!.initialChecks).every((value) => value === null),
  );
  assert.ok(
    Object.values(attach.canonicalBootstrap!.freezeChecks).every((value) => value === null),
  );
  assert.equal(unavailable.ownGetCount, 0);
  assert.equal(unavailable.getCount, 0);
  assert.equal(unavailable.identities.length, 0);
  assertCurrentBootstrapMetadataShape(rejected.readDiagnostics);
  await unavailable.session.close();

  const fragment = currentDirectoryFixture({ detachError: true });
  let skippedUrlReads = 0;
  interceptCurrentBootstrapFrameTrees(fragment, (read, value) => {
    assert.equal(read, 1);
    const frame = (value as { frameTree: { frame: Record<string, unknown> } }).frameTree.frame;
    frame.urlFragment = '#PRIVATE_FRAGMENT?token=PRIVATE_TOKEN';
    frame.headers = { cookie: 'PRIVATE_COOKIE' };
    frame.title = CHAPTER_ENTRY_FIXTURE_TITLE;
    Object.defineProperty(frame, 'url', {
      get() {
        skippedUrlReads += 1;
        throw Object.assign(Error('PRIVATE_FRAME_ERROR'), {
          code: 'PRIVATE_CODE',
          reason: 'PRIVATE_REASON',
          body: 'PRIVATE_BODY',
        });
      },
    });
    return value;
  });
  const failed = await fragment.call(),
    metadata = failed.readDiagnostics!.currentChapterCollection!,
    bootstrap = metadata.canonicalBootstrap!;
  assert.equal(metadata.failedStage, 'canonical_bootstrap');
  assert.equal(metadata.observedReason, 'document_changed');
  assert.equal(bootstrap.subphase, 'initial_checks');
  assert.deepEqual(bootstrap.initialChecks, {
    active: true,
    sameContext: true,
    ownedContext: true,
    currentUrlMatchesAttach: true,
    noParent: true,
    frameIdPresent: true,
    loaderIdPresent: true,
    noFragment: false,
    frameUrlMatchesAttach: null,
  });
  assert.ok(Object.values(bootstrap.freezeChecks).every((value) => value === null));
  assert.equal(skippedUrlReads, 0);
  assert.equal(bootstrap.cdp.failure, 'initialization_failed');
  assert.deepEqual(bootstrap.firstViolation, {
    phase: 'bootstrap',
    reason: 'cdp_source_unverified',
  });
  assert.equal(fragment.detachCount, 1);
  assert.equal(fragment.ownGetCount, 0);
  assert.equal(fragment.getCount, 0);
  assert.deepEqual(failed.records, []);
  assertCurrentBootstrapMetadataShape(failed.readDiagnostics);
  await fragment.session.close();
});

test('current bootstrap failure metadata preserves barrier short circuit and the first pre-cleanup canonical observation', async () => {
  const barrier = currentDirectoryFixture();
  let skippedUrlReads = 0;
  interceptCurrentBootstrapFrameTrees(barrier, (read, value) => {
    if (read === 2) {
      const frame = (value as { frameTree: { frame: Record<string, unknown> } }).frameTree.frame;
      frame.loaderId = 'PRIVATE_OTHER_LOADER';
      Object.defineProperty(frame, 'url', {
        get() {
          skippedUrlReads += 1;
          throw Error('PRIVATE_SKIPPED_FRAME_URL');
        },
      });
    }
    return value;
  });
  const result = await barrier.call(),
    metadata = result.readDiagnostics!.currentChapterCollection!,
    bootstrap = metadata.canonicalBootstrap!;
  assert.equal(metadata.failedStage, 'canonical_bootstrap');
  assert.equal(metadata.observedReason, 'document_changed');
  assert.equal(bootstrap.subphase, 'freeze_checks');
  assert.deepEqual(bootstrap.freezeChecks, {
    rootMatches: true,
    noParent: true,
    loaderMatches: false,
    loaderPresent: null,
    noFragment: null,
    frameUrlMatchesCurrent: null,
    permittedRoute: null,
    noPendingNavigation: null,
    noPendingSameDocument: null,
    noViolation: null,
    connected: null,
  });
  assert.ok(Object.values(bootstrap.initialChecks).every((value) => value === true));
  assert.equal(bootstrap.cdp.initialized, true);
  assert.equal(bootstrap.cdp.rootFrameObserved, true);
  assert.equal(bootstrap.cdp.committedLoaderObserved, true);
  assert.equal(bootstrap.cdp.failure, 'source_unverified');
  assert.equal(skippedUrlReads, 0);
  assert.equal(barrier.ownGetCount, 0);
  assert.equal(barrier.getCount, 0);
  assertCurrentBootstrapMetadataShape(result.readDiagnostics);
  await barrier.session.close();

  let shell: ReturnType<typeof currentDirectoryFixture>;
  shell = currentDirectoryFixture({
    detachError: true,
    duringDetach: () => shell.emit('request', shell.request(CONTEXT_PROBE_TARGET, 'GET', true)),
  });
  const internals = shell.session as unknown as {
    waitForWriterReady(page: Page, timeout: number): Promise<boolean>;
    openExistingChapterDirectory(...args: unknown[]): Promise<unknown>;
  };
  const entry = internals.openExistingChapterDirectory.bind(internals);
  let entered = false;
  internals.openExistingChapterDirectory = async (...args) => {
    const value = await entry(...args);
    entered = true;
    return value;
  };
  internals.waitForWriterReady = async () => !entered;
  const late = await shell.call(),
    origin = late.readDiagnostics!.currentChapterCollection!;
  assert.equal(origin.failedStage, 'canonical_bootstrap');
  assert.equal(origin.observedReason, 'shell_unready');
  assert.equal(origin.canonicalBootstrap!.subphase, 'writer_ready');
  assert.equal(origin.canonicalBootstrap!.firstViolation, null);
  assert.equal(origin.canonicalBootstrap!.cdp.failure, null);
  assert.equal(origin.canonicalBootstrap!.cdp.initialized, true);
  assert.ok(
    Object.values(origin.canonicalBootstrap!.freezeChecks).every((value) => value === null),
  );
  assert.equal(shell.detachCount, 1);
  assert.equal(shell.getCount, 0);
  assert.deepEqual(late.records, []);
  assertCurrentBootstrapMetadataShape(late.readDiagnostics);
  await shell.session.close();
});
