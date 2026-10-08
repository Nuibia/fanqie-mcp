import test from 'node:test';

import { rejected, snapshot, request, binding, raw } from './helpers/short-native-metadata-raw.js';

import {
  planNativeShortMetadataUpdate,
  NATIVE_SHORT_HASH_BASES,
  NATIVE_SHORT_RESOURCE_LIMITS,
  createNativeShortMetadataSnapshot,
  nativeShortMetadataEndpoints,
} from '../src/platform/short-native-metadata.js';

import assert from 'node:assert/strict';

test('strict JSON rejects lossy inputs, holes, exotic objects and resources without evaluating accessors', async (t) => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const hidden = {};
  Object.defineProperty(hidden, 'lost', { value: 1 });
  const symbol = { [Symbol('lost')]: 1 };
  const extraArray = Object.assign([1], { extra: 2 });
  const cases: [string, unknown, string][] = [
    ['undefined', undefined, 'json_invalid_value'],
    ['function', () => 1, 'json_invalid_value'],
    ['bigint', 1n, 'json_invalid_value'],
    ['NaN', NaN, 'json_invalid_number'],
    ['Infinity', Infinity, 'json_invalid_number'],
    ['negative zero', -0, 'json_invalid_number'],
    ['cycle', cycle, 'json_cycle'],
    ['sparse array', Array(2), 'json_sparse_or_extra_array'],
    ['array extra property', extraArray, 'json_sparse_or_extra_array'],
    ['date', new Date(0), 'json_non_plain_object'],
    ['map', new Map(), 'json_non_plain_object'],
    ['hidden property', hidden, 'json_non_data_property'],
    ['symbol property', symbol, 'json_symbol_key'],
    ['unpaired surrogate', '\ud800', 'json_invalid_unicode'],
  ];
  for (const [name, value, code] of cases)
    await t.test(name, () =>
      rejected(
        () =>
          snapshot((input) => {
            input.editData.unknown_metadata = value;
          }),
        code,
      ),
    );
  let calls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'value', {
    enumerable: true,
    get: () => {
      calls++;
      return 1;
    },
  });
  rejected(
    () =>
      snapshot((input) => {
        input.editData.unknown_metadata = accessor;
      }),
    'json_non_data_property',
  );
  const before = snapshot(),
    input = request(before);
  Object.defineProperty(input, 'title', {
    enumerable: true,
    get: () => {
      calls++;
      return 'read';
    },
  });
  rejected(() => planNativeShortMetadataUpdate(before, input), 'json_non_data_property');
  const forged = { ...before };
  Object.defineProperty(forged, 'binding', {
    enumerable: true,
    get: () => {
      calls++;
      return binding;
    },
  });
  rejected(() => planNativeShortMetadataUpdate(forged, request(before)), 'snapshot_shape');
  const forgedBases = { ...NATIVE_SHORT_HASH_BASES };
  Object.defineProperty(forgedBases, 'snapshot', {
    enumerable: true,
    get: () => {
      calls++;
      return NATIVE_SHORT_HASH_BASES.snapshot;
    },
  });
  rejected(
    () => planNativeShortMetadataUpdate({ ...before, hashBases: forgedBases }, request(before)),
    'json_non_data_property',
  );
  assert.equal(calls, 0);
  let deep: unknown = null;
  for (let index = 0; index < NATIVE_SHORT_RESOURCE_LIMITS.depth + 1; index++)
    deep = { next: deep };
  rejected(
    () =>
      snapshot((input) => {
        input.editData.unknown_metadata = deep;
      }),
    'json_resource_limit',
  );
  rejected(
    () =>
      snapshot((input) => {
        input.editData.content = 'x'.repeat(NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes);
      }),
    'json_extent_limit',
  );
  rejected(
    () =>
      snapshot((input) => {
        input.editData.unknown_metadata = Array(NATIVE_SHORT_RESOURCE_LIMITS.nodes + 1).fill(null);
      }),
    'json_resource_limit',
  );
});

test('each full response has its own 3 MiB extent bound, rather than truncating the combined snapshot', () => {
  const half = 'x'.repeat(Math.floor(NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes * 0.6));
  const before = snapshot((input) => {
    input.editData.content = half;
    input.categoryData.large_unknown = half;
  });
  assert.equal(before.savedFields.content.length, half.length);
  assert.equal((before.categoryData.large_unknown as string).length, half.length);
  rejected(
    () =>
      snapshot((input) => {
        input.categoryData.large_unknown = 'x'.repeat(
          NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes,
        );
      }),
    'json_extent_limit',
  );
});

test('JSON objects with __proto__ keys remain opaque data and cannot add save parameters', () => {
  const before = snapshot((input) => {
    input.editData.unknown_metadata = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"x":1}}',
    );
  });
  assert.equal(Object.hasOwn(before.editData.unknown_metadata as object, '__proto__'), true);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
  const plan = planNativeShortMetadataUpdate(before, request(before));
  assert.equal(Object.hasOwn(plan.form, '__proto__'), false);
  assert.equal(Object.hasOwn(plan.form, 'unknown_metadata'), false);
});

