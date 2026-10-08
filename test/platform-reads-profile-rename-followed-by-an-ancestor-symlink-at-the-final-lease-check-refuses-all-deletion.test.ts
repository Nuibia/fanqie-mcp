import test from 'node:test';

import {
  singletonFixture,
  QR_FIXTURE,
  blankPng,
  deferred,
  fakeBrowser,
} from './helpers/platform-reads-metrics-page.js';

import { mkdir, writeFile, lstat, readlink, readFile } from 'node:fs/promises';

import { join } from 'node:path';

import assert from 'node:assert/strict';

import {
  recoverStaleProfileSingletons,
  verifyQrPng,
  parseLoginQrExpiry,
  CANONICAL_OWN_USER_URL,
} from '../src/platform/browser.js';

import { renameSync, symlinkSync } from 'node:fs';

import { fakeQrBrowser } from './helpers/platform-reads-fake-qr-browser.js';

import { type Page } from 'playwright';

import { runInNewContext } from 'node:vm';

test('profile rename followed by an ancestor symlink at the final lease check refuses all deletion', async (t) => {
  for (const attackAtLeaseCheck of [2, 3]) {
    const fixture = await singletonFixture(t);
    await fixture.install();
    await mkdir(join(fixture.profile, 'Default', 'Local Storage'), { recursive: true });
    await writeFile(join(fixture.profile, 'Default', 'Cookies'), 'FIXTURE_AUTH_BYTES');
    await writeFile(
      join(fixture.profile, 'Default', 'Local Storage', 'fixture.txt'),
      'FIXTURE_STORY_BODY',
    );
    const moved = join(fixture.root, 'moved-profile');
    let checks = 0;
    await assert.rejects(
      recoverStaleProfileSingletons(fixture.profile, {
        ...fixture.options,
        assertProfileRecoveryLease: () => {
          if (++checks === attackAtLeaseCheck) {
            renameSync(fixture.profile, moved);
            symlinkSync(moved, fixture.profile);
          }
        },
      }),
      { code: 'browser_unavailable' },
    );
    assert.equal((await lstat(fixture.profile)).isSymbolicLink(), true);
    for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie'] as const)
      assert.equal(await readlink(join(moved, name)), fixture.targets[name]);
    assert.equal(await readFile(join(moved, 'Default', 'Cookies'), 'utf8'), 'FIXTURE_AUTH_BYTES');
    assert.equal(
      await readFile(join(moved, 'Default', 'Local Storage', 'fixture.txt'), 'utf8'),
      'FIXTURE_STORY_BODY',
    );
  }
});

test('QR pixels must actually decode; a blank CAPTCHA-like crop or malformed PNG is refused', () => {
  assert.equal(verifyQrPng(QR_FIXTURE), true);
  assert.equal(verifyQrPng(blankPng()), false);
  assert.equal(verifyQrPng(Buffer.from('PRIVATE_NOT_A_PNG')), false);
});

test('QR lifetime comes only from explicit platform text; absent text stays unknown', () => {
  assert.deepEqual(parseLoginQrExpiry(null), { status: 'unknown' });
  assert.deepEqual(parseLoginQrExpiry('扫码登录'), { status: 'unknown' });
  assert.deepEqual(parseLoginQrExpiry('二维码将在60秒后失效'), {
    status: 'known',
    raw: '二维码将在60秒后失效',
    remainingSeconds: 60,
  });
  assert.deepEqual(parseLoginQrExpiry('有效期：3分钟'), {
    status: 'known',
    raw: '有效期：3分钟',
    validitySeconds: 180,
  });
  assert.deepEqual(parseLoginQrExpiry('剩余0秒'), { status: 'unknown' });
});

