import {
  type NativeShortBodyWriteRequest,
  NATIVE_SHORT_BODY_REPRESENTATION,
} from '../../src/platform/short-native-body.js';

import {
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
} from '../../src/platform/short-native-metadata.js';

import { type NativeShortBodyApiOptions } from '../../src/platform/short-native-body-api.js';

export const WORK = '7000000001',
  ACCOUNT = '0001001';

export const A = '甲'.repeat(90),
  B = '乙'.repeat(60),
  C = '丙'.repeat(150),
  CHANGED = '丁'.repeat(90);

const MARKER =
  '<div data-percentage="0.3" data-fanqie-type="pay_tag" data-min-text="200" data-min-paragraphs="3" data-min-radio="0.3" data-para-nums="3" class="fq-pay-node-animation"></div>';

export const PLAIN = `<p>${A}</p><p>${B}</p><p>${C}</p><p></p>`;

export const MARKED = `<p>${A}</p>${MARKER}<p>${B}</p><p>${C}</p><p></p>`;

export const SET = MARKED,
  PRESERVED = `<p>${CHANGED}</p>${MARKER}<p>${B}</p><p>${C}</p><p></p>`;

export function edit(content = PLAIN) {
  return {
    item_id: WORK,
    publish_status: 0,
    content,
    multi_title: ['Synthetic title', '', 'Synthetic tail'],
    thumb_uri: 'fixture/head&+%',
    book_thumb_uri: 'fixture/cover',
    thumb_url_list: [{ unknown: 'derived-head' }],
    book_thumb_url_list: [{ unknown: 'derived-cover' }],
    category: [{ category_id: 'c1', label: '主类', name: '都市' }],
    sign_type: 1,
    origin_activity_flag: 0,
    latest_version: 7,
    modify_time: '1789450000',
    unknown: { keep: [null, true, { deeper: 'untouched' }] },
  };
}

export function catalog() {
  return {
    category_list: [{ category_id: 'c1', label: '主类', name: '都市' }],
    unknown_catalog: { keep: true },
  };
}

export function business(
  source = PLAIN,
  trial: NativeShortBodyWriteRequest['trial'] = { action: 'set', beforeParagraph: 1 },
  first = A,
): NativeShortBodyWriteRequest {
  // Before hash comes from the protected old native factory. Desired wire is an independent literal.
  const before = createNativeShortMetadataSnapshot({
    binding: { account: { kind: 'account_id', id: ACCOUNT }, work: { kind: 'short', id: WORK } },
    editData: edit(source),
    categoryData: catalog(),
  });
  return {
    expectedSnapshotVersionHash: before.snapshotVersionHash,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedState: 'draft',
    representation: NATIVE_SHORT_BODY_REPRESENTATION,
    paragraphs: [
      { sourceIndex: 0, lines: [first] },
      { sourceIndex: 1, lines: [B] },
      { sourceIndex: 2, lines: [C] },
    ],
    trial,
  };
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

export interface Faults {
  source?: string;
  desired?: string;
  request?: NativeShortBodyWriteRequest;
  drift?: 'unknown' | 'cover' | 'revision' | 'title' | 'catalog';
  owner?: string;
  duplicate?: boolean;
  total?: number;
  lostAck?: boolean;
  ack?: Record<string, unknown>;
  ackData?: unknown;
  response?: 'url' | 'mime' | 'status' | 'utf8' | 'json' | 'code' | 'bytes' | 'depth' | 'nodes';
  afterFail?: boolean;
  afterContent?: string;
  dispose?: 'api' | 'response';
  hold?: 'cookies' | 'creation' | 'post' | 'dispose';
  onStage?: NativeShortBodyApiOptions['onStage'];
  lease?: () => void;
  deadlineMs?: number;
}
