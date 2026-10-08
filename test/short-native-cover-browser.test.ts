import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { BrowserSession, BrowserSessionError } from '../src/platform/browser.js';
import {
  OwnedNativeShortCoverRun,
  unavailableNativeShortCoverApi,
  type NativeShortCoverApiOptions,
  type NativeShortCoverApiResult,
  type NativeShortCoverWriteRequest,
} from '../src/platform/short-native-cover-api.js';
import {
  OwnedNativeShortMetadataRun,
  unavailableNativeShortMetadataApi,
} from '../src/platform/short-native-metadata-api.js';
import { NATIVE_SHORT_HASH_BASES } from '../src/platform/short-native-metadata.js';

const WORK = '1234567890123456789';
const ACCOUNT = '0001001';
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
type CoverBrowserOptions = Parameters<BrowserSession['runNativeShortCoverUpdate']>[1];
type RunInternals = {
  options: NativeShortCoverApiOptions;
  businessRequest: NativeShortCoverWriteRequest | null;
};
type SessionInternals = {
  context: BrowserContext | null;
  page: Page | null;
  queue: Promise<void>;
  identityEpoch: number;
  apiQuarantined: boolean;
  activeNativeShortCover: { stop(): void; done: Promise<NativeShortCoverApiResult> } | null;
};
function fixture() {
  const session = new BrowserSession({
    profileDir: '/synthetic-cover-no-profile',
    headless: true,
    operationTimeoutMs: 5_000,
  });
  const state = session as unknown as SessionInternals;
  let borrowedCloses = 0,
    cookies = 0,
    navigation = 0;
  const connected = { value: true };
  const browser = { isConnected: () => connected.value };
  const context = {
    browser: () => browser,
    async cookies() {
      cookies++;
      throw Error('This Browser control fixture must not use transport');
    },
    async close() {
      borrowedCloses++;
    },
    get request() {
      throw Error('Primary request access forbidden');
    },
  } as unknown as BrowserContext;
  const page = {
    context: () => context,
    isClosed: () => false,
    async goto() {
      navigation++;
      throw Error('Navigation forbidden');
    },
  } as unknown as Page;
  state.context = context;
  state.page = page;
  const businessRequest: NativeShortCoverWriteRequest = {
    expectedSnapshotVersionHash: 'a'.repeat(64),
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedState: 'draft',
    cover: {
      uploadPath: '123e4567-e89b-42d3-a456-426614174000.png',
      sha256: 'b'.repeat(64),
      fit: 'contain',
    },
  };
  const options: CoverBrowserOptions = {
    mode: 'write',
    uploadDir: '/synthetic-cover-upload',
    businessRequest,
    expectedOwner: { kind: 'account', id: ACCOUNT },
    assertLease() {},
    onBeforePlatformRead() {},
    onDurableIntent() {
      throw Error('Durability callback not used by Browser control fixture');
    },
    onBeforePlatformWrite() {
      throw Error('Write callback not used by Browser control fixture');
    },
    onDurableAcknowledgement() {
      throw Error('ACK callback not used by Browser control fixture');
    },
    onVerifiedAccount() {},
  };
  return {
    session,
    state,
    context,
    connected,
    options,
    businessRequest,
    get borrowedCloses() {
      return borrowedCloses;
    },
    get cookies() {
      return cookies;
    },
    get navigation() {
      return navigation;
    },
  };
}
async function mocked<T>(
  run: (this: OwnedNativeShortCoverRun) => Promise<NativeShortCoverApiResult>,
  stop: (this: OwnedNativeShortCoverRun) => void,
  action: () => Promise<T>,
): Promise<T> {
  const originalRun = OwnedNativeShortCoverRun.prototype.run,
    originalStop = OwnedNativeShortCoverRun.prototype.stop;
  OwnedNativeShortCoverRun.prototype.run = run;
  OwnedNativeShortCoverRun.prototype.stop = stop;
  try {
    return await action();
  } finally {
    OwnedNativeShortCoverRun.prototype.run = originalRun;
    OwnedNativeShortCoverRun.prototype.stop = originalStop;
  }
}

