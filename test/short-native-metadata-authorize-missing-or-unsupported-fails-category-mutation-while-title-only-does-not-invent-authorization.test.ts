import test from 'node:test';

import { raw, snapshot, rejected, request, html } from './helpers/short-native-metadata-raw.js';

import {
  planNativeShortMetadataUpdate,
  nativeShortMetadataEndpoints,
} from '../src/platform/short-native-metadata.js';

import assert from 'node:assert/strict';

test('authorize missing or unsupported fails category mutation, while title-only does not invent authorization', async (t) => {
  for (const [name, mutate] of [
    [
      'missing',
      (input: ReturnType<typeof raw>) => {
        delete input.editData.authorize_type;
      },
    ],
    [
      'null',
      (input: ReturnType<typeof raw>) => {
        input.editData.authorize_type = null;
      },
    ],
    [
      'array',
      (input: ReturnType<typeof raw>) => {
        input.editData.authorize_type = [];
      },
    ],
    [
      'object',
      (input: ReturnType<typeof raw>) => {
        input.editData.authorize_type = {};
      },
    ],
  ] as const)
    await t.test(name, () => {
      const before = snapshot(mutate);
      rejected(
        () =>
          planNativeShortMetadataUpdate(
            before,
            request(before, { metadata: { categories: ['11'] } }),
          ),
        'authorize_type_unsupported',
      );
      assert.equal(planNativeShortMetadataUpdate(before, request(before)).form.category, '10,r1');
    });
  for (const authorize of [false, 0, '']) {
    const before = snapshot((input) => {
      input.editData.authorize_type = authorize;
    });
    assert.equal(
      planNativeShortMetadataUpdate(before, request(before, { metadata: { categories: ['11'] } }))
        .form.category,
      '11',
    );
  }
});

test('save semantic baseline accepts only explicit sign 1 and activity 0/1, never guesses missing values', async (t) => {
  for (const value of [1, '1']) {
    const before = snapshot((input) => {
      input.editData.sign_type = value;
    });
    assert.equal(planNativeShortMetadataUpdate(before, request(before)).form.sign_type, '1');
  }
  for (const value of [0, 1, '0', '1']) {
    const before = snapshot((input) => {
      input.editData.origin_activity_flag = value;
    });
    assert.equal(
      planNativeShortMetadataUpdate(before, request(before)).form.activity_flag,
      String(value),
    );
  }
  for (const value of [0, 2, null, true, '01', ''])
    await t.test(`unsupported sign ${String(value)}`, () => {
      const before = snapshot((input) => {
        input.editData.sign_type = value;
      });
      rejected(
        () => planNativeShortMetadataUpdate(before, request(before)),
        'sign_type_unsupported',
      );
    });
  for (const value of [2, null, false, '01', ''])
    await t.test(`unsupported activity ${String(value)}`, () => {
      const before = snapshot((input) => {
        input.editData.origin_activity_flag = value;
      });
      rejected(
        () => planNativeShortMetadataUpdate(before, request(before)),
        'activity_flag_unsupported',
      );
    });
  for (const field of ['sign_type', 'origin_activity_flag']) {
    const before = snapshot((input) => {
      delete input.editData[field];
    });
    assert.equal(Object.hasOwn(before.editData, field), false);
    rejected(
      () => planNativeShortMetadataUpdate(before, request(before)),
      field === 'sign_type' ? 'sign_type_unsupported' : 'activity_flag_unsupported',
    );
  }
});

test('both cover URI source values and complete HTML are mandatory; present empty URI is distinct from absence', () => {
  for (const field of ['thumb_uri', 'book_thumb_uri', 'content']) {
    rejected(
      () =>
        snapshot((input) => {
          delete input.editData[field];
        }),
      `${field}_missing`,
    );
    rejected(
      () =>
        snapshot((input) => {
          input.editData[field] = null;
        }),
      `${field}_missing`,
    );
  }
  const before = snapshot((input) => {
    input.editData.book_thumb_uri = '';
  });
  assert.equal(planNativeShortMetadataUpdate(before, request(before)).form.book_thumb_uri, '');
});

test('form and endpoints have fixed public contract and round-trip all UTF8 fields without extra parameters', () => {
  const before = snapshot(),
    plan = planNativeShortMetadataUpdate(before, request(before, { title: '标题&=+%😀' }));
  const form = new URLSearchParams(plan.request.body);
  assert.deepEqual(Object.fromEntries(form), { ...plan.form });
  assert.deepEqual(
    [...form.keys()].sort(),
    [
      'activity_flag',
      'book_thumb_uri',
      'category',
      'content',
      'item_id',
      'item_version',
      'multi_title',
      'sign_type',
      'thumb_uri',
    ].sort(),
  );
  assert.equal(form.get('content'), html);
  assert.deepEqual(JSON.parse(form.get('multi_title')!), [
    '标题&=+%😀',
    '',
    '副标题&+%',
    '第三标题',
  ]);
  assert.equal(form.get('item_version'), '-1');
  assert.equal(form.has('description'), false);
  assert.equal(form.has('use_ai'), false);
  assert.equal(plan.request.method, 'POST');
  assert.equal(plan.request.contentType, 'application/x-www-form-urlencoded;charset=UTF-8');
  const endpoints = nativeShortMetadataEndpoints('7000000001');
  for (const [name, path] of [
    ['edit', '/api/author/short_article/edit/v1/'],
    ['catalog', '/api/author/short_article/get_category_list/v1/'],
    ['save', '/api/author/short_article/cover/v0/'],
  ] as const) {
    const url = new URL(endpoints[name]);
    assert.equal(url.origin, 'https://fanqienovel.com');
    assert.equal(url.pathname, path);
    assert.equal(url.searchParams.get('aid'), '2503');
    assert.equal(url.searchParams.get('app_name'), 'muye_novel');
    assert.deepEqual(
      [...url.searchParams.keys()].sort(),
      name === 'edit' ? ['aid', 'app_name', 'image_fmt_list', 'item_id'] : ['aid', 'app_name'],
    );
  }
  assert.equal(new URL(endpoints.edit).searchParams.get('image_fmt_list'), '270x480');
  assert.equal(plan.request.url, endpoints.save);
  rejected(() => nativeShortMetadataEndpoints('7001&url=https://example.invalid'), 'work_id');
});
