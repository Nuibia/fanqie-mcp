import { test } from 'node:test';

import assert from 'node:assert/strict';

import {
  terms,
  digest,
  mutable,
  contract,
  code,
  setup,
  marker,
  snapshot,
  observedAt,
  paragraph,
} from './helpers/short-native-submission-mutable.js';

import {
  NATIVE_SHORT_SUBMISSION_TERMS_HASH,
  validateNativeShortSubmissionContract,
  validateNativeShortSubmissionBusinessInput,
  validateNativeShortSubmissionWriteRequest,
  nativeShortSubmissionBusinessInputHash,
  NATIVE_SHORT_SUBMISSION_TTL_MS,
  validateNativeShortPreparedSubmission,
  validateNativeShortSubmissionExpectation,
  nativeShortSubmissionContractVersionHash,
  planNativeShortSubmission,
  createNativeShortPreparedSubmission,
  normalizeNativeShortSubmissionContent,
  compareNativeShortSubmissionReadback,
  NATIVE_SHORT_SUBMISSION_SOURCE_PINS,
  type NativeShortSubmissionSourceDocuments,
  verifyNativeShortSubmissionSources,
} from '../src/platform/short-native-submission.js';

import { createNativeShortMetadataSnapshot } from '../src/platform/short-native-metadata.js';

test('small public terms fixture retains complete official lC text and fixed hash', () => {
  assert.equal(Buffer.byteLength(terms), 4419);
  assert.equal(digest(terms), NATIVE_SHORT_SUBMISSION_TERMS_HASH);
  assert.equal(terms.trimEnd().split('\n').length, 29);
  assert.match(terms, /签约作品合作协议/);
  assert.match(terms, /手机号码/);
  const raw = mutable(contract());
  raw.terms.text += '\n';
  code(() => validateNativeShortSubmissionContract(raw), 'terms_unavailable');
});

test('explicit numeric AI and exact submission scope; body/metadata patch and hash policy overrides rejected', () => {
  const value = setup().business;
  for (const useAi of [undefined, null, 0, '1', true]) {
    code(
      () => validateNativeShortSubmissionBusinessInput({ ...value, useAi }),
      useAi === undefined ? 'json_invalid_value' : 'request_binding',
    );
  }
  code(
    () => validateNativeShortSubmissionBusinessInput({ ...value, title: '替换标题' }),
    'object_shape',
  );
  code(
    () => validateNativeShortSubmissionBusinessInput({ ...value, metadata: {} }),
    'object_shape',
  );
  code(
    () =>
      validateNativeShortSubmissionBusinessInput({
        ...value,
        snapshotScope: 'short-native-body/v1',
      }),
    'business_binding',
  );
  code(() => validateNativeShortSubmissionWriteRequest({ ...value }), 'object_shape');
  assert.notEqual(
    nativeShortSubmissionBusinessInputHash(value),
    nativeShortSubmissionBusinessInputHash({ ...value, useAi: 2 }),
  );
});

