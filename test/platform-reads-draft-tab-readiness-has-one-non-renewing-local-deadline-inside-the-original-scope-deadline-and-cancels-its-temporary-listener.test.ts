import test from 'node:test';

import { chapterDraftDirectoryFixture } from './helpers/platform-reads-chapter-draft-directory-fixture.js';

import assert from 'node:assert/strict';

import { deferred } from './helpers/platform-reads-metrics-page.js';

import { type Page } from 'playwright';

import { CONTEXT_PROBE_TARGET } from './helpers/platform-reads-legacy-chapter-application-fixture.js';

import {
  SHORT_METADATA_ASSETS,
  classifyShortMetadataRequest,
  isShortMetadataEditUrl,
  shortMetadataDocument,
  projectShortMetadataFields,
  safeShortMetadataResult,
  SHORT_METADATA_STATIC_ALIAS,
} from '../src/platform/short-metadata-schema.js';

import {
  metadataSchema_DOC,
  metadataSchema_WORK,
  metadataSchema_EDIT,
  metadataSchema_shortMetadataDeferred,
  metadataSchema_tick,
} from './helpers/platform-reads-current-chapter-body-fixture.js';

import { metadataSchema_shortMetadataFixture } from './helpers/platform-reads-metadata-schema-short-metadata-fixture.js';

test('draft-tab readiness has one non-renewing local deadline inside the original scope deadline and cancels its temporary listener', async () => {
  for (const scenario of [
    { delay: 200, budget: 80, local: false },
    { delay: 5_000, budget: 4_000, local: true },
  ]) {
    const fixture = chapterDraftDirectoryFixture({ delayedTab: scenario.delay });
    const started = performance.now();
    const result = await fixture.call({ timeoutMs: scenario.budget });
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.records.length, 0);
    assert.equal(result.coverage.complete, false);
    assert.equal(fixture.tabClicks, 0);
    assert.equal(fixture.getCount, 0);
    assert.equal(fixture.ownGetCount, 0);
    assert.equal(fixture.identities.length, 0);
    if (scenario.local) {
      assert.equal(
        result.errors.some((error) => error.code === 'chapter_draft_tab_unavailable'),
        true,
      );
      assert.equal(performance.now() - started < 3_500, true);
    }
    assert.equal(fixture.guarded, false);
    assert.equal(fixture.listenerCount('close'), 0);
    await fixture.session.close();
  }
  const fixture = chapterDraftDirectoryFixture({ delayedTab: 5_000 }),
    controller = new AbortController(),
    started = deferred();
  const evaluate = fixture.page.evaluate.bind(fixture.page);
  fixture.page.evaluate = (async (callback: unknown, arg: unknown) => {
    const value = await evaluate(callback as never, arg as never);
    if ((arg as { mode?: string })?.mode === 'tab') started.resolve();
    return value;
  }) as Page['evaluate'];
  const operation = fixture.call({ signal: controller.signal });
  await started.promise;
  let advanced = false;
  const queued = fixture.session.withPage(async () => {
    advanced = true;
    return true;
  });
  assert.equal(advanced, false);
  controller.abort();
  await assert.rejects(operation, { code: 'cancelled' });
  assert.equal(await queued, true);
  assert.equal(fixture.tabClicks, 0);
  assert.equal(fixture.getCount, 0);
  assert.equal(fixture.guarded, false);
  assert.equal(fixture.listenerCount('close'), 0);
  await fixture.session.close();
});

test('draft-tab readiness never substitutes a replaced acquired node and preserves the route violation through a delayed render', async () => {
  const replaced = chapterDraftDirectoryFixture({ delayedTab: 40, tabChanged: true });
  const result = await replaced.call();
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.records.length, 0);
  assert.equal(result.coverage.complete, false);
  assert.equal(
    result.errors.some((error) => error.code === 'chapter_draft_tab_changed'),
    true,
  );
  assert.equal(replaced.tabClicks, 0);
  assert.equal(replaced.getCount, 0);
  assert.equal(replaced.ownGetCount, 0);
  assert.equal(replaced.identities.length, 0);
  assert.equal(replaced.handleDisposals, 2);
  assert.equal(replaced.guarded, false);
  await replaced.session.close();
  const moved = chapterDraftDirectoryFixture({ delayedTab: 200 });
  const evaluate = moved.page.evaluate.bind(moved.page);
  let changed = false;
  moved.page.evaluate = (async (callback: unknown, arg: unknown) => {
    const value = await evaluate(callback as never, arg as never);
    if (!changed && (arg as { mode?: string })?.mode === 'tab') {
      changed = true;
      moved.setUrl('https://fanqienovel.com/main/writer/create-book');
      moved.emit('framenavigated', moved.page.mainFrame());
      moved.setUrl(CONTEXT_PROBE_TARGET);
      moved.emit('framenavigated', moved.page.mainFrame());
    }
    return value;
  }) as Page['evaluate'];
  const unavailable = await moved.call();
  assert.equal(changed, true);
  assert.equal(unavailable.status, 'capability_unavailable');
  assert.equal(unavailable.records.length, 0);
  assert.equal(unavailable.coverage.complete, false);
  assert.equal(moved.tabClicks, 0);
  assert.equal(moved.getCount, 0);
  assert.equal(moved.ownGetCount, 0);
  assert.equal(moved.identities.length, 0);
  assert.equal(moved.guarded, false);
  assert.equal(moved.listenerCount('close'), 0);
  await moved.session.close();
});

