import {
  type NativeShortBinding,
  type NativeShortMetadataSnapshot,
  createNativeShortMetadataSnapshot,
  type NativeShortMetadataRequest,
  NATIVE_SHORT_HASH_BASES,
  NativeShortMetadataError,
} from '../../src/platform/short-native-metadata.js';

import assert from 'node:assert/strict';

export const binding: NativeShortBinding = {
  account: { kind: 'account_id', id: '1001' },
  work: { kind: 'short', id: '7000000001' },
};

export const html =
  '<section style="color:red" data-x="a&amp;b"><p>合成 &amp; + %</p><pay_tag data-ratio="40"></pay_tag><img src="synthetic://image" alt="图"/><p></p></section>';

export function raw() {
  return {
    binding: {
      account: { kind: 'account_id' as const, id: binding.account.id },
      work: { kind: 'short' as const, id: binding.work.id },
    },
    editData: {
      item_id: '7000000001',
      publish_status: 0,
      content: html,
      multi_title: ['原主标题', '', '副标题&+%', '第三标题'],
      thumb_uri: 'synthetic/portrait&+%',
      book_thumb_uri: 'synthetic/book-cover',
      category: [
        { category_id: 10, label: '主类', name: '主甲', legacy: ['keep'] },
        { category_id: 'r1', label: '角色', name: '角色甲' },
      ],
      sign_type: 1,
      origin_activity_flag: 0,
      authorize_type: 0,
      category_max_count: 4,
      thumb_url_list: [{ main_url: 'https://example.invalid/one?Expires=123', extra: null }],
      book_thumb_url_list: [{ main_url: 'https://example.invalid/two?Expires=456' }],
      unknown_metadata: {
        nested: [null, false, 3, '', { preserve: true }],
        timestamp: 'synthetic-time',
      },
      description: '合成未请求字段',
      use_ai: 2,
      title_problem: null,
    } as Record<string, unknown>,
    categoryData: {
      category_list: [
        { category_id: 10, label: '主类', name: '主甲', source: { a: 1 } },
        { category_id: 11, label: '主类', name: '主乙' },
        { category_id: 'r1', label: '角色', name: '角色甲' },
        { category_id: 'r2', label: '角色', name: '角色乙' },
        { category_id: 30, label: '主题', name: '主题甲' },
      ],
      unknown_catalog: { revision: 1, URLs: ['https://example.invalid/catalog?a=1'] },
    } as Record<string, unknown>,
  };
}

export function snapshot(
  mutate?: (input: ReturnType<typeof raw>) => void,
): NativeShortMetadataSnapshot {
  const input = raw();
  mutate?.(input);
  return createNativeShortMetadataSnapshot(input);
}

export function request(
  before: NativeShortMetadataSnapshot,
  patch: Record<string, unknown> = { title: '新合成标题' },
): NativeShortMetadataRequest {
  return {
    expectedSnapshotVersionHash: before.snapshotVersionHash,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedState: 'draft',
    ...patch,
  } as NativeShortMetadataRequest;
}

export function rejected(action: () => unknown, code?: string): void {
  assert.throws(
    action,
    (error) => error instanceof NativeShortMetadataError && (!code || error.code === code),
  );
}

export function afterEdit(
  before: NativeShortMetadataSnapshot,
  mutate: (edit: Record<string, unknown>) => void,
) {
  const edit = structuredClone(before.editData) as Record<string, unknown>;
  mutate(edit);
  return createNativeShortMetadataSnapshot({
    binding: before.binding,
    editData: edit,
    categoryData: before.categoryData,
  });
}
