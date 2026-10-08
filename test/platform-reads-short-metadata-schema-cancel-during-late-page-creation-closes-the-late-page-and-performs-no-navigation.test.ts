import test from 'node:test';

import {
  metadataSchema_shortMetadataDeferred,
  metadataSchema_tick,
  metadataSchema_WORK,
  metadataSchema_ACCOUNT,
} from './helpers/platform-reads-current-chapter-body-fixture.js';

import { metadataSchema_shortMetadataFixture } from './helpers/platform-reads-metadata-schema-short-metadata-fixture.js';

import assert from 'node:assert/strict';

import { BrowserSession } from '../src/platform/browser.js';

import {
  metadataApiSchema_fixture,
  metadataApiSchema_OWN,
  metadataApiSchema_WORK,
} from './helpers/platform-reads-metadata-api-schema-api-schema-deferred.js';

import {
  shortMetadataApiListUrl,
  safeShortMetadataApiResult,
} from '../src/platform/short-metadata-api-schema.js';

test('short metadata schema: cancel during late page creation closes the late page and performs no navigation', async () => {
  const gate = metadataSchema_shortMetadataDeferred<void>(),
    f = metadataSchema_shortMetadataFixture({ pageGate: gate.promise }),
    controller = new AbortController();
  const pending = f.call(controller.signal);
  await metadataSchema_tick();
  controller.abort();
  gate.resolve();
  const result = await pending;
  assert.equal(result.reason, 'cancelled');
  assert.equal(f.stats.go, 0);
  assert.equal(f.stats.pageClose, 1);
  assert.equal(f.stats.primaryClose, 0);
  await f.session.close();
});

test('short metadata schema: late JSON and slow close keep the sibling FIFO held until all owned tasks settle', async () => {
  const json = metadataSchema_shortMetadataDeferred<void>(),
    close = metadataSchema_shortMetadataDeferred<void>(),
    f = metadataSchema_shortMetadataFixture({ jsonGate: json.promise, closeGate: close.promise }),
    controller = new AbortController();
  const first = f.call(controller.signal);
  for (let i = 0; i < 10 && !f.stats.jsonStarted; i++) await metadataSchema_tick();
  assert(f.stats.jsonStarted);
  controller.abort();
  let next = false;
  const queued = f.session
    .diagnoseShortMetadataSchema(metadataSchema_WORK, {
      expectedAccountId: metadataSchema_ACCOUNT,
      assertLease: () => {},
      onBeforePlatformRead: () => {},
      onVerifiedAccount: () => {},
    })
    .then(() => {
      next = true;
    });
  await metadataSchema_tick();
  assert.equal(next, false);
  assert.equal(f.stats.cookies, 1);
  close.resolve();
  await metadataSchema_tick();
  assert.equal(next, false);
  json.resolve();
  assert.equal((await first).reason, 'cancelled');
  await queued;
  assert.equal(next, true);
  await f.session.close();
});

test('short metadata schema: shutdown interrupts fresh context and drains it before the borrowed persistent context closes', async () => {
  const gate = metadataSchema_shortMetadataDeferred<void>(),
    f = metadataSchema_shortMetadataFixture({ createGate: gate.promise });
  const running = f.call();
  await metadataSchema_tick();
  const closing = f.session.close();
  await metadataSchema_tick();
  assert.equal(f.stats.primaryClose, 0);
  gate.resolve();
  await running;
  await closing;
  assert.equal(f.stats.freshClose, 1);
  assert.equal(f.stats.primaryClose, 1);
});

test('short metadata schema: cold session returns local unavailable without claiming a platform read', async () => {
  const session = new BrowserSession({ profileDir: '/never-read', headless: true });
  let marked = 0;
  const result = await session.diagnoseShortMetadataSchema(metadataSchema_WORK, {
    expectedAccountId: metadataSchema_ACCOUNT,
    assertLease: () => {},
    onBeforePlatformRead: () => {
      marked++;
    },
    onVerifiedAccount: () => {},
  });
  assert.equal(result.reason, 'context_unavailable');
  assert.equal(result.proof.platformStarted, false);
  assert.equal(marked, 0);
  await session.close();
});

test('short metadata schema: cancel before cookies return performs no context creation or platform access', async () => {
  const gate = metadataSchema_shortMetadataDeferred<void>(),
    f = metadataSchema_shortMetadataFixture({ cookieGate: gate.promise }),
    controller = new AbortController();
  const pending = f.call(controller.signal);
  await metadataSchema_tick();
  controller.abort();
  gate.resolve();
  const result = await pending;
  assert.equal(result.reason, 'cancelled');
  assert.equal(f.stats.state, null);
  assert.equal(f.stats.beforeRead, 0);
  assert.equal(f.stats.primaryClose, 0);
  await f.session.close();
});

test('short metadata schema: cancel while route guard setup is pending drains installation and closes owned context before any page', async () => {
  const gate = metadataSchema_shortMetadataDeferred<void>(),
    f = metadataSchema_shortMetadataFixture({ routeGate: gate.promise }),
    controller = new AbortController();
  const pending = f.call(controller.signal);
  await metadataSchema_tick();
  controller.abort();
  gate.resolve();
  const result = await pending;
  assert.equal(result.reason, 'cancelled');
  assert.equal(f.stats.newPage, 0);
  assert.equal(result.cleanup.contextClosed, true);
  assert.equal(f.stats.beforeRead, 0);
  await f.session.close();
});