test('short metadata schema: exact GET classifier denies target changes, query ambiguity and public-prefix expansion', () => {
  assert.equal(SHORT_METADATA_ASSETS.length, 85);
  assert.equal(
    classifyShortMetadataRequest(metadataSchema_DOC, 'GET', 'document', true, metadataSchema_WORK),
    'document',
  );
  assert.equal(isShortMetadataEditUrl(metadataSchema_EDIT, metadataSchema_WORK), true);
  for (const url of [
    metadataSchema_EDIT + '&item_id=' + metadataSchema_WORK,
    metadataSchema_EDIT + '&create=true',
    metadataSchema_EDIT.replace(metadataSchema_WORK, '0'),
    metadataSchema_EDIT + '#x',
    metadataSchema_EDIT.replace('https:', 'http:'),
  ])
    assert.equal(isShortMetadataEditUrl(url, metadataSchema_WORK), false);
  assert.equal(
    classifyShortMetadataRequest(
      SHORT_METADATA_ASSETS[0]![0],
      'GET',
      'script',
      false,
      metadataSchema_WORK,
    ),
    'static',
  );
  assert.equal(
    classifyShortMetadataRequest(
      SHORT_METADATA_ASSETS[0]![0] + '?new=1',
      'GET',
      'script',
      false,
      metadataSchema_WORK,
    ),
    'deny',
  );
  assert.equal(
    classifyShortMetadataRequest(metadataSchema_EDIT, 'HEAD', 'fetch', false, metadataSchema_WORK),
    'deny',
  );
  assert.throws(() => shortMetadataDocument('0000000000'));
});

test('short metadata schema: fixed metadata projection bounds category samples, counts unknown keys without revealing values', () => {
  const input = {
    category: Array.from({ length: 120 }, () => ({
      category_id: 'PRIVATE-ID',
      label: 'PRIVATE-LABEL',
      name: 'PRIVATE-NAME',
      extra: 'PRIVATE-EXTRA',
    })),
    thumb_uri: null,
    thumb_url_list: [],
    book_thumb_uri: true,
    book_thumb_url_list: 8,
    'PRIVATE-KEY': 'PRIVATE-VALUE',
  };
  const projected = projectShortMetadataFields(input);
  assert.equal(projected.fields[0]!.arrayCount, 100);
  assert.equal(projected.fields[0]!.truncated, true);
  assert.equal(projected.fields[0]!.categorySamples.length, 16);
  assert.equal(projected.unknownKeyCount, 1);
  assert(!JSON.stringify(projected).includes('PRIVATE'));
});

test('short metadata schema: owned collector binds natural request/root/loader, cookie-only context and actual cleanup before success', async () => {
  const f = metadataSchema_shortMetadataFixture();
  const result = await f.call();
  assert.equal(result.status, 'success', JSON.stringify(result));
  assert.equal(f.stats.primaryClose, 0);
  assert.equal(f.stats.freshClose, 1);
  assert.deepEqual(f.stats.state.storageState.origins, []);
  assert.equal(f.stats.state.serviceWorkers, 'block');
  assert(f.stats.guardsBeforePage);
  assert.equal(result.own.attempts, 2);
  assert.equal(result.own.disposed, 2);
  assert.equal(result.cleanup.pendingAtEnd, 0);
  assert.equal(f.stats.owner, 1);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.deepEqual(safeShortMetadataResult({ ...result, secret: 'PRIVATE' }), result);
  await f.session.close();
  assert.equal(f.stats.primaryClose, 1);
});

test('short metadata schema: static alias is registered per source Request and network ID without granting independent wire permission', async () => {
  assert.equal(
    classifyShortMetadataRequest(
      SHORT_METADATA_STATIC_ALIAS.wire,
      'GET',
      'script',
      false,
      metadataSchema_WORK,
    ),
    'deny',
  );
  const f = metadataSchema_shortMetadataFixture({ alias: {} }),
    result = await f.call();
  assert.equal(result.status, 'success', JSON.stringify(result));
  assert.deepEqual(f.stats.aliasContinues, [{ url: SHORT_METADATA_STATIC_ALIAS.wire }]);
  assert.equal(f.stats.aliasFetchAck, 1);
  assert.equal(result.blocked.redirect, 0);
  assert.equal(result.cleanup.pendingAtEnd, 0);
  assert.equal(f.stats.primaryClose, 0);
  assert.equal(JSON.stringify(result).includes(SHORT_METADATA_STATIC_ALIAS.wire), false);
  await f.session.close();
});

