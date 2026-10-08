import test from 'node:test';

import { singletonFixture } from './helpers/platform-reads-metrics-page.js';

import {
  mkdir,
  writeFile,
  lstat,
  readFile,
  realpath,
  rm,
  symlink,
  readlink,
} from 'node:fs/promises';

import { join } from 'node:path';

import {
  recoverStaleProfileSingletons,
  BrowserSessionError,
  BrowserSession,
  type ProfileLockRecoveryOptions,
} from '../src/platform/browser.js';

import assert from 'node:assert/strict';

import { renameSync, symlinkSync } from 'node:fs';

import { chromium, type BrowserContext, type Page } from 'playwright';

test('leased stale Docker singleton links recover without changing authentication or story storage', async (t) => {
  const fixture = await singletonFixture(t);
  await fixture.install();
  await fixture.processEntry('1', 'node');
  await mkdir(join(fixture.profile, 'Default', 'Local Storage'), { recursive: true });
  const cookies = join(fixture.profile, 'Default', 'Cookies');
  const storage = join(fixture.profile, 'Default', 'Local Storage', 'fixture.txt');
  await writeFile(cookies, 'FIXTURE_AUTH_BYTES');
  await writeFile(storage, 'FIXTURE_STORY_BODY');
  let leaseChecks = 0;
  const recovered = await recoverStaleProfileSingletons(fixture.profile, {
    ...fixture.options,
    assertProfileRecoveryLease: () => {
      leaseChecks += 1;
    },
  });
  assert.deepEqual(recovered, {
    recovered: true,
    removed: ['SingletonCookie', 'SingletonSocket', 'SingletonLock'],
  });
  assert.ok(leaseChecks >= 2);
  for (const name of recovered.removed)
    await assert.rejects(lstat(join(fixture.profile, name)), { code: 'ENOENT' });
  assert.equal(await readFile(cookies, 'utf8'), 'FIXTURE_AUTH_BYTES');
  assert.equal(await readFile(storage, 'utf8'), 'FIXTURE_STORY_BODY');
  assert.deepEqual(await recoverStaleProfileSingletons(fixture.profile, fixture.options), {
    recovered: false,
    removed: [],
  });
});

test('partial lock set needs a proven dead PID; orphan sidecars stay untouched', async (t) => {
  const lockOnly = await singletonFixture(t);
  await lockOnly.install(['SingletonLock']);
  assert.deepEqual(await recoverStaleProfileSingletons(lockOnly.profile, lockOnly.options), {
    recovered: true,
    removed: ['SingletonLock'],
  });
  const sidecars = await singletonFixture(t);
  await sidecars.install(['SingletonSocket', 'SingletonCookie']);
  await assert.rejects(recoverStaleProfileSingletons(sidecars.profile, sidecars.options), {
    code: 'browser_unavailable',
  });
  await sidecars.assertIntact(['SingletonSocket', 'SingletonCookie']);
});

test('an extant lock PID or another current-namespace Chromium process refuses all deletion', async (t) => {
  const activePid = await singletonFixture(t);
  await activePid.install();
  await activePid.processEntry('188', 'node');
  await assert.rejects(recoverStaleProfileSingletons(activePid.profile, activePid.options), {
    code: 'browser_unavailable',
  });
  await activePid.assertIntact();
  const activeChrome = await singletonFixture(t);
  await activeChrome.install();
  await activeChrome.processEntry('900', 'chrome');
  await assert.rejects(recoverStaleProfileSingletons(activeChrome.profile, activeChrome.options), {
    code: 'browser_unavailable',
  });
  await activeChrome.assertIntact();
});