test('QR capture selects only the scan tab, returns verified element PNG and polling never reloads it', async () => {
  const { session, counters, authenticate } = fakeQrBrowser();
  const result = await session.getLoginQrcode();
  assert.equal(result.status, 'ready');
  assert.equal(result.qrVerified, true);
  assert.deepEqual(result.image, QR_FIXTURE);
  assert.equal(result.appInstructions, '番茄作家助手扫码登录');
  assert.deepEqual(result.expiry, { status: 'unknown' });
  const metadata = { ...result, image: undefined };
  for (const secret of ['PRIVATE_QUERY', 'PRIVATE_FRAGMENT', 'fanqie-fixture'])
    assert.equal(JSON.stringify(metadata).includes(secret), false);
  assert.equal(result.login.sourceUrl, 'https://fanqienovel.com/main/writer/login');
  await session.inspectCurrentLogin();
  await session.checkLogin();
  await session.startLogin();
  assert.equal(counters.goto, 1);
  assert.equal(counters.tabClicks, 1);
  assert.equal(counters.fullPageScreenshots, 0);
  await session.getLoginQrcode();
  assert.equal(counters.goto, 2);
  assert.equal(counters.tabClicks, 2);
  authenticate();
  assert.equal((await session.inspectCurrentLogin()).status, 'authenticated');
});

test('already authenticated QR requests avoid navigation and return no image or nonce fragment', async () => {
  const { session, counters } = fakeQrBrowser({ authenticated: true });
  const result = await session.getLoginQrcode();
  assert.equal(result.status, 'authenticated');
  assert.equal(result.image, undefined);
  assert.equal(counters.goto, 0);
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
});

test('challenge, expired, missing scan tab and non-QR images return explicit failure without whole-page images', async () => {
  for (const [options, status] of [
    [{ challenge: true }, 'challenge'],
    [{ expired: true }, 'expired'],
    [{ tabMissing: true }, 'unsupported'],
    [{ image: blankPng() }, 'unsupported'],
  ] as const) {
    const { session, counters } = fakeQrBrowser(options);
    const result = await session.getLoginQrcode();
    assert.equal(result.status, status);
    assert.equal(result.image, undefined);
    assert.equal(counters.fullPageScreenshots, 0);
    assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
    if (options.challenge) assert.equal(counters.tabClicks, 0);
  }
});

test('QR navigation or capture failure uses fixed errors instead of retaining nonce or image source', async () => {
  for (const failure of [
    { gotoError: new Error('https://passport.example/PRIVATE_NONCE') },
    { screenshotError: new Error('data:image/png;PRIVATE_NONCE') },
  ]) {
    const { session } = fakeQrBrowser(failure);
    await assert.rejects(session.getLoginQrcode(), (error: unknown) =>
      Boolean(
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'login_qr_unavailable' &&
        'message' in error &&
        !String(error.message).includes('PRIVATE_NONCE'),
      ),
    );
  }
});

test('cancel during QR capture closes its page and invalidates the active scan before FIFO restoration', async () => {
  const { session, pages } = fakeQrBrowser();
  const page = pages[0]!;
  const entered = deferred();
  const closed = deferred();
  const controller = new AbortController();
  page.onClose = () => closed.resolve();
  const original = page.locator;
  page.locator = ((selector: string) => {
    const target = original(selector);
    if (!selector.includes('code__img')) return target;
    return {
      ...target,
      first() {
        return this;
      },
      async screenshot() {
        entered.resolve();
        await closed.promise;
        throw new Error('PRIVATE_NONCE');
      },
    };
  }) as unknown as Page['locator'];
  const capture = session.getLoginQrcode({ signal: controller.signal });
  const rejected = assert.rejects(capture, { code: 'cancelled' });
  await entered.promise;
  controller.abort();
  await rejected;
  assert.equal(page.isClosed(), true);
  assert.equal((session as unknown as { qrLoginPage: Page | null }).qrLoginPage, null);
  const restored = await session.withPage(async (current) => current);
  assert.notEqual(restored, page);
  assert.equal(restored.isClosed(), false);
});

