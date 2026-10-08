import {
  type NativeShortBinding,
  createNativeShortMetadataSnapshot,
} from '../../src/platform/short-native-metadata.js';

import assert from 'node:assert/strict';

import { createHash } from 'node:crypto';

// Independent synthetic reference. It never calls the new body/proof implementation to make expected data.
export type Data = Record<string, unknown>;

export interface Stage {
  schema: string;
  kind: string;
  sequence: number;
  eventAt: string;
  priorStageHash: string | null;
  payload: Data;
}

export interface Trace {
  schema: string;
  scope: string;
  provenance: { mode: string; executor: string };
  accountId: string;
  workId: string;
  inputHash: string;
  stages: Stage[];
  simulatedAttemptOrdinal: number | null;
}

export const SCOPE = 'short-native-body/v1';

export const REPRESENTATION = 'native-plain-paragraph-vector/v1';

export const ACCOUNT = 'synthetic-owner-甲',
  WORK = '7000000001';

export const BINDING: NativeShortBinding = {
  account: { kind: 'account_id', id: '9001' },
  work: { kind: 'short', id: WORK },
};

export const BASES = {
  snapshot: 'full-edit-catalog-and-typed-binding/v1',
  catalog: 'full-category-data-json/v1',
  document: 'exact-html-utf8/v1',
  savedFields: 'cover-v0-reconstructible-fields/v1',
  categorySelection: 'ordered-raw-category-id-label-name/v1',
  sourceVector: 'native-short-body-source-paragraph-vector/v1',
  submittedVector: 'native-short-body-submitted-provenance-vector/v1',
  effectiveWireVector: 'native-short-body-effective-wire-vector/v1',
  body: 'native-short-body-semantic-paragraph-lf-body/v1',
  paragraphs: 'native-short-body-ordered-exact-paragraph-html-utf8/v1',
  marker: 'native-short-body-exact-pay-marker/v1',
  covers: 'native-short-body-unchanged-full-source-cover-fields/v1',
  preservation: 'native-short-body-full-source-except-content-and-exact-server-revision-fields/v1',
  invalidRevisionPreservation: 'native-short-body-unmasked-invalid-server-revision/v1',
  desired: 'native-short-body-desired-form-and-preservation/v1',
  business: 'native-short-body-account-target-business-input/v1',
};

export const TIMES = [
  '2026-10-05T00:00:00.000Z',
  '2026-10-05T00:00:00.001Z',
  '2026-10-05T00:00:00.002Z',
  '2026-10-05T00:00:00.003Z',
  '2026-10-05T00:00:00.004Z',
  '2026-10-05T00:00:00.005Z',
  '2026-10-05T00:00:00.006Z',
];

export function utf16(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    assert.ok(typeof encoded === 'string');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(utf16).join(',')}]`;
  const d = value as Data;
  return `{${Object.keys(d)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${utf16(d[key])}`)
    .join(',')}}`;
}

export const sha = (value: unknown): string =>
  createHash('sha256').update(utf16(value), 'utf8').digest('hex');

export const bytesHash = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function data(value: unknown): Data {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Data;
}

export function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error('Synthetic literal index missing');
  return value;
}

export function raw(content = '<p>甲</p><p></p>', latest = 7, extra: Data = {}) {
  return {
    binding: BINDING,
    editData: {
      item_id: WORK,
      publish_status: 0,
      multi_title: ['Synthetic title', 'Synthetic tail'],
      content,
      thumb_uri: 'synthetic-head-uri',
      book_thumb_uri: 'synthetic-cover-uri',
      category: [],
      sign_type: 1,
      origin_activity_flag: 0,
      latest_version: latest,
      modify_time: '1789450000',
      opaque: { keep: [null, true, 'original'] },
      ...extra,
    },
    categoryData: {
      category_list: [
        { category_id: 'fixture-category-1', label: 'Synthetic', name: 'Fixture catalog' },
      ],
      opaque_catalog: 'synthetic-catalog-original',
    },
  };
}

// Modern status carrier adapter; independent original content/hash oracle is unchanged.
export function modernTuple4(value: ReturnType<typeof raw>) {
  const metadata = createNativeShortMetadataSnapshot(value);
  return { ...value, statusFacts: structuredClone(metadata.statusFacts) };
}

export const DRAFT_STATUS_FACTS = {
  schema: 'fanqie-short-status-facts/v1',
  source: 'editor_edit_v1',
  basis: 'editor-publish-and-display/v1',
  editor: { namespace: 'publish_status', raw: 0, presence: 'observed', branch: 'draft' },
  management: {
    namespace: 'display_status',
    raw: null,
    presence: 'missing',
    label: null,
    state: 'unknown',
    basis: 'unknown',
  },
  resolvedState: 'draft',
  draftEditable: true,
  conflict: false,
  reasons: ['status_not_observed'],
};

export const MARKER = { rawHtml: null, boundary: null, attrs: null };

export function preservation(source: ReturnType<typeof raw>, validRevision = true): string {
  const edit: Data = { ...source.editData };
  if (validRevision) {
    delete edit.content;
    delete edit.latest_version;
    delete edit.modify_time;
  }
  return sha(
    validRevision
      ? {
          basis: BASES.preservation,
          scope: SCOPE,
          binding: BINDING,
          editData: edit,
          categoryData: source.categoryData,
        }
      : {
          basis: BASES.invalidRevisionPreservation,
          binding: BINDING,
          editData: edit,
          categoryData: source.categoryData,
        },
  );
}

export function documentHashes(text: string) {
  return {
    bodyHash: sha({ basis: BASES.body, binding: BINDING, body: `${text}\n` }),
    paragraphsHash: sha({
      basis: BASES.paragraphs,
      binding: BINDING,
      paragraphs: [`<p>${text}</p>`, '<p></p>'],
    }),
    markerHash: sha({ basis: BASES.marker, binding: BINDING, marker: MARKER }),
  };
}
