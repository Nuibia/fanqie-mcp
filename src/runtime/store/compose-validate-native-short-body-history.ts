import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import {
  createValidateNativeShortBodyHistory,
  createGetNativeShortBodyOriginalAudit,
  createValidateNativeShortBodyJob,
  createReconcileNativeShortBodyWrite,
} from './operations/jobs-api-validate-native-short-body-history.js';

import {
  createGetNativeShortSubmissionPreparation,
  createListNativeShortSubmissionAttempts,
} from './operations/jobs-api-get-native-short-submission-preparation.js';

export function composeValidateNativeShortBodyHistory(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.validateNativeShortBodyHistory = createValidateNativeShortBodyHistory({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get nativeShortBodyContext() {
      return owner.nativeShortBodyContext.bind(owner);
    },
    get nativeShortBodySettlementError() {
      return owner.nativeShortBodySettlementError.bind(owner);
    },
    get nativeShortBodyRecoveryFromPayload() {
      return owner.nativeShortBodyRecoveryFromPayload.bind(owner);
    },
    get nativeShortBodyLaterRead() {
      return owner.nativeShortBodyLaterRead.bind(owner);
    },
  });
  operations.getNativeShortBodyOriginalAudit = createGetNativeShortBodyOriginalAudit({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get assertOwnership() {
      return owner.assertOwnership.bind(owner);
    },
    get rawJob() {
      return owner.rawJob.bind(owner);
    },
    get nativeShortBodyContext() {
      return owner.nativeShortBodyContext.bind(owner);
    },
    get validateNativeShortBodyHistory() {
      return owner.validateNativeShortBodyHistory.bind(owner);
    },
    get nativeShortBodyRecoveryFreshRead() {
      return owner.nativeShortBodyRecoveryFreshRead.bind(owner);
    },
    get nativeShortBodyRecoveryFromPayload() {
      return owner.nativeShortBodyRecoveryFromPayload.bind(owner);
    },
  });
  operations.validateNativeShortBodyJob = createValidateNativeShortBodyJob({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get validateNativeShortBodyHistory() {
      return owner.validateNativeShortBodyHistory.bind(owner);
    },
    get nativeShortBodyContext() {
      return owner.nativeShortBodyContext.bind(owner);
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get nativeShortBodyLaterRead() {
      return owner.nativeShortBodyLaterRead.bind(owner);
    },
    get nativeShortBodyRecoveryFromPayload() {
      return owner.nativeShortBodyRecoveryFromPayload.bind(owner);
    },
    get rawJob() {
      return owner.rawJob.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get getNativeShortBodyOriginalAudit() {
      return owner.getNativeShortBodyOriginalAudit.bind(owner);
    },
  });
  operations.reconcileNativeShortBodyWrite = createReconcileNativeShortBodyWrite({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get nativeShortBodyLaterRead() {
      return owner.nativeShortBodyLaterRead.bind(owner);
    },
    get nativeShortBodyRecoveryFromPayload() {
      return owner.nativeShortBodyRecoveryFromPayload.bind(owner);
    },
    get getNativeShortBodyOriginalAudit() {
      return owner.getNativeShortBodyOriginalAudit.bind(owner);
    },
    get nativeShortBodyContext() {
      return owner.nativeShortBodyContext.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get nativeShortBodySettlementError() {
      return owner.nativeShortBodySettlementError.bind(owner);
    },
    get getJob() {
      return owner.getJob.bind(owner);
    },
  });
  operations.getNativeShortSubmissionPreparation = createGetNativeShortSubmissionPreparation({
    get rawJob() {
      return owner.rawJob.bind(owner);
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
  });
  operations.listNativeShortSubmissionAttempts = createListNativeShortSubmissionAttempts({
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
