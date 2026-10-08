import test from 'node:test';

import { currentChapterBodyFixture } from './helpers/platform-reads-current-chapter-body-fixture.js';

import assert from 'node:assert/strict';

import {
  CONTEXT_PROBE_TARGET,
  CONTEXT_PROBE_REF,
} from './helpers/platform-reads-legacy-chapter-application-fixture.js';

import { deferred } from './helpers/platform-reads-metrics-page.js';

import { currentDirectoryFixture } from './helpers/platform-reads-assert-context-probe-safe.js';

import { contextVolumeProbeFixture } from './helpers/platform-reads-context-volume-probe-fixture.js';

import { type Page } from 'playwright';

import { chapterDraftDirectoryFixture } from './helpers/platform-reads-chapter-draft-directory-fixture.js';

test('chapter body never requests absent targets or unverified owners and fails a single response without retries or leaked payload aliases', async () => {
  const absent = currentChapterBodyFixture();
  const missing = await absent.call({}, '7800000000000000099');
  assert.equal(missing.status, 'capability_unavailable');
  assert.equal(absent.bodyGets, 0);
  assert.equal(missing.records.length, 0);
  assert.equal(absent.identities.length, 0);
  await absent.session.close();
  const owner = currentChapterBodyFixture({
    directory: { ownBefore: { json: { code: 0, data: { id: '1002' } } } },
  });
  const denied = await owner.call();
  assert.equal(owner.bodyGets, 0);
  assert.equal(denied.coverage.complete, false);
  await owner.session.close();
  for (const url of [
    'data:text/plain,PRIVATE_BODY_ROUTE',
    'https://PRIVATE_USER:PRIVATE_PASSWORD@fanqienovel.com/api/author/chapter/chapter_list/v1',
    'https://fanqienovel.com/api/author/chapter/chapter_list/v1#PRIVATE_BODY_FRAGMENT',
  ]) {
    const blocked = currentChapterBodyFixture({
      directory: { blockedRequest: { url, method: 'GET', navigation: false } },
    });
    const result = await blocked.call();
    assert.equal(blocked.blocked, 1);
    assert.equal(blocked.bodyGets, 0);
    assert.equal(result.records.length, 0);
    assert.equal(result.coverage.complete, false);
    await blocked.session.close();
  }
  for (const options of [
    { status: 403 },
    { responseUrl: 'https://external.invalid/PRIVATE_BODY_URL' },
    { code: 1 },
    { patch: { book_id: '7600000000000000002' } },
    { patch: { item_id: '7800000000000000099' } },
    { patch: { volume_id: '7700000000000000099' } },
    { patch: { content: null, body: 'PRIVATE_BODY_ALIAS' } },
    { patch: { latest_version: '7' } },
    { jsonError: true },
    { transportError: true },
    { disposeError: true },
  ]) {
    const fixture = currentChapterBodyFixture(options);
    const result = await fixture.call();
    assert.equal(fixture.bodyGets, 1);
    assert.equal(fixture.bodyDisposals, options.transportError ? 0 : 1);
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.records.length, 0);
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.pagesFetched, 0);
    assert.deepEqual(result.coverage.fields, []);
    assert.equal(fixture.identities.length, 0);
    assert.equal(JSON.stringify(result).includes('PRIVATE_BODY_'), false);
    await fixture.session.close();
  }
});

test('chapter body buffers remain private when owner callback canonical cleanup or its original deadline fail late', async () => {
  for (const mode of ['owner', 'callback', 'detach', 'navigation', 'deadline'] as const) {
    let fixture: ReturnType<typeof currentChapterBodyFixture>;
    fixture = currentChapterBodyFixture({
      directory: {
        ...(mode === 'owner' ? { ownAfter: { json: { code: 0, data: { id: '1002' } } } } : {}),
        ...(mode === 'detach' ? { detachError: true } : {}),
        ...(mode === 'navigation'
          ? {
              duringDetach: () =>
                fixture.emitNewDocument(CONTEXT_PROBE_TARGET, fixture.currentLoader),
            }
          : {}),
        ...(mode === 'deadline'
          ? { duringDetach: () => new Promise((resolve) => setTimeout(resolve, 450)) }
          : {}),
      },
    });
    const result = await fixture.call({
      ...(mode === 'callback'
        ? {
            onVerifiedOwner: () => {
              throw Error('PRIVATE_BODY_CALLBACK');
            },
          }
        : {}),
      ...(mode === 'deadline' ? { timeoutMs: 350 } : {}),
    });
    assert.equal(fixture.bodyGets, 1);
    assert.equal(fixture.bodyDisposals, 1);
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.records.length, 0);
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.paginationComplete, false);
    assert.equal(result.coverage.totalRecords, null);
    assert.equal(result.coverage.recordsFetched, 0);
    assert.equal(result.readDiagnostics, undefined);
    assert.equal(JSON.stringify(result).includes('PRIVATE_BODY_'), false);
    await fixture.session.close();
  }
});

