import {
  edit,
  turn,
  withFactory,
  WORK,
  failed,
  deferred,
  ACCOUNT,
} from './helpers/short-native-metadata-api-deferred.js';

import test from 'node:test';

import { writeFixture, writeFailed } from './helpers/short-native-metadata-api-write-fixture.js';

import assert from 'node:assert/strict';

for (const [name, overrides, reason] of [
  ['ACK lost after platform stored', { lostAck: true }, 'response_unavailable'],
  ['string ACK code', { ack: { code: '0' } }, 'response_unverified'],
  ['nonzero ACK code', { ack: { code: 1 } }, 'response_unverified'],
  [
    'changed unrequested tail',
    {
      afterMutation: (raw: ReturnType<typeof edit>) => {
        raw.multi_title[1] = 'private-changed-tail';
      },
    },
    'readback_mismatch',
  ],
  [
    'changed preserved HTML',
    {
      afterMutation: (raw: ReturnType<typeof edit>) => {
        raw.content += '<p>private-change</p>';
      },
    },
    'readback_mismatch',
  ],
  [
    'same category ID wrong name',
    {
      afterMutation: (raw: ReturnType<typeof edit>) => {
        raw.category[0]!.name = 'private-changed-name';
      },
    },
    'readback_mismatch',
  ],
  ['missing after target', { afterRows: [] }, 'target_unverified'],
  ['after disposal failure', { postDisposeFailure: true }, 'cleanup_failed'],
  ['final owner failure', { callbackFault: 'final_owner' }, 'callback_failed'],
] as const)
  test(`native write ${name} keeps one attempted POST and requires later reconciliation`, async () => {
    const f = writeFixture(overrides);
    const result = await f.run.run();
    writeFailed(result, reason);
    assert.equal(f.posts.length, 1);
    assert.equal(result.proof.writeMarked, true);
    assert.equal(f.marks, 1);
    assert.equal(f.current.multi_title[0], 'Changed synthetic title');
  });

for (const stage of [
  'durable',
  'mark',
  'post',
  'post_body',
  'post_dispose',
  'final_owner',
] as const)
  test(`native write cancellation at ${stage} tracks real pending callbacks and response work through drain`, async () => {
    const f = writeFixture({ writeHold: stage });
    let done = false;
    const running = f.run.run().then((value) => {
      done = true;
      return value;
    });
    await f.writeEntered;
    f.controller.abort();
    await turn();
    assert.equal(done, false);
    f.releaseWrite();
    const result = await running;
    writeFailed(result, 'cancelled');
    assert.equal(f.posts.length, ['durable', 'mark'].includes(stage) ? 0 : 1);
    assert.equal(f.apiCloses, 1);
    assert.equal(f.borrowedCloses, 0);
  });

test('native write captures business values and deadline and never evaluates a business getter', async () => {
  const f = writeFixture({ writeHold: 'durable' });
  const running = f.run.run();
  await f.writeEntered;
  (f.options.businessRequest as any).title = 'Altered alias';
  f.options.deadline = performance.now() + 1_000_000;
  f.releaseWrite();
  const result = await running;
  assert.equal(result.status, 'success');
  assert.equal(result.snapshot!.savedFields.multi_title[0], 'Changed synthetic title');
  let getterCalls = 0;
  const g = writeFixture({
    requestMutation: (value) => {
      Object.defineProperty(value, 'title', {
        enumerable: true,
        get() {
          getterCalls++;
          throw Error('private-getter');
        },
      });
    },
  });
  writeFailed(await g.run.run(), 'unsupported_schema');
  assert.equal(getterCalls, 0);
  assert.equal(g.events.length, 0);
});

test('Browser native write installs stop/done before late creation and retains its Page sibling FIFO until drain', async () => {
  const f = writeFixture({ writeHold: 'post_body' });
  await withFactory(f, async () => {
    const running = f.session.runNativeShortMetadataUpdate(WORK, f.browserOptions);
    await f.writeEntered;
    assert((f.internals as any).activeNativeShortMetadataWrite);
    let helperDone = false;
    const helper = f.session.verifyCurrentAccount(f.page).then((value) => {
      helperDone = true;
      return value;
    });
    await turn();
    assert.equal(helperDone, false);
    assert.equal(f.pageTouches, 0);
    f.controller.abort();
    await turn();
    assert.equal(helperDone, false);
    assert.equal(f.pageTouches, 0);
    f.releaseWrite();
    writeFailed(await running, 'cancelled');
    assert.equal((await helper).status, 'authenticated');
  });
  await f.session.close();
});

test('Browser native write close grace retains borrowed resources until late durable callback actually finishes', async () => {
  const f = writeFixture({ writeHold: 'durable' });
  await withFactory(f, async () => {
    const running = f.session.runNativeShortMetadataUpdate(WORK, f.browserOptions);
    await f.writeEntered;
    const original = globalThis.setTimeout;
    globalThis.setTimeout = ((
      fn: Parameters<typeof setTimeout>[0],
      ms?: number,
      ...args: unknown[]
    ) => original(fn, ms === 25_000 ? 5 : ms, ...args)) as typeof setTimeout;
    try {
      await assert.rejects(f.session.close(), { code: 'shutdown_incomplete' });
    } finally {
      globalThis.setTimeout = original;
    }
    assert.equal(f.borrowedCloses, 0);
    assert((f.internals as any).activeNativeShortMetadataWrite);
    assert(f.internals.context);
    f.releaseWrite();
    writeFailed(await running, 'cancelled');
    await f.session.close();
    assert.equal(f.borrowedCloses, 1);
    assert.equal(f.apiCloses, 1);
    assert.equal(f.posts.length, 0);
  });
});

