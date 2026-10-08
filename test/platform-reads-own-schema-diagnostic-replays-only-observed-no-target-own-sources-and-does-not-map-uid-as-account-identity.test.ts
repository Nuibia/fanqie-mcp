import test from 'node:test';

import { identityEvents } from './helpers/platform-reads-fake-qr-browser.js';

import { type Page } from 'playwright';

import assert from 'node:assert/strict';

import { deferred } from './helpers/platform-reads-metrics-page.js';

import {
  type OwnResponseStructure,
  parseOwnResponseIdentity,
  parseOwnIdentity,
  CANONICAL_OWN_USER_URL,
} from '../src/platform/browser.js';

test('own-schema diagnostic replays only observed no-target own sources and does not map uid as account identity', async () => {
  const fixture = identityEvents();
  const source = 'https://fanqienovel.com/api/author/account/info/v0/?nonce=PRIVATE_NONCE';
  const own = { ...fixture.request(), url: () => source };
  fixture.events.get('request')!(own);
  fixture.events.get('response')!(
    fixture.response(own, async () => ({ code: 0, data: { uid: 'PRIVATE_UID' } })),
  );
  await Promise.resolve();
  await Promise.resolve();
  let forbiddenReads = 0;
  for (const raw of [
    'https://fanqienovel.com/api/author/account/info/v0/?target_id=12345',
    'https://fanqienovel.com/api/user/info/v2?user_id=12345',
    'https://fanqienovel.com/api/author/sa_stats/book_list/v0/',
  ]) {
    const request = { ...fixture.request(), url: () => raw };
    fixture.events.get('request')!(request);
    fixture.events.get('response')!(
      fixture.response(request, async () => {
        if (raw.includes('/sa_stats/')) return { code: 0, data: { stats_book_list: [] } };
        forbiddenReads += 1;
        throw new Error('Forbidden own response body');
      }),
    );
  }
  const replayed: string[] = [];
  fixture.pages[0]!.evaluate = (async (_callback: unknown, arg: unknown) => {
    if (typeof arg === 'string') {
      replayed.push(arg);
      return {
        status: 200,
        json: { code: 0, data: { uid: 'PRIVATE_UID', nickname: 'PRIVATE_NICK' } },
      };
    }
    if (arg && typeof arg === 'object')
      return { controls: [], routerStructure: [], truncated: { controls: false, router: false } };
    return fixture.neutral;
  }) as Page['evaluate'];
  const result = await fixture.session.diagnoseCurrentLoginPage();
  assert.equal(result.status, 'unknown');
  assert.equal(fixture.sessionInternal.identity, null);
  assert.deepEqual(replayed, [source]);
  assert.equal(forbiddenReads, 0);
  assert.deepEqual(result.ownResponseStructure, [
    {
      pathTemplate: '/api/author/account/info/v0/',
      status: 200,
      fields: [
        { path: 'code', type: 'number' },
        { path: 'data', type: 'object' },
        { path: 'data.uid', type: 'string' },
        { path: 'data.nickname', type: 'string' },
      ],
      truncated: false,
    },
  ]);
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
});

test('fresh own-schema response across navigation is refused and cannot populate the next document cache', async () => {
  const fixture = identityEvents();
  const pending = deferred<unknown>();
  const started = deferred();
  const request = { ...fixture.request(), url: () => 'https://fanqienovel.com/api/user/info/v2' };
  fixture.events.get('request')!(request);
  fixture.events.get('response')!(
    fixture.response(request, async () => ({ code: 0, data: { uid: 'PRIVATE_UID' } })),
  );
  await Promise.resolve();
  await Promise.resolve();
  fixture.pages[0]!.evaluate = (async (_callback: unknown, arg: unknown) => {
    if (typeof arg === 'string') {
      started.resolve();
      return pending.promise;
    }
    return fixture.neutral;
  }) as Page['evaluate'];
  const diagnosis = fixture.session.diagnoseCurrentLoginPage();
  const rejected = assert.rejects(diagnosis, { code: 'login_diagnostic_stale' });
  await started.promise;
  fixture.events.get('framenavigated')!(null);
  pending.resolve({ status: 200, json: { code: 0, data: { uid: 'PRIVATE_UID' } } });
  await rejected;
  assert.equal(
    (
      fixture.session as unknown as {
        pageOwnStructures: WeakMap<Page, Map<string, OwnResponseStructure>>;
      }
    ).pageOwnStructures.get(fixture.pages[0]!)?.size,
    0,
  );
});

