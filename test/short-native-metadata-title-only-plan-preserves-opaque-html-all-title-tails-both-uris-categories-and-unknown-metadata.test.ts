import test from 'node:test';

import {
  snapshot,
  request,
  html,
  afterEdit,
  rejected,
  raw,
} from './helpers/short-native-metadata-raw.js';

import {
  planNativeShortMetadataUpdate,
  compareNativeShortMetadataReadback,
  createNativeShortMetadataSnapshot,
} from '../src/platform/short-native-metadata.js';

import assert from 'node:assert/strict';

import { createHash } from 'node:crypto';

test('title-only plan preserves opaque HTML, all title tails, both URIs, categories and unknown metadata', () => {
  const before = snapshot(),
    plan = planNativeShortMetadataUpdate(before, request(before, { title: '新&+%合成标题' }));
  assert.equal(plan.form.content, html);
  assert.equal(
    plan.form.multi_title,
    JSON.stringify(['新&+%合成标题', '', '副标题&+%', '第三标题']),
  );
  assert.equal(plan.form.thumb_uri, before.savedFields.thumb_uri);
  assert.equal(plan.form.book_thumb_uri, before.savedFields.book_thumb_uri);
  assert.equal(plan.form.category, '10,r1');
  assert.equal(plan.atomicRevision, false);
  assert.equal(plan.kind, 'native_metadata_payload_plan');
  const after = afterEdit(before, (edit) => {
    edit.multi_title = ['新&+%合成标题', '', '副标题&+%', '第三标题'];
  });
  const comparison = compareNativeShortMetadataReadback(plan.expectation, after);
  assert.equal(comparison.matches, true);
  assert.equal(comparison.reason, 'match');
  assert.equal(
    comparison.actual.documentHash,
    createHash('sha256').update(html, 'utf8').digest('hex'),
  );
});

test('category plan uses first label, group order and stable same-group caller order with raw ID types', () => {
  const before = snapshot(),
    plan = planNativeShortMetadataUpdate(
      before,
      request(before, { metadata: { categories: ['30', 'r2', '10', 'r1'] } }),
    );
  assert.equal(plan.form.category, '10,r2,r1,30');
  assert.equal(plan.form.multi_title, JSON.stringify(before.savedFields.multi_title));
  const after = afterEdit(before, (edit) => {
    edit.category = [
      { category_id: 10, label: '主类', name: '主甲' },
      { category_id: 'r2', label: '角色', name: '角色乙' },
      { category_id: 'r1', label: '角色', name: '角色甲' },
      { category_id: 30, label: '主题', name: '主题甲' },
    ];
  });
  assert.equal(compareNativeShortMetadataReadback(plan.expectation, after).matches, true);
});

test('category readback checks requested raw ID, label and name after portable expectation round-trip', async (t) => {
  const before = snapshot(),
    plan = planNativeShortMetadataUpdate(
      before,
      request(before, { metadata: { categories: ['r2', '11'] } }),
    );
  const expectedRows = [
    { category_id: 11, label: '主类', name: '主乙' },
    { category_id: 'r2', label: '角色', name: '角色乙' },
  ];
  const portable = JSON.parse(JSON.stringify(plan.expectation));
  const correct = afterEdit(before, (edit) => {
    edit.category = structuredClone(expectedRows);
  });
  assert.equal(compareNativeShortMetadataReadback(portable, correct).matches, true);
  assert.equal(
    compareNativeShortMetadataReadback(portable, correct).actual.categorySelectionHash,
    portable.categorySelectionHash,
  );
  for (const field of ['label', 'name'] as const)
    await t.test(`same IDs but wrong ${field}`, () => {
      const after = afterEdit(before, (edit) => {
        const rows = structuredClone(expectedRows);
        rows[0]![field] = '错误分类';
        edit.category = rows;
      });
      const comparison = compareNativeShortMetadataReadback(portable, after);
      assert.equal(comparison.matches, false);
      assert.equal(comparison.reason, 'category_selection_changed');
      assert.equal(comparison.actual.savedFieldsHash, portable.savedFieldsHash);
      assert.equal(comparison.actual.preservationHash, portable.preservationHash);
    });
  rejected(
    () =>
      compareNativeShortMetadataReadback(
        { ...portable, categorySelectionHash: 'invalid' },
        correct,
      ),
    'expectation_hash',
  );
  rejected(
    () =>
      compareNativeShortMetadataReadback(
        { ...portable, categorySelectionHash: undefined },
        correct,
      ),
    'json_invalid_value',
  );
});

test('classifier rejects empty, unknown, duplicate, missing main and multiple main categories before any plan', async (t) => {
  const before = snapshot();
  for (const [name, categories, code] of [
    ['empty does not clear', [], 'requested_category_shape'],
    ['unknown ID no name fallback', ['10', '角色甲'], 'requested_category_unknown'],
    ['duplicate ID', ['10', 'r1', 'r1'], 'requested_category_duplicate'],
    ['no main item', ['r1'], 'main_category_exactly_one'],
    ['two main items', ['10', '11'], 'main_category_exactly_one'],
  ] as const)
    await t.test(name, () =>
      rejected(
        () => planNativeShortMetadataUpdate(before, request(before, { metadata: { categories } })),
        code,
      ),
    );
});

