import test from 'node:test';

import { v2Snapshot, v2After } from './helpers/short-native-metadata-assert-literal.js';

import {
  planNativeShortMetadataUpdateV2,
  compareNativeShortMetadataReadbackV2,
  NATIVE_SHORT_HASH_BASES,
  compareNativeShortMetadataReadbackVersioned,
  type NativeShortMetadataExpectationV2,
  nativeShortMetadataDesiredContentHash,
} from '../src/platform/short-native-metadata.js';

import { request, rejected } from './helpers/short-native-metadata-raw.js';

import assert from 'node:assert/strict';

for (const [name, change] of [
  [
    'zero delta',
    (edit: Record<string, unknown>) => {
      edit.latest_version = 7;
    },
  ],
  [
    'double delta',
    (edit: Record<string, unknown>) => {
      edit.latest_version = 9;
    },
  ],
  [
    'decreased revision',
    (edit: Record<string, unknown>) => {
      edit.latest_version = 6;
    },
  ],
  [
    'missing revision',
    (edit: Record<string, unknown>) => {
      delete edit.latest_version;
    },
  ],
  [
    'missing token',
    (edit: Record<string, unknown>) => {
      delete edit.modify_time;
    },
  ],
  [
    'string revision',
    (edit: Record<string, unknown>) => {
      edit.latest_version = '8';
    },
  ],
  [
    'fraction revision',
    (edit: Record<string, unknown>) => {
      edit.latest_version = 8.5;
    },
  ],
  [
    'unsafe revision',
    (edit: Record<string, unknown>) => {
      edit.latest_version = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    'decreased token',
    (edit: Record<string, unknown>) => {
      edit.modify_time = '0000000122';
    },
  ],
  [
    'invalid token',
    (edit: Record<string, unknown>) => {
      edit.modify_time = '000000012x';
    },
  ],
  [
    'trailing newline token',
    (edit: Record<string, unknown>) => {
      edit.modify_time = '0000000123\n';
    },
  ],
] as const)
  test(`v2 ${name} after cannot match its valid frozen before`, () => {
    const before = v2Snapshot(),
      plan = planNativeShortMetadataUpdateV2(before, request(before)),
      after = v2After(before, '新合成标题', change);
    const compared = compareNativeShortMetadataReadbackV2(plan.expectation, after);
    assert.equal(compared.matches, false);
    assert.equal(compared.reason, 'server_revision_not_proven');
  });

for (const [name, change] of [
  [
    'other source timestamp',
    (edit: Record<string, unknown>) => {
      (edit.unknown_metadata as Record<string, unknown>).timestamp = 'new-time';
    },
  ],
  [
    'nested revision path',
    (edit: Record<string, unknown>) => {
      (edit.unknown_metadata as Record<string, unknown>).latest_version = 8;
    },
  ],
  [
    'new unknown raw',
    (edit: Record<string, unknown>) => {
      edit.new_server_field = null;
    },
  ],
  [
    'deleted unknown raw',
    (edit: Record<string, unknown>) => {
      delete edit.description;
    },
  ],
  [
    'raw type changed',
    (edit: Record<string, unknown>) => {
      edit.use_ai = '2';
    },
  ],
  [
    'tail title changed',
    (edit: Record<string, unknown>) => {
      (edit.multi_title as string[])[1] = 'changed tail';
    },
  ],
  [
    'cover changed',
    (edit: Record<string, unknown>) => {
      edit.thumb_uri = 'another';
    },
  ],
  [
    'document changed',
    (edit: Record<string, unknown>) => {
      edit.content = '<p>other</p>';
    },
  ],
] as const)
  test(`v2 allowed server change cannot hide ${name}`, () => {
    const before = v2Snapshot(),
      plan = planNativeShortMetadataUpdateV2(before, request(before));
    assert.equal(
      compareNativeShortMetadataReadbackV2(plan.expectation, v2After(before, '新合成标题', change))
        .matches,
      false,
    );
  });

test('v2 expectation dispatch rejects mixed version bases policy extras and forged before instead of legacy fallback', () => {
  const before = v2Snapshot(),
    plan = planNativeShortMetadataUpdateV2(before, request(before)),
    after = v2After(before);
  for (const change of [
    (value: Record<string, unknown>) => {
      delete value.version;
    },
    (value: Record<string, unknown>) => {
      value.version = 1;
    },
    (value: Record<string, unknown>) => {
      value.hashBases = NATIVE_SHORT_HASH_BASES;
    },
    (value: Record<string, unknown>) => {
      value.serverRevisionPolicy = 'another';
    },
    (value: Record<string, unknown>) => {
      value.serverRevisionBefore = { latestVersion: '7', modifyTime: '0000000123' };
    },
    (value: Record<string, unknown>) => {
      value.serverRevisionBefore = { latestVersion: 7, modifyTime: '0000000123', extra: true };
    },
    (value: Record<string, unknown>) => {
      value.transport = true;
    },
  ])
    rejected(() => {
      const expected = JSON.parse(JSON.stringify(plan.expectation));
      change(expected);
      compareNativeShortMetadataReadbackVersioned(expected, after);
    });
  const changed = JSON.parse(JSON.stringify(plan.expectation)) as NativeShortMetadataExpectationV2;
  (changed.serverRevisionBefore as { latestVersion: number }).latestVersion = 6;
  assert.equal(compareNativeShortMetadataReadbackV2(changed, after).matches, false);
  assert.notEqual(
    nativeShortMetadataDesiredContentHash(changed),
    nativeShortMetadataDesiredContentHash(plan.expectation),
  );
});

test('v2 category plan retains original requested-category behavior and rejects empty clearing', () => {
  const before = v2Snapshot(),
    plan = planNativeShortMetadataUpdateV2(
      before,
      request(before, { metadata: { categories: ['30', 'r2', '10', 'r1'] } }),
    );
  const after = v2After(before, '原主标题', (edit) => {
    edit.category = [
      { category_id: 10, label: '主类', name: '主甲' },
      { category_id: 'r2', label: '角色', name: '角色乙' },
      { category_id: 'r1', label: '角色', name: '角色甲' },
      { category_id: 30, label: '主题', name: '主题甲' },
    ];
  });
  assert.equal(plan.form.category, '10,r2,r1,30');
  assert.equal(compareNativeShortMetadataReadbackV2(plan.expectation, after).matches, true);
  rejected(() =>
    planNativeShortMetadataUpdateV2(before, request(before, { metadata: { categories: [] } })),
  );
});
