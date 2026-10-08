import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import {
  createReconcileNativeShortTrialWrite,
  createValidateNativeShortCoverHistory,
  createGetNativeShortCoverOriginalAudit,
  createAssertNativeShortCoverLiveSettlement,
} from './operations/jobs-api-assert-native-short-trial-live-settlement.js';
import {
  createNativeShortCoverSettlementError,
  createNativeShortCoverLaterRead,
} from './operations/native-states-native-short-submission-context.js';

export function composeReconcileNativeShortTrialWrite(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.reconcileNativeShortTrialWrite = createReconcileNativeShortTrialWrite({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get getNativeShortTrialOriginalAudit() {
      return owner.getNativeShortTrialOriginalAudit.bind(owner);
    },
    get nativeShortTrialLaterRead() {
      return owner.nativeShortTrialLaterRead.bind(owner);
    },
    get nativeShortTrialContext() {
      return owner.nativeShortTrialContext.bind(owner);
    },
    get assertNativeShortTrialLiveSettlement() {
      return owner.assertNativeShortTrialLiveSettlement.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get nativeShortTrialSettlementError() {
      return owner.nativeShortTrialSettlementError.bind(owner);
    },
    get getJob() {
      return owner.getJob.bind(owner);
    },
  });
  operations.nativeShortCoverSettlementError = createNativeShortCoverSettlementError({});
  operations.nativeShortCoverLaterRead = createNativeShortCoverLaterRead({
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
  operations.validateNativeShortCoverHistory = createValidateNativeShortCoverHistory({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get nativeShortCoverContext() {
      return owner.nativeShortCoverContext.bind(owner);
    },
    get nativeShortCoverSettlementError() {
      return owner.nativeShortCoverSettlementError.bind(owner);
    },
    get nativeShortCoverLaterRead() {
      return owner.nativeShortCoverLaterRead.bind(owner);
    },
    get assertNativeShortCoverLiveSettlement() {
      return owner.assertNativeShortCoverLiveSettlement.bind(owner);
    },
  });
  operations.getNativeShortCoverOriginalAudit = createGetNativeShortCoverOriginalAudit({
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
    get nativeShortCoverContext() {
      return owner.nativeShortCoverContext.bind(owner);
    },
    get validateNativeShortCoverHistory() {
      return owner.validateNativeShortCoverHistory.bind(owner);
    },
  });
  operations.assertNativeShortCoverLiveSettlement = createAssertNativeShortCoverLiveSettlement({});
}