// These are Browser lifecycle fixtures, not image/API/platform success proofs.
test('cover cold, disconnected, pre-cancelled and quarantined states never launch or enter an owned run', async () => {
  let runs = 0,
    launches = 0;
  const originalLaunch = chromium.launchPersistentContext;
  chromium.launchPersistentContext = async () => {
    launches++;
    throw Error('Cold cover must not launch');
  };
  try {
    await mocked(
      async function () {
        runs++;
        throw Error('Owned run forbidden');
      },
      function () {},
      async () => {
        const cold = fixture();
        cold.state.context = null;
        cold.state.page = null;
        assert.equal(
          (await cold.session.runNativeShortCoverUpdate(WORK, cold.options)).reason,
          'context_unavailable',
        );
        const disconnected = fixture();
        disconnected.connected.value = false;
        assert.equal(
          (await disconnected.session.runNativeShortCoverUpdate(WORK, disconnected.options)).reason,
          'context_unavailable',
        );
        const cancelled = fixture(),
          controller = new AbortController();
        controller.abort();
        assert.equal(
          (
            await cancelled.session.runNativeShortCoverUpdate(WORK, {
              ...cancelled.options,
              signal: controller.signal,
            })
          ).reason,
          'cancelled',
        );
        const fenced = fixture();
        fenced.state.apiQuarantined = true;
        assert.equal(
          (await fenced.session.runNativeShortCoverUpdate(WORK, fenced.options)).reason,
          'cleanup_failed',
        );
        const closed = fixture();
        await closed.session.close();
        assert.equal(
          (await closed.session.runNativeShortCoverUpdate(WORK, closed.options)).reason,
          'cancelled',
        );
        for (const f of [cold, disconnected, cancelled, fenced, closed]) {
          assert.equal(f.cookies, 0);
          assert.equal(f.navigation, 0);
        }
      },
    );
    assert.equal(runs, 0);
    assert.equal(launches, 0);
  } finally {
    chromium.launchPersistentContext = originalLaunch;
  }
});

test('cover installs active stop/done before its first await; close retains borrowed resources through the actual drain', async () => {
  const f = fixture(),
    entered = deferred<void>(),
    release = deferred<void>();
  let stops = 0;
  await mocked(
    async function () {
      assert(f.state.activeNativeShortCover);
      entered.resolve();
      await release.promise;
      return unavailableNativeShortCoverApi('cancelled');
    },
    function () {
      stops++;
    },
    async () => {
      const running = f.session.runNativeShortCoverUpdate(WORK, f.options);
      await entered.promise;
      let pageEntered = false;
      const page = f.session
        .read(async () => {
          pageEntered = true;
        })
        .then(
          () => null,
          (error) => error,
        );
      const closing = f.session.close();
      await turn();
      assert.equal(stops, 1);
      assert.equal(f.borrowedCloses, 0);
      assert.equal(pageEntered, false);
      assert(f.state.activeNativeShortCover);
      release.resolve();
      assert.equal((await running).reason, 'cancelled');
      await closing;
      assert((await page) instanceof BrowserSessionError);
      assert.equal(pageEntered, false);
      assert.equal(f.borrowedCloses, 1);
      assert.equal(f.state.context, null);
      assert.equal(f.state.activeNativeShortCover, null);
      assert.equal(f.cookies, 0);
      assert.equal(f.navigation, 0);
    },
  );
});

