import test from 'node:test';

import {
  snapshot,
  request,
  html,
  afterEdit,
  raw,
  rejected,
} from './helpers/short-native-metadata-raw.js';

import {
  planNativeShortMetadataUpdate,
  compareNativeShortMetadataReadback,
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_METADATA_SCOPE,
} from '../src/platform/short-native-metadata.js';

import assert from 'node:assert/strict';

test('readback rejects changed documents, title tails, other URI, unrequested raw fields/types and source state', async (t) => {
  const before = snapshot(),
    plan = planNativeShortMetadataUpdate(before, request(before));
  const baseline = (edit: Record<string, unknown>) => {
    edit.multi_title = ['新合成标题', '', '副标题&+%', '第三标题'];
  };
  const cases: [string, (edit: Record<string, unknown>) => void, string][] = [
    [
      'HTML attribute',
      (edit) => {
        edit.content = html.replace('color:red', 'color:blue');
      },
      'document_changed',
    ],
    [
      'extra trailing empty P',
      (edit) => {
        edit.content = html + '<p></p>';
      },
      'document_changed',
    ],
    [
      'first title wrong',
      (edit) => {
        (edit.multi_title as string[])[0] = 'wrong';
      },
      'saved_fields_changed',
    ],
    [
      'empty tail lost',
      (edit) => {
        (edit.multi_title as string[]).splice(1, 1);
      },
      'saved_fields_changed',
    ],
    [
      'third tail lost',
      (edit) => {
        (edit.multi_title as string[]).pop();
      },
      'saved_fields_changed',
    ],
    [
      'tail modified',
      (edit) => {
        (edit.multi_title as string[])[2] = 'wrong';
      },
      'saved_fields_changed',
    ],
    [
      'other cover changed',
      (edit) => {
        edit.book_thumb_uri = 'different';
      },
      'saved_fields_changed',
    ],
    [
      'category ID raw type changed',
      (edit) => {
        (edit.category as { category_id: unknown }[])[0]!.category_id = '10';
      },
      'saved_fields_changed',
    ],
    [
      'category row unknown removed',
      (edit) => {
        delete (edit.category as Record<string, unknown>[])[0]!.legacy;
      },
      'preservation_not_proven',
    ],
    [
      'unknown property removed',
      (edit) => {
        delete edit.description;
      },
      'preservation_not_proven',
    ],
    [
      'unknown missing vs null',
      (edit) => {
        delete edit.title_problem;
      },
      'preservation_not_proven',
    ],
    [
      'new unknown property',
      (edit) => {
        edit.server_added = null;
      },
      'preservation_not_proven',
    ],
    [
      'raw URL expiry',
      (edit) => {
        (edit.thumb_url_list as { main_url: string }[])[0]!.main_url =
          'https://example.invalid/one?Expires=999';
      },
      'preservation_not_proven',
    ],
    [
      'unknown timestamp',
      (edit) => {
        (edit.unknown_metadata as { timestamp: string }).timestamp = 'different';
      },
      'preservation_not_proven',
    ],
    [
      'sign raw type',
      (edit) => {
        edit.sign_type = '1';
      },
      'preservation_not_proven',
    ],
    [
      'activity raw type',
      (edit) => {
        edit.origin_activity_flag = '0';
      },
      'preservation_not_proven',
    ],
    [
      'published state',
      (edit) => {
        edit.publish_status = 1;
      },
      'state_not_draft',
    ],
    [
      'unknown state',
      (edit) => {
        edit.publish_status = '0';
      },
      'state_not_draft',
    ],
    [
      'response ID becomes sentinel',
      (edit) => {
        edit.item_id = '0';
      },
      'preservation_not_proven',
    ],
  ];
  for (const [name, mutate, reason] of cases)
    await t.test(name, () => {
      const after = afterEdit(before, (edit) => {
        baseline(edit);
        mutate(edit);
      });
      const comparison = compareNativeShortMetadataReadback(plan.expectation, after);
      assert.equal(comparison.matches, false);
      assert.equal(comparison.reason, reason);
      assert.equal(JSON.stringify(comparison).includes(html), false);
      assert.equal(JSON.stringify(comparison).includes('synthetic/portrait'), false);
    });
});

test('readback checks complete catalog and typed account/target binding', () => {
  const before = snapshot(),
    plan = planNativeShortMetadataUpdate(before, request(before));
  const input = raw();
  input.editData.multi_title = ['新合成标题', '', '副标题&+%', '第三标题'];
  input.categoryData.unknown_catalog = { revision: 2 };
  assert.equal(
    compareNativeShortMetadataReadback(plan.expectation, createNativeShortMetadataSnapshot(input))
      .reason,
    'catalog_changed',
  );
  const otherAccount = raw();
  otherAccount.binding.account.id = '1002';
  assert.equal(
    compareNativeShortMetadataReadback(
      plan.expectation,
      createNativeShortMetadataSnapshot(otherAccount),
    ).reason,
    'binding_changed',
  );
  const otherTarget = raw();
  otherTarget.binding.work.id = '8000000001';
  otherTarget.editData.item_id = '8000000001';
  assert.equal(
    compareNativeShortMetadataReadback(
      plan.expectation,
      createNativeShortMetadataSnapshot(otherTarget),
    ).reason,
    'binding_changed',
  );
});

test('combined plan comparison uses portable intent hashes; malformed scope or missing expectation cannot pass', () => {
  const before = snapshot(),
    plan = planNativeShortMetadataUpdate(
      before,
      request(before, { title: '新组合标题', metadata: { categories: ['r2', '11'] } }),
    );
  const after = afterEdit(before, (edit) => {
    edit.multi_title = ['新组合标题', '', '副标题&+%', '第三标题'];
    edit.category = [
      { category_id: 11, label: '主类', name: '主乙' },
      { category_id: 'r2', label: '角色', name: '角色乙' },
    ];
  });
  const portable = JSON.parse(JSON.stringify(plan.expectation));
  const comparison = compareNativeShortMetadataReadback(portable, after);
  assert.equal(comparison.matches, true);
  assert.equal(comparison.scope, NATIVE_SHORT_METADATA_SCOPE);
  assert.notEqual(comparison.actual.snapshotVersionHash, portable.sourceVersionHash);
  assert.equal(comparison.actual.preservationHash, portable.preservationHash);
  assert.equal(comparison.actual.savedFieldsHash, portable.savedFieldsHash);
  assert.equal(Object.hasOwn(comparison, 'success'), false);
  assert.equal(Object.isFrozen(comparison.actual), true);
  rejected(
    () => compareNativeShortMetadataReadback({ ...portable, scope: 'old-short-plain' }, after),
    'expectation_scope',
  );
  rejected(
    () => compareNativeShortMetadataReadback({ ...portable, preservationHash: undefined }, after),
    'json_invalid_value',
  );
  rejected(
    () =>
      compareNativeShortMetadataReadback(
        { ...portable, hashBases: { ...portable.hashBases, extra: 'unsupported' } },
        after,
      ),
    'expectation_scope',
  );
  rejected(
    () =>
      compareNativeShortMetadataReadback(
        { ...portable, requested: { title: false, categories: false } },
        after,
      ),
    'expectation_shape',
  );
  let calls = 0;
  Object.defineProperty(portable, 'preservationHash', {
    enumerable: true,
    get: () => {
      calls++;
      return plan.expectation.preservationHash;
    },
  });
  rejected(() => compareNativeShortMetadataReadback(portable, after), 'json_non_data_property');
  assert.equal(calls, 0);
});
