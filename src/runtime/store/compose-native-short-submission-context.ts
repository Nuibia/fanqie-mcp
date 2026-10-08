import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import {
  createNativeShortSubmissionContext,
  createNativeShortTrialContext,
} from './operations/native-states-native-short-submission-context.js';
import {
  createRecordNativeShortSubmissionAttempt,
  createListNativeShortTrialAttempts,
  createRecordNativeShortTrialAttempt,
} from './operations/jobs-api-get-native-short-submission-preparation.js';

import { createListNativeShortCoverAttempts } from './operations/jobs-api-list-native-short-cover-attempts.js';
export function composeNativeShortSubmissionContext(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.nativeShortSubmissionContext = createNativeShortSubmissionContext({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
    get listNativeShortSubmissionAttempts() {
      return owner.listNativeShortSubmissionAttempts.bind(owner);
    },
    get getNativeShortSubmissionPreparation() {
      return owner.getNativeShortSubmissionPreparation.bind(owner);
    },
  });
  operations.recordNativeShortSubmissionAttempt = createRecordNativeShortSubmissionAttempt({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get transaction() {
      return owner.transaction.bind(owner);
    },
    get runningJob() {
      return owner.runningJob.bind(owner);
    },
    get assertNotCancelled() {
      return owner.assertNotCancelled.bind(owner);
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
    get listNativeShortSubmissionAttempts() {
      return owner.listNativeShortSubmissionAttempts.bind(owner);
    },
    get nativeShortSubmissionContext() {
      return owner.nativeShortSubmissionContext.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
  });
  operations.listNativeShortTrialAttempts = createListNativeShortTrialAttempts({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get ensureOpen() {
      return owner.ensureOpen.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
  });
  operations.nativeShortTrialContext = createNativeShortTrialContext({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
    get listNativeShortTrialAttempts() {
      return owner.listNativeShortTrialAttempts.bind(owner);
    },
  });
  operations.recordNativeShortTrialAttempt = createRecordNativeShortTrialAttempt({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get transaction() {
      return owner.transaction.bind(owner);
    },
    get runningJob() {
      return owner.runningJob.bind(owner);
    },
    get assertNotCancelled() {
      return owner.assertNotCancelled.bind(owner);
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
    get listNativeShortTrialAttempts() {
      return owner.listNativeShortTrialAttempts.bind(owner);
    },
    get nativeShortTrialContext() {
      return owner.nativeShortTrialContext.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
  });
  operations.listNativeShortCoverAttempts = createListNativeShortCoverAttempts({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get ensureOpen() {
      return owner.ensureOpen.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
  });
}
