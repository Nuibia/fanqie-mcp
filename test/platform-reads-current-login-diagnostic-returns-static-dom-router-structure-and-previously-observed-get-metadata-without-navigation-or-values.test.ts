import test from 'node:test';

import { fakeBrowser, deferred } from './helpers/platform-reads-metrics-page.js';

import { type Page } from 'playwright';

import assert from 'node:assert/strict';

import { runInNewContext } from 'node:vm';

import { identityEvents } from './helpers/platform-reads-fake-qr-browser.js';

import { projectOwnResponseFields } from '../src/platform/browser.js';

test('current-login diagnostic returns static DOM/router structure and previously observed GET metadata without navigation or values', async () => {
  const { session, pages } = fakeBrowser();
  const page = pages[0]!;
  const listeners = new Map<string, (...args: unknown[]) => void>();
  page.on = ((event: string, listener: (...args: unknown[]) => void) => {
    listeners.set(event, listener);
    return page;
  }) as typeof page.on;
  (session as unknown as { observeIdentity(current: Page): void }).observeIdentity(page);
  let bodiesRead = 0;
  const response = (method: string, raw: string, resourceType = 'xhr') => {
    const request = { url: () => raw, method: () => method, resourceType: () => resourceType };
    return {
      url: () => raw,
      status: () => 200,
      ok: () => true,
      request: () => request,
      json: async () => {
        bodiesRead += 1;
        throw new Error('Unknown response bodies must not be read');
      },
    };
  };
  const emit = (item: ReturnType<typeof response>) => {
    listeners.get('request')!(item.request());
    listeners.get('response')!(item);
  };
  emit(
    response(
      'GET',
      'https://fanqienovel.com/api/author/user/info/v1/?nonce=PRIVATE_NONCE#PRIVATE_FRAGMENT',
    ),
  );
  emit(response('GET', 'https://fanqienovel.com/api/author/books/1001/?token=PRIVATE_TOKEN'));
  emit(response('POST', 'https://fanqienovel.com/api/author/update/v1/'));
  emit(response('GET', 'https://external.example/api/author/info/v1/'));
  page.goto = (async () => {
    throw new Error('Diagnostic must never navigate');
  }) as Page['goto'];
  page.url = () => 'https://fanqienovel.com/main/writer/?nonce=PRIVATE_NONCE#PRIVATE_FRAGMENT';
  const element = (
    tagName: string,
    textContent: string,
    attributes: Record<string, string> = {},
  ) => ({
    tagName,
    textContent,
    value: 'PRIVATE_INPUT_VALUE',
    getAttribute: (key: string) => attributes[key] ?? null,
    getBoundingClientRect: () => ({ width: 100, height: 40 }),
  });
  const controls = [
    element('BUTTON', '知道了', { class: 'arco-btn', id: 'PRIVATE_TOKEN' }),
    element('INPUT', '', { class: 'arco-input', type: 'text', 'aria-label': 'PRIVATE_NICK' }),
    element('BUTTON', 'PRIVATE_NICK'),
  ];
  page.evaluate = (async (callback: unknown, arg: unknown) => {
    const source = String(callback);
    const production = new URL('./platform-reads.test.ts', import.meta.url).href.endsWith('.js');
    if (production) assert.equal(source.includes('__name'), false);
    return runInNewContext(`(${source})(arg)`, {
      arg,
      document: {
        body: { innerText: '作品管理 PRIVATE_STORY_BODY' },
        querySelector: () => null,
        querySelectorAll: () => controls,
      },
      window: {
        _ROUTER_DATA: {
          loaderData: {
            PRIVATE_ROUTE_NICKNAME: {
              userInfo: {
                user_id: '1001',
                author_id: '2001',
                nickname: 'PRIVATE_NICK',
                token: 'PRIVATE_TOKEN',
                email: 'PRIVATE_EMAIL',
                PRIVATE_TITLE_KEY: 'PRIVATE_STORY_BODY',
                12345: 'PRIVATE_DYNAMIC_KEY',
              },
            },
          },
        },
      },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
      location: { pathname: '/main/writer/' },
      ...(production ? {} : { __name: (value: unknown) => value }),
    });
  }) as Page['evaluate'];
  const result = await session.diagnoseCurrentLoginPage();
  assert.equal(result.status, 'authenticated');
  assert.equal(result.identityObserved.authorId, true);
  assert.equal(result.sourceUrl, 'https://fanqienovel.com/main/writer/');
  assert.deepEqual(result.getResponses, [
    { pathTemplate: '/api/author/user/info/v1/', status: 200, resourceType: 'xhr' },
    { pathTemplate: '/api/author/books/{id}/', status: 200, resourceType: 'xhr' },
  ]);
  assert.equal(result.controls[0]?.label, '知道了');
  assert.equal(result.controls[0]?.attributes.id, undefined);
  assert.ok(
    result.routerStructure.some(
      (entry) =>
        entry.pathTemplate === '_ROUTER_DATA.loaderData.{route}.userInfo' &&
        entry.fields.includes('user_id'),
    ),
  );
  assert.equal(bodiesRead, 0);
  for (const secret of ['PRIVATE_', '1001', '2001', '12345'])
    assert.equal(JSON.stringify(result).includes(secret), false);
  listeners.get('framenavigated')!(null);
  assert.equal((await session.diagnoseCurrentLoginPage()).getResponses.length, 0);
});

