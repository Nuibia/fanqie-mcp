import { createNativeShortMetadataSnapshot } from '../../src/platform/short-native-metadata.js';

import assert from 'node:assert/strict';

import { type NativeShortMetadataApiResult } from '../../src/platform/short-native-metadata-api.js';

// All accounts, HTML and transport responses here are synthetic. No browser or
// platform is contacted, and createApplication must keep injected data fixture.
export const WORK = '7000000001',
  ACCOUNT = '900100190010019001001';

export const PRIVATE = [
  'PRIVATE_BODY',
  'PRIVATE_TAIL',
  'PRIVATE_HEAD_URI',
  'PRIVATE_COVER_URI',
  'PRIVATE_OPAQUE',
  ACCOUNT,
];

export function edit() {
  return {
    item_id: WORK,
    publish_status: 0,
    multi_title: ['Synthetic title', 'PRIVATE_TAIL'],
    content: ['甲', '乙', '丙', '丁', '戊', '己']
      .map((char) => `<p>${char.repeat(110)}PRIVATE_BODY</p>`)
      .join(''),
    thumb_uri: 'PRIVATE_HEAD_URI',
    book_thumb_uri: 'PRIVATE_COVER_URI',
    category: [{ category_id: 'c1', label: '主类', name: '合成' }],
    category_max_count: 8,
    sign_type: 1,
    origin_activity_flag: 0,
    authorize_type: 0,
    latest_version: 7,
    modify_time: '1789450000',
    opaque: { values: [null, true, 'PRIVATE_OPAQUE'] },
  };
}

export const catalog = () => ({
  category_list: [{ category_id: 'c1', label: '主类', name: '合成' }],
  opaque_catalog: 'PRIVATE_OPAQUE',
});

const binding = {
  account: { kind: 'account_id' as const, id: ACCOUNT },
  work: { kind: 'short' as const, id: WORK },
};

export function snapshot(value: unknown = edit()) {
  return createNativeShortMetadataSnapshot({ binding, editData: value, categoryData: catalog() });
}

export function noPrivate(output: unknown) {
  const text = JSON.stringify(output);
  for (const marker of PRIVATE)
    assert.equal(text.includes(marker), false, `private marker leaked: ${marker}`);
}

export function readResult(value: unknown): NativeShortMetadataApiResult {
  const at = new Date().toISOString();
  return {
    schema: 'native-short-metadata-api-read/v1',
    status: 'success',
    reason: null,
    snapshot: snapshot(value),
    proof: {
      platformStarted: true,
      ownerBefore: true,
      ownerAfter: true,
      ownerCallback: true,
      fixedSourceVerified: true,
      targetUnique: true,
      paginationComplete: true,
      atomicRevision: false,
      readStartedAt: at,
      readFinishedAt: at,
      proofCapturedAt: at,
    },
    requests: {
      own: { attempts: 2, disposed: 2 },
      list: { attempts: 1, disposed: 1 },
      edit: { attempts: 1, disposed: 1 },
      catalog: { attempts: 1, disposed: 1 },
    },
    list: { pagesRead: 1, rowsRead: 1, totalCount: 1 },
    cleanup: {
      sessionCreated: true,
      sessionDisposed: true,
      pendingAtEnd: 0,
      disposalFailures: 0,
      quarantined: false,
      checkedAt: at,
    },
  };
}

export type Mode = 'success' | 'ack-lost' | 'pre-save-drift' | 'cleanup-fails';