test('chapter body cancel waits for actual response disposal before releasing FIFO and legacy readers never issue the controlled candidate', async () => {
  const started = deferred(),
    release = deferred(),
    controller = new AbortController();
  const fixture = currentChapterBodyFixture({
    duringJson: async () => {
      started.resolve();
      await release.promise;
    },
  });
  const reading = fixture.call({ signal: controller.signal });
  await started.promise;
  let nextRan = false;
  const queued = fixture.session.withPage(async () => {
    nextRan = true;
  });
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nextRan, false);
  assert.equal(fixture.bodyDisposals, 0);
  release.resolve();
  await assert.rejects(reading, { code: 'cancelled' });
  await queued;
  assert.equal(nextRan, true);
  assert.equal(fixture.bodyDisposals, 1);
  assert.equal(fixture.identities.length, 0);
  await fixture.session.close();
  const legacy = currentDirectoryFixture();
  const directory = await legacy.call();
  assert.equal(directory.status, 'partial');
  assert.equal(
    legacy.calls.some((call) => new URL(call.url).pathname === '/api/author/edit_article/v0/'),
    false,
  );
  await legacy.session.close();
  const diagnostic = contextVolumeProbeFixture();
  const probe = await diagnostic.session.diagnoseReadPage(`diagnostic:${CONTEXT_PROBE_REF}`, {
    chapterVolumeContext: true,
  });
  assert.equal(probe.status, 'success');
  assert.equal(diagnostic.calls.length, 1);
  assert.equal(
    diagnostic.calls.some((call) => new URL(call.url).pathname === '/api/author/edit_article/v0/'),
    false,
  );
  await diagnostic.session.close();
});

test('chapter body drains all guarded route tasks including late continue failure before final delivery and FIFO release', async () => {
  for (const mode of [
    'continue',
    'continue-failure',
    'abort-failure',
    'unroute-failure',
    'late-detach-failure',
  ] as const) {
    const started = deferred(),
      release = deferred();
    let fixture: ReturnType<typeof currentChapterBodyFixture>, task: Promise<void> | undefined;
    const delayed = async () => {
      started.resolve();
      await release.promise;
      if (mode !== 'continue') throw Error('PRIVATE_BODY_ROUTE_FAILURE');
    };
    const launch = () => {
      task = fixture.invokeBodyRoute(
        mode === 'abort-failure' ? { method: 'POST', abort: delayed } : { continue: delayed },
      );
    };
    fixture = currentChapterBodyFixture({
      ...(mode === 'late-detach-failure' ? { directory: { duringDetach: launch } } : {}),
      ...(mode !== 'unroute-failure' && mode !== 'late-detach-failure'
        ? { duringJson: launch }
        : {}),
    });
    if (mode === 'unroute-failure') {
      const unroute = fixture.page.unroute.bind(fixture.page);
      fixture.page.unroute = (async (...args: Parameters<Page['unroute']>) => {
        if (fixture.bodyGets) {
          launch();
          throw Error('PRIVATE_BODY_UNROUTE_FAILURE');
        }
        return unroute(...args);
      }) as Page['unroute'];
    }
    const reading = fixture.call();
    await started.promise;
    let nextRan = false,
      finished = false;
    const queued = fixture.session.withPage(async () => {
      nextRan = true;
    });
    reading.then(() => {
      finished = true;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(nextRan, false);
      assert.equal(finished, false);
    } finally {
      release.resolve();
    }
    await task;
    const result = await reading;
    await queued;
    assert.equal(nextRan, true);
    assert.equal(fixture.bodyGets, 1);
    assert.equal(fixture.bodyDisposals, 1);
    assert.equal(result.status, mode === 'continue' ? 'success' : 'capability_unavailable');
    assert.equal(result.records.length, mode === 'continue' ? 1 : 0);
    assert.equal(result.coverage.complete, mode === 'continue');
    assert.equal(
      JSON.stringify(result).includes('PRIVATE_BODY_ROUTE_FAILURE') ||
        JSON.stringify(result).includes('PRIVATE_BODY_UNROUTE_FAILURE'),
      false,
    );
    await fixture.session.close();
  }
  let unknown: ReturnType<typeof currentChapterBodyFixture>;
  unknown = currentChapterBodyFixture({
    directory: {
      ownBefore: { duringGet: () => unknown.invokeBodyRoute({ navigation: 'unknown' }) },
    },
  });
  const denied = await unknown.call();
  assert.equal(unknown.routeForwards, 0);
  assert.equal(unknown.routeAborts, 1);
  assert.equal(unknown.bodyGets, 0);
  assert.equal(denied.records.length, 0);
  assert.equal(denied.coverage.complete, false);
  await unknown.session.close();
});

test('draft-tab readiness waits for delayed exact scoped DOM without a business GET before the original handle is acquired', async () => {
  const fixture = chapterDraftDirectoryFixture({ delayedTab: 120 });
  const evaluate = fixture.page.evaluate.bind(fixture.page);
  let absent = 0,
    checkedBeforeClick = 0;
  fixture.page.evaluate = (async (callback: unknown, arg: unknown) => {
    const value = (await evaluate(callback as never, arg as never)) as unknown as {
      bound?: boolean;
    };
    if ((arg as { mode?: string })?.mode === 'tab' && fixture.tabClicks === 0) {
      checkedBeforeClick++;
      assert.equal(fixture.guarded, true);
      assert.equal(fixture.getCount, 0);
      assert.equal(fixture.ownGetCount, 0);
      assert.equal(fixture.identities.length, 0);
      if (value.bound !== true) absent++;
    }
    return value;
  }) as Page['evaluate'];
  const result = await fixture.call();
  assert.equal(absent > 0, true);
  assert.equal(checkedBeforeClick >= 3, true);
  assert.equal(result.status, 'success');
  assert.equal(result.coverage.complete, true);
  assert.equal(result.records.length, 2);
  assert.equal(fixture.tabClicks, 1);
  assert.equal(fixture.nextClicks, 1);
  assert.equal(fixture.getCount, 4);
  assert.equal(fixture.ownGetCount, 2);
  assert.equal(fixture.ownDisposals, 2);
  assert.equal(fixture.identities.length, 1);
  assert.equal(fixture.guarded, false);
  assert.equal(fixture.listenerCount('close'), 0);
  await fixture.session.close();
});