for (const [name, alias] of [
  ['direct wire', { sourceUrl: SHORT_METADATA_STATIC_ALIAS.wire }],
  ['source query change', { sourceUrl: SHORT_METADATA_STATIC_ALIAS.source + '&extra=1' }],
  ['source non-GET', { method: 'POST' }],
  ['source wrong type', { type: 'fetch' }],
  ['source navigation', { navigation: true }],
  ['source foreign frame', { child: true }],
  ['source redirect chain', { redirected: true }],
  ['absent PW source request', { omitPageRequest: true }],
  ['absent owned network source', { omitNetwork: true }],
  ['ambiguous network source', { duplicateNetwork: true }],
  ['different route Request', { routeRequestMismatch: true }],
  ['wrong Fetch network ID', { pauseNetworkId: 'unregistered' }],
  ['unobserved Fetch wire URL', { pauseUrl: SHORT_METADATA_STATIC_ALIAS.wire }],
  ['changed source URL at Fetch', { pauseUrl: SHORT_METADATA_STATIC_ALIAS.source + '&extra=1' }],
  ['different response Request', { responseRequestMismatch: true }],
  ['unchanged response source URL', { responseUrl: SHORT_METADATA_STATIC_ALIAS.source }],
  ['duplicate source Request', { duplicateSource: true }],
  ['duplicate source response', { duplicateResponse: true }],
  ['missing source response', { omitResponse: true }],
  ['unregistered source traffic', { unrouted: true }],
] as const)
  test(`short metadata schema: static alias rejects ${name} and exposes no metadata`, async () => {
    const f = metadataSchema_shortMetadataFixture({ alias }),
      result = await f.call();
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.fields, null);
    assert.equal(result.cleanup.contextClosed, true);
    assert.equal(result.cleanup.pendingAtEnd, 0);
    assert.equal(f.stats.owner, 0);
    assert.equal(f.stats.primaryClose, 0);
    await f.session.close();
  });

test('short metadata schema: late second alias network source vetoes a schema already captured from the private edit response', async () => {
  const f = metadataSchema_shortMetadataFixture({ alias: { lateDuplicateNetwork: true } }),
    result = await f.call();
  assert.equal(result.proof.uniqueNaturalResponse, true);
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.reason, 'protocol_failed');
  assert.equal(result.blocked.protocolFailure, 1);
  assert.equal(result.fields, null);
  assert.equal(result.cleanup.pendingAtEnd, 0);
  assert.equal(f.stats.primaryClose, 0);
  await f.session.close();
});

test('short metadata schema: registered alias wire 302 remains blocked without publishing schema', async () => {
  const f = metadataSchema_shortMetadataFixture({ alias: { pauseStatus: 302 } }),
    result = await f.call();
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.reason, 'redirect_blocked');
  assert.equal(result.blocked.redirect, 1);
  assert.equal(f.stats.redirectsFailed, 1);
  assert.equal(f.stats.aliasFetchAck, 0);
  assert.equal(result.fields, null);
  assert.equal(result.cleanup.pendingAtEnd, 0);
  await f.session.close();
});

for (const [name, opts, reason] of [
  ['302 redirect', { redirect: 302 }, 'redirect_blocked'],
  ['307 redirect', { redirect: 307 }, 'redirect_blocked'],
  ['duplicate natural response', { duplicate: true }, 'response_unverified'],
  ['changed own account after capture', { ownerChanged: true }, 'owner_changed'],
  ['foreign frame', { foreign: true }, 'source_changed'],
  ['platform POST', { blockedPost: true }, 'request_blocked'],
  ['late within-document escape during cleanup', { lateWithin: true }, 'source_changed'],
  ['callback failure', { callbackFails: true }, 'callback_failed'],
  ['response disposal failure', { disposeFails: true }, 'cleanup_failed'],
  ['WebSocket attempt', { websocket: true }, 'request_blocked'],
  ['service worker', { worker: true }, 'request_blocked'],
  ['old document loader', { staleLoader: true }, 'source_changed'],
  ['unknown GET', { unknownGet: true }, 'request_blocked'],
] as const)
  test(`short metadata schema: owned collector rejects ${name} and never closes the primary`, async () => {
    const f = metadataSchema_shortMetadataFixture(opts);
    const result = await f.call();
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.reason, reason);
    assert.equal(result.fields, null);
    assert.equal(f.stats.primaryClose, 0);
    assert.equal(result.cleanup.contextClosed, true);
    assert.equal(result.cleanup.pendingAtEnd, 0);
    if ('redirect' in opts) assert.equal(f.stats.redirectsFailed, 1);
    await f.session.close();
  });

test('short metadata schema: cancel during late context creation owns and closes the late context without creating a page', async () => {
  const gate = metadataSchema_shortMetadataDeferred<void>(),
    f = metadataSchema_shortMetadataFixture({ createGate: gate.promise }),
    controller = new AbortController();
  const pending = f.call(controller.signal);
  await metadataSchema_tick();
  controller.abort();
  gate.resolve();
  const result = await pending;
  assert.equal(result.reason, 'cancelled');
  assert.equal(f.stats.newPage, 0);
  assert.equal(f.stats.freshClose, 1);
  assert.equal(f.stats.primaryClose, 0);
  await f.session.close();
});
