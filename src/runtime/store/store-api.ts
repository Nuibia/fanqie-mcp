import {
  type Job,
  type EvidenceRef,
  type JobKind,
  type RuntimeFailure,
  type PlatformTarget,
  type GenericShortPublicationTuple,
} from './runtime-error.js';
import { type ServiceLeaseLostSignal, type NewJob } from './native-closure-signal.js';
import * as bodyProof from '../../platform/short-native-body-proof.js';

import { type PublicReadPurpose } from '../public-read.js';

import { type NativeShortBodyBusinessInput } from '../../platform/short-native-body.js';

import { type StoreOperations } from './operations.js';
import { StoreRuntimeInternals } from './store-runtime-internals.js';
export class StoreApi extends StoreRuntimeInternals {
  withPublicProjectionRead<T>(accountId: string, purpose: PublicReadPurpose, callback: () => T): T {
    return this.operation('withPublicProjectionRead')(accountId, purpose, callback);
  }
  memoPublicProjection<T>(namespace: string, key: unknown, compute: () => T): T {
    return this.operation('memoPublicProjection')(namespace, key, compute);
  }
  assertPublicReadEntryAllowed(): ReturnType<StoreOperations['assertPublicReadEntryAllowed']> {
    return this.operation('assertPublicReadEntryAllowed')();
  }
  assertPublicReadMutationAllowed(): ReturnType<
    StoreOperations['assertPublicReadMutationAllowed']
  > {
    return this.operation('assertPublicReadMutationAllowed')();
  }
  runLeaseLossCleanup<T>(action: () => T): T {
    return this.operation('runLeaseLossCleanup')(action);
  }
  hasLostServiceLease(): ReturnType<StoreOperations['hasLostServiceLease']> {
    return this.operation('hasLostServiceLease')();
  }
  onServiceLeaseLost(
    listener: (signal: ServiceLeaseLostSignal) => void,
  ): ReturnType<StoreOperations['onServiceLeaseLost']> {
    return this.operation('onServiceLeaseLost')(listener);
  }
  assertLeaseOwnership(): ReturnType<StoreOperations['assertLeaseOwnership']> {
    return this.operation('assertLeaseOwnership')();
  }
  close(): ReturnType<StoreOperations['close']> {
    return this.operation('close')();
  }
  getJob(id: string, accountId?: string): ReturnType<StoreOperations['getJob']> {
    return this.operation('getJob')(id, accountId);
  }
  listKnownWriteTaskSummaries(
    accountId: string,
  ): ReturnType<StoreOperations['listKnownWriteTaskSummaries']> {
    return this.operation('listKnownWriteTaskSummaries')(accountId);
  }
  listJobs(accountId?: string): ReturnType<StoreOperations['listJobs']> {
    return this.operation('listJobs')(accountId);
  }
  getJobForPublicProjection(
    id: string,
    accountId: string,
  ): ReturnType<StoreOperations['getJobForPublicProjection']> {
    return this.operation('getJobForPublicProjection')(id, accountId);
  }
  listJobsForPublicProjection(
    accountId: string,
  ): ReturnType<StoreOperations['listJobsForPublicProjection']> {
    return this.operation('listJobsForPublicProjection')(accountId);
  }
  findIdempotent(
    accountId: string,
    kind: JobKind,
    operation: string,
    key: string,
  ): ReturnType<StoreOperations['findIdempotent']> {
    return this.operation('findIdempotent')(accountId, kind, operation, key);
  }
  createJob(input: NewJob): ReturnType<StoreOperations['createJob']> {
    return this.operation('createJob')(input);
  }
  startJob(id: string): ReturnType<StoreOperations['startJob']> {
    return this.operation('startJob')(id);
  }
  requestCancellation(
    id: string,
    reason: RuntimeFailure = { code: 'cancelled', message: 'Job cancellation was requested.' },
  ): ReturnType<StoreOperations['requestCancellation']> {
    return this.operation('requestCancellation')(id, reason);
  }
  markPlatformReadStarted(id: string): ReturnType<StoreOperations['markPlatformReadStarted']> {
    return this.operation('markPlatformReadStarted')(id);
  }
  markPlatformWriteStarted(id: string): ReturnType<StoreOperations['markPlatformWriteStarted']> {
    return this.operation('markPlatformWriteStarted')(id);
  }
  listNativeShortBodyAttempts(
    jobId: string,
    accountId: string,
  ): ReturnType<StoreOperations['listNativeShortBodyAttempts']> {
    return this.operation('listNativeShortBodyAttempts')(jobId, accountId);
  }
  getNativeShortBodyRecoveryContext(
    jobId: string,
    accountId: string,
  ): ReturnType<StoreOperations['getNativeShortBodyRecoveryContext']> {
    return this.operation('getNativeShortBodyRecoveryContext')(jobId, accountId);
  }
  prepareNativeShortBodyReconciliation(
    jobId: string,
    accountId: string,
  ): ReturnType<StoreOperations['prepareNativeShortBodyReconciliation']> {
    return this.operation('prepareNativeShortBodyReconciliation')(jobId, accountId);
  }
  issueNativeShortBodyWriteAuthority(
    jobId: string,
    accountId: string,
    input: NativeShortBodyBusinessInput,
    expectedPlatformAccount: string,
  ): ReturnType<StoreOperations['issueNativeShortBodyWriteAuthority']> {
    return this.operation('issueNativeShortBodyWriteAuthority')(
      jobId,
      accountId,
      input,
      expectedPlatformAccount,
    );
  }
  issueNativeShortBodyReconciliationAuthority(
    readJobId: string,
    accountId: string,
    originalJobId: string,
    audit: bodyProof.NativeShortBodyOriginalAudit,
    expectedPlatformAccount: string,
    recoveryContext?: bodyProof.NativeShortBodyRecoveryContextV2,
    comparisonPolicy?: 'native-short-body-derived-word-number/v2',
  ): ReturnType<StoreOperations['issueNativeShortBodyReconciliationAuthority']> {
    return this.operation('issueNativeShortBodyReconciliationAuthority')(
      readJobId,
      accountId,
      originalJobId,
      audit,
      expectedPlatformAccount,
      recoveryContext,
      comparisonPolicy,
    );
  }
  getNativeShortBodyOriginalAudit(
    jobId: string,
    accountId: string,
    recoveryContext?: bodyProof.NativeShortBodyRecoveryContextV2,
  ): ReturnType<StoreOperations['getNativeShortBodyOriginalAudit']> {
    return this.operation('getNativeShortBodyOriginalAudit')(jobId, accountId, recoveryContext);
  }
  getNativeShortSubmissionPreparation(
    jobId: string,
    accountId: string,
  ): ReturnType<StoreOperations['getNativeShortSubmissionPreparation']> {
    return this.operation('getNativeShortSubmissionPreparation')(jobId, accountId);
  }
  listNativeShortSubmissionAttempts(
    jobId: string,
  ): ReturnType<StoreOperations['listNativeShortSubmissionAttempts']> {
    return this.operation('listNativeShortSubmissionAttempts')(jobId);
  }
  recordNativeShortSubmissionAttempt(
    jobId: string,
    ref: EvidenceRef,
  ): ReturnType<StoreOperations['recordNativeShortSubmissionAttempt']> {
    return this.operation('recordNativeShortSubmissionAttempt')(jobId, ref);
  }
  listNativeShortTrialAttempts(
    jobId: string,
  ): ReturnType<StoreOperations['listNativeShortTrialAttempts']> {
    return this.operation('listNativeShortTrialAttempts')(jobId);
  }
  recordNativeShortTrialAttempt(
    jobId: string,
    ref: EvidenceRef,
  ): ReturnType<StoreOperations['recordNativeShortTrialAttempt']> {
    return this.operation('recordNativeShortTrialAttempt')(jobId, ref);
  }
  listNativeShortCoverAttempts(
    jobId: string,
  ): ReturnType<StoreOperations['listNativeShortCoverAttempts']> {
    return this.operation('listNativeShortCoverAttempts')(jobId);
  }
  recordNativeShortCoverAttempt(
    jobId: string,
    phase: 'upload' | 'save',
    ref: EvidenceRef,
  ): ReturnType<StoreOperations['recordNativeShortCoverAttempt']> {
    return this.operation('recordNativeShortCoverAttempt')(jobId, phase, ref);
  }
  getGenericShortOriginalAudit(
    originalId: string,
    accountId: string,
    readJobId: string,
  ): ReturnType<StoreOperations['getGenericShortOriginalAudit']> {
    return this.operation('getGenericShortOriginalAudit')(originalId, accountId, readJobId);
  }
  genericShortPublication(
    jobId: string,
    accountId: string,
  ): ReturnType<StoreOperations['genericShortPublication']> {
    return this.operation('genericShortPublication')(jobId, accountId);
  }
  genericShortProjection(
    jobId: string,
    accountId: string,
    includeDataset = true,
  ): ReturnType<StoreOperations['genericShortProjection']> {
    return this.operation('genericShortProjection')(jobId, accountId, includeDataset);
  }
  genericShortCreationEventProjection(
    memberId: string,
    accountId: string,
    includeDataset = true,
  ): ReturnType<StoreOperations['genericShortCreationEventProjection']> {
    return this.operation('genericShortCreationEventProjection')(
      memberId,
      accountId,
      includeDataset,
    );
  }
  genericShortPublicJob(
    job: Job,
    tuple: GenericShortPublicationTuple,
  ): ReturnType<StoreOperations['genericShortPublicJob']> {
    return this.operation('genericShortPublicJob')(job, tuple);
  }
  addJobMetadata(
    id: string,
    values: Record<string, unknown>,
  ): ReturnType<StoreOperations['addJobMetadata']> {
    return this.operation('addJobMetadata')(id, values);
  }
  recordTarget(
    id: string,
    value: PlatformTarget | string,
  ): ReturnType<StoreOperations['recordTarget']> {
    return this.operation('recordTarget')(id, value);
  }
  saveEvidence(
    jobId: string,
    dataset: string,
    payload: unknown,
  ): ReturnType<StoreOperations['saveEvidence']> {
    return this.operation('saveEvidence')(jobId, dataset, payload);
  }
  listEvidence(jobId: string): ReturnType<StoreOperations['listEvidence']> {
    return this.operation('listEvidence')(jobId);
  }
  readEvidence(reference: EvidenceRef): ReturnType<StoreOperations['readEvidence']> {
    return this.operation('readEvidence')(reference);
  }
  completeReadJob(
    jobId: string,
    references: EvidenceRef[],
  ): ReturnType<StoreOperations['completeReadJob']> {
    return this.operation('completeReadJob')(jobId, references);
  }
  completeWriteJob(
    jobId: string,
    result: unknown,
  ): ReturnType<StoreOperations['completeWriteJob']> {
    return this.operation('completeWriteJob')(jobId, result);
  }
  failJob(jobId: string, error: RuntimeFailure): ReturnType<StoreOperations['failJob']> {
    return this.operation('failJob')(jobId, error);
  }
  recoverInterrupted(): ReturnType<StoreOperations['recoverInterrupted']> {
    return this.operation('recoverInterrupted')();
  }
  resolveOperatorEntryInvestigation(
    originalId: string,
    readJobId: string,
  ): ReturnType<StoreOperations['resolveOperatorEntryInvestigation']> {
    return this.operation('resolveOperatorEntryInvestigation')(originalId, readJobId);
  }
  getNativeCompensationContext(
    originalJobId: string,
  ): ReturnType<StoreOperations['getNativeCompensationContext']> {
    return this.operation('getNativeCompensationContext')(originalJobId);
  }
  registerNativeCompensationAttestation(
    input: unknown,
  ): ReturnType<StoreOperations['registerNativeCompensationAttestation']> {
    return this.operation('registerNativeCompensationAttestation')(input);
  }
  getNativeShortSubmissionOriginalAudit(
    jobId: string,
  ): ReturnType<StoreOperations['getNativeShortSubmissionOriginalAudit']> {
    return this.operation('getNativeShortSubmissionOriginalAudit')(jobId);
  }
  getNativeShortTrialOriginalAudit(
    jobId: string,
  ): ReturnType<StoreOperations['getNativeShortTrialOriginalAudit']> {
    return this.operation('getNativeShortTrialOriginalAudit')(jobId);
  }
  getNativeShortCoverOriginalAudit(
    jobId: string,
  ): ReturnType<StoreOperations['getNativeShortCoverOriginalAudit']> {
    return this.operation('getNativeShortCoverOriginalAudit')(jobId);
  }
  reconcileWriteJob(
    originalId: string,
    reconciliationJobId: string,
    resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: unknown },
  ): ReturnType<StoreOperations['reconcileWriteJob']> {
    return this.operation('reconcileWriteJob')(originalId, reconciliationJobId, resolution);
  }
  getCreationRecovery(originalId: string): ReturnType<StoreOperations['getCreationRecovery']> {
    return this.operation('getCreationRecovery')(originalId);
  }
  claimCreationRecovery(
    originalId: string,
    resumeJobId: string,
    bindings: {
      accountId: string;
      originalInputHash: string;
      resumeInputHash: string;
      clientReferenceHash: string;
      requestedContentHash: string;
    },
  ): ReturnType<StoreOperations['claimCreationRecovery']> {
    return this.operation('claimCreationRecovery')(originalId, resumeJobId, bindings);
  }
  completeCreationRecovery(
    originalId: string,
    resumeJobId: string,
  ): ReturnType<StoreOperations['completeCreationRecovery']> {
    return this.operation('completeCreationRecovery')(originalId, resumeJobId);
  }
  getCreationRepairSuccessor(
    previousId: string,
  ): ReturnType<StoreOperations['getCreationRepairSuccessor']> {
    return this.operation('getCreationRepairSuccessor')(previousId);
  }
  getCreationRepairAncestorIds(
    originalId: string,
    recoveryId: string,
    previousId: string,
  ): ReturnType<StoreOperations['getCreationRepairAncestorIds']> {
    return this.operation('getCreationRepairAncestorIds')(originalId, recoveryId, previousId);
  }
  getCreationRepair(recoveryId: string): ReturnType<StoreOperations['getCreationRepair']> {
    return this.operation('getCreationRepair')(recoveryId);
  }
  claimCreationRepair(
    originalId: string,
    recoveryId: string,
    repairId: string,
    bindings: {
      accountId: string;
      originalInputHash: string;
      recoveryInputHash: string;
      repairInputHash: string;
      clientReferenceHash: string;
      requestedContentHash: string;
      desiredContentHash: string;
      expectedContentHash: string;
      requestedTitleHash: string;
      requestedBodyHash: string;
    },
    previousRepairId?: string,
  ): ReturnType<StoreOperations['claimCreationRepair']> {
    return this.operation('claimCreationRepair')(
      originalId,
      recoveryId,
      repairId,
      bindings,
      previousRepairId,
    );
  }
  completeCreationRepair(
    originalId: string,
    recoveryId: string,
    repairId: string,
  ): ReturnType<StoreOperations['completeCreationRepair']> {
    return this.operation('completeCreationRepair')(originalId, recoveryId, repairId);
  }
  getCurrent(accountId: string, scope = 'account'): ReturnType<StoreOperations['getCurrent']> {
    return this.operation('getCurrent')(accountId, scope);
  }
  getManifestForJob(
    accountId: string,
    jobId: string,
  ): ReturnType<StoreOperations['getManifestForJob']> {
    return this.operation('getManifestForJob')(accountId, jobId);
  }
  history(accountId: string, scope?: string): ReturnType<StoreOperations['history']> {
    return this.operation('history')(accountId, scope);
  }
}
