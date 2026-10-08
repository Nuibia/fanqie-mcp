import test from 'node:test';

import {
  fixture,
  OWN,
  WORK,
  ACCOUNT,
  edit,
  failed,
  turn,
} from './helpers/short-native-metadata-api-deferred.js';

import assert from 'node:assert/strict';

import { shortMetadataApiListUrl } from '../src/platform/short-metadata-api-schema.js';

import {
  nativeShortMetadataEndpoints,
  NATIVE_SHORT_HASH_BASES,
  NATIVE_SHORT_RESOURCE_LIMITS,
} from '../src/platform/short-native-metadata.js';

test('native owned GET returns full private domain snapshot only after exact sequential reads and clean drain', async () => {
  const f = fixture(),
    result = await f.run.run();
  assert.equal(result.status, 'success');
  assert.equal(result.reason, null);
  assert(result.snapshot);
  assert.deepEqual(
    f.calls.map((call) => call.url),
    [
      OWN,
      shortMetadataApiListUrl(0),
      nativeShortMetadataEndpoints(WORK).edit,
      nativeShortMetadataEndpoints(WORK).catalog,
      OWN,
    ],
  );
  for (const call of f.calls) {
    assert.equal(call.options.maxRedirects, 0);
    assert.equal(call.options.maxRetries, 0);
    assert((call.options.timeout as number) > 0);
    assert.deepEqual(Object.keys(call.options).sort(), [
      'failOnStatusCode',
      'maxRedirects',
      'maxRetries',
      'timeout',
    ]);
  }
  assert.equal(result.snapshot.binding.account.id, ACCOUNT);
  assert.deepEqual(JSON.parse(JSON.stringify(result.snapshot.editData)), edit());
  assert.equal(result.snapshot.savedFields.content, edit().content);
  assert.deepEqual(result.snapshot.savedFields.multi_title, edit().multi_title);
  assert.equal(result.snapshot.savedFields.thumb_uri, edit().thumb_uri);
  assert.equal(result.snapshot.savedFields.book_thumb_uri, edit().book_thumb_uri);
  assert.equal(
    result.snapshot.hashBases.categorySelection,
    NATIVE_SHORT_HASH_BASES.categorySelection,
  );
  assert.match(result.snapshot.categorySelectionHash, /^[a-f0-9]{64}$/);
  assert.equal(result.snapshot.responseBinding, 'sentinel');
  assert.equal(result.proof.atomicRevision, false);
  assert.equal(f.apiCloses, 1);
  assert.equal(f.borrowedCloses, 0);
  assert.equal(f.pageTouches, 0);
  assert.deepEqual(result.requests, {
    own: { attempts: 2, disposed: 2 },
    list: { attempts: 1, disposed: 1 },
    edit: { attempts: 1, disposed: 1 },
    catalog: { attempts: 1, disposed: 1 },
  });
  assert.equal(result.cleanup.sessionDisposed, true);
  assert.equal(result.cleanup.pendingAtEnd, 0);
  assert.equal(f.callbacks, 1);
  assert.equal(f.quarantines, 0);
  assert(Object.isFrozen(result));
  assert(Object.isFrozen(result.snapshot.editData.unknown));
  const state = f.contextOptions as { storageState: { cookies: unknown[]; origins: unknown[] } };
  assert.equal(state.storageState.cookies.length, 1);
  assert.deepEqual(state.storageState.origins, []);
  assert.deepEqual(Object.keys(state), ['storageState']);
  assert(f.events.indexOf('read_boundary') < f.events.indexOf('get'));
  assert(Date.parse(result.proof.readFinishedAt!) <= Date.parse(result.cleanup.checkedAt));
  assert(Date.parse(result.cleanup.checkedAt) <= Date.parse(result.proof.proofCapturedAt!));
});

