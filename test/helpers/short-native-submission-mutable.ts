import { readFileSync } from 'node:fs';

import { createHash } from 'node:crypto';

import {
  type NativeShortSubmissionContract,
  NATIVE_SHORT_SUBMISSION_SOURCE_PINS,
  validateNativeShortSubmissionContract,
  nativeShortSubmissionContractVersionHash,
  NATIVE_SHORT_SUBMISSION_TERMS_HASH,
  validateNativeShortSubmissionBusinessInput,
  NATIVE_SHORT_SUBMISSION_SCOPE,
  createNativeShortPreparedSubmission,
  planNativeShortSubmission,
  NativeShortSubmissionError,
} from '../../src/platform/short-native-submission.js';

import {
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
} from '../../src/platform/short-native-metadata.js';

import assert from 'node:assert/strict';

export const observedAt = '2026-10-07T04:00:00.000Z';

export const terms = readFileSync(
  new URL(
    './fixtures/short-native-submission-terms-4c89ddd6.txt',
    new URL('../short-native-submission.test.ts', import.meta.url).href,
  ),
  'utf8',
);

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };

export function mutable<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>;
}

export const digest = (text: string) => createHash('sha256').update(text).digest('hex');

export function contract(): NativeShortSubmissionContract {
  const sources = {
    writer: {
      url: NATIVE_SHORT_SUBMISSION_SOURCE_PINS.writer.url,
      sha256: digest('<!doctype html>fixture-no-live'),
      observedAt,
    },
    main: { ...NATIVE_SHORT_SUBMISSION_SOURCE_PINS.main, observedAt },
    publishShort: { ...NATIVE_SHORT_SUBMISSION_SOURCE_PINS.publishShort, observedAt },
    asyncMain: { ...NATIVE_SHORT_SUBMISSION_SOURCE_PINS.asyncMain, observedAt },
  };
  return validateNativeShortSubmissionContract({
    schema: 'short-native-submission-contract/v1',
    mode: 'fixture-no-live',
    observedAt,
    sourceHash: nativeShortSubmissionContractVersionHash(sources),
    sources,
    terms: {
      title: '短故事发布事项',
      text: terms,
      sha256: NATIVE_SHORT_SUBMISSION_TERMS_HASH,
      sourceUrl: sources.publishShort.url,
      sourceSha256: sources.publishShort.sha256,
      byteStart: 192356,
      byteEndExclusive: 202397,
    },
    validation: {
      titleCount: 'unknown',
      validateThreshold: 'unknown',
      checkPre: 'not_called_get_only',
    },
  });
}

export const paragraph = `<p>${'正文'.repeat(50)}</p>`;

export const marker =
  '<div data-percentage="0.3333333333333333" data-fanqie-type="pay_tag" data-min-text="200" data-min-paragraphs="3" data-min-radio="0.3" data-para-nums="3" class=""></div>';

export function snapshot(changes: Record<string, unknown> = {}) {
  return createNativeShortMetadataSnapshot({
    binding: {
      account: { kind: 'account_id', id: '1001' },
      work: { kind: 'short', id: '7000000001' },
    },
    editData: {
      item_id: '7000000001',
      publish_status: 0,
      display_status: 0,
      content: `${paragraph}${marker}${paragraph}${paragraph}`,
      multi_title: ['合成原创短故事'],
      thumb_uri: '',
      book_thumb_uri: 'public-fixture-cover',
      category: [{ category_id: 10, label: '主类', name: '主甲' }],
      sign_type: 1,
      origin_activity_flag: 0,
      story_origin_divided_chapters: 0,
      authorize_type: 0,
      use_ai: 2,
      ...changes,
    },
    categoryData: { category_list: [{ category_id: 10, label: '主类', name: '主甲' }] },
  });
}

export function setup(useAi: 1 | 2 = 1) {
  const current = snapshot(),
    source = contract();
  const business = validateNativeShortSubmissionBusinessInput({
    expectedSnapshotVersionHash: current.snapshotVersionHash,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedState: 'draft',
    useAi,
    target: { kind: 'short', workId: current.binding.work.id },
    snapshotScope: NATIVE_SHORT_SUBMISSION_SCOPE,
  });
  const prepared = createNativeShortPreparedSubmission(current, source, business, observedAt);
  return {
    current,
    source,
    business,
    prepared,
    plan: planNativeShortSubmission(current, source, business, prepared, observedAt),
  };
}

export function code(callback: () => unknown, wanted: string) {
  assert.throws(
    callback,
    (error: unknown) => error instanceof NativeShortSubmissionError && error.code === wanted,
  );
}
