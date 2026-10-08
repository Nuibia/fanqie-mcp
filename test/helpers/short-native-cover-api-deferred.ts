import { createHash, randomUUID } from 'node:crypto';

import {
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
  nativeShortMetadataEndpoints,
} from '../../src/platform/short-native-metadata.js';

import {
  nativeShortCoverImagePolicy,
  NATIVE_SHORT_COVER_SCOPE,
  NATIVE_SHORT_COVER_HASH_BASES,
} from '../../src/platform/short-native-cover.js';

import {
  type NativeShortCoverReceiptFields,
  type NativeShortCoverReceipt,
  type NativeShortCoverHeldIntent,
  type NativeShortCoverAcknowledgement,
} from '../../src/platform/short-native-cover-api.js';

import { type APIRequest } from 'playwright';

import { prepareNativeShortCoverImage } from '../../src/platform/short-native-cover-image.js';

export const WORK = '1234567890123456789',
  ACCOUNT = '0001001';

export const UPLOAD =
  'https://fanqienovel.com/api/author/data/upload_pic_v1/v0?aid=2503&aid=2503&app_name=muye_novel';

export const URI = 'synthetic/recommended&+%',
  PIC_URL = 'https://opaque.example.invalid/image?x=+&y=%';

export const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

// Complete baseline grayscale JPEG: each block contains DC=0/AC=EOB under
// one-symbol Huffman tables. This is a synthetic 600x800 RAM fixture, not a cover
// preparation oracle (the separate image suite supplies real decoder evidence).
function syntheticJpeg() {
  const segment = (marker: number, data: Buffer) => {
    const prefix = Buffer.from([255, marker, 0, 0]);
    prefix.writeUInt16BE(data.length + 2, 2);
    return Buffer.concat([prefix, data]);
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

export const JPEG = syntheticJpeg();

export const edit = () => ({
  item_id: WORK,
  publish_status: 0,
  multi_title: ['标题 &+% 中文', '保留尾标题'],
  content:
    '<p style="color:red">合成 &amp; + % <strong>HTML</strong></p><pay_tag ratio="40"></pay_tag>',
  thumb_uri: 'synthetic/head&+%',
  book_thumb_uri: 'synthetic/old-cover',
  book_thumb_url_list: ['synthetic/old-url'],
  thumb_url_list: [{ main_url: 'synthetic/head-url' }],
  category: [{ category_id: 'c1', label: '主类', name: '都市' }],
  sign_type: 1,
  origin_activity_flag: 0,
  authorize_type: 0,
  category_max_count: 8,
  latest_version: 7,
  modify_time: '1789450000',
  unknown: { keep: [null, true, 'value&+%'], omittedIsDifferent: false },
});

export const catalog = () => ({
  category_list: [{ category_id: 'c1', label: '主类', name: '都市' }],
  unknown_catalog: { preserved: true },
});

export function beforeSnapshot() {
  return createNativeShortMetadataSnapshot({
    binding: { account: { kind: 'account_id', id: ACCOUNT }, work: { kind: 'short', id: WORK } },
    editData: edit(),
    categoryData: catalog(),
  });
}

export function afterEdit() {
  return {
    ...edit(),
    book_thumb_uri: URI,
    book_thumb_url_list: [{ opaque: 'synthetic/derived-url' }],
    latest_version: 8,
    modify_time: '1789450001',
  };
}

export function business() {
  return {
    expectedSnapshotVersionHash: beforeSnapshot().snapshotVersionHash,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedState: 'draft' as const,
    cover: { uploadPath: `${randomUUID()}.jpg`, sha256: digest(JPEG) },
  };
}

export function asset(bytes = JPEG) {
  return {
    sourceSha256: digest(JPEG),
    sourceSize: JPEG.length,
    sourceMimeType: 'image/jpeg' as const,
    sourceWidth: 600,
    sourceHeight: 800,
    preparedSha256: digest(bytes),
    preparedSize: bytes.length,
    policy: nativeShortCoverImagePolicy(),
  };
}

export type Stage =
  | 'upload:intent'
  | 'upload:attempt'
  | 'upload:acknowledgement'
  | 'save:intent'
  | 'save:attempt'
  | 'save:acknowledgement';

export function receiptCallbacks(
  events: string[],
  transform?: (
    key: Stage,
    fields: NativeShortCoverReceiptFields,
    confirm: (fields: NativeShortCoverReceiptFields) => NativeShortCoverReceipt,
  ) => NativeShortCoverReceipt,
) {
  const jobId = randomUUID(),
    baseline = { id: randomUUID(), sha256: 'b'.repeat(64), capturedAt: '' };
  const receipts: NativeShortCoverReceipt[] = [],
    held = new Map<string, NativeShortCoverHeldIntent>();
  function build(
    source: NativeShortCoverHeldIntent | NativeShortCoverReceipt | NativeShortCoverAcknowledgement,
    stage: NativeShortCoverReceiptFields['stage'],
  ): NativeShortCoverReceiptFields {
    const phase = source.phase,
      h = held.get(phase)!;
    const intent = h.uploadIntent,
      observation = 'acknowledgedAt' in source ? source : null;
    const eventAt =
      stage === 'intent'
        ? h.checkedAt
        : stage === 'acknowledgement'
          ? observation!.acknowledgedAt
          : new Date().toISOString();
    const capturedAt = new Date().toISOString();
    if (!baseline.capturedAt) baseline.capturedAt = capturedAt;
    return {
      phase,
      stage,
      accountId: 'synthetic-local-service',
      jobId,
      target: { kind: 'short-story', id: WORK },
      binding: intent.binding,
      scope: NATIVE_SHORT_COVER_SCOPE,
      hashBases: NATIVE_SHORT_COVER_HASH_BASES,
      baseline: { ...baseline },
      evidence: { id: randomUUID(), sha256: 'e'.repeat(64), capturedAt },
      sourceVersionHash: intent.sourceVersionHash,
      assetHash: intent.assetHash,
      intentHash: intent.intentHash,
      uploadAckHash: observation?.uploadAckHash ?? h.expectation?.uploadAckHash ?? null,
      preSaveVersionHash: phase === 'save' ? h.snapshot.snapshotVersionHash : null,
      desiredContentHash: observation?.desiredContentHash ?? h.desiredContentHash,
      ordinal: stage === 'attempt' ? 1 : null,
      transport:
        stage === 'attempt'
          ? {
              schema:
                phase === 'upload'
                  ? 'native-short-cover-upload-transport/v1'
                  : 'native-short-cover-save-transport/v1',
              provenance: 'static-unobserved',
              method: 'POST',
              url: phase === 'upload' ? UPLOAD : nativeShortMetadataEndpoints(WORK).save,
              encoding:
                phase === 'upload'
                  ? 'multipart-file-temp-image-jpeg'
                  : 'application/x-www-form-urlencoded;charset=UTF-8',
            }
          : null,
      eventAt,
    };
  }
  function invoke(
    source: NativeShortCoverHeldIntent | NativeShortCoverReceipt | NativeShortCoverAcknowledgement,
    stage: NativeShortCoverReceiptFields['stage'],
    confirm: (fields: NativeShortCoverReceiptFields) => NativeShortCoverReceipt,
  ) {
    const key = `${source.phase}:${stage}` as Stage;
    events.push(key);
    const fields = build(source, stage),
      receipt = transform ? transform(key, fields, confirm) : confirm(fields);
    receipts.push(receipt);
    return receipt;
  }
  return {
    receipts,
    held,
    onDurableIntent(
      value: NativeShortCoverHeldIntent,
      confirm: (fields: NativeShortCoverReceiptFields) => NativeShortCoverReceipt,
    ) {
      held.set(value.phase, value);
      return invoke(value, 'intent', confirm);
    },
    onBeforePlatformWrite(
      value: NativeShortCoverReceipt,
      confirm: (fields: NativeShortCoverReceiptFields) => NativeShortCoverReceipt,
    ) {
      return invoke(value, 'attempt', confirm);
    },
    onDurableAcknowledgement(
      value: NativeShortCoverAcknowledgement,
      confirm: (fields: NativeShortCoverReceiptFields) => NativeShortCoverReceipt,
    ) {
      return invoke(value, 'acknowledgement', confirm);
    },
  };
}

export interface Overrides {
  drift?: boolean;
  ownerChanged?: boolean;
  loseAck?: 'upload' | 'save';
  responseFault?: 'url' | 'code' | 'utf8' | 'uri';
  hold?: 'image' | 'creation' | 'upload' | 'dispose';
  failDispose?: 'response' | 'api' | 'image';
  transform?: Parameters<typeof receiptCallbacks>[1];
  onVerified?: () => void;
  lease?: () => void;
  factory?: Pick<APIRequest, 'newContext'>;
  prepared?: Awaited<ReturnType<typeof prepareNativeShortCoverImage>>;
  nonDraftRead?: 1 | 2 | 3;
}
