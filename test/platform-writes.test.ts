/** Scene index retained for source integrity; type imports register no tests. */
export type TestScenes = [
  typeof import('./platform-writes-no-unverified-profile-advertises-or-performs-a-write.test.js'),
  typeof import('./platform-writes-changed-terms-expired-preparation-changed-target-and-unaccepted-terms-prevent-submission.test.js'),
  typeof import('./platform-writes-validation-exhausts-chapter-id-deadline-inside-the-first-url-read-and-stays-unknown-before-its-hook.test.js'),
  typeof import('./platform-writes-chapter-creation-invalid-timeouts-or-missing-bounded-parent-and-client-reference-fail-before-intent-and-navigation.test.js'),
  typeof import('./platform-writes-long-book-metadata-update-saves-only-requested-controls-after-durable-intent-and-verifies-full-reopened-metadata-including-controlled-cover.test.js'),
  typeof import('./platform-writes-long-book-metadata-post-save-lost-response-changed-target-owner-state-or-incomplete-readback-remains-uncertain-without-automatic-replay.test.js'),
  typeof import('./platform-writes-write-guards-saved-target-remains-bound-across-field-and-save-control-awaits.test.js'),
  typeof import('./platform-writes-native-short-metadata-capability-rejects-every-request-before-page-access-verification-or-intent.test.js'),
  typeof import('./platform-writes-native-short-rejects-wrong-target-duplicate-parent-failed-code-and-unobserved-response-before-any-fill.test.js'),
  typeof import('./platform-writes-native-short-old-get-foreign-target-foreign-title-and-duplicate-parameter-responses-are-not-save-acks.test.js'),
  typeof import('./platform-writes-native-short-readonly-snapshot-bypasses-cached-body-while-exact-discard-follows-desired-intent-only-for-a-write.test.js'),
  typeof import('./platform-writes-r6-native-generic-read-preserves-the-exact-same-get-raw-matrix-and-full-eight-state-facts.test.js'),
  typeof import('./platform-writes-r6-proof17-records-both-original-owner-invocations-and-preserves-checked-at-at-t-500ms.test.js'),
  typeof import('./platform-writes-r6-uncertain-save-keeps-its-last-actual-observation-and-raw-capture-failure-cannot-become-trusted-unknown.test.js'),
];