test('a PID reused by the exact current Node executable recovers only singleton links and preserves profile storage', async (t) => {
  const fixture = await singletonFixture(t);
  await fixture.install();
  await fixture.processEntry('188', 'libuv-worker');
  await fixture.processExecutable('188');
  await mkdir(join(fixture.profile, 'Default', 'Local Storage'), { recursive: true });
  const cookies = join(fixture.profile, 'Default', 'Cookies');
  const storage = join(fixture.profile, 'Default', 'Local Storage', 'fixture.txt');
  await writeFile(cookies, 'FIXTURE_AUTH_BYTES');
  await writeFile(storage, 'FIXTURE_STORY_BODY');
  assert.deepEqual(await recoverStaleProfileSingletons(fixture.profile, fixture.options), {
    recovered: true,
    removed: ['SingletonCookie', 'SingletonSocket', 'SingletonLock'],
  });
  assert.equal(await readFile(cookies, 'utf8'), 'FIXTURE_AUTH_BYTES');
  assert.equal(await readFile(storage, 'utf8'), 'FIXTURE_STORY_BODY');
  assert.equal(
    await realpath(join(fixture.procRoot, '188', 'exe')),
    await realpath(process.execPath),
  );
});

test('PID reuse is refused for unknown, different or forged runtime executables without deleting any singleton', async (t) => {
  for (const kind of ['missing', 'different', 'forged-self'] as const) {
    const fixture = await singletonFixture(t);
    await fixture.install();
    await fixture.processEntry('188', 'libuv-worker');
    if (kind !== 'missing') {
      const otherExe = join(fixture.root, 'different-runtime');
      await writeFile(otherExe, 'FIXTURE_EXECUTABLE');
      await fixture.processExecutable(
        '188',
        otherExe,
        kind === 'forged-self' ? otherExe : process.execPath,
      );
    }
    await assert.rejects(recoverStaleProfileSingletons(fixture.profile, fixture.options), {
      code: 'browser_unavailable',
    });
    await fixture.assertIntact();
  }
});

test('a Chromium lock owner or another Chromium process blocks even a proven Node PID reuse', async (t) => {
  for (const ownerIsChrome of [false, true]) {
    const fixture = await singletonFixture(t);
    await fixture.install();
    await fixture.processEntry('188', ownerIsChrome ? 'chrome' : 'libuv-worker');
    await fixture.processExecutable('188');
    if (!ownerIsChrome) await fixture.processEntry('900', 'chromium');
    await assert.rejects(recoverStaleProfileSingletons(fixture.profile, fixture.options), {
      code: 'browser_unavailable',
    });
    await fixture.assertIntact();
  }
});

test('a Node PID executable changing at the final lease check refuses recovery before any deletion', async (t) => {
  const fixture = await singletonFixture(t);
  await fixture.install();
  await fixture.processEntry('188', 'libuv-worker');
  await fixture.processExecutable('188');
  const otherExe = join(fixture.root, 'different-runtime');
  await writeFile(otherExe, 'FIXTURE_EXECUTABLE');
  let checks = 0;
  await assert.rejects(
    recoverStaleProfileSingletons(fixture.profile, {
      ...fixture.options,
      assertProfileRecoveryLease: () => {
        if (++checks === 2) {
          renameSync(
            join(fixture.procRoot, '188', 'exe'),
            join(fixture.procRoot, '188', 'old-exe'),
          );
          symlinkSync(otherExe, join(fixture.procRoot, '188', 'exe'));
        }
      },
    }),
    { code: 'browser_unavailable' },
  );
  await fixture.assertIntact();
});

test('browser startup cleans a partial context and preserves fixed BrowserSessionError diagnostics', async (t) => {
  const original = chromium.launchPersistentContext;
  t.after(() => {
    chromium.launchPersistentContext = original;
  });
  let closed = false;
  const safeError = new BrowserSessionError(
    'browser_unavailable',
    'Profile singleton PID executable could not be verified as the current Node runtime',
  );
  chromium.launchPersistentContext = (async () => ({
    setDefaultTimeout() {
      throw safeError;
    },
    async close() {
      closed = true;
    },
  })) as unknown as typeof original;
  const session = new BrowserSession({ profileDir: '/not-opened-fixture-profile', headless: true });
  await assert.rejects(
    session.withPage(async () => undefined),
    (error: unknown) => error === safeError,
  );
  assert.equal(closed, true);
  const internal = session as unknown as { context: BrowserContext | null; page: Page | null };
  assert.equal(internal.context, null);
  assert.equal(internal.page, null);
  await session.close();
});

