import test from 'node:test';

import {
  fixture,
  OWN,
  listUrl,
  RAW,
  type Controls,
  clone,
} from './helpers/short-draft-directory-deferred.js';

import assert from 'node:assert/strict';

import {
  shortDraftDirectoryReadUrl,
  createShortDraftDirectoryEvidence,
  validateShortDraftDirectoryApiResult,
  validateShortDraftDirectoryEvidence,
  OwnedShortDraftDirectoryRun,
  hasReservedShortDraftDirectorySignal,
} from '../src/platform/short-draft-directory.js';

import { type APIRequest } from 'playwright';

test('directory empty and 1 10 11 100 totals use independent fixed URLs and complete own two list counters', async () => {
  for (const [total, pages] of [
    [0, 1],
    [1, 1],
    [10, 1],
    [11, 2],
    [100, 10],
  ] as const) {
    const f = fixture({ total });
    const result = await f.run();
    assert.equal(result.status, 'success');
    assert.deepEqual(f.calls, [
      OWN,
      ...Array.from({ length: pages }, (_, index) => listUrl(index)),
      OWN,
    ]);
    assert.deepEqual(result.requests, {
      own: { attempts: 2, disposed: 2 },
      list: { attempts: pages, disposed: pages },
    });
    assert.deepEqual(
      {
        pages: result.coverage.pagesRead,
        rows: result.coverage.rowsRead,
        total: result.coverage.declaredTotal,
      },
      { pages, rows: total, total },
    );
    assert.equal(result.records.length, total);
    assert.equal(result.coverage.complete, true);
    assert.equal(result.coverage.atomicRevision, false);
    if (total > 0)
      assert.deepEqual(result.records[0], {
        id: { namespace: 'native_short_item', value: '1000000000' },
        title: null,
        publicationStatus: 'unknown',
        signingStatus: 'unknown',
        listingScope: 'own_draft_list',
      });
    assert.equal(f.callbacks.reads, 1);
    assert.equal(f.callbacks.owners, 1);
    assert(f.callbacks.leases >= pages * 3);
    assert(f.events.indexOf('session-disposed') < f.events.indexOf('owner-callback'));
    assert.equal(f.counts().borrowedCloses, 0);
    assert(Object.isFrozen(result));
    assert(Object.isFrozen(result.records));
    assert.equal(JSON.stringify(result).includes(RAW), false);
    for (let index = 0; index < pages; index++)
      assert.equal(shortDraftDirectoryReadUrl('list', index), listUrl(index));
  }
  assert.equal(shortDraftDirectoryReadUrl('own'), OWN);
  assert.throws(() => shortDraftDirectoryReadUrl('own', 0));
  assert.throws(() => shortDraftDirectoryReadUrl('list', 10));
});

test('directory ID-only decoder rejects 101 duplicate drift wrong-page types and identity boundaries', async () => {
  const failures: Controls[] = [
    { total: 101 },
    { total: 2, ids: ['1000000000', '1000000000'] },
    {
      total: 11,
      mutate(data, kind, index) {
        return kind === 'list' && index === 1 ? { ...data, total_count: 12 } : data;
      },
    },
    {
      total: 11,
      mutate(data, kind, index) {
        return kind === 'list' && index === 1 ? { ...data, item_list: [] } : data;
      },
    },
    ...['0123456789', '123456789', '12345678901234567890123', '100000000\ud800'].map((id) => ({
      total: 1,
      ids: [id],
    })),
    {
      mutate(data, kind) {
        return kind === 'list' ? { total_count: '1', item_list: data.item_list } : data;
      },
    },
    {
      mutate(data, kind) {
        return kind === 'list' ? { total_count: 1, item_list: [{ item_id: 1000000000 }] } : data;
      },
    },
    {
      mutate(data, kind) {
        return kind === 'list' ? { total_count: 1, item_list: [{}] } : data;
      },
    },
    {
      bytes: Buffer.from('{"code":0,"data":{"total_count":-0,"item_list":[]}}'),
      bytesKind: 'list',
    },
  ];
  for (const controls of failures) {
    const f = fixture(controls),
      result = await f.run();
    assert.equal(result.status, 'capability_unavailable');
    assert.equal(result.coverage.complete, false);
    assert.deepEqual(result.records, []);
    assert.equal(f.callbacks.owners, 0);
    assert.equal(result.cleanup.pendingAtEnd, 0);
  }
  for (const id of ['1000000000', '1234567890123456789012']) {
    const f = fixture({ ids: [id] });
    assert.equal((await f.run()).records[0]!.id.value, id);
  }
});

