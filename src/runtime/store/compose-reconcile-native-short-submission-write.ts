import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import {
  createReconcileNativeShortSubmissionWrite,
  createValidateNativeShortTrialHistory,
  createGetNativeShortTrialOriginalAudit,
} from './operations/jobs-api-assert-native-short-submission-live-settlement.js';
import {
  createNativeShortTrialSettlementError,
  createNativeShortTrialLaterRead,
} from './operations/native-states-native-short-submission-context.js';

import { createAssertNativeShortTrialLiveSettlement } from './operations/jobs-api-assert-native-short-trial-live-settlement.js';
export function composeReconcileNativeShortSubmissionWrite(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.reconcileNativeShortSubmissionWrite = createReconcileNativeShortSubmissionWrite({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get getNativeShortSubmissionOriginalAudit() {
      return owner.getNativeShortSubmissionOriginalAudit.bind(owner);
    },
    get nativeShortSubmissionLaterRead() {
      return owner.nativeShortSubmissionLaterRead.bind(owner);
    },
    get nativeShortSubmissionContext() {
      return owner.nativeShortSubmissionContext.bind(owner);
    },
    get assertNativeShortSubmissionLiveSettlement() {
      return owner.assertNativeShortSubmissionLiveSettlement.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get nativeShortSubmissionSettlementError() {
      return owner.nativeShortSubmissionSettlementError.bind(owner);
    },
    get getJob() {
      return owner.getJob.bind(owner);
    },
  });
  operations.nativeShortTrialSettlementError = createNativeShortTrialSettlementError({});
  operations.nativeShortTrialLaterRead = createNativeShortTrialLaterRead({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
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
  operations.validateNativeShortTrialHistory = createValidateNativeShortTrialHistory({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get nativeShortTrialContext() {
      return owner.nativeShortTrialContext.bind(owner);
    },
    get nativeShortTrialSettlementError() {
      return owner.nativeShortTrialSettlementError.bind(owner);
    },
    get nativeShortTrialLaterRead() {
      return owner.nativeShortTrialLaterRead.bind(owner);
    },
    get assertNativeShortTrialLiveSettlement() {
      return owner.assertNativeShortTrialLiveSettlement.bind(owner);
    },
  });
  operations.getNativeShortTrialOriginalAudit = createGetNativeShortTrialOriginalAudit({
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
    get nativeShortTrialContext() {
      return owner.nativeShortTrialContext.bind(owner);
    },
    get validateNativeShortTrialHistory() {
      return owner.validateNativeShortTrialHistory.bind(owner);
    },
  });
  operations.assertNativeShortTrialLiveSettlement = createAssertNativeShortTrialLiveSettlement({});
}