test('item ID binding records exact, sentinel and real absence, without accepting another target', async (t) => {
  assert.equal(snapshot().responseBinding, 'exact');
  assert.equal(
    snapshot((input) => {
      input.editData.item_id = '0';
    }).responseBinding,
    'sentinel',
  );
  const absent = snapshot((input) => {
    delete input.editData.item_id;
  });
  assert.equal(absent.responseBinding, 'absent');
  assert.equal(planNativeShortMetadataUpdate(absent, request(absent)).form.item_id, '7000000001');
  const sentinel = snapshot((input) => {
    input.editData.item_id = '0';
  });
  assert.equal(
    planNativeShortMetadataUpdate(sentinel, request(sentinel)).form.item_id,
    '7000000001',
  );
  assert.equal(Object.hasOwn(absent.editData, 'item_id'), false);
  assert.notEqual(
    absent.snapshotVersionHash,
    snapshot((input) => {
      input.editData.item_id = '0';
    }).snapshotVersionHash,
  );
  for (const item of ['8000000001', 7001, 0, null, ''] as const)
    await t.test(`response ${String(item)}`, () =>
      rejected(
        () =>
          snapshot((input) => {
            input.editData.item_id = item;
          }),
        'response_target_mismatch',
      ),
    );
  const wrongKind = raw();
  (wrongKind.binding.account as { kind: string }).kind = 'profile';
  rejected(() => createNativeShortMetadataSnapshot(wrongKind), 'binding_kind');
  const badId = raw();
  badId.binding.work.id = '0';
  rejected(() => createNativeShortMetadataSnapshot(badId), 'binding_id');
});

test('typed account and native work IDs use existing exact bounds without decimal normalization', async (t) => {
  for (const id of ['1000000000', '9'.repeat(22)])
    await t.test(`accepted work length ${id.length}`, () => {
      const input = raw();
      input.binding.work.id = id;
      input.editData.item_id = id;
      assert.equal(createNativeShortMetadataSnapshot(input).binding.work.id, id);
      assert.equal(new URL(nativeShortMetadataEndpoints(id).edit).searchParams.get('item_id'), id);
    });
  for (const id of [
    '0',
    '1',
    '9'.repeat(9),
    '9'.repeat(23),
    '0' + '9'.repeat(9),
    '0' + '9'.repeat(21),
  ])
    await t.test(`rejected work ${id}`, () => {
      const input = raw();
      input.binding.work.id = id;
      input.editData.item_id = id;
      rejected(() => createNativeShortMetadataSnapshot(input), 'binding_id');
      rejected(() => nativeShortMetadataEndpoints(id), 'work_id');
    });
  for (const id of ['0', '01', '9'.repeat(30)])
    await t.test(`accepted account ${id}`, () => {
      const input = raw();
      input.binding.account.id = id;
      const current = createNativeShortMetadataSnapshot(input);
      assert.equal(current.binding.account.id, id);
      assert.equal(
        planNativeShortMetadataUpdate(current, request(current)).expectation.binding.account.id,
        id,
      );
    });
  for (const id of ['', '9'.repeat(31), '-1', '1.0', ' 1', '1 '])
    await t.test(`rejected account ${id}`, () => {
      const input = raw();
      input.binding.account.id = id;
      rejected(() => createNativeShortMetadataSnapshot(input));
    });
});

test('empty and unsupported requests reject as a whole, even alongside a valid title/category patch', async (t) => {
  const before = snapshot();
  const patches: [string, Record<string, unknown>, string][] = [
    ['empty request', {}, 'empty_request'],
    ['empty metadata', { metadata: {} }, 'empty_request'],
    ['description', { title: '标题', metadata: { description: 'unused' } }, 'unsupported_field'],
    ['AI', { metadata: { categories: ['10'], use_ai: 1 } }, 'unsupported_field'],
    ['trial', { title: '标题', metadata: { trial_ratio: 0.4 } }, 'unsupported_field'],
    ['new cover', { title: '标题', metadata: { cover: 'new' } }, 'unsupported_field'],
    ['extra root URL', { title: '标题', url: 'https://example.invalid' }, 'unsupported_field'],
    ['caller multi_title', { metadata: { multi_title: ['title'] } }, 'unsupported_field'],
    ['body', { title: '标题', content: '<p>different</p>' }, 'unsupported_field'],
    ['nested metadata null', { title: '标题', metadata: null }, 'metadata_shape'],
  ];
  for (const [name, patch, code] of patches)
    await t.test(name, () => {
      let result: unknown = null;
      rejected(() => {
        result = planNativeShortMetadataUpdate(before, request(before, patch));
      }, code);
      assert.equal(result, null);
    });
  assert.equal(
    planNativeShortMetadataUpdate(before, request(before, { title: '标题', metadata: {} })).form
      .multi_title,
    JSON.stringify(['标题', '', '副标题&+%', '第三标题']),
  );
  rejected(
    () => planNativeShortMetadataUpdate(before, request(before, { title: undefined })),
    'json_invalid_value',
  );
});