test('confirmed own-user v2 maps its string data.id only; generic identity parsing remains explicit', () => {
  const body = {
    code: 0,
    data: { id: '7680000000000000001', name: 'FIXTURE_NAME', avatar: 'PRIVATE_AVATAR' },
  };
  const own = parseOwnResponseIdentity(
    body,
    'https://fanqienovel.com/api/user/info/v2?nonce=PRIVATE_NONCE#PRIVATE_FRAGMENT',
  );
  assert.deepEqual(own, {
    accountId: '7680000000000000001',
    authorId: null,
    displayName: 'FIXTURE_NAME',
    evidenceSource: 'https://fanqienovel.com/api/user/info/v2',
  });
  assert.equal(
    parseOwnIdentity({ id: '7680000000000000001', name: 'FIXTURE_NAME' }, 'fixture'),
    null,
  );
  for (const source of [
    'https://fanqienovel.com/api/author/account/info/v0/',
    'https://fanqienovel.com/api/author/info/v1/',
    'https://fanqienovel.com/api/author/sa_stats/book_list/v0/',
    'https://fanqienovel.com/api/book/info/v2',
    'https://evil.example/api/user/info/v2',
    'https://user:password@fanqienovel.com/api/user/info/v2',
    'https://fanqienovel.com/api/user/info/v2?user_id=7680000000000000001',
    'https://fanqienovel.com/api/user/info/v2?target_id=7680000000000000001',
    'https://fanqienovel.com/api/user/info/v2?uid=7680000000000000001',
    'https://fanqienovel.com/api/user/info/v2?id=7680000000000000001',
  ])
    assert.equal(parseOwnResponseIdentity(body, source)?.accountId ?? null, null);
  for (const id of [7680000000000000001, 'bad-id', '1.5', '1'.repeat(31), null])
    assert.equal(
      parseOwnResponseIdentity(
        { code: 0, data: { id, name: 'FIXTURE_NAME' } },
        'https://fanqienovel.com/api/user/info/v2',
      )?.accountId ?? null,
      null,
    );
  assert.equal(
    parseOwnResponseIdentity(
      { code: 1, data: body.data },
      'https://fanqienovel.com/api/user/info/v2',
    ),
    null,
  );
  assert.equal(
    parseOwnResponseIdentity({ data: body.data }, 'https://fanqienovel.com/api/user/info/v2'),
    null,
  );
});

test('observer and fresh current-account verification use the same observed own-user v2 schema', async () => {
  const fixture = identityEvents();
  const request = {
    ...fixture.request(),
    url: () => 'https://fanqienovel.com/api/user/info/v2?nonce=PRIVATE_NONCE',
  };
  const body = { code: 0, data: { id: '7680000000000000001', name: 'FIXTURE_NAME' } };
  fixture.events.get('request')!(request);
  fixture.events.get('response')!(fixture.response(request, async () => body));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    (await fixture.session.inspectCurrentLogin()).identity?.accountId,
    '7680000000000000001',
  );
  const replayed: string[] = [];
  fixture.pages[0]!.evaluate = (async (_callback: unknown, arg: unknown) => {
    if (typeof arg === 'string') {
      replayed.push(arg);
      return { status: 200, ok: true, json: body };
    }
    return fixture.neutral;
  }) as Page['evaluate'];
  const fresh = await fixture.session.verifyCurrentAccount(fixture.pages[0]!);
  assert.equal(fresh.status, 'authenticated');
  assert.equal(fresh.identity?.accountId, '7680000000000000001');
  assert.equal(fresh.identity?.authorId, null);
  assert.equal(fresh.identity?.evidenceSource, 'https://fanqienovel.com/api/user/info/v2');
  assert.deepEqual(replayed, [CANONICAL_OWN_USER_URL]);
});

