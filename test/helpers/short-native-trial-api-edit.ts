import { createNativeShortTrialSnapshot } from '../../src/platform/short-native-trial.js';

import {
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
} from '../../src/platform/short-native-metadata.js';

import {
  type NativeShortTrialReceiptStage,
  type NativeShortTrialReceiptFields,
  type NativeShortTrialReceipt,
} from '../../src/platform/short-native-trial-api.js';

export const WORK = '7000000001',
  ACCOUNT = '0001001';

export const HTML = `<p>${'甲'.repeat(90)}</p><p></p><p>${'乙'.repeat(60)}</p><p>${'丙'.repeat(150)}</p>`;

export function edit() {
  return {
    item_id: WORK,
    publish_status: 0,
    content: HTML,
    multi_title: ['合成主标题&+%', '', '保全尾标题'],
    thumb_uri: 'fixture/head&+%',
    book_thumb_uri: 'fixture/book',
    category: [{ category_id: 'c1', label: '主类', name: '都市' }],
    thumb_url_list: [{ opaque: 'fixture/head-derived' }],
    book_thumb_url_list: [{ opaque: 'fixture/book-derived' }],
    sign_type: 1,
    origin_activity_flag: 0,
    latest_version: 7,
    modify_time: '1789450000',
    unknown: { keep: [null, true, 'value&+%'] },
  };
}

export function catalog() {
  return {
    category_list: [{ category_id: 'c1', label: '主类', name: '都市' }],
    unknown: { keep: true },
  };
}

export function before() {
  return createNativeShortTrialSnapshot(
    createNativeShortMetadataSnapshot({
      binding: { account: { kind: 'account_id', id: ACCOUNT }, work: { kind: 'short', id: WORK } },
      editData: edit(),
      categoryData: catalog(),
    }),
  );
}

export function business() {
  return {
    expectedSnapshotVersionHash: before().snapshotVersionHash,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedState: 'draft' as const,
    metadata: { trial: { action: 'set' as const, beforeParagraph: 3 } },
  };
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

export type ReceiptTransform = (
  stage: NativeShortTrialReceiptStage,
  fields: NativeShortTrialReceiptFields,
  confirm: (fields: NativeShortTrialReceiptFields) => NativeShortTrialReceipt,
) => NativeShortTrialReceipt;

export interface Faults {
  read?: boolean;
  drift?: boolean;
  ownerChanged?: boolean;
  duplicateList?: boolean;
  acknowledgementLost?: boolean;
  mismatch?: boolean;
  afterFault?: boolean;
  redirectGet?: boolean;
  responseFault?: 'url' | 'code' | 'utf8' | 'redirect' | 'content-type';
  failDispose?: 'response' | 'api';
  hold?: 'creation' | 'post' | 'dispose';
  transform?: ReceiptTransform;
  ackData?: Record<string, unknown>;
  ackEnvelope?: Record<string, unknown>;
  baselineFails?: boolean;
  lease?: () => void;
  onVerified?: () => void;
  nonDraftRead?: 1 | 2 | 3;
}