test('native owned GET fully paginates and never stores other draft rows in its snapshot', async () => {
  const rows = Array.from({ length: 11 }, (_, index) =>
    String(1234567890123456790n + BigInt(index)),
  );
  rows[10] = WORK;
  const f = fixture({ rows }),
    result = await f.run.run();
  assert.equal(result.status, 'success');
  assert.equal(result.list.pagesRead, 2);
  assert.equal(result.list.rowsRead, 11);
  assert.equal(JSON.stringify(result.snapshot).includes('private-row'), false);
  assert.equal(result.requests.list.disposed, 2);
});

for (const [name, response, reason] of [
  ['redirect', () => ({ status: 302 }), 'redirect_blocked'],
  ['wrong URL', () => ({ url: OWN + '?untrusted=private' }), 'response_unverified'],
  ['bad status', () => ({ status: 500 }), 'response_unverified'],
  ['content type', () => ({ headers: { 'content-type': 'text/html' } }), 'response_unverified'],
  [
    'declared extent',
    () => ({
      headers: {
        'content-type': 'application/json',
        'content-length': String(NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes + 1),
      },
    }),
    'response_unverified',
  ],
  [
    'actual extent',
    () => ({ bytes: Buffer.alloc(NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes + 1) }),
    'response_unverified',
  ],
  [
    'invalid UTF8',
    () => ({
      bytes: Buffer.from([
        123, 34, 99, 111, 100, 101, 34, 58, 48, 44, 34, 100, 97, 116, 97, 34, 58, 123, 34, 120, 34,
        58, 34, 0xc3, 0x28, 34, 125, 125,
      ]),
    }),
    'response_unverified',
  ],
  ['invalid JSON', () => ({ bytes: Buffer.from('{') }), 'response_unverified'],
  ['wrong code type', () => ({ envelope: { code: '0', data: {} } }), 'response_unverified'],
  ['array data', () => ({ envelope: { code: 0, data: [] } }), 'response_unverified'],
  ['numeric owner', () => ({ envelope: { code: 0, data: { id: 1001 } } }), 'identity_unverified'],
  [
    'author namespace',
    () => ({ envelope: { code: 0, data: { author_id: ACCOUNT } } }),
    'identity_unverified',
  ],
  ['another owner', () => ({ envelope: { code: 0, data: { id: '1001' } } }), 'owner_changed'],
] as const)
  test(`native fixed GET rejects ${name}, no raw result and response/client are disposed`, async () => {
    const f = fixture({ response }),
      result = await f.run.run();
    failed(result, reason);
    assert.equal(f.calls.length, 1);
    assert.equal(result.requests.own.disposed, 1);
    assert.equal(f.apiCloses, 1);
    assert.equal(f.callbacks, 0);
    assert.equal(JSON.stringify(result).includes('private'), false);
  });

for (const [name, response, reason] of [
  [
    'duplicate target',
    (url: string) =>
      url === shortMetadataApiListUrl(0)
        ? {
            envelope: {
              code: 0,
              data: { total_count: 2, item_list: [{ item_id: WORK }, { item_id: WORK }] },
            },
          }
        : {},
    'pagination_inconsistent',
  ],
  [
    'missing target',
    (url: string) =>
      url === shortMetadataApiListUrl(0)
        ? { envelope: { code: 0, data: { total_count: 0, item_list: [] } } }
        : {},
    'target_unverified',
  ],
  [
    'over 100',
    (url: string) =>
      url === shortMetadataApiListUrl(0)
        ? { envelope: { code: 0, data: { total_count: 101, item_list: [] } } }
        : {},
    'bounded_unavailable',
  ],
  [
    'short page',
    (url: string) =>
      url === shortMetadataApiListUrl(0)
        ? { envelope: { code: 0, data: { total_count: 1, item_list: [] } } }
        : {},
    'pagination_inconsistent',
  ],
  [
    'different edit ID',
    (url: string) =>
      url === nativeShortMetadataEndpoints(WORK).edit
        ? { envelope: { code: 0, data: { ...edit(), item_id: '9999999999' } } }
        : {},
    'unsupported_schema',
  ],
  [
    'incomplete raw',
    (url: string) =>
      url === nativeShortMetadataEndpoints(WORK).edit
        ? { envelope: { code: 0, data: { multi_title: ['private'] } } }
        : {},
    'unsupported_schema',
  ],
  [
    'owner after changed',
    (url: string, index: number) =>
      url === OWN && index > 1 ? { envelope: { code: 0, data: { id: '9999' } } } : {},
    'owner_changed',
  ],
] as const)
  test(`native complete source rejects ${name}`, async () => {
    const f = fixture({ response }),
      result = await f.run.run();
    failed(result, reason);
    assert.equal(f.callbacks, 0);
    assert.equal(f.apiCloses, 1);
  });