test('signed category lock follows raw authorize truthiness and strict current main ID membership', () => {
  const locked = snapshot((input) => {
    input.editData.authorize_type = '0';
  });
  rejected(
    () =>
      planNativeShortMetadataUpdate(locked, request(locked, { metadata: { categories: ['11'] } })),
    'category_locked',
  );
  const repairable = snapshot((input) => {
    input.editData.authorize_type = 1;
    input.editData.category = [{ category_id: '10', label: '主类', name: '旧类型主类' }];
  });
  assert.equal(
    planNativeShortMetadataUpdate(
      repairable,
      request(repairable, { metadata: { categories: ['11'] } }),
    ).form.category,
    '11',
  );
  const titlePlan = planNativeShortMetadataUpdate(locked, request(locked));
  assert.equal(titlePlan.form.category, '10,r1');
});

test('snapshots and plans copy caller data and deeply freeze every exposed nested value', () => {
  const input = raw(),
    before = createNativeShortMetadataSnapshot(input);
  const version = before.snapshotVersionHash;
  input.editData.content = 'caller mutation';
  (input.editData.multi_title as string[])[2] = 'caller tail mutation';
  (input.editData.unknown_metadata as { timestamp: string }).timestamp = 'caller mutation';
  (input.categoryData.category_list as { name: string }[])[0]!.name = 'caller catalog mutation';
  input.binding.work.id = '8000000001';
  assert.equal(before.snapshotVersionHash, version);
  assert.equal(before.savedFields.content, html);
  assert.equal(before.savedFields.multi_title[2], '副标题&+%');
  assert.equal(before.binding.work.id, '7000000001');
  assert.equal(before.catalog[0]!.name, '主甲');
  assert.throws(() => {
    (before.editData.unknown_metadata as { timestamp: string }).timestamp = 'changed';
  }, TypeError);
  assert.throws(() => {
    (before.savedFields.multi_title as string[]).pop();
  }, TypeError);
  const mutableCategories = ['10', 'r2'];
  const plan = planNativeShortMetadataUpdate(
    before,
    request(before, { metadata: { categories: mutableCategories } }),
  );
  mutableCategories[0] = '11';
  assert.equal(plan.form.category, '10,r2');
  assert.equal(Object.isFrozen(plan.expectation.requested), true);
  assert.throws(() => {
    (plan.form as Record<string, string>).category = '11';
  }, TypeError);
  assert.throws(() => {
    (plan.expectation.binding.work as { id: string }).id = '8000000001';
  }, TypeError);
});

test('complete raw version is key-order stable, with typed binding and exact document byte scope', () => {
  const input = raw(),
    before = createNativeShortMetadataSnapshot(input);
  function reverse(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reverse);
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .reverse()
          .map(([key, child]) => [key, reverse(child)]),
      );
    return value;
  }
  const reordered = createNativeShortMetadataSnapshot(reverse(input) as ReturnType<typeof raw>);
  assert.equal(reordered.snapshotVersionHash, before.snapshotVersionHash);
  assert.equal(reordered.catalogHash, before.catalogHash);
  assert.equal(reordered.savedFieldsHash, before.savedFieldsHash);
  assert.equal(before.documentHash, createHash('sha256').update(html, 'utf8').digest('hex'));
  const anotherAccount = snapshot((input) => {
    input.binding.account.id = '1002';
  });
  assert.notEqual(anotherAccount.snapshotVersionHash, before.snapshotVersionHash);
  assert.notEqual(anotherAccount.savedFieldsHash, before.savedFieldsHash);
  assert.equal(anotherAccount.documentHash, before.documentHash);
  assert.equal(anotherAccount.catalogHash, before.catalogHash);
});

test('version includes title tails, HTML attributes, unknown presence/type, URL lists and catalog order', async (t) => {
  const before = snapshot();
  const changes: [string, (input: ReturnType<typeof raw>) => void][] = [
    [
      'tail title',
      (input) => {
        (input.editData.multi_title as string[])[3] = '不同尾标题';
      },
    ],
    [
      'HTML attribute',
      (input) => {
        input.editData.content = html.replace('color:red', 'color:blue');
      },
    ],
    [
      'unknown missing',
      (input) => {
        delete input.editData.title_problem;
      },
    ],
    [
      'unknown type',
      (input) => {
        input.editData.title_problem = '';
      },
    ],
    [
      'unknown nested',
      (input) => {
        (input.editData.unknown_metadata as { nested: unknown[] }).nested.reverse();
      },
    ],
    [
      'raw URL-list expiry',
      (input) => {
        input.editData.thumb_url_list = [
          { main_url: 'https://example.invalid/one?Expires=999', extra: null },
        ];
      },
    ],
    [
      'unknown source timestamp',
      (input) => {
        (input.editData.unknown_metadata as { timestamp: string }).timestamp = 'new-synthetic-time';
      },
    ],
    [
      'source category order',
      (input) => {
        (input.editData.category as unknown[]).reverse();
      },
    ],
    [
      'catalog array order',
      (input) => {
        (input.categoryData.category_list as unknown[]).reverse();
      },
    ],
    [
      'catalog unknown field',
      (input) => {
        input.categoryData.unknown_catalog = { revision: 2 };
      },
    ],
  ];
  for (const [name, change] of changes)
    await t.test(name, () =>
      assert.notEqual(snapshot(change).snapshotVersionHash, before.snapshotVersionHash),
    );
  assert.equal(
    snapshot((input) => {
      input.editData.observed_at = 'raw source timestamp';
    }).documentHash,
    before.documentHash,
  );
  // Observation/request provenance belongs outside the factory's raw source JSON.
  rejected(
    () =>
      createNativeShortMetadataSnapshot({ ...raw(), observedAt: 'outside' } as ReturnType<
        typeof raw
      >),
    'snapshot_input',
  );
});
