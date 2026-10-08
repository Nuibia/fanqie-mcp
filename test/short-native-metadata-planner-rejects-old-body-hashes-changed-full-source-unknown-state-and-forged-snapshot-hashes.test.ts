import test from 'node:test';

import { snapshot, rejected, request } from './helpers/short-native-metadata-raw.js';

import {
  planNativeShortMetadataUpdate,
  type NativeShortMetadataRequest,
  NATIVE_SHORT_RESOURCE_LIMITS,
} from '../src/platform/short-native-metadata.js';

import assert from 'node:assert/strict';

test('planner rejects old/body hashes, changed full source, unknown state and forged snapshot hashes', () => {
  const before = snapshot();
  rejected(
    () =>
      planNativeShortMetadataUpdate(before, {
        ...request(before),
        expectedSnapshotVersionHash: before.documentHash,
      }),
    'source_version_mismatch',
  );
  rejected(
    () =>
      planNativeShortMetadataUpdate(before, {
        ...request(before),
        hashBasis: 'plain-body-v1',
      } as unknown as NativeShortMetadataRequest),
    'source_version_mismatch',
  );
  const changed = snapshot((input) => {
    input.editData.title_problem = 'unknown change';
  });
  rejected(
    () => planNativeShortMetadataUpdate(changed, request(before)),
    'source_version_mismatch',
  );
  rejected(
    () =>
      planNativeShortMetadataUpdate(
        { ...before, snapshotVersionHash: '0'.repeat(64) },
        request(before),
      ),
    'snapshot_hash_mismatch',
  );
  for (const status of [1, 2, '0', null]) {
    const current = snapshot((input) => {
      input.editData.publish_status = status;
    });
    // Editor publish_status=1 only proves non-draft, never publication without management display_status.
    assert.equal(current.state, 'unknown');
    rejected(() => planNativeShortMetadataUpdate(current, request(current)), 'state_not_draft');
  }
  const absent = snapshot((input) => {
    delete input.editData.publish_status;
  });
  rejected(() => planNativeShortMetadataUpdate(absent, request(absent)), 'state_not_draft');
});

test('modern native metadata binds editor and management facts before planning', () => {
  for (const display of [1, 4, 5, 7, 10, 12, 99]) {
    const conflicting = snapshot((input) => {
      input.editData.display_status = display;
    });
    assert.equal(conflicting.state, 'unknown');
    assert.equal(conflicting.statusFacts.conflict, display !== 99);
    rejected(
      () => planNativeShortMetadataUpdate(conflicting, request(conflicting)),
      'state_not_draft',
    );
  }
  const states = [
    'published',
    'reviewing',
    'reviewing',
    'rejected',
    'waiting_publication',
    'distribution_stopped',
  ];
  for (const [index, display] of [1, 4, 5, 7, 10, 12].entries()) {
    const observed = snapshot((input) => {
      input.editData.publish_status = 1;
      input.editData.display_status = display;
    });
    assert.equal(observed.state, states[index]);
    rejected(() => planNativeShortMetadataUpdate(observed, request(observed)), 'state_not_draft');
  }
  const modern = snapshot();
  rejected(
    () =>
      planNativeShortMetadataUpdate(
        { ...modern, statusFacts: { ...modern.statusFacts, resolvedState: 'published' } },
        request(modern),
      ),
    'snapshot_hash_mismatch',
  );
});

test('new title validation is an explicit local resource bound and does not trim or filter old titles', () => {
  const before = snapshot();
  for (const title of [
    '',
    '   ',
    'new\nline',
    'nul\u0000title',
    'x'.repeat(NATIVE_SHORT_RESOURCE_LIMITS.newTitleUtf8Bytes + 1),
  ])
    rejected(() => planNativeShortMetadataUpdate(before, request(before, { title })));
  const title = '字'.repeat(26) + '😀'; // ps=25 does not prove any platform counting unit.
  assert.equal(
    JSON.parse(
      planNativeShortMetadataUpdate(before, request(before, { title })).form.multi_title!,
    )[0],
    title,
  );
  assert.equal(
    JSON.parse(
      planNativeShortMetadataUpdate(before, request(before, { title: ' 有首尾空格 ' })).form
        .multi_title!,
    )[0],
    ' 有首尾空格 ',
  );
  rejected(
    () =>
      snapshot((input) => {
        input.editData.multi_title = [];
      }),
    'multi_title_shape',
  );
  rejected(
    () =>
      snapshot((input) => {
        input.editData.multi_title = ['valid', null];
      }),
    'multi_title_shape',
  );
  rejected(
    () =>
      snapshot((input) => {
        input.editData.multi_title = ['valid', , 'hole'];
      }),
    'json_sparse_or_extra_array',
  );
});