test('an own-account JSON finishing after ordinary navigation cannot restore the previous account', async () => {
  const fixture = identityEvents();
  const pending = deferred<unknown>();
  const request = fixture.request();
  fixture.events.get('request')!(request);
  fixture.events.get('response')!(fixture.response(request, () => pending.promise));
  await fixture.session.withPage(async (page) => {
    await page.goto('https://fanqienovel.com/main/writer/short-data');
  });
  pending.resolve({ code: 0, data: { author_id: '1111', user_id: '2222' } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fixture.sessionInternal.identity, null);
  assert.equal((await fixture.session.inspectCurrentLogin()).status, 'unknown');
});

test('an old request whose response arrives after checkLogin cannot adopt the new document generation', async () => {
  const fixture = identityEvents();
  const request = fixture.request();
  let bodiesRead = 0;
  fixture.events.get('request')!(request);
  assert.equal((await fixture.session.checkLogin()).status, 'unknown');
  fixture.events.get('response')!(
    fixture.response(request, async () => {
      bodiesRead += 1;
      return { code: 0, data: { author_id: '1111' } };
    }),
  );
  await Promise.resolve();
  assert.equal(bodiesRead, 0);
  assert.equal(fixture.sessionInternal.identity, null);
});

test('navigation clears previously accepted account cache and old-page JSON cannot affect a replacement page', async () => {
  const fixture = identityEvents();
  const first = fixture.request();
  fixture.events.get('request')!(first);
  fixture.events.get('response')!(
    fixture.response(first, async () => ({ code: 0, data: { author_id: '1111' } })),
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(fixture.sessionInternal.identity);
  fixture.events.get('framenavigated')!(null);
  assert.equal(fixture.sessionInternal.identity, null);
  const pending = deferred<unknown>();
  const second = fixture.request();
  fixture.events.get('request')!(second);
  fixture.events.get('response')!(fixture.response(second, () => pending.promise));
  await fixture.pages[0]!.close();
  const replacement = await fixture.session.withPage(async (page) => page);
  pending.resolve({ code: 0, data: { author_id: '1111' } });
  await Promise.resolve();
  await Promise.resolve();
  assert.notEqual(replacement, fixture.pages[0]);
  assert.equal(fixture.sessionInternal.identity, null);
});

test('a fresh own-account GET finishing across navigation fails closed without returning or caching its old account', async () => {
  const fixture = identityEvents();
  const pending = deferred<{ status: number; ok: boolean; json: unknown }>();
  const started = deferred();
  fixture.internal.ownInfoUrls.set(
    fixture.pages[0]!,
    new Set(['https://fanqienovel.com/api/author/info/v1/']),
  );
  let evaluation = 0;
  fixture.pages[0]!.evaluate = (async () => {
    if (++evaluation === 1)
      return { loginRequired: false, managementVisible: true, ownAccount: { author_id: '1111' } };
    started.resolve();
    return pending.promise;
  }) as Page['evaluate'];
  const verified = fixture.session.verifyCurrentAccount(fixture.pages[0]!);
  await started.promise;
  fixture.events.get('framenavigated')!(null);
  pending.resolve({ status: 200, ok: true, json: { code: 0, data: { author_id: '1111' } } });
  const result = await verified;
  assert.equal(result.status, 'unknown');
  assert.equal(result.identity, null);
  assert.equal(fixture.sessionInternal.identity, null);
});

test('external router identities, nickname-only and bare management UI do not establish authenticated identity', async () => {
  const external = fakeBrowser();
  external.pages[0]!.url = () => 'https://evil.example/main/writer/';
  external.pages[0]!.evaluate = (async () => {
    throw new Error('External DOM must not be read as identity');
  }) as Page['evaluate'];
  assert.equal((await external.session.inspectCurrentLogin()).status, 'unknown');
  const nickname = fakeBrowser();
  nickname.pages[0]!.evaluations.push({
    loginRequired: false,
    managementVisible: false,
    ownAccount: { nickname: 'PRIVATE_NAME' },
  });
  const named = await nickname.session.inspectCurrentLogin();
  assert.equal(named.status, 'unknown');
  assert.equal(named.identity, null);
  const bare = fakeBrowser();
  bare.pages[0]!.evaluations.push({
    loginRequired: false,
    managementVisible: true,
    ownAccount: null,
  });
  assert.equal((await bare.session.inspectCurrentLogin()).status, 'unknown');
});

test('DOM inspection finishing after navigation never returns or caches the old router identity', async () => {
  const fixture = identityEvents();
  const pending = deferred<unknown>();
  const started = deferred();
  fixture.pages[0]!.evaluate = (async () => {
    started.resolve();
    return pending.promise;
  }) as Page['evaluate'];
  const inspected = fixture.session.inspectCurrentLogin();
  await started.promise;
  fixture.events.get('framenavigated')!(null);
  pending.resolve({
    loginRequired: false,
    managementVisible: true,
    ownAccount: { author_id: '1111' },
  });
  const result = await inspected;
  assert.equal(result.status, 'unknown');
  assert.equal(result.identity, null);
  assert.equal(fixture.sessionInternal.identity, null);
  fixture.pages[0]!.evaluate = (async () => fixture.neutral) as Page['evaluate'];
  assert.equal((await fixture.session.inspectCurrentLogin()).status, 'unknown');
});

test('own response schema uses fixed field names/types without values, dynamic keys, prose or array items', () => {
  const item = Object.defineProperty({}, 'author_id', {
    enumerable: true,
    get() {
      throw new Error('Array item must not be read');
    },
  });
  const data = Object.defineProperty(
    {
      uid: 'PRIVATE_UID',
      user_info: { nickname: 'PRIVATE_NICK', uid: 'PRIVATE_UID' },
      profile: { PRIVATE_DYNAMIC_NICKNAME: 'PRIVATE_VALUE' },
      roles: [item],
      content: 'PRIVATE_BODY',
      body: 'PRIVATE_BODY',
      title: 'PRIVATE_TITLE',
      12345: 'PRIVATE_DYNAMIC_ID',
    },
    'PRIVATE_SECRET_KEY',
    {
      enumerable: true,
      get() {
        throw new Error('Unknown field value must not be read');
      },
    },
  );
  const result = projectOwnResponseFields({ code: 0, data });
  assert.deepEqual(result.fields, [
    { path: 'code', type: 'number' },
    { path: 'data', type: 'object' },
    { path: 'data.uid', type: 'string' },
    { path: 'data.user_info', type: 'object' },
    { path: 'data.user_info.nickname', type: 'string' },
    { path: 'data.user_info.uid', type: 'string' },
    { path: 'data.profile', type: 'object' },
    { path: 'data.roles', type: 'array' },
  ]);
  assert.equal(result.truncated, false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
  assert.equal(JSON.stringify(result).includes('12345'), false);
});