test('native list inconsistent second-page total cannot establish a unique target', async () => {
  const rows = Array.from({ length: 11 }, (_, index) =>
    String(1234567890123456790n + BigInt(index)),
  );
  rows[0] = WORK;
  const f = fixture({
    rows,
    response: (url) =>
      url === shortMetadataApiListUrl(1)
        ? { envelope: { code: 0, data: { total_count: 10, item_list: [] } } }
        : {},
  });
  failed(await f.run.run(), 'pagination_inconsistent');
  assert.equal(f.calls.length, 3);
});

for (const stage of [
  'cookies',
  'creation',
  'get',
  'body',
  'response_dispose',
  'api_dispose',
] as const)
  test(`native cancellation at ${stage} keeps real late work owned until drain`, async () => {
    const f = fixture({ hold: stage });
    let settled = false;
    const running = f.run.run().then((value) => {
      settled = true;
      return value;
    });
    await f.entered;
    f.controller.abort();
    await turn();
    assert.equal(settled, false);
    assert.equal(f.callbacks, 0);
    f.release();
    const result = await running;
    failed(result, 'cancelled');
    assert.equal(f.borrowedCloses, 0);
    assert.equal(f.pageTouches, 0);
    if (stage === 'cookies') {
      assert.equal(f.apiCloses, 0);
      assert.equal(f.calls.length, 0);
    } else assert.equal(f.apiCloses, 1);
    if (stage === 'get') assert.equal(result.requests.own.disposed, 1);
  });

test('native deadline stays active through held API disposal, with no final callback or snapshot', async () => {
  const f = fixture({ hold: 'api_dispose', deadlineMs: 100 });
  f.options.deadline = performance.now() + 1_000_000;
  const running = f.run.run();
  await f.entered;
  await new Promise((resolve) => setTimeout(resolve, 120));
  f.release();
  failed(await running, 'timeout');
  assert.equal(f.callbacks, 0);
});

for (const kind of ['response', 'api'] as const)
  test(`native ${kind} disposal failure quarantines the entire borrowed account and never exposes raw`, async () => {
    const f = fixture({ failDispose: kind }),
      result = await f.run.run();
    failed(result, 'cleanup_failed');
    assert.equal(result.cleanup.quarantined, true);
    assert.equal(f.quarantines, 1);
    assert.equal(f.borrowedCloses, 0);
  });

for (const revoked of ['lease', 'source', 'abort', 'throw'] as const)
  test(`native callback ${revoked} revocation cannot publish after cleanup`, async () => {
    let f: ReturnType<typeof fixture>;
    let invalid = false;
    f = fixture({
      lease: () => {
        if (invalid && revoked === 'lease') throw Error('private-lease');
      },
      source: () => {
        if (invalid && revoked === 'source') throw Error('private-source');
      },
      callback: () => {
        invalid = true;
        if (revoked === 'abort') f.controller.abort();
        if (revoked === 'throw') throw Error('private-callback');
      },
    });
    failed(
      await f.run.run(),
      {
        lease: 'lease_unavailable',
        source: 'source_changed',
        abort: 'cancelled',
        throw: 'callback_failed',
      }[revoked],
    );
    assert.equal(f.apiCloses, 1);
  });