test('Browser native write API cleanup failure quarantines new read, write and Page siblings before platform work', async () => {
  const f = writeFixture({ postDisposeFailure: true });
  await withFactory(f, async () => {
    writeFailed(
      await f.session.runNativeShortMetadataUpdate(WORK, f.browserOptions),
      'cleanup_failed',
    );
    const calls = f.calls.length;
    writeFailed(
      await f.session.runNativeShortMetadataUpdate(WORK, f.browserOptions),
      'cleanup_failed',
    );
    failed(await f.session.runNativeShortMetadata(WORK, f.browserOptions as any), 'cleanup_failed');
    await assert.rejects(f.session.verifyCurrentAccount(f.page), { code: 'shutdown_incomplete' });
    assert.equal(f.calls.length, calls);
    assert.equal(f.posts.length, 1);
    assert.equal(f.pageTouches, 0);
    await assert.rejects(f.session.close(), { code: 'shutdown_incomplete' });
    assert.equal(f.borrowedCloses, 0);
  });
});

for (const stage of ['cookies', 'creation'] as const)
  test(`Browser native write close during first pending ${stage} already owns stop/done and never POSTs`, async () => {
    const f = writeFixture({ hold: stage });
    await withFactory(f, async () => {
      const running = f.session.runNativeShortMetadataUpdate(WORK, f.browserOptions);
      await f.entered;
      assert((f.internals as any).activeNativeShortMetadataWrite);
      let closed = false;
      const closing = f.session.close().then(() => {
        closed = true;
      });
      await turn();
      assert.equal(closed, false);
      assert.equal(f.borrowedCloses, 0);
      f.release();
      writeFailed(await running, 'cancelled');
      await closing;
      assert.equal(f.posts.length, 0);
      assert.equal(f.calls.length, 0);
      assert.equal(f.apiCloses, stage === 'cookies' ? 0 : 1);
      assert.equal(f.borrowedCloses, 1);
    });
  });

test('Browser native write captures queued request and owner before its FIFO slot and never uses Page', async () => {
  const f = writeFixture(),
    gate = deferred<void>(),
    entered = deferred<void>();
  const reader = f.session.withPage(async () => {
    entered.resolve();
    await gate.promise;
  });
  await entered.promise;
  await withFactory(f, async () => {
    const options = {
      ...f.browserOptions,
      expectedOwner: { ...f.browserOptions.expectedOwner },
      businessRequest: { ...f.browserOptions.businessRequest },
    };
    const running = f.session.runNativeShortMetadataUpdate(WORK, options);
    options.expectedOwner.id = '9999';
    options.businessRequest.title = 'Changed after queue';
    gate.resolve();
    await reader;
    const result = await running;
    assert.equal(result.status, 'success');
    assert.equal(result.snapshot!.savedFields.multi_title[0], 'Changed synthetic title');
    assert.equal(result.snapshot!.binding.account.id, ACCOUNT);
    assert.equal(f.pageTouches, 0);
  });
  await f.session.close();
});

for (const fence of ['lease', 'epoch', 'abort'] as const)
  test(`Browser native write ${fence} revocation after mark vetoes HTTP and keeps the conservative marked proof`, async () => {
    let valid = true;
    const f = writeFixture({
      writeHold: 'mark',
      lease: () => {
        if (!valid && fence === 'lease') throw Error('private-lease');
      },
    });
    await withFactory(f, async () => {
      const running = f.session.runNativeShortMetadataUpdate(WORK, f.browserOptions);
      await f.writeEntered;
      if (fence === 'lease') valid = false;
      else if (fence === 'epoch') f.internals.identityEpoch++;
      else f.controller.abort();
      f.releaseWrite();
      const result = await running;
      writeFailed(
        result,
        fence === 'lease'
          ? 'lease_unavailable'
          : fence === 'epoch'
            ? 'source_changed'
            : 'cancelled',
      );
      assert.equal(f.marks, 1);
      assert.equal(f.posts.length, 0);
      assert.equal(result.proof.writeMarked, true);
      assert.equal(f.apiCloses, 1);
    });
    await f.session.close();
  });

test('native write original deadline includes held API disposal and cannot be extended through the caller alias', async () => {
  const f = writeFixture({ hold: 'api_dispose', deadlineMs: 2_500 });
  const running = f.run.run();
  await f.entered;
  f.options.deadline = performance.now() + 1_000_000;
  await new Promise((resolve) => setTimeout(resolve, 2_600));
  f.release();
  const result = await running;
  writeFailed(result, 'timeout');
  assert.equal(f.posts.length, 1);
  assert.equal(result.cleanup.sessionDisposed, true);
  assert.equal(f.finalAt, null);
});

test('Browser native write final owner callback epoch revocation invalidates the already clean captured readback', async () => {
  let f!: ReturnType<typeof writeFixture>;
  f = writeFixture({
    callback: () => {
      f.internals.identityEpoch++;
    },
  });
  await withFactory(f, async () => {
    writeFailed(
      await f.session.runNativeShortMetadataUpdate(WORK, f.browserOptions),
      'source_changed',
    );
    assert.equal(f.posts.length, 1);
    assert.equal(f.apiCloses, 1);
  });
  await f.session.close();
});
