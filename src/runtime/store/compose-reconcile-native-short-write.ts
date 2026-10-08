import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import {
  createReconcileNativeShortWrite,
  createValidateNativeShortSubmissionHistory,
  createGetNativeShortSubmissionOriginalAudit,
} from './operations/jobs-api-reconcile-native-short-write.js';
import {
  createNativeShortSubmissionSettlementError,
  createNativeShortSubmissionLaterRead,
} from './operations/native-states-native-short-submission-context.js';

import { createAssertNativeShortSubmissionLiveSettlement } from './operations/jobs-api-assert-native-short-submission-live-settlement.js';
export function composeReconcileNativeShortWrite(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.reconcileNativeShortWrite = createReconcileNativeShortWrite({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get nativeOriginalEvidence() {
      return owner.nativeOriginalEvidence.bind(owner);
    },
    get nativeReconciliationRow() {
      return owner.nativeReconciliationRow.bind(owner);
    },
    get validateNativeClosure() {
      return owner.validateNativeClosure.bind(owner);
    },
    get nativeLaterRead() {
      return owner.nativeLaterRead.bind(owner);
    },
    get assertNativeLiveSettlement() {
      return owner.assertNativeLiveSettlement.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get getJob() {
      return owner.getJob.bind(owner);
    },
  });
  operations.nativeShortSubmissionSettlementError = createNativeShortSubmissionSettlementError({});
  operations.nativeShortSubmissionLaterRead = createNativeShortSubmissionLaterRead({
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
  operations.validateNativeShortSubmissionHistory = createValidateNativeShortSubmissionHistory({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get nativeShortSubmissionContext() {
      return owner.nativeShortSubmissionContext.bind(owner);
    },
    get nativeShortSubmissionSettlementError() {
      return owner.nativeShortSubmissionSettlementError.bind(owner);
    },
    get nativeShortSubmissionLaterRead() {
      return owner.nativeShortSubmissionLaterRead.bind(owner);
    },
    get assertNativeShortSubmissionLiveSettlement() {
      return owner.assertNativeShortSubmissionLiveSettlement.bind(owner);
    },
  });
  operations.getNativeShortSubmissionOriginalAudit = createGetNativeShortSubmissionOriginalAudit({
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
    get nativeShortSubmissionContext() {
      return owner.nativeShortSubmissionContext.bind(owner);
    },
    get validateNativeShortSubmissionHistory() {
      return owner.validateNativeShortSubmissionHistory.bind(owner);
    },
  });
  operations.assertNativeShortSubmissionLiveSettlement =
    createAssertNativeShortSubmissionLiveSettlement({});
}