test('actual QR UI callback serializes static instructions and countdown only, excluding challenge payloads', async () => {
  const { session, pages } = fakeBrowser();
  const page = pages[0]!;
  const element = (text: string) => ({
    innerText: text,
    textContent: text,
    childElementCount: 0,
    getBoundingClientRect: () => ({ width: 200, height: 200 }),
  });
  const instruction = element('番茄作家助手扫码登录');
  const nonce = element('PRIVATE_QR_NONCE');
  const countdown = element('二维码将在45秒后失效');
  const qr = {
    ...element('番茄作家助手扫码登录\n二维码将在45秒后失效\nPRIVATE_QR_NONCE'),
    querySelectorAll: () => [instruction, nonce, countdown],
  };
  page.evaluate = (async (callback: unknown) => {
    const source = String(callback);
    const production = new URL('./platform-reads.test.ts', import.meta.url).href.endsWith('.js');
    if (production) assert.equal(source.includes('__name'), false);
    return runInNewContext(`(${source})()`, {
      document: {
        querySelector: () => qr,
        querySelectorAll: () => [element('请完成安全验证 PRIVATE_CHALLENGE_PAYLOAD')],
      },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
      ...(production ? {} : { __name: (value: unknown) => value }),
    });
  }) as Page['evaluate'];
  const result = await (
    session as unknown as { readLoginQrUi(current: Page): Promise<unknown> }
  ).readLoginQrUi(page);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    challenge: true,
    expired: false,
    appInstructions: '番茄作家助手扫码登录',
    expiryText: '二维码将在45秒后失效',
  });
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
});

test('scan completion at the official writer root permits management verification without treating the redirect as authentication', async () => {
  const { session, pages, counters } = fakeQrBrowser();
  await session.getLoginQrcode();
  const page = pages[0]!;
  page.url = () => 'https://fanqienovel.com/main/writer/';
  page.evaluate = (async (callback: unknown, arg: unknown) => {
    if (arg === CANONICAL_OWN_USER_URL)
      return {
        status: 200,
        ok: true,
        json: { code: 0, data: { id: '1001', name: 'FIXTURE_NAME' } },
      };
    if (String(callback).includes('location.origin')) {
      const source = String(callback);
      const production = new URL('./platform-reads.test.ts', import.meta.url).href.endsWith('.js');
      if (production) assert.equal(source.includes('__name'), false);
      return runInNewContext(`(${source})()`, {
        location: { origin: 'https://fanqienovel.com', pathname: '/main/writer/' },
        document: { querySelectorAll: () => [] },
        ...(production ? {} : { __name: (value: unknown) => value }),
      });
    }
    return {
      loginRequired: false,
      managementVisible: counters.goto > 1,
      ownAccount: counters.goto > 1 ? { user_id: '1001', author_id: '2001' } : null,
    };
  }) as Page['evaluate'];
  const result = await session.checkLogin();
  assert.equal(counters.goto, 2);
  assert.equal(result.status, 'authenticated');
  assert.equal(result.identity?.accountId, '1001');
});

test('login-required or visible scan controls keep even a writer-root page intact', async () => {
  const required = fakeQrBrowser();
  await required.session.getLoginQrcode();
  required.pages[0]!.url = () => 'https://fanqienovel.com/main/writer/';
  assert.equal((await required.session.checkLogin()).status, 'login_required');
  assert.equal(required.counters.goto, 1);
  const visibleQr = fakeQrBrowser();
  await visibleQr.session.getLoginQrcode();
  visibleQr.pages[0]!.url = () => 'https://fanqienovel.com/main/writer/';
  visibleQr.pages[0]!.evaluate = (async (callback: unknown) =>
    String(callback).includes('location.origin')
      ? false
      : { loginRequired: false, managementVisible: false, ownAccount: null }) as Page['evaluate'];
  assert.equal((await visibleQr.session.checkLogin()).status, 'unknown');
  assert.equal(visibleQr.counters.goto, 1);
});
