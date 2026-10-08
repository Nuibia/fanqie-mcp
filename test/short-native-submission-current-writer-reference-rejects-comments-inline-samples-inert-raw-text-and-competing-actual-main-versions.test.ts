import { test } from 'node:test';

import {
  NATIVE_SHORT_SUBMISSION_SOURCE_PINS,
  nativeShortSubmissionWriterScriptReferences,
  compareNativeShortSubmissionReadback,
  createNativeShortPreparedSubmission,
  validateNativeShortSubmissionWriteRequest,
} from '../src/platform/short-native-submission.js';

import assert from 'node:assert/strict';

import { code, setup, snapshot, observedAt } from './helpers/short-native-submission-mutable.js';

test('current writer reference rejects comments, inline samples, inert raw-text and competing actual main versions', () => {
  const src = NATIVE_SHORT_SUBMISSION_SOURCE_PINS.main.url;
  const script = `<script defer="defer" src="${src}"></script>`;
  assert.deepEqual(
    nativeShortSubmissionWriterScriptReferences(`<!doctype html><html>${script}</html>`),
    [src],
  );
  for (const html of [
    `<!--${script}-->`,
    `<script>const example = '${script}';</script>`,
    `<script><!--<script></script>${script}`,
    `<script><![CDATA[${script}</script>`,
    `<textarea>${script}</textarea>`,
    `<title>${script}</title>`,
    `<style>${script}</style>`,
    `<plaintext>${script}`,
    `<plaintext>${script}</plaintext>`,
    `<noscript>${script}</noscript>`,
    `<template>${script}</template>`,
    `<div title='${script}'></div>`,
    `<script data-src="${src}"></script>`,
    `<script title='src="${src}"'></script>`,
    `<script type="text/plain" src="${src}"></script>`,
    `${script}<script src="${src.replace('c1caeb5e', 'new-build')}"></script>`,
    `${script}<script src="https://other-cdn.example/main.new-build.js"></script>`,
    `${script}${script}`,
    `<script nomodule src="${src}"></script>`,
    `<script language="vbscript" src="${src}"></script>`,
    `<script integrity="sha256-invalid" src="${src}"></script>`,
  ])
    code(() => nativeShortSubmissionWriterScriptReferences(html), 'official_reference_unavailable');
});

test('readback compares every submitted sign/activity/story-origin flag, including unknown values', () => {
  const { plan } = setup();
  for (const [field, values, reason] of [
    ['sign_type', [2, null], 'sign_type_changed'],
    ['origin_activity_flag', [1, null], 'activity_flag_changed'],
    ['story_origin_divided_chapters', [1, null], 'story_origin_divided_chapters_changed'],
  ] as const) {
    for (const value of values) {
      const after = snapshot({ publish_status: 1, display_status: 4, use_ai: 1, [field]: value });
      const comparison = compareNativeShortSubmissionReadback(plan.expectation, after);
      assert.equal(comparison.matches, false, field + ' ' + String(value));
      assert.equal(comparison.reason, reason);
    }
  }
  const unknown = snapshot({
    publish_status: 1,
    display_status: 4,
    use_ai: 1,
    sign_type: null,
    origin_activity_flag: null,
    story_origin_divided_chapters: null,
  });
  assert.equal(compareNativeShortSubmissionReadback(plan.expectation, unknown).matches, false);
});

test('prepare refuses category selections that the current UI would repair', () => {
  const { source } = setup();
  for (const category of [
    [{ category_id: 99, label: '主类', name: '主甲' }],
    [
      { category_id: 10, label: '主类', name: '主甲' },
      { category_id: 10, label: '主类', name: '主甲' },
    ],
    [{ category_id: 10, label: '主类', name: '旧名称' }],
    [{ category_id: '10', label: '主类', name: '主甲' }],
    [{ category_id: 10, label: '旧主类', name: '主甲' }],
  ]) {
    const current = snapshot({ category });
    code(
      () =>
        createNativeShortPreparedSubmission(
          current,
          source,
          { ...setup().business, expectedSnapshotVersionHash: current.snapshotVersionHash },
          observedAt,
        ),
      'categories_invalid',
    );
  }
});

test('property-key bytes count toward the bounded descriptor capture budget', () => {
  const input = { ['k'.repeat(33 * 1024 * 1024)]: null };
  code(() => validateNativeShortSubmissionWriteRequest(input), 'json_resource_limit');
});

test('known original-title whitespace guard runs before wire trim', () => {
  const { source } = setup();
  for (const title of [' 合成原创短故事 ', '\n合成原创短故事', '合成原创短故事\t']) {
    const current = snapshot({ multi_title: [title] });
    code(
      () =>
        createNativeShortPreparedSubmission(
          current,
          source,
          { ...setup().business, expectedSnapshotVersionHash: current.snapshotVersionHash },
          observedAt,
        ),
      'title_invalid',
    );
  }
});
