import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import { createReconcileNativeShortCoverWrite } from './operations/jobs-api-reconcile-native-short-cover-write.js';
import {
  createReconcileWriteJob,
  createGetCreationRecovery,
} from './operations/jobs-api-reconcile-write-job.js';

import {
  createGenericCreationEnvelope,
  createGenericRepairEntry,
} from './operations/creation-recovery-generic-creation-event.js';

import { createClaimCreationRecovery } from './operations/jobs-api-claim-creation-recovery.js';
export function composeReconcileNativeShortCoverWrite(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.reconcileNativeShortCoverWrite = createReconcileNativeShortCoverWrite({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get getNativeShortCoverOriginalAudit() {
      return owner.getNativeShortCoverOriginalAudit.bind(owner);
    },
    get nativeShortCoverLaterRead() {
      return owner.nativeShortCoverLaterRead.bind(owner);
    },
    get nativeShortCoverContext() {
      return owner.nativeShortCoverContext.bind(owner);
    },
    get assertNativeShortCoverLiveSettlement() {
      return owner.assertNativeShortCoverLiveSettlement.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get nativeShortCoverSettlementError() {
      return owner.nativeShortCoverSettlementError.bind(owner);
    },
    get getJob() {
      return owner.getJob.bind(owner);
    },
  });
  operations.reconcileWriteJob = createReconcileWriteJob({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get transaction() {
      return owner.transaction.bind(owner);
    },
    get getJob() {
      return owner.getJob.bind(owner);
    },
    get getCreationRepair() {
      return owner.getCreationRepair.bind(owner);
    },
    get getCreationRepairSuccessor() {
      return owner.getCreationRepairSuccessor.bind(owner);
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
    get reconcileNativeShortSubmissionWrite() {
      return owner.reconcileNativeShortSubmissionWrite.bind(owner);
    },
    get reconcileNativeShortBodyWrite() {
      return owner.reconcileNativeShortBodyWrite.bind(owner);
    },
    get reconcileNativeShortTrialWrite() {
      return owner.reconcileNativeShortTrialWrite.bind(owner);
    },
    get reconcileNativeShortCoverWrite() {
      return owner.reconcileNativeShortCoverWrite.bind(owner);
    },
    get getNativeCompensationContext() {
      return owner.getNativeCompensationContext.bind(owner);
    },
    get reconcileNativeCompensation() {
      return owner.reconcileNativeCompensation.bind(owner);
    },
    get reconcileNativeShortWrite() {
      return owner.reconcileNativeShortWrite.bind(owner);
    },
    get genericMutationGraph() {
      return owner.genericMutationGraph.bind(owner);
    },
    get genericReadComplete() {
      return owner.genericReadComplete.bind(owner);
    },
    get genericValidateAudit() {
      return owner.genericValidateAudit.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
  });
  operations.getCreationRecovery = createGetCreationRecovery({
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
  operations.genericCreationEnvelope = createGenericCreationEnvelope({
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get genericWitness() {
      return owner.genericWitness.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
  });
  operations.genericRepairEntry = createGenericRepairEntry({
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
    get genericWitness() {
      return owner.genericWitness.bind(owner);
    },
  });
  operations.claimCreationRecovery = createClaimCreationRecovery({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get transaction() {
      return owner.transaction.bind(owner);
    },
    get getJob() {
      return owner.getJob.bind(owner);
    },
    get runningJob() {
      return owner.runningJob.bind(owner);
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
    get genericCreationEnvelope() {
      return owner.genericCreationEnvelope.bind(owner);
    },
    get listJobs() {
      return owner.listJobs.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
  });
}
