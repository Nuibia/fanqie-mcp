import test from 'node:test';

import {
  fixture,
  deferred,
  turn,
  type Controls,
  RAW,
  type BrowserOptions,
} from './helpers/short-draft-directory-deferred.js';

import assert from 'node:assert/strict';

import { durable } from './helpers/short-draft-directory-durable.js';

import {
  projectShortDraftDirectoryContext,
  safeShortDraftDirectoryJob,
} from '../src/platform/short-draft-directory.js';

import { readFileSync } from 'node:fs';

import path from 'node:path';

import { Store } from '../src/runtime/store.js';

test('directory cancel and deadline before cookies or HTTP never create an observation or owner proof', async () => {
  const controller = new AbortController();
  controller.abort();
  const f = fixture();
  const cancelled = await f.run({ signal: controller.signal });
  assert.equal(cancelled.reason, 'cancelled');
  assert.equal(f.counts().cookieCalls, 0);
  assert.deepEqual(cancelled.requests, {
    own: { attempts: 0, disposed: 0 },
    list: { attempts: 0, disposed: 0 },
  });
  const expired = fixture();
  assert.equal((await expired.run({ deadline: performance.now() - 1 })).reason, 'timeout');
  assert.equal(expired.counts().creates, 0);
  const gate = deferred<void>(),
    entered = deferred<void>();
  const timeout = fixture({ creationGate: gate.promise, onCreate: () => entered.resolve() });
  const deadline = performance.now() + 500,
    run = timeout.run({ deadline });
  let latchTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      entered.promise,
      run.then(() => {
        throw Error('Expected pending creation before the deadline');
      }),
      new Promise<never>((_resolve, reject) => {
        latchTimer = setTimeout(() => reject(Error('Creation latch was not reached')), 1_000);
      }),
    ]);
    if (latchTimer !== undefined) clearTimeout(latchTimer);
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.max(1, Math.ceil(deadline - performance.now()) + 30)),
    );
    gate.resolve();
    const result = await run;
    assert.equal(result.reason, 'timeout');
    assert.equal(timeout.counts().sessionDisposals, 1);
    assert.equal(timeout.calls.length, 0);
    assert.equal(result.cleanup.pendingAtEnd, 0);
  } finally {
    if (latchTimer !== undefined) clearTimeout(latchTimer);
    gate.resolve();
    await Promise.allSettled([run]);
  }
});

test('directory installs stop before late cookies and creation and retains real FIFO and borrowed context through close', async () => {
  for (const phase of ['cookies', 'creation'] as const) {
    const gate = deferred<void>(),
      f = fixture(
        phase === 'cookies' ? { cookiesGate: gate.promise } : { creationGate: gate.promise },
      );
    const pending = f.browser.runShortDraftDirectory(f.browserOptions, f.factory);
    await turn();
    assert(f.state.activeShortDraftDirectory);
    let closed = false;
    const closing = f.browser.close().then(() => {
      closed = true;
    });
    await turn();
    assert.equal(closed, false);
    assert.equal(f.counts().borrowedCloses, 0);
    gate.resolve();
    const result = await pending;
    await closing;
    assert.equal(result.reason, 'cancelled');
    assert.equal(f.calls.length, 0);
    assert.equal(f.counts().borrowedCloses, 1);
    assert.equal(f.counts().sessionDisposals, phase === 'creation' ? 1 : 0);
    assert.equal(f.state.activeShortDraftDirectory, null);
  }
});

test('directory late GET body and response disposal hold FIFO until actual handles settle', async () => {
  for (const phase of ['get', 'body', 'dispose'] as const) {
    const gate = deferred<void>(),
      control: Controls =
        phase === 'get'
          ? { getGate: gate.promise }
          : phase === 'body'
            ? { bodyGate: gate.promise }
            : { responseDisposeGate: gate.promise };
    const f = fixture(control),
      controller = new AbortController();
    let firstDone = false;
    const first = f.browser
      .runShortDraftDirectory({ ...f.browserOptions, signal: controller.signal }, f.factory)
      .then((value) => {
        firstDone = true;
        return value;
      });
    await turn();
    controller.abort();
    const next = f.browser.runShortDraftDirectory(f.browserOptions, f.factory);
    await turn();
    assert.equal(firstDone, false);
    assert.equal(f.counts().creates, 1);
    gate.resolve();
    const result = await first;
    assert.equal(result.reason, 'cancelled');
    assert.equal(result.requests.own.disposed, 1);
    assert.equal(result.cleanup.pendingAtEnd, 0);
    assert.equal((await next).status, 'success');
    assert.equal(f.counts().creates, 2);
    await f.browser.close();
  }
});

