import {
  type NativeShortSubmissionExpectation,
  type NativeShortSubmissionComparison,
  validateNativeShortSubmissionExpectation,
} from './create-native-short-prepared-submission.js';

import { type NativeShortMetadataSnapshot } from '../short-native-metadata.js';

import { checkedSnapshot, same, freeze, sha } from './reject.js';

export function compareNativeShortSubmissionReadback(
  input: NativeShortSubmissionExpectation,
  snapshotInput: NativeShortMetadataSnapshot,
): NativeShortSubmissionComparison {
  const expected = validateNativeShortSubmissionExpectation(input),
    after = checkedSnapshot(snapshotInput),
    form = expected.form;
  const content = after.savedFields.content === form.content;
  let trial = content;
  if (!content) {
    try {
      const beforeMarker = /<div[^>]*data-fanqie-type="pay_tag"[^>]*><\/div>/.exec(
          form.content!,
        )?.[0],
        afterMarker = /<div[^>]*data-fanqie-type="pay_tag"[^>]*><\/div>/.exec(
          after.savedFields.content,
        )?.[0];
      trial = !!beforeMarker && beforeMarker === afterMarker;
    } catch {
      trial = false;
    }
  }
  const fields = {
    content,
    title: JSON.stringify(after.savedFields.multi_title) === form.multi_title,
    categories:
      after.categorySelectionHash === expected.categorySelectionHash &&
      after.savedFields.category.map(String).join(',') === form.category,
    covers:
      after.savedFields.thumb_uri === form.thumb_uri &&
      after.savedFields.book_thumb_uri === form.book_thumb_uri,
    trial,
    signType: after.savedFields.sign_type === Number(form.sign_type),
    activityFlag: after.savedFields.activity_flag === Number(form.activity_flag),
    storyOriginDividedChapters:
      after.editData.story_origin_divided_chapters === Number(form.story_origin_divided_chapters),
  };
  const observed = after.editData.use_ai,
    evidence: NativeShortSubmissionComparison['ai']['evidence'] = !Object.hasOwn(
      after.editData,
      'use_ai',
    )
      ? 'missing'
      : observed !== 1 && observed !== 2
        ? 'invalid'
        : observed === expected.useAi
          ? 'matched'
          : 'mismatch';
  let reason = 'match';
  if (!same(after.binding, expected.binding)) reason = 'binding_changed';
  else if (after.catalogHash !== expected.catalogHash) reason = 'catalog_changed';
  else if (!fields.content) reason = 'content_changed';
  else if (!fields.title) reason = 'title_changed';
  else if (!fields.categories) reason = 'categories_changed';
  else if (!fields.covers) reason = 'covers_changed';
  else if (!fields.trial) reason = 'trial_changed';
  else if (!fields.signType) reason = 'sign_type_changed';
  else if (!fields.activityFlag) reason = 'activity_flag_changed';
  else if (!fields.storyOriginDividedChapters) reason = 'story_origin_divided_chapters_changed';
  else if (evidence !== 'matched') reason = `ai_${evidence}`;
  return freeze({
    matches: reason === 'match',
    reason,
    observedStatus: after.state,
    statusFacts: after.statusFacts,
    ai: {
      sent: expected.useAi,
      observed: observed === 1 || observed === 2 ? observed : null,
      evidence,
    },
    actual: {
      snapshotVersionHash: after.snapshotVersionHash,
      catalogHash: after.catalogHash,
      contentHash: sha(after.savedFields.content),
    },
    fields,
  });
}
