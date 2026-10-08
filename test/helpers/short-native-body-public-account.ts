import { createNativeShortMetadataSnapshot } from '../../src/platform/short-native-metadata.js';

import { type BrowserContext } from 'playwright';

// All inputs and transport responses here are fixed synthetic data. Body writes
// inherit the production Browser lifecycle; no runtime runner or issuer is mocked.
export const ACCOUNT = '900100190010019001001',
  OWNER = 'body-public-fixture-owner',
  WORK = '7000000001';

export const SOURCE = '<p>PRIVATE_BODY甲</p><p>PRIVATE_TAIL乙</p><p></p>';

export const DESIRED = '<p>PRIVATE_BODY修改</p><p>PRIVATE_TAIL乙</p><p></p>';

export const TOKEN = 'synthetic-body-public-protocol-token';

// Crash recovery still waits for the real App lease (operation budget + 30 seconds).
export const CRASH_OPERATION_TIMEOUT_MS = 10_000;

export const edit = (content = SOURCE): Record<string, unknown> => ({
  item_id: WORK,
  publish_status: 0,
  content,
  multi_title: ['Synthetic title', 'PRIVATE_TITLE'],
  thumb_uri: 'PRIVATE_HEAD_URI',
  book_thumb_uri: 'PRIVATE_COVER_URI',
  category: [],
  sign_type: 1,
  origin_activity_flag: 0,
  latest_version: 7,
  modify_time: '1789450000',
  opaque: { keep: [null, true, 'PRIVATE_OPAQUE'] },
});

export const catalog = () => ({
  category_list: [{ category_id: 'c1', label: 'Synthetic', name: 'Fixture' }],
  opaque_catalog: 'PRIVATE_CATALOG',
});

export const native = (data: Record<string, unknown>) =>
  createNativeShortMetadataSnapshot({
    binding: { account: { kind: 'account_id', id: ACCOUNT }, work: { kind: 'short', id: WORK } },
    editData: data,
    categoryData: catalog(),
  });

type FixtureMode =
  | 'success'
  | 'ack-lost'
  | 'ack-contradiction'
  | 'pre-save-drift'
  | 'version-drift'
  | 'owner-drift'
  | 'lease-drift'
  | 'cancel'
  | 'death-attempt'
  | 'death-ack';

export interface FixtureOptions {
  dir?: string;
  owner?: string;
  writes?: boolean;
  withFactory?: boolean;
  mode?: FixtureMode;
  source?: string;
  expectedHtml?: string;
  keep?: boolean;
  derivedCount?: boolean;
  timeoutMs?: number;
}

export interface BrowserInternals {
  context: BrowserContext | null;
  page: unknown;
  identityEpoch: number;
}