test('cover FIFO is shared with native reads and Page siblings until owned run completion', async () => {
  const f = fixture(),
    release = deferred<void>(),
    entered = deferred<void>();
  const events: string[] = [];
  const originalNative = OwnedNativeShortMetadataRun.prototype.run;
  OwnedNativeShortMetadataRun.prototype.run = async function () {
    events.push('native');
    return unavailableNativeShortMetadataApi('response_unavailable');
  };
  try {
    await mocked(
      async function () {
        events.push('cover');
        entered.resolve();
        await release.promise;
        events.push('cover_drained');
        return unavailableNativeShortCoverApi('response_unavailable');
      },
      function () {},
      async () => {
        const cover = f.session.runNativeShortCoverUpdate(WORK, f.options);
        await entered.promise;
        const native = f.session.runNativeShortMetadata(WORK, {
          mode: 'read',
          expectedOwner: { kind: 'account', id: ACCOUNT },
          assertLease() {},
          onBeforePlatformRead() {},
          onVerifiedAccount() {},
        });
        const page = f.session.read(async () => {
          events.push('page');
          return 7;
        });
        await turn();
        assert.deepEqual(events, ['cover']);
        release.resolve();
        await cover;
        await native;
        assert.equal(await page, 7);
        assert.deepEqual(events, ['cover', 'cover_drained', 'native', 'page']);
        await f.session.close();
        assert.equal(f.borrowedCloses, 1);
        assert.equal(f.cookies, 0);
        assert.equal(f.navigation, 0);
      },
    );
  } finally {
    OwnedNativeShortMetadataRun.prototype.run = originalNative;
  }
});

test('cover captures business values, owner, upload directory and callbacks before waiting in FIFO', async () => {
  const f = fixture(),
    queueGate = deferred<void>();
  f.state.queue = queueGate.promise;
  f.options.timeoutMs = 3_000;
  const originalRead = f.options.onBeforePlatformRead,
    originalOwner = f.options.onVerifiedAccount;
  await mocked(
    async function () {
      const run = this as unknown as RunInternals;
      assert.equal(run.options.expectedOwner.id, ACCOUNT);
      assert.equal(run.options.uploadDir, '/synthetic-cover-upload');
      assert.equal(Object.hasOwn(run.options, 'timeoutMs'), false);
      assert(run.options.deadline > performance.now());
      assert.equal(run.options.onBeforePlatformRead, originalRead);
      assert.equal(run.options.onVerifiedAccount, originalOwner);
      assert.equal(run.businessRequest?.expectedSnapshotVersionHash, 'a'.repeat(64));
      assert.equal(run.businessRequest?.cover.sha256, 'b'.repeat(64));
      assert.equal(run.businessRequest?.cover.fit, 'contain');
      assert(Object.isFrozen(run.businessRequest?.cover));
      run.options.assertBorrowedActive();
      return unavailableNativeShortCoverApi('response_unavailable');
    },
    function () {},
    async () => {
      const running = f.session.runNativeShortCoverUpdate(WORK, f.options);
      (f.businessRequest as { expectedSnapshotVersionHash: string }).expectedSnapshotVersionHash =
        'c'.repeat(64);
      (f.businessRequest.cover as { sha256: string; fit: string }).sha256 = 'd'.repeat(64);
      (f.businessRequest.cover as { fit: string }).fit = 'cover';
      f.options.timeoutMs = 1;
      f.options.expectedOwner.id = '2002';
      f.options.uploadDir = '/changed';
      f.options.onBeforePlatformRead = () => {
        throw Error('Changed callback');
      };
      f.options.onVerifiedAccount = () => {
        throw Error('Changed owner callback');
      };
      queueGate.resolve();
      await running;
      await f.session.close();
    },
  );
});

for (const changed of ['epoch', 'context', 'connection', 'quarantine'] as const) {
  test(`cover borrowed checker rejects ${changed} mutation after an await`, async () => {
    const f = fixture(),
      entered = deferred<void>(),
      release = deferred<void>();
    await mocked(
      async function () {
        const run = this as unknown as RunInternals;
        run.options.assertBorrowedActive();
        entered.resolve();
        await release.promise;
        assert.throws(
          () => run.options.assertBorrowedActive(),
          (error) =>
            error instanceof BrowserSessionError && error.code === 'capability_unavailable',
        );
        return unavailableNativeShortCoverApi('source_changed');
      },
      function () {},
      async () => {
        const running = f.session.runNativeShortCoverUpdate(WORK, f.options);
        await entered.promise;
        if (changed === 'epoch') f.state.identityEpoch++;
        if (changed === 'context') f.state.context = null;
        if (changed === 'connection') f.connected.value = false;
        if (changed === 'quarantine') f.state.apiQuarantined = true;
        release.resolve();
        assert.equal((await running).reason, 'source_changed');
        assert.equal(f.state.activeNativeShortCover, null);
      },
    );
  });
}

