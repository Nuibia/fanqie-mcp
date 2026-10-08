import { createHash } from 'node:crypto';

import { createNativeShortMetadataSnapshot } from '../../src/platform/short-native-metadata.js';

import assert from 'node:assert/strict';

import { loadConfig } from '../../src/config.js';

import { DatabaseSync } from 'node:sqlite';

import path from 'node:path';

import { readFileSync } from 'node:fs';

import { nativeShortCoverImagePolicy } from '../../src/platform/short-native-cover.js';

import { type NativeShortMetadataApiResult } from '../../src/platform/short-native-metadata-api.js';

// Every account, image, client and platform response in this suite is synthetic.
// No fixture result may promote live capability or settle a live unknown write.
export const WORK = '7000000001',
  ACCOUNT = '900100190010019001001';

export const UPLOAD =
  'https://fanqienovel.com/api/author/data/upload_pic_v1/v0?aid=2503&aid=2503&app_name=muye_novel';

const PRIVATE = [
  'PRIVATE_HTML',
  'PRIVATE_TAIL',
  'PRIVATE_HEAD_URI',
  'PRIVATE_OLD_URI',
  'PRIVATE_NEW_URI',
  'PRIVATE_PIC_URL',
  'PRIVATE_UNKNOWN',
  'PRIVATE_UPLOAD_PATH',
  ACCOUNT,
];

export const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');

function jpeg() {
  const segment = (marker: number, bytes: Buffer) => {
    const prefix = Buffer.from([255, marker, 0, 0]);
    prefix.writeUInt16BE(bytes.length + 2, 2);
    return Buffer.concat([prefix, bytes]);
  };
  const counts = Buffer.alloc(16);
  counts[0] = 1;
  return Buffer.concat([
    Buffer.from([255, 216]),
    segment(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])),
    segment(0xc0, Buffer.from([8, 3, 32, 2, 88, 1, 1, 0x11, 0])),
    segment(0xc4, Buffer.concat([Buffer.from([0]), counts, Buffer.from([0])])),
    segment(0xc4, Buffer.concat([Buffer.from([0x10]), counts, Buffer.from([0])])),
    segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    Buffer.alloc(1875),
    Buffer.from([255, 217]),
  ]);
}

export const JPEG = jpeg();

export function edit() {
  return {
    item_id: WORK,
    publish_status: 0,
    multi_title: ['Synthetic title', 'PRIVATE_TAIL'],
    content: '<p>PRIVATE_HTML</p><div data-fanqie-type="pay_tag"></div>',
    thumb_uri: 'PRIVATE_HEAD_URI',
    book_thumb_uri: 'PRIVATE_OLD_URI',
    thumb_url_list: [{ main_url: 'https://example.invalid/PRIVATE_HEAD_URI' }],
    book_thumb_url_list: [{ opaque: 'PRIVATE_OLD_URI' }],
    category: [{ category_id: 'c1', label: '主类', name: '合成' }],
    category_max_count: 8,
    sign_type: 1,
    origin_activity_flag: 0,
    authorize_type: 0,
    latest_version: 7,
    modify_time: '1789450000',
    opaque: { values: [null, true, 'PRIVATE_UNKNOWN'] },
  };
}

export const catalog = () => ({
  category_list: [{ category_id: 'c1', label: '主类', name: '合成' }],
  opaque_catalog: 'PRIVATE_UNKNOWN',
});

const binding = {
  account: { kind: 'account_id' as const, id: ACCOUNT },
  work: { kind: 'short' as const, id: WORK },
};

export function snapshot(value: unknown = edit()) {
  return createNativeShortMetadataSnapshot({ binding, editData: value, categoryData: catalog() });
}

export function afterEdit() {
  return {
    ...edit(),
    book_thumb_uri: 'PRIVATE_NEW_URI',
    book_thumb_url_list: [{ opaque: 'PRIVATE_NEW_URI' }],
    latest_version: 8,
    modify_time: '1789450001',
  };
}

export function noPrivate(output: unknown) {
  const text = JSON.stringify(output);
  for (const marker of PRIVATE)
    assert.equal(text.includes(marker), false, `private marker leaked: ${marker}`);
}

export function privateAfter(
  config: ReturnType<typeof loadConfig>,
  jobId: string,
): Record<string, any> {
  const db = new DatabaseSync(path.join(config.dataDir, 'operations.sqlite'));
  try {
    const rows = db
      .prepare('SELECT path FROM evidence WHERE job_id=? AND dataset=?')
      .all(jobId, 'short_native_cover_after');
    assert.equal(
      rows.length,
      1,
      'the owned partial observation must be durable before unknown settlement',
    );
    return JSON.parse(
      readFileSync(path.join(config.dataDir, 'evidence', String(rows[0]!.path)), 'utf8'),
    ).payload;
  } finally {
    db.close();
  }
}

export function asset() {
  return {
    sourceSha256: digest(JPEG),
    sourceSize: JPEG.length,
    sourceMimeType: 'image/jpeg' as const,
    sourceWidth: 600,
    sourceHeight: 800,
    preparedSha256: digest(JPEG),
    preparedSize: JPEG.length,
    policy: nativeShortCoverImagePolicy(),
  };
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

export type Mode = 'success' | 'upload-ack-lost' | 'save-ack-lost' | 'pre-save-drift';
