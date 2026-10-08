import {
  metadataApiSchema_rows,
  metadataApiSchema_fixture,
  metadataApiSchema_OWN,
  metadataApiSchema_WORK,
  metadataApiSchema_ACCOUNT,
  metadataApiSchema_apiSchemaDeferred,
  metadataApiSchema_pause,
} from './helpers/platform-reads-metadata-api-schema-api-schema-deferred.js';

import test from 'node:test';

import assert from 'node:assert/strict';

import { BrowserSession } from '../src/platform/browser.js';

for (const [name, options, reason] of [
  ['more than 100 rows', { total: 101 }, 'bounded_unavailable'],
  ['no target', { targetAbsent: true }, 'target_unverified'],
  ['empty list', { total: 0 }, 'target_unverified'],
  [
    'duplicate later target',
    {
      listData: (page: number) => ({
        total_count: 11,
        item_list: page === 0 ? metadataApiSchema_rows(10) : [metadataApiSchema_rows(1)[0]],
      }),
    },
    'pagination_inconsistent',
  ],
  [
    'changed later total',
    {
      listData: (page: number) => ({
        total_count: page ? 12 : 11,
        item_list: page ? metadataApiSchema_rows(1) : metadataApiSchema_rows(10),
      }),
    },
    'pagination_inconsistent',
  ],
  [
    'short first page',
    { listData: () => ({ total_count: 11, item_list: metadataApiSchema_rows(9) }) },
    'pagination_inconsistent',
  ],
  [
    'zero stable ID',
    { listData: () => ({ total_count: 1, item_list: [{ item_id: '0' }] }) },
    'response_unverified',
  ],
  [
    'nonstring stable ID',
    { listData: () => ({ total_count: 1, item_list: [{ item_id: 8545000000 }] }) },
    'response_unverified',
  ],
  [
    'wrong response path',
    { listData: () => ({ total_count: 1, list: metadataApiSchema_rows(1) }) },
    'response_unverified',
  ],
  ['invalid own schema', { badOwn: true }, 'identity_unverified'],
  ['owner after changed', { ownerChanged: true }, 'owner_changed'],
  ['redirect', { redirect: true }, 'redirect_blocked'],
  ['wrong fixed URL', { wrongUrl: true }, 'response_unverified'],
  ['HTML response', { badContentType: true }, 'response_unverified'],
  ['oversize body', { oversize: true }, 'response_unverified'],
  ['oversize content-length', { declaredOversize: true }, 'response_unverified'],
  ['nonzero code', { codeFailure: true }, 'response_unverified'],
  ['HTTP exception', { getReject: true }, 'response_unavailable'],
  ['callback failure', { callbackFail: true }, 'callback_failed'],
] as const)
  test(`short metadata API schema: rejects ${name} with no values and completed cleanup`, async () => {
    const f = metadataApiSchema_fixture(options);
    try {
      const result = await f.call();
      assert.equal(result.status, 'capability_unavailable');
      assert.equal(result.reason, reason);
      assert.equal(result.fields, null);
      assert.equal(result.cleanup.sessionDisposed, true);
      assert.equal(result.cleanup.pendingAtEnd, 0);
      assert.equal(f.stats.primaryClose, 0);
      assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
      assert.equal(
        f.stats.gets.filter((url) => url === metadataApiSchema_OWN).length,
        name === 'owner after changed' || name === 'callback failure' ? 2 : 1,
      );
    } finally {
      await f.close();
    }
  });

for (const kind of ['response', 'session'] as const)
  test(`short metadata API schema: ${kind} dispose rejection quarantines account and refuses both primary and old/new diagnostic successors`, async () => {
    const f = metadataApiSchema_fixture(
      kind === 'response' ? { responseDisposeFail: true } : { sessionDisposeFail: true },
    );
    try {
      const result = await f.call();
      assert.equal(result.reason, 'cleanup_failed');
      assert.equal(result.cleanup.quarantined, true);
      assert.equal(result.cleanup.disposalFailures, 1);
      assert.equal(result.fields, null);
      assert.equal(f.stats.callback, 0);
      const reads = f.stats.gets.length;
      await assert.rejects(f.next(), (error: any) => error.code === 'shutdown_incomplete');
      assert.equal(f.stats.primaryReads, 0);
      assert.equal((await f.call()).reason, 'cleanup_failed');
      assert.equal(
        (
          await f.session.diagnoseShortMetadataSchema(metadataApiSchema_WORK, {
            expectedAccountId: metadataApiSchema_ACCOUNT,
            assertLease: () => {},
            onBeforePlatformRead: () => {
              throw Error('Must not read');
            },
            onVerifiedAccount: () => {},
          })
        ).reason,
        'cleanup_failed',
      );
      await assert.rejects(f.session.close(), (error: any) => error.code === 'shutdown_incomplete');
      assert.equal(f.stats.primaryClose, 0);
      assert.equal(f.stats.gets.length, reads);
    } finally {
      await f.close();
    }
  });