test('cover close grace failure retains borrowed context and active slot until late completion', async () => {
  const f = fixture(),
    entered = deferred<void>(),
    release = deferred<void>();
  let stops = 0;
  await mocked(
    async function () {
      entered.resolve();
      await release.promise;
      return unavailableNativeShortCoverApi('cancelled');
    },
    function () {
      stops++;
    },
    async () => {
      const running = f.session.runNativeShortCoverUpdate(WORK, f.options);
      await entered.promise;
      const originalTimeout = globalThis.setTimeout;
      globalThis.setTimeout = ((
        fn: (...args: unknown[]) => void,
        delay?: number,
        ...args: unknown[]
      ) => originalTimeout(fn, delay === 25_000 ? 2 : delay, ...args)) as typeof setTimeout;
      try {
        await assert.rejects(
          f.session.close(),
          (error) => error instanceof BrowserSessionError && error.code === 'shutdown_incomplete',
        );
      } finally {
        globalThis.setTimeout = originalTimeout;
      }
      assert.equal(stops, 1);
      assert.equal(f.borrowedCloses, 0);
      assert.equal(f.state.context, f.context);
      assert(f.state.activeNativeShortCover);
      release.resolve();
      await running;
      await f.session.close();
      assert.equal(f.borrowedCloses, 1);
      assert.equal(f.state.context, null);
    },
  );
});

test('cover disposal quarantine fences later cover, native and Page calls, and close preserves borrowed context', async () => {
  const f = fixture();
  let runs = 0;
  await mocked(
    async function () {
      runs++;
      (this as unknown as RunInternals).options.onQuarantine();
      const result = unavailableNativeShortCoverApi('cleanup_failed');
      result.cleanup.quarantined = true;
      return result;
    },
    function () {},
    async () => {
      assert.equal(
        (await f.session.runNativeShortCoverUpdate(WORK, f.options)).reason,
        'cleanup_failed',
      );
      assert.equal(
        (await f.session.runNativeShortCoverUpdate(WORK, f.options)).reason,
        'cleanup_failed',
      );
      assert.equal(
        (
          await f.session.runNativeShortMetadata(WORK, {
            mode: 'read',
            expectedOwner: { kind: 'account', id: ACCOUNT },
            assertLease() {},
            onBeforePlatformRead() {},
            onVerifiedAccount() {},
          })
        ).reason,
        'cleanup_failed',
      );
      await assert.rejects(
        f.session.read(async () => 1),
        (error) => error instanceof BrowserSessionError && error.code === 'shutdown_incomplete',
      );
      await assert.rejects(
        f.session.close(),
        (error) => error instanceof BrowserSessionError && error.code === 'shutdown_incomplete',
      );
      assert.equal(runs, 1);
      assert.equal(f.borrowedCloses, 0);
      assert.equal(f.state.context, f.context);
    },
  );
});

for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648]) {
  test(`cover invalid timeout ${String(timeoutMs)} rejects before queue/owned work`, async () => {
    const f = fixture();
    const beforeQueue = f.state.queue;
    await assert.rejects(
      f.session.runNativeShortCoverUpdate(WORK, { ...f.options, timeoutMs }),
      (error) => error instanceof BrowserSessionError && error.code === 'invalid_config',
    );
    assert.equal(f.state.queue, beforeQueue);
    assert.equal(f.state.activeNativeShortCover, null);
    assert.equal(f.cookies, 0);
  });
}
