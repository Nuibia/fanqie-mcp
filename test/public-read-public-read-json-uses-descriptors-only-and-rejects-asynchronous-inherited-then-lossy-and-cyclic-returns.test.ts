import test from 'node:test';

import assert from 'node:assert/strict';

import {
  capturePublicReadJson,
  PUBLIC_READ_MEMO_BUDGET_BYTES,
  PublicReadError,
} from '../src/runtime/public-read.js';

import { unavailable, coordinator } from './helpers/public-read-coordinator.js';

test('public-read JSON uses descriptors only and rejects asynchronous, inherited then, lossy and cyclic returns', () => {
  const dto = Object.assign(Object.create(null), { id: 'synthetic', rows: [null, true, 12, 'x'] });
  assert.deepEqual(capturePublicReadJson(dto), dto);
  let getters = 0;
  const then = Object.defineProperty({}, 'then', {
      enumerable: true,
      get() {
        getters++;
        throw Error('must not read');
      },
    }),
    field = Object.defineProperty({}, 'payload', {
      enumerable: true,
      get() {
        getters++;
        return 'private';
      },
    });
  const cycle: any = {};
  cycle.self = cycle;
  const symbol = { [Symbol('synthetic')]: 1 };
  for (const bad of [
    Promise.resolve(1),
    then,
    field,
    new Array(2),
    cycle,
    symbol,
    { x: undefined },
    { x: NaN },
    { x: Infinity },
    { x: BigInt(1) },
    { x: () => 1 },
    Object.create(Date.prototype),
  ])
    assert.throws(() => capturePublicReadJson(bad), unavailable);
  Object.defineProperty(Object.prototype, 'then', {
    configurable: true,
    get() {
      getters++;
      return () => {};
    },
  });
  try {
    assert.throws(() => capturePublicReadJson({ okay: true }), unavailable);
    assert.throws(() => capturePublicReadJson([]), unavailable);
  } finally {
    delete (Object.prototype as any).then;
  }
  assert.equal(getters, 0);
});

test('public-read memo is successful, defensive, namespace/key complete and request-local; budget falls back strictly', () => {
  assert.equal(PUBLIC_READ_MEMO_BUDGET_BYTES, 64 * 1024 * 1024);
  const f = coordinator(),
    scope = f.scope;
  let builds = 0,
    failures = 0;
  const build = () => ({ nested: { value: ++builds } });
  scope.run('owner', 'jobs', () => {
    const first = scope.memo('strict', { id: 'same', account: 'owner', hash: 'a' }, build);
    first.nested.value = 999;
    assert.deepEqual(scope.memo('strict', { id: 'same', account: 'owner', hash: 'a' }, build), {
      nested: { value: 1 },
    });
    scope.memo('public', { id: 'same', account: 'owner', hash: 'a' }, build);
    scope.memo('strict', { id: 'same', account: 'other', hash: 'a' }, build);
    scope.memo('strict', { id: 'same', account: 'owner', hash: 'b' }, build);
    assert.equal(
      scope.memo('key-domain', [undefined], () => ({ domain: 'undefined' })).domain,
      'undefined',
    );
    assert.equal(
      scope.memo('key-domain', [{ $publicReadUndefined: true }], () => ({ domain: 'literal' }))
        .domain,
      'literal',
    );
    assert.equal(
      scope.memo('key-domain', { nested: [{ value: undefined }] }, () => ({
        domain: 'nested-undefined',
      })).domain,
      'nested-undefined',
    );
    assert.equal(
      scope.memo('key-domain', { nested: [{ value: { $publicReadUndefined: true } }] }, () => ({
        domain: 'nested-literal',
      })).domain,
      'nested-literal',
    );
    for (let i = 0; i < 2; i++)
      assert.throws(
        () =>
          scope.memo('bad', { id: 'bad' }, () => {
            failures++;
            throw new PublicReadError();
          }),
        unavailable,
      );
    return { okay: true };
  });
  assert.equal(builds, 4);
  assert.equal(failures, 2);
  scope.run('owner', 'jobs', () =>
    scope.memo('strict', { id: 'same', account: 'owner', hash: 'a' }, build),
  );
  assert.equal(builds, 5);
  const tiny = coordinator(8);
  let uncached = 0;
  const huge = () => ({ padding: 'x'.repeat(100), ordinal: ++uncached });
  tiny.scope.run('owner', 'status', () => {
    assert.equal(tiny.scope.memo('large', 'key', huge).ordinal, 1);
    assert.equal(tiny.scope.memo('large', 'key', huge).ordinal, 2);
    return { okay: true };
  });
  assert.equal(uncached, 2);
  for (const kind of ['sql', 'file'] as const) {
    const bounded = coordinator(8);
    let physical = 0;
    const value = { padding: 'x'.repeat(100) };
    bounded.scope.run('owner', 'jobs', () => {
      for (let i = 0; i < 2; i++)
        assert.deepEqual(
          kind === 'sql'
            ? bounded.scope.sql('SELECT budget-fallback', 'get', [], () => {
                physical++;
                return value;
              })
            : bounded.scope.file('budget-fallback', (mark) => {
                physical++;
                mark({ sha: 'stable', nlink: 1 });
                return value;
              }),
          value,
        );
      return {};
    });
    assert.equal(
      physical,
      3,
      'overbudget SQL/file success re-reads strictly and remains in final journal',
    );
    let changed = false;
    assert.throws(
      () =>
        bounded.scope.run('owner', 'jobs', () => {
          const read = () =>
            kind === 'sql'
              ? bounded.scope.sql('SELECT changed-budget', 'get', [], () => ({
                  padding: changed ? 'changed' : 'x'.repeat(100),
                }))
              : bounded.scope.file('changed-budget', (mark) => {
                  mark({ sha: changed ? 'changed' : 'stable' });
                  return value;
                });
          read();
          changed = true;
          read();
          return {};
        }),
      unavailable,
    );
  }
});

test('public-read pending self/two-key cycles fail bounded without granting success; nested opening cannot clear outer fault', () => {
  const f = coordinator(),
    s = f.scope;
  let recursion = 0;
  s.run('owner', 'jobs', () => {
    assert.throws(
      () =>
        s.memo('graph', 'self', () => {
          recursion++;
          return s.memo('graph', 'self', () => {
            assert.fail('pending cannot certify');
          });
        }),
      unavailable,
    );
    assert.throws(
      () =>
        s.memo('graph', 'A', () =>
          s.memo('graph', 'B', () =>
            s.memo('graph', 'A', () => assert.fail('cycle cannot certify')),
          ),
        ),
      unavailable,
    );
    return { fallback: 'unavailable' };
  });
  assert.equal(recursion, 1);
  assert.throws(
    () =>
      s.run('owner', 'jobs', () => {
        assert.throws(() => s.run('owner', 'status', () => ({})), unavailable);
        return { catchCannotRestore: true };
      }),
    unavailable,
  );
  assert.deepEqual(
    s.run('owner', 'jobs', () => ({ fresh: true })),
    { fresh: true },
  );
  const other = coordinator();
  assert.throws(
    () =>
      s.run('owner', 'jobs', () => {
        try {
          other.scope.assertReadAllowed();
        } catch {}
        return { crossStore: false };
      }),
    unavailable,
  );
});