test('complete reconstruction, exact 10-field publish form, retained marker and explicit no-live fixture', () => {
  const { prepared, plan } = setup();
  assert.deepEqual(
    Object.keys(plan.form).sort(),
    [
      'content',
      'item_id',
      'multi_title',
      'thumb_uri',
      'book_thumb_uri',
      'category',
      'sign_type',
      'activity_flag',
      'story_origin_divided_chapters',
      'use_ai',
    ].sort(),
  );
  assert.equal(plan.form.use_ai, '1');
  assert.equal(plan.form.sign_type, '1');
  assert.equal(plan.form.story_origin_divided_chapters, '0');
  assert.ok(plan.form.content!.includes(marker));
  assert.equal(plan.form.multi_title, '["合成原创短故事"]');
  assert.ok(!Object.hasOwn(plan.form, 'item_version'));
  assert.ok(!Object.hasOwn(plan.form, 'percentage'));
  assert.equal(plan.request.liveAllowed, false);
  assert.match(plan.request.url, /\/short_article\/publish\/v0\//);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(plan.request.body)), plan.form);
  assert.equal(
    Date.parse(prepared.expiresAt) - Date.parse(prepared.preparedAt),
    NATIVE_SHORT_SUBMISSION_TTL_MS,
  );
  assert.equal(prepared.validation.titleCount, 'unknown');
  assert.equal(prepared.validation.validateThreshold, 'unknown');
  assert.equal(prepared.validation.checkPre, 'not_called_get_only');
  assert.equal(prepared.validation.clientFullGate, 'not_proven');
  assert.ok(Object.isFrozen(prepared.completeCurrentSnapshot.editData));
  assert.equal(validateNativeShortPreparedSubmission(prepared).payloadHash, prepared.payloadHash);
  assert.equal(
    validateNativeShortSubmissionExpectation(plan.expectation).payloadHash,
    plan.payloadHash,
  );
});

test('source version identity ignores fresh observation times and nonce bytes, payload preserves original evidence', () => {
  const { current, source, business, prepared } = setup();
  const updated = mutable(source);
  updated.observedAt = '2026-10-07T04:01:00.000Z';
  for (const value of Object.values(updated.sources)) value.observedAt = updated.observedAt;
  updated.sources.writer.sha256 = digest('new nonce bytes');
  assert.equal(nativeShortSubmissionContractVersionHash(updated.sources), source.sourceHash);
  const freshSource = validateNativeShortSubmissionContract(updated);
  assert.equal(
    planNativeShortSubmission(current, freshSource, business, prepared, updated.observedAt)
      .payloadHash,
    prepared.payloadHash,
  );
  assert.notEqual(
    createNativeShortPreparedSubmission(current, freshSource, business, updated.observedAt)
      .payloadHash,
    prepared.payloadHash,
  );
  code(
    () => planNativeShortSubmission(current, source, business, prepared, prepared.expiresAt),
    'preparation_expired',
  );
  code(
    () =>
      planNativeShortSubmission(current, source, business, prepared, '2026-10-07T03:59:59.999Z'),
    'preparation_expired',
  );
});

test('exact tp order and fullwidth output, no general HTML repair or stripping trial tag', () => {
  assert.equal(
    normalizeNativeShortSubmissionContent('<p class="">&lt;&gt;&amp;&nbsp;&amp;lt;</p>'),
    '<p>＜＞& &lt;</p>',
  );
  assert.equal(
    normalizeNativeShortSubmissionContent(
      '<small id="x" data-source="y" data-reason="z">原文</small>',
    ),
    '原文',
  );
  assert.equal(normalizeNativeShortSubmissionContent(marker), marker);
  assert.equal(
    normalizeNativeShortSubmissionContent('<p style="color:red">正文</p>'),
    '<p style="color:red">正文</p>',
  );
});

test('supported source branches and trial constraints fail closed, never guess new activity selection', () => {
  const { source } = setup();
  const attempt = (patch: Record<string, unknown>) => {
    const current = snapshot(patch);
    return createNativeShortPreparedSubmission(
      current,
      source,
      { ...setup().business, expectedSnapshotVersionHash: current.snapshotVersionHash },
      observedAt,
    );
  };
  assert.equal(
    attempt({ story_origin_divided_chapters: 1 }).form.story_origin_divided_chapters,
    '1',
  );
  code(() => attempt({ origin_activity_flag: 1 }), 'activity_branch_unsupported');
  code(() => attempt({ activity_info: { activity_id: '987' } }), 'activity_branch_unsupported');
  code(() => attempt({ story_origin_divided_chapters: null }), 'story_origin_branch_unsupported');
  code(() => attempt({ content: `${paragraph}${paragraph}${paragraph}` }), 'trial_required');
  code(
    () => attempt({ content: '<section><p>未知节点</p></section>' }),
    'trial_document_unsupported',
  );
  code(() => attempt({ book_thumb_uri: '' }), 'cover_required');
  code(() => attempt({ authorize_type: 1 }), 'signed_min_text');
  code(() => attempt({ category: [] }), 'categories_invalid');
  code(() => attempt({ title_problem: true }), 'unresolved_review_problem');
});

test('original target readback separates ACK assumptions, observed review state and missing/invalid AI evidence', () => {
  const { plan } = setup();
  const after = snapshot({ publish_status: 1, display_status: 4, use_ai: 1 });
  const result = compareNativeShortSubmissionReadback(plan.expectation, after);
  assert.equal(result.matches, true);
  assert.equal(result.observedStatus, 'reviewing');
  assert.equal(result.ai.evidence, 'matched');
  assert.equal(
    compareNativeShortSubmissionReadback(
      plan.expectation,
      snapshot({ publish_status: 1, display_status: 1, use_ai: 1 }),
    ).observedStatus,
    'published',
  );
  const noAi = mutable(after.editData);
  delete noAi.use_ai;
  const missing = createNativeShortMetadataSnapshot({
    binding: after.binding,
    editData: noAi,
    categoryData: after.categoryData,
  });
  const unavailable = compareNativeShortSubmissionReadback(plan.expectation, missing);
  assert.equal(unavailable.matches, false);
  assert.equal(unavailable.reason, 'ai_missing');
  assert.equal(unavailable.ai.observed, null);
  assert.equal(
    compareNativeShortSubmissionReadback(plan.expectation, snapshot({ use_ai: '1' })).ai.evidence,
    'invalid',
  );
  assert.equal(
    compareNativeShortSubmissionReadback(plan.expectation, snapshot({ use_ai: 2 })).ai.evidence,
    'mismatch',
  );
  assert.equal(
    compareNativeShortSubmissionReadback(
      plan.expectation,
      snapshot({ publish_status: 1, display_status: 7, use_ai: 1 }),
    ).observedStatus,
    'rejected',
  );
  assert.equal(
    compareNativeShortSubmissionReadback(
      plan.expectation,
      snapshot({ publish_status: 1, display_status: 999, use_ai: 1 }),
    ).observedStatus,
    'unknown',
  );
  assert.equal(
    compareNativeShortSubmissionReadback(
      plan.expectation,
      snapshot({ content: `${paragraph}${marker}${paragraph}<p>不同正文</p>`, use_ai: 1 }),
    ).reason,
    'content_changed',
  );
  assert.equal(
    compareNativeShortSubmissionReadback(
      plan.expectation,
      snapshot({ book_thumb_uri: 'other', use_ai: 1 }),
    ).reason,
    'covers_changed',
  );
});

test('descriptor copying rejects getters, sparse arrays and tampered derived snapshot without execution', () => {
  const { current, source, business, prepared } = setup();
  let calls = 0;
  const getter = Object.defineProperty({ ...business }, 'useAi', {
    enumerable: true,
    get() {
      calls++;
      return 1;
    },
  });
  code(() => validateNativeShortSubmissionBusinessInput(getter), 'json_non_data_property');
  assert.equal(calls, 0);
  const bad = mutable(prepared);
  bad.completeCurrentSnapshot.snapshotVersionHash = 'f'.repeat(64);
  code(() => validateNativeShortPreparedSubmission(bad), 'snapshot_hash_mismatch');
  const patch = { ...current, editData: { ...current.editData } };
  Object.defineProperty(patch.editData, 'content', {
    enumerable: true,
    get() {
      calls++;
      return paragraph;
    },
  });
  code(
    () => createNativeShortPreparedSubmission(patch, source, business, observedAt),
    'json_non_data_property',
  );
  assert.equal(calls, 0);
  const mismatched = { ...business, expectedSnapshotVersionHash: 'f'.repeat(64) };
  code(
    () => createNativeShortPreparedSubmission(current, source, mismatched, observedAt),
    'source_version_mismatch',
  );
  const sparse = mutable(current);
  sparse.savedFields.multi_title = new Array(1);
  code(
    () => createNativeShortPreparedSubmission(sparse, source, business, observedAt),
    'json_array_shape',
  );
  const altered = mutable(prepared);
  altered.form.use_ai = '2';
  code(() => validateNativeShortPreparedSubmission(altered), 'prepared_hash_mismatch');
});

test('production source verifier unavailable on wrong fixed versions or extra caller policy', () => {
  const documents = Object.fromEntries(
    Object.entries(NATIVE_SHORT_SUBMISSION_SOURCE_PINS).map(([name, pin]) => [
      name,
      { url: pin.url, body: '', observedAt },
    ]),
  ) as unknown as NativeShortSubmissionSourceDocuments;
  code(() => verifyNativeShortSubmissionSources(documents), 'official_source_unavailable');
  code(
    () => verifyNativeShortSubmissionSources({ ...documents, contractHashOverride: 'x' }),
    'object_shape',
  );
  const summary = mutable(contract());
  summary.sources.main.sha256 = 'f'.repeat(64);
  code(() => validateNativeShortSubmissionContract(summary), 'contract_invalid');
  summary.sources.main = { ...NATIVE_SHORT_SUBMISSION_SOURCE_PINS.main, observedAt };
  summary.terms.sourceUrl = 'https://example.invalid/terms';
  code(() => validateNativeShortSubmissionContract(summary), 'terms_unavailable');
});
