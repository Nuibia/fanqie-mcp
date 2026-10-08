import {
  type NativeShortBinding,
  type NativeShortMetadataSnapshot,
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
} from '../../src/platform/short-native-metadata.js';

import { createHash } from 'node:crypto';

import {
  type NativeShortCoverPreparedAsset,
  nativeShortCoverImagePolicy,
  type NativeShortCoverUploadRequest,
  type NativeShortCoverUploadIntent,
  createNativeShortCoverUploadIntent,
  NativeShortCoverError,
} from '../../src/platform/short-native-cover.js';

import assert from 'node:assert/strict';

export const target: NativeShortBinding = {
  account: { kind: 'account_id', id: '1001' },
  work: { kind: 'short', id: '7000000001' },
};

export const html = '<p data-synthetic="&amp;+%">SYNTHETIC ONLY &amp; text</p>\n<p></p>';

export const ack = {
  picUri: 'synthetic/recommended&+%=封面',
  picUrl: 'opaque-synthetic-ack-url?x=&+%=',
};

export const sha = (text: string) => createHash('sha256').update(text).digest('hex');

export function asset(fit: 'cover' | 'contain' = 'cover'): NativeShortCoverPreparedAsset {
  return {
    sourceSha256: sha('synthetic-source'),
    sourceSize: 1234,
    sourceMimeType: 'image/png',
    sourceWidth: 1200,
    sourceHeight: 900,
    preparedSha256: sha('synthetic-prepared-jpeg'),
    preparedSize: 987,
    policy: nativeShortCoverImagePolicy(fit),
  };
}

export function raw() {
  return {
    binding: structuredClone(target),
    editData: {
      item_id: target.work.id,
      publish_status: 0,
      content: html,
      multi_title: ['Synthetic primary &+%', '', 'Tail 2', '尾题'],
      thumb_uri: 'synthetic/story-head&+%',
      book_thumb_uri: 'synthetic/old-recommended',
      category: [
        { category_id: 10, label: '主类', name: '主甲', opaque: [null, false, 'exact'] },
        { category_id: 'r1', label: '角色', name: '角色甲' },
      ],
      sign_type: '1',
      origin_activity_flag: '0',
      authorize_type: 1,
      category_max_count: 2,
      thumb_url_list: [{ main_url: 'synthetic:head-url?expiry=1', keep: { nested: true } }],
      book_thumb_url_list: [{ arbitrary_static_schema_unknown: ['synthetic:old-url'] }],
      latest_version: 7,
      modify_time: '0000000123',
      unknown_metadata: {
        latest_version: 7,
        modify_time: 'other-opaque-time',
        nested: [null, false, 1, '', { keep: true }],
      },
      description: 'Synthetic preserved field',
      use_ai: 2,
      zero: 0,
      title_problem: null,
    } as Record<string, unknown>,
    categoryData: {
      category_list: [
        { category_id: 10, label: '主类', name: '主甲', extra: true },
        { category_id: 'r1', label: '角色', name: '角色甲' },
      ],
      unknown_catalog: { latest_version: 999, signed_url: 'synthetic:catalog?expiry=1' },
    } as Record<string, unknown>,
  };
}

export function snapshot(
  change?: (input: ReturnType<typeof raw>) => void,
): NativeShortMetadataSnapshot {
  const input = raw();
  change?.(input);
  return createNativeShortMetadataSnapshot(input);
}

export function request(
  before: NativeShortMetadataSnapshot,
  prepared = asset(),
): NativeShortCoverUploadRequest {
  return {
    expectedSnapshotVersionHash: before.snapshotVersionHash,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedState: 'draft',
    asset: prepared,
  };
}

export function intent(
  before: NativeShortMetadataSnapshot = snapshot(),
): NativeShortCoverUploadIntent {
  return createNativeShortCoverUploadIntent(before, request(before));
}

export function changed(
  before: NativeShortMetadataSnapshot,
  change: (edit: Record<string, unknown>, categories: Record<string, unknown>) => void,
  binding = before.binding,
) {
  const edit = structuredClone(before.editData) as Record<string, unknown>,
    categories = structuredClone(before.categoryData) as Record<string, unknown>;
  change(edit, categories);
  return createNativeShortMetadataSnapshot({ binding, editData: edit, categoryData: categories });
}

export function after(
  before: NativeShortMetadataSnapshot,
  change?: (edit: Record<string, unknown>, categories: Record<string, unknown>) => void,
) {
  return changed(before, (edit, categories) => {
    edit.book_thumb_uri = ack.picUri;
    edit.book_thumb_url_list = [
      'synthetic:derived-url-unrelated-to-ack',
      { unknown_schema: [null, false, 12] },
    ];
    edit.latest_version = 8;
    edit.modify_time = '0000000124';
    change?.(edit, categories);
  });
}

export function rejected(action: () => unknown, code?: string): void {
  assert.throws(
    action,
    (error) =>
      error instanceof NativeShortCoverError &&
      (code === undefined || error.code === code) &&
      !error.message.includes(html),
  );
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function mutable(value: unknown): Record<string, any> {
  return clone(value) as Record<string, any>;
}