test('unknown Chromium startup errors remain a fixed safe message without platform URL or launch stack', async (t) => {
  const original = chromium.launchPersistentContext;
  t.after(() => {
    chromium.launchPersistentContext = original;
  });
  chromium.launchPersistentContext = (async () => {
    throw new Error('PRIVATE_LAUNCH_STACK https://example.invalid/?token=PRIVATE_TOKEN');
  }) as typeof original;
  const session = new BrowserSession({ profileDir: '/not-opened-fixture-profile', headless: true });
  await assert.rejects(
    session.withPage(async () => undefined),
    {
      code: 'browser_unavailable',
      message:
        'Persistent Chromium could not start; check browser installation, display and profile lock',
    },
  );
  await session.close();
});

test('malicious singleton targets fail the complete-set check before any deletion', async (t) => {
  for (const [name, target] of [
    ['SingletonSocket', '../Default/Cookies'],
    ['SingletonCookie', '../../storage'],
    ['SingletonLock', '../host-188'],
  ] as const) {
    const fixture = await singletonFixture(t);
    await fixture.install();
    await rm(join(fixture.profile, name));
    await symlink(target, join(fixture.profile, name));
    await assert.rejects(recoverStaleProfileSingletons(fixture.profile, fixture.options), {
      code: 'browser_unavailable',
    });
    for (const other of ['SingletonLock', 'SingletonSocket', 'SingletonCookie'] as const)
      assert.equal(
        await readlink(join(fixture.profile, other)),
        other === name ? target : fixture.targets[other],
      );
  }
});

test('ordinary singleton files and symlinked profile paths are never removed or followed', async (t) => {
  const fixture = await singletonFixture(t);
  await fixture.install(['SingletonLock', 'SingletonSocket']);
  await writeFile(join(fixture.profile, 'SingletonCookie'), 'ordinary-file');
  await assert.rejects(recoverStaleProfileSingletons(fixture.profile, fixture.options), {
    code: 'browser_unavailable',
  });
  await fixture.assertIntact(['SingletonLock', 'SingletonSocket']);
  assert.equal(await readFile(join(fixture.profile, 'SingletonCookie'), 'utf8'), 'ordinary-file');
  const linked = await singletonFixture(t);
  await linked.install();
  const alias = join(linked.root, 'profile-alias');
  await symlink(linked.profile, alias);
  await assert.rejects(recoverStaleProfileSingletons(alias, linked.options), {
    code: 'browser_unavailable',
  });
  await linked.assertIntact();
});

test('missing, lost or asynchronous application lease refuses recovery before mutation', async (t) => {
  const fixture = await singletonFixture(t);
  await fixture.install();
  await assert.rejects(
    recoverStaleProfileSingletons(fixture.profile, {
      procRoot: fixture.procRoot,
    } as ProfileLockRecoveryOptions),
    { code: 'browser_unavailable' },
  );
  await fixture.assertIntact();
  let checks = 0;
  await assert.rejects(
    recoverStaleProfileSingletons(fixture.profile, {
      ...fixture.options,
      assertProfileRecoveryLease: () => {
        if (++checks > 1) throw new Error('lease lost');
      },
    }),
    { code: 'browser_unavailable' },
  );
  await fixture.assertIntact();
  await assert.rejects(
    recoverStaleProfileSingletons(fixture.profile, {
      ...fixture.options,
      assertProfileRecoveryLease: async () => undefined,
    }),
    { code: 'browser_unavailable' },
  );
  await fixture.assertIntact();
});