test('directory response and session disposal failure quarantine the account and reject successors without borrowed teardown', async () => {
  for (const control of [{ responseDisposeFails: true }, { sessionDisposeFails: true }]) {
    const f = fixture(control),
      result = await f.browser.runShortDraftDirectory(f.browserOptions, f.factory);
    assert.equal(result.reason, 'cleanup_failed');
    assert.equal(result.cleanup.quarantined, true);
    assert.equal(result.cleanup.pendingAtEnd, 0);
    assert.equal(f.browser.hasUnsafeApiCleanup, true);
    assert.equal(
      (await f.browser.runShortDraftDirectory(f.browserOptions, f.factory)).reason,
      'cleanup_failed',
    );
    assert.equal(f.counts().creates, 1);
    await assert.rejects(f.browser.close(), /disposal is unverified/);
    assert.equal(f.counts().borrowedCloses, 0);
  }
  const gate = deferred<void>(),
    f = fixture({ getGate: gate.promise, responseDisposeFails: true }),
    controller = new AbortController();
  const pending = f.run({ signal: controller.signal });
  await turn();
  controller.abort();
  gate.resolve();
  assert.equal((await pending).cleanup.quarantined, true);
});

test('directory Browser captures closed factory options and rejects cold changed epoch disconnected and pre-cancelled sources', async () => {
  const cold = fixture();
  cold.state.context = null;
  assert.equal(
    (await cold.browser.runShortDraftDirectory(cold.browserOptions, cold.factory)).reason,
    'context_unavailable',
  );
  assert.equal(cold.counts().cookieCalls, 0);
  const disconnected = fixture();
  disconnected.connected.value = false;
  assert.equal(
    (
      await disconnected.browser.runShortDraftDirectory(
        disconnected.browserOptions,
        disconnected.factory,
      )
    ).reason,
    'context_unavailable',
  );
  const controller = new AbortController();
  controller.abort();
  const cancelled = fixture();
  assert.equal(
    (
      await cancelled.browser.runShortDraftDirectory(
        { ...cancelled.browserOptions, signal: controller.signal },
        cancelled.factory,
      )
    ).reason,
    'cancelled',
  );
  const changed = fixture();
  changed.control.onGet = () => {
    changed.state.identityEpoch++;
  };
  const moved = await changed.browser.runShortDraftDirectory(
    changed.browserOptions,
    changed.factory,
  );
  assert.equal(moved.reason, 'source_changed');
  assert.deepEqual(moved.records, []);
  let gets = 0;
  const f = fixture();
  const options = Object.defineProperty({ ...f.browserOptions }, 'expectedOwner', {
    get() {
      gets++;
      throw Error(RAW);
    },
    enumerable: true,
  });
  await assert.rejects(f.browser.runShortDraftDirectory(options, f.factory));
  assert.equal(gets, 0);
  await assert.rejects(
    f.browser.runShortDraftDirectory(
      { ...f.browserOptions, mode: 'write' } as unknown as BrowserOptions,
      f.factory,
    ),
  );
  const blocked = deferred<void>();
  (f.browser as unknown as { queue: Promise<void> }).queue = blocked.promise;
  const pending = f.browser.runShortDraftDirectory(f.browserOptions, f.factory);
  f.factory.newContext = async () => {
    throw Error('Late replacement forbidden');
  };
  blocked.resolve();
  assert.equal((await pending).status, 'success');
  await f.browser.close();
});

test('directory real Store Queue Browser publish safe physical fixture manifest and replay saved after deadline and reopen without GET', async () => {
  const d = await durable(11);
  try {
    const job = await d.execute().completion;
    assert.equal(job.status, 'succeeded');
    const view = projectShortDraftDirectoryContext(d.publicContext(job));
    assert.equal(view.validated, true);
    assert.equal(view.verifiedLive, false);
    assert.equal(view.collectionMode, 'fixture');
    assert.equal(view.data[0]!.records.length, 11);
    assert.deepEqual(view.data[0]!.records[0], {
      id: { namespace: 'native_short_item', value: '1000000000' },
      title: null,
      publicationStatus: 'unknown',
      signingStatus: 'unknown',
      listingScope: 'own_draft_list',
    });
    const before = d.f.calls.length,
      ref = d.store.listEvidence(job.id)[0]!;
    assert.equal(
      readFileSync(path.join(d.evidenceDirectory, ref.path), 'utf8').includes(RAW),
      false,
    );
    const future = { ...d.publicContext(job), evaluationAt: '2099-01-01T00:00:00.000Z' };
    assert.equal(projectShortDraftDirectoryContext(future).data[0]!.coverage.complete, true);
    assert.equal(d.f.calls.length, before);
    assert.equal(Object.hasOwn(safeShortDraftDirectoryJob(job, view), 'metadata'), false);
    assert.equal(Object.hasOwn(view.data[0]!, 'owner'), false);
    assert.equal(JSON.stringify(view).includes(ref.path), false);
    d.store.close();
    const reopened = new Store({
      databasePath: d.databasePath,
      evidenceDirectory: d.evidenceDirectory,
      evidenceMode: 'fixture',
    });
    try {
      const actual = reopened.getJob(job.id, 'directory-test')!,
        refs = reopened.listEvidence(job.id);
      const restored = projectShortDraftDirectoryContext({
        accountId: 'directory-test',
        job: actual,
        manifest: reopened.getManifestForJob('directory-test', job.id),
        refs,
        documents: refs.map((r) => reopened.readEvidence(r)),
        evaluationAt: new Date().toISOString(),
      });
      assert.deepEqual(restored, view);
      assert.equal(d.f.calls.length, before);
    } finally {
      reopened.close();
    }
  } finally {
    await d.close();
  }
});