for (const stage of ['cookies', 'creation'] as const)
  test(`short metadata API schema: cancellation during late ${stage} owns eventual handle and performs no GET/page`, async () => {
    const gate = metadataApiSchema_apiSchemaDeferred(),
      f = metadataApiSchema_fixture(
        stage === 'cookies' ? { cookieGate: gate.promise } : { createGate: gate.promise },
      ),
      controller = new AbortController();
    try {
      const running = f.call(controller.signal);
      await metadataApiSchema_pause();
      controller.abort();
      let finished = false;
      void running.then(() => {
        finished = true;
      });
      await metadataApiSchema_pause();
      assert.equal(finished, false);
      gate.resolve();
      const result = await running;
      assert.equal(result.reason, 'cancelled');
      assert.equal(f.stats.gets.length, 0);
      assert.equal(f.stats.created, stage === 'creation' ? 1 : 0);
      assert.equal(f.stats.sessionDispose, stage === 'creation' ? 1 : 0);
      assert.equal(f.stats.beforeRead, 0);
      assert.equal(f.stats.pages, 0);
    } finally {
      gate.resolve();
      await f.close();
    }
  });

test('short metadata API schema: late GET and response dispose hold sibling FIFO after cancellation until all owned work settles', async () => {
  const get = metadataApiSchema_apiSchemaDeferred(),
    dispose = metadataApiSchema_apiSchemaDeferred(),
    f = metadataApiSchema_fixture({ getGate: get.promise, responseDisposeGate: dispose.promise }),
    controller = new AbortController();
  try {
    const running = f.call(controller.signal);
    while (f.stats.gets.length < 2) await metadataApiSchema_pause();
    controller.abort();
    const next = f.next();
    await metadataApiSchema_pause();
    assert.equal(f.stats.primaryReads, 0);
    assert.equal(f.stats.sessionDispose, 1);
    get.resolve();
    await metadataApiSchema_pause();
    assert.equal(f.stats.responseDispose, 2);
    assert.equal(f.stats.primaryReads, 0);
    dispose.resolve();
    const result = await running;
    assert.equal(result.reason, 'cancelled');
    assert.equal(result.cleanup.pendingAtEnd, 0);
    assert.equal(await next, 'next');
    assert.equal(f.stats.primaryClose, 0);
  } finally {
    get.resolve();
    dispose.resolve();
    await f.close();
  }
});

test('short metadata API schema: late body completion after cancellation is drained and never exposes the target projection', async () => {
  const gate = metadataApiSchema_apiSchemaDeferred(),
    f = metadataApiSchema_fixture({ bodyGate: gate.promise }),
    controller = new AbortController();
  try {
    const running = f.call(controller.signal);
    while (f.stats.bodies < 2) await metadataApiSchema_pause();
    controller.abort();
    let ended = false;
    void running.then(() => {
      ended = true;
    });
    await metadataApiSchema_pause();
    assert.equal(ended, false);
    gate.resolve();
    const result = await running;
    assert.equal(result.reason, 'cancelled');
    assert.equal(result.fields, null);
    assert.equal(result.cleanup.pendingAtEnd, 0);
    assert.equal(f.stats.callback, 0);
  } finally {
    gate.resolve();
    await f.close();
  }
});

test('short metadata API schema: deadline includes successful session disposal and cannot publish captured fields after slow cleanup', async () => {
  const gate = metadataApiSchema_apiSchemaDeferred(),
    f = metadataApiSchema_fixture({ sessionDisposeGate: gate.promise });
  try {
    const running = f.call(undefined, 30);
    while (!f.stats.sessionDispose) await metadataApiSchema_pause();
    await new Promise((resolve) => setTimeout(resolve, 50));
    gate.resolve();
    const result = await running;
    assert.equal(result.reason, 'timeout');
    assert.equal(result.fields, null);
    assert.equal(result.proof.ownerAfter, true);
    assert.equal(result.cleanup.sessionDisposed, true);
    assert.equal(f.stats.callback, 0);
  } finally {
    gate.resolve();
    await f.close();
  }
});

test('short metadata API schema: shutdown stops late API creation and drains it before closing borrowed persistent browser', async () => {
  const gate = metadataApiSchema_apiSchemaDeferred(),
    f = metadataApiSchema_fixture({ createGate: gate.promise });
  try {
    const running = f.call();
    await metadataApiSchema_pause();
    const closing = f.session.close();
    await metadataApiSchema_pause();
    assert.equal(f.stats.primaryClose, 0);
    gate.resolve();
    const result = await running;
    await closing;
    assert.equal(result.reason, 'cancelled');
    assert.equal(f.stats.sessionDispose, 1);
    assert.equal(f.stats.primaryClose, 1);
    assert.equal(f.stats.gets.length, 0);
  } finally {
    gate.resolve();
    await f.close();
  }
});

test('short metadata API schema: cold context and already cancelled calls do not claim platform observation', async () => {
  const session = new BrowserSession({ profileDir: '/synthetic/never-open', headless: true });
  let starts = 0;
  const options = {
    expectedAccountId: metadataApiSchema_ACCOUNT,
    assertLease: () => {},
    onBeforePlatformRead: () => {
      starts++;
    },
    onVerifiedAccount: () => {},
  };
  assert.equal(
    (await session.diagnoseShortMetadataApiSchema(metadataApiSchema_WORK, options)).reason,
    'context_unavailable',
  );
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (
      await session.diagnoseShortMetadataApiSchema(metadataApiSchema_WORK, {
        ...options,
        signal: controller.signal,
      })
    ).reason,
    'cancelled',
  );
  assert.equal(starts, 0);
  await session.close();
});
