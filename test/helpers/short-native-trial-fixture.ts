import {
  type NativeShortBinding,
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
} from '../../src/platform/short-native-metadata.js';

import {
  type NativeShortTrialSnapshot,
  createNativeShortTrialSnapshot,
  type NativeShortTrialAction,
  type NativeShortTrialWriteRequest,
  NativeShortTrialError,
} from '../../src/platform/short-native-trial.js';

import assert from 'node:assert/strict';

export const binding: NativeShortBinding = {
  account: { kind: 'account_id', id: '0001001' },
  work: { kind: 'short', id: '7000000001' },
};

export const HTML = `<p>${'甲'.repeat(90)}</p><p></p><p>${'乙'.repeat(60)}</p><p>${'丙'.repeat(150)}</p>`;

export function fixture(content = HTML) {
  return {
    binding,
    editData: {
      item_id: binding.work.id,
      publish_status: 0,
      content,
      multi_title: ['合成主标题&+%', '', '保全尾标题'],
      thumb_uri: 'fixture/portrait&+%',
      book_thumb_uri: 'fixture/book',
      thumb_url_list: [{ opaque: 'fixture/portrait-derived' }],
      book_thumb_url_list: [{ opaque: 'fixture/book-derived' }],
      category: [{ category_id: 'c1', label: '主类', name: '都市', extra: 'preserve' }],
      sign_type: 1,
      origin_activity_flag: 0,
      category_max_count: 8,
      authorize_type: 0,
      latest_version: 7,
      modify_time: '1789450000',
      unknown: { preserve: [null, false, 2, 'value&+%'] },
      description: '未请求字段',
      use_ai: 2,
    } as Record<string, unknown>,
    categoryData: {
      category_list: [{ category_id: 'c1', label: '主类', name: '都市' }],
      unknown: { keep: true },
    } as Record<string, unknown>,
  };
}

export function snapshot(
  content = HTML,
  mutate?: (raw: ReturnType<typeof fixture>) => void,
): NativeShortTrialSnapshot {
  const raw = fixture(content);
  mutate?.(raw);
  return createNativeShortTrialSnapshot(createNativeShortMetadataSnapshot(raw));
}

export function request(
  before: NativeShortTrialSnapshot,
  trial: NativeShortTrialAction = { action: 'set', beforeParagraph: 3 },
): NativeShortTrialWriteRequest {
  return {
    expectedSnapshotVersionHash: before.snapshotVersionHash,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedState: 'draft',
    metadata: { trial },
  };
}

export function after(
  before: NativeShortTrialSnapshot,
  content: string,
  mutate?: (raw: ReturnType<typeof fixture>) => void,
) {
  const raw = {
    binding: before.binding,
    editData: structuredClone(before.native.editData) as Record<string, unknown>,
    categoryData: structuredClone(before.native.categoryData) as Record<string, unknown>,
  };
  raw.editData.content = content;
  raw.editData.latest_version = (before.native.editData.latest_version as number) + 1;
  raw.editData.modify_time = '1789450001';
  mutate?.(raw);
  return createNativeShortTrialSnapshot(createNativeShortMetadataSnapshot(raw));
}

export function rejected(callback: () => unknown, code?: string) {
  assert.throws(
    callback,
    (error) => error instanceof NativeShortTrialError && (!code || error.code === code),
  );
}