test('directory transport enforces no redirect retry HTTP JSON byte length and fatal UTF8 without raw causes', async () => {
  for (const control of [
    { status: 302 },
    { status: 500 },
    { responseUrl: 'https://invalid.example/redirect' },
    { contentType: 'text/html' },
    { contentLength: 'invalid' },
    { contentLength: '3145729' },
    { bytes: Buffer.alloc(3145729), bytesKind: 'list' as const },
    { bytes: Buffer.from([0xc3, 0x28]) },
    { bytes: Buffer.from('{"code":1,"data":{}}') },
    { bytes: Buffer.from('{"code":0,"data":[]}') },
    { getFails: true },
  ]) {
    const f = fixture(control),
      result = await f.run();
    assert.equal(result.status, 'capability_unavailable');
    assert.deepEqual(result.records, []);
    assert.equal(result.cleanup.pendingAtEnd, 0);
    assert.equal(JSON.stringify(result).includes(RAW), false);
    assert.equal(f.callbacks.owners, 0);
  }
  const prefix = '{"code":0,"data":{"total_count":0,"item_list":[],"private":"',
    suffix = '"}}';
  const bytes = Buffer.from(
    prefix + 'x'.repeat(3145728 - Buffer.byteLength(prefix + suffix)) + suffix,
  );
  const f = fixture({ total: 0, bytes, bytesKind: 'list' });
  assert.equal((await f.run()).status, 'success');
  assert.equal(bytes.length, 3145728);
});

test('directory typed own before after final callback and every lease source fence prevent successful publication', async () => {
  for (const control of [
    { ownerBefore: '1002' },
    { ownerAfter: '1002' },
    { ownerBefore: 1001 },
    { ownerAfter: 'not-decimal' },
  ]) {
    const f = fixture(control);
    assert.equal((await f.run()).status, 'capability_unavailable');
    assert.equal(f.callbacks.owners, 0);
  }
  const callback = fixture();
  const result = await callback.run({
    onVerifiedAccount() {
      throw Error(RAW);
    },
  });
  assert.equal(result.reason, 'callback_failed');
  assert.equal(result.proof.ownerCallback, false);
  const early = fixture();
  assert.equal(
    (
      await early.run({
        assertLease() {
          throw Error(RAW);
        },
      })
    ).reason,
    'lease_unavailable',
  );
  assert.equal(early.counts().creates, 0);
  const revoked = fixture();
  let checks = 0;
  const late = await revoked.run({
    assertLease() {
      if (++checks === 7) throw Error(RAW);
    },
  });
  assert.equal(late.status, 'capability_unavailable');
  assert.equal(late.reason, 'lease_unavailable');
  assert.equal(late.cleanup.sessionDisposed, true);
  const source = fixture();
  let reads = 0;
  const moved = await source.run({
    assertBorrowedActive() {
      if (++reads === 6) throw Error(RAW);
    },
  });
  assert.equal(moved.reason, 'source_changed');
  assert.deepEqual(moved.records, []);
});

test('directory result source issuance rejects clones getters unknown fields Unicode sparse and fixture live claims', async () => {
  const f = fixture(),
    raw = await f.run();
  const evidence = createShortDraftDirectoryEvidence(raw, 'default');
  assert.equal(evidence.source.transport, 'fixture-request');
  assert.equal(evidence.source.mode, 'fixture');
  assert.equal(evidence.source.application, 'default');
  assert.throws(() => createShortDraftDirectoryEvidence(clone(raw), 'default'));
  assert.throws(() => createShortDraftDirectoryEvidence(clone(raw), 'injected'));
  const invalids: unknown[] = [
    { ...clone(raw), body: RAW },
    { ...clone(raw), reason: RAW },
    {
      ...clone(raw),
      records: [
        { ...raw.records[0]!, id: { namespace: 'management_preview_short', value: '1000000000' } },
      ],
    },
    { ...clone(raw), coverage: { ...raw.coverage, rowsRead: NaN } },
    { ...clone(raw), coverage: { ...raw.coverage, firstPageIndex: -0 } },
  ];
  const sparse = clone(raw);
  sparse.records = new Array(1);
  invalids.push(sparse);
  let gets = 0;
  invalids.push(
    Object.defineProperty(clone(raw), 'records', {
      get() {
        gets++;
        throw Error(RAW);
      },
      enumerable: true,
    }),
  );
  invalids.push(Object.assign(clone(raw), { [Symbol('secret')]: RAW }));
  invalids.push({
    ...clone(raw),
    records: [{ ...raw.records[0]!, id: { namespace: 'native_short_item', value: '\ud800' } }],
  });
  for (const v of invalids) assert.throws(() => validateShortDraftDirectoryApiResult(v));
  assert.equal(gets, 0);
  assert.throws(() =>
    validateShortDraftDirectoryEvidence({
      ...clone(evidence),
      source: { ...evidence.source, mode: 'live' },
    }),
  );
  const options = Object.defineProperty({ ...f.options }, 'expectedOwner', {
    get() {
      gets++;
      throw Error(RAW);
    },
    enumerable: true,
  });
  assert.throws(() => new OwnedShortDraftDirectoryRun(f.context, options, f.factory));
  const badFactory = Object.defineProperty({}, 'newContext', {
    get() {
      gets++;
      throw Error(RAW);
    },
    enumerable: true,
  });
  assert.throws(
    () =>
      new OwnedShortDraftDirectoryRun(
        f.context,
        f.options,
        badFactory as Pick<APIRequest, 'newContext'>,
      ),
  );
  assert.equal(gets, 0);
  assert.equal(hasReservedShortDraftDirectorySignal({ datasets: ['short_drafts'] }), true);
  assert.equal(hasReservedShortDraftDirectorySignal({ scope: 'short_drafts' }), true);
  assert.equal(
    hasReservedShortDraftDirectorySignal({ schema: 'short-draft-directory-unknown/v9' }),
    true,
  );
});