test('short metadata schema: nonrenewing deadline includes actual context cleanup and cannot publish captured fields after slow close', async () => {
  const gate = metadataSchema_shortMetadataDeferred<void>(),
    f = metadataSchema_shortMetadataFixture({ closeGate: gate.promise });
  const pending = f.call(undefined, 20);
  for (let i = 0; i < 20 && !f.stats.freshClose; i++) await metadataSchema_tick();
  assert.equal(f.stats.freshClose, 1);
  await new Promise((resolve) => setTimeout(resolve, 35));
  gate.resolve();
  const result = await pending;
  assert.equal(result.reason, 'timeout');
  assert.equal(result.fields, null);
  assert.equal(result.cleanup.pendingAtEnd, 0);
  assert.equal(f.stats.owner, 0);
  assert.equal(f.stats.primaryClose, 0);
  await f.session.close();
});

for (const mechanism of ['route', 'fetch'] as const) {
  test(`short metadata schema: unknown ${mechanism} rejection after owned close permanently vetoes an already captured schema`, async () => {
    const f = metadataSchema_shortMetadataFixture(
      mechanism === 'route' ? { lateRouteError: 'unknown' } : { lateFetchError: 'unknown' },
    );
    const result = await f.call();
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.reason, 'protocol_failed');
    assert.equal(result.fields, null);
    assert.equal(result.proof.uniqueNaturalResponse, true);
    assert.equal(result.cleanup.contextClosed, true);
    assert.equal(result.cleanup.pendingAtEnd, 0);
    assert.equal(result.blocked.protocolFailure, 1);
    assert.equal(f.stats.primaryClose, 0);
    await f.session.close();
  });
  test(`short metadata schema: explicit ${mechanism} TargetClosed terminal is accepted only after actual owned close`, async () => {
    const f = metadataSchema_shortMetadataFixture(
      mechanism === 'route'
        ? { lateRouteError: 'target_closed' }
        : { lateFetchError: 'target_closed' },
    );
    const result = await f.call();
    assert.equal(result.status, 'success');
    assert.equal(result.cleanup.contextClosed, true);
    assert.equal(result.cleanup.pendingAtEnd, 0);
    assert.equal(result.blocked.protocolFailure, 0);
    assert.equal(f.stats.primaryClose, 0);
    await f.session.close();
  });
}

test('short metadata schema: unknown close rejection after confirmed context closure still fails the observation', async () => {
  const f = metadataSchema_shortMetadataFixture({ closeReject: true });
  const result = await f.call();
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.reason, 'cleanup_failed');
  assert.equal(result.fields, null);
  assert.equal(result.cleanup.contextClosed, true);
  assert.equal(result.cleanup.pendingAtEnd, 0);
  assert.equal(f.stats.primaryClose, 0);
  await f.session.close();
});

test('short metadata schema: TargetClosed from an allowed static continue before owned close is a permanent failure', async () => {
  const f = metadataSchema_shortMetadataFixture({ earlyRouteTargetClosed: true });
  const result = await f.call();
  assert.equal(result.status, 'capability_unavailable');
  assert.equal(result.reason, 'protocol_failed');
  assert.equal(result.fields, null);
  assert.equal(result.proof.uniqueNaturalResponse, true);
  assert.equal(result.blocked.protocolFailure, 1);
  assert.equal(result.cleanup.pendingAtEnd, 0);
  assert.equal(f.stats.primaryClose, 0);
  await f.session.close();
});

test('short metadata API schema: full bounded list binds stable target and projects only five field types after owned cleanup', async () => {
  const f = metadataApiSchema_fixture();
  try {
    const result = await f.call();
    assert.equal(result.status, 'success');
    assert.equal(result.reason, null);
    assert.equal(result.proof.atomicRevision, false);
    assert.deepEqual(result.list, {
      attempts: 2,
      disposed: 2,
      pagesRead: 2,
      rowsRead: 11,
      totalCount: 11,
    });
    assert.deepEqual(result.own, { attempts: 2, disposed: 2 });
    assert.deepEqual(f.stats.gets, [
      metadataApiSchema_OWN,
      shortMetadataApiListUrl(0),
      shortMetadataApiListUrl(1),
      metadataApiSchema_OWN,
    ]);
    assert.equal(f.stats.callback, 1);
    assert.equal(f.stats.beforeRead, 1);
    assert.equal(f.stats.primaryClose, 0);
    assert.equal(f.stats.pages, 0);
    assert.deepEqual(Object.keys(f.stats.state), ['storageState']);
    assert.deepEqual(f.stats.state.storageState.origins, []);
    assert.equal(f.stats.state.storageState.cookies.length, 1);
    assert.equal(result.fields![0]!.categorySamples[0]!.fields[0]!.type, 'string');
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    assert.equal(JSON.stringify(result).includes(metadataApiSchema_WORK), false);
    assert.equal(result.cleanup.sessionDisposed, true);
    assert.equal(result.cleanup.pendingAtEnd, 0);
    assert.deepEqual(safeShortMetadataApiResult({ ...result, body: 'PRIVATE' }), result);
    assert(Date.parse(result.proof.readStartedAt!) <= Date.parse(result.proof.readFinishedAt!));
    assert(Date.parse(result.cleanup.checkedAt) <= Date.parse(result.proof.proofCapturedAt!));
  } finally {
    await f.close();
  }
});

test('short metadata API schema: exactly 100 rows reads ten complete pages even after first-page target hit', async () => {
  const f = metadataApiSchema_fixture({ total: 100 });
  try {
    const result = await f.call();
    assert.equal(result.status, 'success');
    assert.equal(result.list.attempts, 10);
    assert.equal(result.list.rowsRead, 100);
    assert.equal(f.stats.gets.length, 12);
  } finally {
    await f.close();
  }
});