test('name-only user v2 and author account records never authenticate an account', async () => {
  for (const [source, data] of [
    ['https://fanqienovel.com/api/user/info/v2', { name: 'FIXTURE_NAME' }],
    [
      'https://fanqienovel.com/api/author/account/info/v0/',
      { id: '7680000000000000001', author_name: 'FIXTURE_AUTHOR_NAME' },
    ],
  ] as const) {
    const fixture = identityEvents();
    const request = { ...fixture.request(), url: () => source };
    fixture.events.get('request')!(request);
    fixture.events.get('response')!(fixture.response(request, async () => ({ code: 0, data })));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal((await fixture.session.inspectCurrentLogin()).status, 'unknown');
    fixture.pages[0]!.evaluate = (async (_callback: unknown, arg: unknown) =>
      typeof arg === 'string'
        ? {
            status: 200,
            ok: true,
            json: {
              code: 0,
              data:
                arg === CANONICAL_OWN_USER_URL && source !== CANONICAL_OWN_USER_URL
                  ? { name: 'FIXTURE_NAME' }
                  : data,
            },
          }
        : fixture.neutral) as Page['evaluate'];
    const fresh = await fixture.session.verifyCurrentAccount(fixture.pages[0]!);
    assert.equal(fresh.status, 'unknown');
    assert.equal(fresh.identity, null);
  }
});

test('same-document name-only API and DOM records cannot erase a verified stable identity; navigation still clears it', async () => {
  const fixture = identityEvents();
  const own = { ...fixture.request(), url: () => 'https://fanqienovel.com/api/user/info/v2' };
  fixture.events.get('request')!(own);
  fixture.events.get('response')!(
    fixture.response(own, async () => ({ code: 0, data: { id: '1001', name: 'FIXTURE_OWNER' } })),
  );
  await Promise.resolve();
  await Promise.resolve();
  const named = {
    ...fixture.request(),
    url: () => 'https://fanqienovel.com/api/author/account/info/v0/',
  };
  fixture.events.get('request')!(named);
  fixture.events.get('response')!(
    fixture.response(named, async () => ({ code: 0, data: { author_name: 'FIXTURE_OWNER' } })),
  );
  await Promise.resolve();
  await Promise.resolve();
  fixture.pages[0]!.evaluate = (async () => ({
    ...fixture.neutral,
    ownAccount: { nickname: 'FIXTURE_OWNER' },
  })) as Page['evaluate'];
  assert.equal((await fixture.session.inspectCurrentLogin()).identity?.accountId, '1001');
  assert.equal((fixture.sessionInternal.identity as { accountId: string }).accountId, '1001');
  fixture.events.get('framenavigated')!(null);
  assert.equal((await fixture.session.inspectCurrentLogin()).status, 'unknown');
  assert.equal(
    (fixture.sessionInternal.identity as { accountId?: string } | null)?.accountId ?? null,
    null,
  );
});

test('current-login diagnostic reports the stable own ID verified by its fresh GET while exposing only booleans/schema', async () => {
  const fixture = identityEvents();
  const source = 'https://fanqienovel.com/api/user/info/v2?nonce=PRIVATE_NONCE';
  fixture.internal.ownInfoUrls.set(fixture.pages[0]!, new Set([source]));
  fixture.pages[0]!.evaluate = (async (_callback: unknown, arg: unknown) => {
    if (typeof arg === 'string')
      return { status: 200, json: { code: 0, data: { id: '1001', name: 'PRIVATE_OWNER' } } };
    if (arg && typeof arg === 'object')
      return { controls: [], routerStructure: [], truncated: { controls: false, router: false } };
    return fixture.neutral;
  }) as Page['evaluate'];
  const result = await fixture.session.diagnoseCurrentLoginPage();
  assert.equal(result.status, 'authenticated');
  assert.equal(result.identityObserved.accountId, true);
  assert.equal(result.identityObserved.authorId, false);
  for (const secret of ['1001', 'PRIVATE_OWNER', 'PRIVATE_NONCE'])
    assert.equal(JSON.stringify(result).includes(secret), false);
});
