import { readFileSync } from 'node:fs';

import { createHash, randomUUID } from 'node:crypto';

import {
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
} from '../../src/platform/short-native-metadata.js';

import {
  type NativeShortSubmissionContract,
  NATIVE_SHORT_SUBMISSION_SOURCE_PINS,
  validateNativeShortSubmissionContract,
  nativeShortSubmissionContractVersionHash,
  NATIVE_SHORT_SUBMISSION_TERMS_HASH,
  NATIVE_SHORT_SUBMISSION_SCOPE,
  createNativeShortPreparedSubmission,
  planNativeShortSubmission,
} from '../../src/platform/short-native-submission.js';

import {
  type NativeShortSubmissionReceiptStage,
  type NativeShortSubmissionReceiptFields,
  type NativeShortSubmissionReceipt,
} from '../../src/platform/short-native-submission-api.js';

export const SUBMISSION_FIXTURE_WORK = '7000000001',
  SUBMISSION_FIXTURE_OWNER = '0001001';

export const SUBMISSION_FIXTURE_MARKER =
  '<div data-percentage="0.3333333333333333" data-fanqie-type="pay_tag" data-min-text="200" data-min-paragraphs="3" data-min-radio="0.3" data-para-nums="3" class=""></div>';

const paragraph = `<p>${'合成正文'.repeat(50)}</p>`;

const terms = readFileSync(
  new URL(
    './fixtures/short-native-submission-terms-4c89ddd6.txt',
    new URL('../short-native-submission-fixture.ts', import.meta.url).href,
  ),
  'utf8',
);

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

export function submissionFixtureEdit(changes: Record<string, unknown> = {}) {
  return {
    item_id: SUBMISSION_FIXTURE_WORK,
    publish_status: 0,
    display_status: 0,
    content: `${paragraph}${SUBMISSION_FIXTURE_MARKER}${paragraph}${paragraph}`,
    multi_title: ['合成原创短故事'],
    thumb_uri: '',
    book_thumb_uri: 'fixture-book-cover',
    category: [{ category_id: 'c1', label: '主类', name: '主甲' }],
    sign_type: 1,
    origin_activity_flag: 0,
    story_origin_divided_chapters: 0,
    authorize_type: 0,
    use_ai: 2,
    ...changes,
  };
}

export function submissionFixtureCatalog() {
  return { category_list: [{ category_id: 'c1', label: '主类', name: '主甲' }] };
}

export function submissionFixtureSnapshot(
  changes: Record<string, unknown> = {},
  catalogChanges: Record<string, unknown> = {},
) {
  return createNativeShortMetadataSnapshot({
    binding: {
      account: { kind: 'account_id', id: SUBMISSION_FIXTURE_OWNER },
      work: { kind: 'short', id: SUBMISSION_FIXTURE_WORK },
    },
    editData: submissionFixtureEdit(changes),
    categoryData: { ...submissionFixtureCatalog(), ...catalogChanges },
  });
}

/** Real terms + pinned descriptors; synthetic script bodies are explicitly never live proof. */
export function submissionFixtureContract(
  observedAt = new Date().toISOString(),
): NativeShortSubmissionContract {
  const sources = {
    writer: {
      url: NATIVE_SHORT_SUBMISSION_SOURCE_PINS.writer.url,
      sha256: sha('<!doctype html>synthetic-no-live'),
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

export function submissionFixtureSetup(
  useAi: 1 | 2 = 1,
  changes: Record<string, unknown> = {},
  catalogChanges: Record<string, unknown> = {},
) {
  const snapshot = submissionFixtureSnapshot(changes, catalogChanges),
    contract = submissionFixtureContract(),
    businessRequest = {
      expectedSnapshotVersionHash: snapshot.snapshotVersionHash,
      hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
      expectedState: 'draft' as const,
      useAi,
    },
    business = {
      ...businessRequest,
      target: { kind: 'short' as const, workId: SUBMISSION_FIXTURE_WORK },
      snapshotScope: NATIVE_SHORT_SUBMISSION_SCOPE,
    };
  const prepared = createNativeShortPreparedSubmission(
      snapshot,
      contract,
      business,
      new Date().toISOString(),
    ),
    plan = planNativeShortSubmission(
      snapshot,
      contract,
      business,
      prepared,
      new Date().toISOString(),
    );
  return {
    snapshot,
    contract,
    businessRequest,
    business,
    prepared,
    plan,
    servicePrepared: {
      preparationJobId: randomUUID(),
      preparationEvidence: {
        id: randomUUID(),
        sha256: 'a'.repeat(64),
        capturedAt: prepared.preparedAt,
      },
      prepared,
    },
  };
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

export interface SubmissionFixtureFaults {
  content?: string;
  editChanges?: Record<string, unknown>;
  catalogChanges?: Record<string, unknown>;
  mode?: 'prepare' | 'submit' | 'read';
  drift?: boolean;
  duplicateList?: boolean;
  ownerChanged?: boolean;
  afterMissingAi?: boolean;
  afterStatus?: 'draft' | 'unknown' | 'reviewing' | 'published';
  mismatch?: boolean;
  acknowledgementLost?: boolean;
  acknowledgementCode?: number;
  acknowledgementMessage?: string;
  responseFault?: 'redirect' | 'url' | 'utf8' | 'mime' | 'code';
  afterFault?: boolean;
  redirectGet?: boolean;
  failDispose?: 'response' | 'api';
  hold?: 'creation' | 'post' | 'dispose';
  baselineFails?: boolean;
  onVerifiedFails?: boolean;
  lease?: () => void;
  transform?: (
    stage: NativeShortSubmissionReceiptStage,
    fields: NativeShortSubmissionReceiptFields,
    confirm: (fields: NativeShortSubmissionReceiptFields) => NativeShortSubmissionReceipt,
  ) => NativeShortSubmissionReceipt;
}
