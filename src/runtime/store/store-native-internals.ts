import { type Job, type EvidenceRef, type EvidenceDocument } from './runtime-error.js';
import { timestamp, type NativeReconciliationRow } from './native-closure-signal.js';
import * as bodyProof from '../../platform/short-native-body-proof.js';

import { type NativeShortTrialReconciliationContext } from '../../platform/short-native-trial-proof.js';
import { type NativeShortSubmissionReconciliationContext } from '../../platform/short-native-submission-proof.js';
import { type NativeShortCoverReconciliationContext } from '../../platform/short-native-cover-proof.js';
import {
  type NativeShortCompensationAuthority,
  type NativeShortCompensationSourceContext,
  validateNativeShortReconciliationContext,
} from '../../platform/short-native-metadata-proof.js';
import {
  type NativeShortBodyBusinessInput,
  type NativeShortBodyExpectation,
} from '../../platform/short-native-body.js';

import { type StoreOperations } from './operations.js';
import { StoreOperationHost } from './operation-host.js';
export class StoreNativeInternals extends StoreOperationHost {
  private nativeShortBodySignal(
    job: Job,
    closureJson?: string,
  ): ReturnType<StoreOperations['nativeShortBodySignal']> {
    return this.operation('nativeShortBodySignal')(job, closureJson);
  }
  private nativeShortBodyContext(job: Job): ReturnType<StoreOperations['nativeShortBodyContext']> {
    return this.operation('nativeShortBodyContext')(job);
  }
  private nativeShortBodyStage(
    job: Job,
    kind: bodyProof.NativeShortBodyStageKind,
    payload: unknown,
    eventAt: string,
  ): ReturnType<StoreOperations['nativeShortBodyStage']> {
    return this.operation('nativeShortBodyStage')(job, kind, payload, eventAt);
  }
  private persistNativeShortBodyStage(
    jobId: string,
    kind: bodyProof.NativeShortBodyStageKind,
    payload: unknown,
    eventAt = timestamp(),
  ): ReturnType<StoreOperations['persistNativeShortBodyStage']> {
    return this.operation('persistNativeShortBodyStage')(jobId, kind, payload, eventAt);
  }
  private nativeShortBodyIssuer(): ReturnType<StoreOperations['nativeShortBodyIssuer']> {
    return this.operation('nativeShortBodyIssuer')();
  }
  private nativeShortBodyRecoveryFreshRead(
    recovery: bodyProof.NativeShortBodyOwnedGetRecoveryV2,
    accountId: string,
  ): ReturnType<StoreOperations['nativeShortBodyRecoveryFreshRead']> {
    return this.operation('nativeShortBodyRecoveryFreshRead')(recovery, accountId);
  }
  private nativeShortBodyRecoveryFromPayload(
    input: unknown,
    accountId: string,
  ): ReturnType<StoreOperations['nativeShortBodyRecoveryFromPayload']> {
    return this.operation('nativeShortBodyRecoveryFromPayload')(input, accountId);
  }
  private nativeShortBodyReconciliationRows(
    originalJobId: string,
    accountId: string,
    recovery?: bodyProof.NativeShortBodyOwnedGetRecoveryV2,
  ): ReturnType<StoreOperations['nativeShortBodyReconciliationRows']> {
    return this.operation('nativeShortBodyReconciliationRows')(originalJobId, accountId, recovery);
  }
  private createNativeShortBodyAuthority(
    mode: 'write' | 'reconcile',
    jobId: string,
    accountId: string,
    business: NativeShortBodyBusinessInput,
    expectedPlatformAccount: string,
    audit: bodyProof.NativeShortBodyOriginalAudit | null,
    expectation: NativeShortBodyExpectation | null,
    recoveryContext?: bodyProof.NativeShortBodyRecoveryContextV2,
    comparisonPolicy?: 'native-short-body-derived-word-number/v2',
  ): ReturnType<StoreOperations['createNativeShortBodyAuthority']> {
    return this.operation('createNativeShortBodyAuthority')(
      mode,
      jobId,
      accountId,
      business,
      expectedPlatformAccount,
      audit,
      expectation,
      recoveryContext,
      comparisonPolicy,
    );
  }
  private nativeShortBodyLaterRead(
    readId: string,
  ): ReturnType<StoreOperations['nativeShortBodyLaterRead']> {
    return this.operation('nativeShortBodyLaterRead')(readId);
  }
  private nativeShortBodySettlementError(
    status: 'succeeded' | 'failed' | 'uncertain',
  ): ReturnType<StoreOperations['nativeShortBodySettlementError']> {
    return this.operation('nativeShortBodySettlementError')(status);
  }
  private validateNativeShortBodyHistory(
    job: Job,
  ): ReturnType<StoreOperations['validateNativeShortBodyHistory']> {
    return this.operation('validateNativeShortBodyHistory')(job);
  }
  private validateNativeShortBodyJob(
    job: Job,
    latest: NativeReconciliationRow | null,
  ): ReturnType<StoreOperations['validateNativeShortBodyJob']> {
    return this.operation('validateNativeShortBodyJob')(job, latest);
  }
  private reconcileNativeShortBodyWrite(
    original: Job,
    readJob: Job,
    resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: unknown },
  ): ReturnType<StoreOperations['reconcileNativeShortBodyWrite']> {
    return this.operation('reconcileNativeShortBodyWrite')(original, readJob, resolution);
  }
  private nativeShortSubmissionContext(
    job: Job,
  ): ReturnType<StoreOperations['nativeShortSubmissionContext']> {
    return this.operation('nativeShortSubmissionContext')(job);
  }
  private nativeShortTrialContext(
    job: Job,
  ): ReturnType<StoreOperations['nativeShortTrialContext']> {
    return this.operation('nativeShortTrialContext')(job);
  }
  private nativeShortCoverContext(
    job: Job,
  ): ReturnType<StoreOperations['nativeShortCoverContext']> {
    return this.operation('nativeShortCoverContext')(job);
  }
  private validateNativeCompensationSourceIdentity(
    authority: NativeShortCompensationAuthority,
  ): ReturnType<StoreOperations['validateNativeCompensationSourceIdentity']> {
    return this.operation('validateNativeCompensationSourceIdentity')(authority);
  }
  private validateNativeCompensationInstalledSource(
    authority: NativeShortCompensationAuthority,
  ): ReturnType<StoreOperations['validateNativeCompensationInstalledSource']> {
    return this.operation('validateNativeCompensationInstalledSource')(authority);
  }
  private nativeBoundedReferences(
    jobId: string,
    maximum: number,
  ): ReturnType<StoreOperations['nativeBoundedReferences']> {
    return this.operation('nativeBoundedReferences')(jobId, maximum);
  }
  private nativeRegistrationSignal(
    job: Job,
  ): ReturnType<StoreOperations['nativeRegistrationSignal']> {
    return this.operation('nativeRegistrationSignal')(job);
  }
  private nativeRegistrationRows(
    original: Job,
  ): ReturnType<StoreOperations['nativeRegistrationRows']> {
    return this.operation('nativeRegistrationRows')(original);
  }
  private nativeCompensationSource(
    originalId: string,
    registration: Job | null,
    supplied?: { operatorJobId: string; authority: NativeShortCompensationAuthority },
  ): ReturnType<StoreOperations['nativeCompensationSource']> {
    return this.operation('nativeCompensationSource')(originalId, registration, supplied);
  }
  private validateNativeRegistrationJob(
    job: Job,
  ): ReturnType<StoreOperations['validateNativeRegistrationJob']> {
    return this.operation('validateNativeRegistrationJob')(job);
  }
  private validateNativeCompensatedClosure(
    original: Job,
  ): ReturnType<StoreOperations['validateNativeCompensatedClosure']> {
    return this.operation('validateNativeCompensatedClosure')(original);
  }
  private reconcileNativeCompensation(
    source: NativeShortCompensationSourceContext,
    readJob: Job,
    resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: unknown },
  ): ReturnType<StoreOperations['reconcileNativeCompensation']> {
    return this.operation('reconcileNativeCompensation')(source, readJob, resolution);
  }
  private nativeReconciliationRow(
    originalId: string,
    position: 'first' | 'last',
    before?: number,
  ): ReturnType<StoreOperations['nativeReconciliationRow']> {
    return this.operation('nativeReconciliationRow')(originalId, position, before);
  }
  private nativeLaterRead(
    originalId: string,
    readId: string,
  ): ReturnType<StoreOperations['nativeLaterRead']> {
    return this.operation('nativeLaterRead')(originalId, readId);
  }
  private nativeOriginalEvidence(
    original: Job,
  ): ReturnType<StoreOperations['nativeOriginalEvidence']> {
    return this.operation('nativeOriginalEvidence')(original);
  }
  private assertNativeLiveSettlement(
    checked: ReturnType<typeof validateNativeShortReconciliationContext>,
    documents: EvidenceDocument[],
    later: EvidenceDocument,
  ): ReturnType<StoreOperations['assertNativeLiveSettlement']> {
    return this.operation('assertNativeLiveSettlement')(checked, documents, later);
  }
  private validateNativeReconciliationRow(
    original: Job,
    refs: EvidenceRef[],
    documents: EvidenceDocument[],
    row: NativeReconciliationRow,
    first: NativeReconciliationRow,
  ): ReturnType<StoreOperations['validateNativeReconciliationRow']> {
    return this.operation('validateNativeReconciliationRow')(original, refs, documents, row, first);
  }
  private validateNativeClosure(
    original: Job,
  ): ReturnType<StoreOperations['validateNativeClosure']> {
    return this.operation('validateNativeClosure')(original);
  }
  private reconcileNativeShortWrite(
    original: Job,
    readJob: Job,
    resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: unknown },
  ): ReturnType<StoreOperations['reconcileNativeShortWrite']> {
    return this.operation('reconcileNativeShortWrite')(original, readJob, resolution);
  }
  private nativeShortSubmissionSettlementError(
    status: 'succeeded' | 'failed' | 'uncertain',
  ): ReturnType<StoreOperations['nativeShortSubmissionSettlementError']> {
    return this.operation('nativeShortSubmissionSettlementError')(status);
  }
  private nativeShortSubmissionLaterRead(
    readId: string,
  ): ReturnType<StoreOperations['nativeShortSubmissionLaterRead']> {
    return this.operation('nativeShortSubmissionLaterRead')(readId);
  }
  private validateNativeShortSubmissionHistory(
    job: Job,
  ): ReturnType<StoreOperations['validateNativeShortSubmissionHistory']> {
    return this.operation('validateNativeShortSubmissionHistory')(job);
  }
  private assertNativeShortSubmissionLiveSettlement(
    context: NativeShortSubmissionReconciliationContext,
    resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: Record<string, unknown> },
  ): ReturnType<StoreOperations['assertNativeShortSubmissionLiveSettlement']> {
    return this.operation('assertNativeShortSubmissionLiveSettlement')(context, resolution);
  }
  private reconcileNativeShortSubmissionWrite(
    originalJob: Job,
    readJob: Job,
    resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: unknown },
  ): ReturnType<StoreOperations['reconcileNativeShortSubmissionWrite']> {
    return this.operation('reconcileNativeShortSubmissionWrite')(originalJob, readJob, resolution);
  }
  private nativeShortTrialSettlementError(
    status: 'succeeded' | 'failed' | 'uncertain',
  ): ReturnType<StoreOperations['nativeShortTrialSettlementError']> {
    return this.operation('nativeShortTrialSettlementError')(status);
  }
  private nativeShortTrialLaterRead(
    readId: string,
  ): ReturnType<StoreOperations['nativeShortTrialLaterRead']> {
    return this.operation('nativeShortTrialLaterRead')(readId);
  }
  private validateNativeShortTrialHistory(
    job: Job,
  ): ReturnType<StoreOperations['validateNativeShortTrialHistory']> {
    return this.operation('validateNativeShortTrialHistory')(job);
  }
  private assertNativeShortTrialLiveSettlement(
    context: NativeShortTrialReconciliationContext,
  ): ReturnType<StoreOperations['assertNativeShortTrialLiveSettlement']> {
    return this.operation('assertNativeShortTrialLiveSettlement')(context);
  }
  private reconcileNativeShortTrialWrite(
    originalJob: Job,
    readJob: Job,
    resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: unknown },
  ): ReturnType<StoreOperations['reconcileNativeShortTrialWrite']> {
    return this.operation('reconcileNativeShortTrialWrite')(originalJob, readJob, resolution);
  }
  private nativeShortCoverSettlementError(
    status: 'succeeded' | 'failed' | 'uncertain',
  ): ReturnType<StoreOperations['nativeShortCoverSettlementError']> {
    return this.operation('nativeShortCoverSettlementError')(status);
  }
  private nativeShortCoverLaterRead(
    readId: string,
  ): ReturnType<StoreOperations['nativeShortCoverLaterRead']> {
    return this.operation('nativeShortCoverLaterRead')(readId);
  }
  private validateNativeShortCoverHistory(
    job: Job,
  ): ReturnType<StoreOperations['validateNativeShortCoverHistory']> {
    return this.operation('validateNativeShortCoverHistory')(job);
  }
  private assertNativeShortCoverLiveSettlement(
    context: NativeShortCoverReconciliationContext,
  ): ReturnType<StoreOperations['assertNativeShortCoverLiveSettlement']> {
    return this.operation('assertNativeShortCoverLiveSettlement')(context);
  }
  private reconcileNativeShortCoverWrite(
    originalJob: Job,
    readJob: Job,
    resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: unknown },
  ): ReturnType<StoreOperations['reconcileNativeShortCoverWrite']> {
    return this.operation('reconcileNativeShortCoverWrite')(originalJob, readJob, resolution);
  }
}