test('category max uses only absent default, preserves source raw data, and enforces dynamic count', async (t) => {
  const fallback = snapshot((input) => {
    delete input.editData.category_max_count;
  });
  const defaultPlan = planNativeShortMetadataUpdate(fallback, request(fallback));
  assert.deepEqual(defaultPlan.categoryMax, { value: 8, basis: 'public-client-default-8' });
  assert.equal(Object.hasOwn(fallback.editData, 'category_max_count'), false);
  const dynamic = snapshot((input) => {
    input.editData.category_max_count = 2;
  });
  assert.deepEqual(
    planNativeShortMetadataUpdate(
      dynamic,
      request(dynamic, { metadata: { categories: ['r1', '10'] } }),
    ).categoryMax,
    { value: 2, basis: 'source' },
  );
  rejected(
    () =>
      planNativeShortMetadataUpdate(
        dynamic,
        request(dynamic, { metadata: { categories: ['10', 'r1', '30'] } }),
      ),
    'category_max_exceeded',
  );
  for (const value of [null, '8', 0, -1, 1.5, NATIVE_SHORT_RESOURCE_LIMITS.categoryCount + 1])
    await t.test(`invalid max ${String(value)}`, () => {
      const before = snapshot((input) => {
        input.editData.category_max_count = value;
      });
      rejected(() => planNativeShortMetadataUpdate(before, request(before)), 'category_max_count');
    });
  rejected(
    () =>
      snapshot((input) => {
        input.editData.category_max_count = undefined;
      }),
    'json_invalid_value',
  );
});

test('catalog rejects duplicate IDs, CSV collisions, malformed group/name and unsafe IDs', async (t) => {
  const cases: [string, unknown, string][] = [
    [
      'duplicate ID',
      [
        { category_id: 10, label: 'main', name: 'a' },
        { category_id: 10, label: 'other', name: 'b' },
      ],
      'catalog_duplicate_or_csv_collision',
    ],
    [
      'string-number CSV collision',
      [
        { category_id: 10, label: 'main', name: 'a' },
        { category_id: '10', label: 'other', name: 'b' },
      ],
      'catalog_duplicate_or_csv_collision',
    ],
    ['comma ID', [{ category_id: 'a,b', label: 'main', name: 'a' }], 'category_id'],
    [
      'unsafe numeric ID',
      [{ category_id: Number.MAX_SAFE_INTEGER + 1, label: 'main', name: 'a' }],
      'category_id',
    ],
    ['missing label', [{ category_id: 10, name: 'a' }], 'category_label'],
    ['empty label', [{ category_id: 10, label: '', name: 'a' }], 'category_label'],
    ['missing name', [{ category_id: 10, label: 'main' }], 'category_name'],
    ['numeric label', [{ category_id: 10, label: 1, name: 'a' }], 'category_label'],
    ['empty catalog', [], 'category_shape'],
  ];
  for (const [name, value, code] of cases)
    await t.test(name, () =>
      rejected(
        () =>
          snapshot((input) => {
            input.categoryData.category_list = value;
          }),
        code,
      ),
    );
});

test('first catalog group is authoritative, without treating a fixed label/name as main', () => {
  const before = snapshot((input) => {
    (input.categoryData.category_list as unknown[]).reverse();
  });
  assert.equal(
    planNativeShortMetadataUpdate(
      before,
      request(before, { metadata: { categories: ['r1', '10', '30'] } }),
    ).form.category,
    '30,r1,10',
  );
  rejected(
    () =>
      planNativeShortMetadataUpdate(before, request(before, { metadata: { categories: ['10'] } })),
    'main_category_exactly_one',
  );
});

test('unrequested old, duplicate and over-count categories are preserved without repair; empty baseline omits category', () => {
  const before = snapshot((input) => {
    input.editData.category_max_count = 1;
    input.editData.category = [
      { category_id: 10, label: '旧主类', name: '旧名', unknown: true },
      { category_id: 10, label: '旧主类', name: '旧名' },
      { category_id: 'obsolete', label: '旧类', name: '过期' },
    ];
  });
  assert.equal(
    planNativeShortMetadataUpdate(before, request(before)).form.category,
    '10,10,obsolete',
  );
  const empty = snapshot((input) => {
    input.editData.category = [];
  });
  const plan = planNativeShortMetadataUpdate(empty, request(empty));
  assert.equal(Object.hasOwn(plan.form, 'category'), false);
  assert.equal(new URLSearchParams(plan.request.body).has('category'), false);
  rejected(
    () => planNativeShortMetadataUpdate(empty, request(empty, { metadata: { categories: [] } })),
    'requested_category_shape',
  );
});
