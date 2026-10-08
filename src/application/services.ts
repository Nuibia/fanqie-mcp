import {
  type RejectBindingOperation,
  type PersistBindingOperation,
  type BindIdentityOperation,
  type CheckLoginOperation,
  type RequireLoginOperation,
  type ReadAccountPageOperation,
  type CollectedAccountDatasetOperation,
} from './contracts/identity.js';

import {
  type RefsForOperation,
  type UnavailableNativeViewOperation,
  type PublicJobOperation,
  type IsExplicitBodyReadOperation,
  type ExplicitBodyReadViewOperation,
  type JobManifestOperation,
  type NativeOriginalContextOperation,
  type NativeReconciliationContextOperation,
  type NativeClosureContextOperation,
} from './contracts/evidence-context.js';

import {
  type UnavailableDirectoryProjectionOperation,
  type DirectoryViewOperation,
  type EvidenceViewOperation,
  type OutputJobOperation,
  type ListedJobOperation,
} from './contracts/evidence-projection.js';

import {
  type CompletedOperation,
  type WaitOperation,
  type ManifestViewOperation,
  type SnapshotOperation,
  type CollectOperation,
  type RefreshOperation,
  type EnqueueNativeShortMetadataReadOperation,
} from './contracts/query.js';

import {
  type NativeBoundAccountOperation,
  type CapabilitiesOperation,
  type StatusOperation,
  type PlatformAccountOperation,
} from './contracts/capabilities.js';

import {
  type GenericCaptureOperation,
  type ModernShortProfileOperation,
  type BeginGenericShortStatusOperation,
  type AdvanceGenericShortStatusOperation,
  type BindGenericShortTargetOperation,
  type PersistGenericShortObservationOperation,
  type GenericCanonicalResultOperation,
  type GenericShortRunOperation,
  type RetainGenericShortContextOperation,
  type GenericBusinessExecutionOperation,
} from './contracts/generic-write.js';

import {
  type WriteOptionsOperation,
  type RuntimeTargetOperation,
  type ExecuteWriteOperation,
  type ExecuteNativeShortBodyWriteOperation,
  type SubmissionOptionsOperation,
  type ExecuteNativeShortSubmissionWriteOperation,
  type ExecuteNativeShortTrialWriteOperation,
  type ExecuteNativeShortCoverWriteOperation,
  type ExecuteNativeShortMetadataWriteOperation,
  type BookWriteOptionsOperation,
  type ExecuteBookMetadataWriteOperation,
} from './contracts/maintenance.js';

import {
  type ResumeCreateDraftOperation,
  type RepairCreatedDraftOperation,
} from './contracts/creation-recovery.js';

import {
  type NativeAuditBeforeReadOperation,
  type ReconcileNativeShortMetadataOperation,
  type ReconcileNativeCompensationOperation,
  type ReconcileBookMetadataOperation,
} from './contracts/reconciliation.js';

import {
  type RequireEditorWritesEnabledOperation,
  type ReceiveCoverOperation,
  type CaptureSubmissionToolInputOperation,
  type RawTrialToolSignalOperation,
  type CaptureTrialToolInputOperation,
  type RawBodyToolSignalOperation,
  type CaptureBodyToolInputOperation,
  type CaptureDirectoryToolInputOperation,
  type ToolOperation,
} from './contracts/tool-input.js';

import {
  type CallOperation,
  type AbortForLeaseLossOperation,
  type CloseOwnedOperation,
} from './contracts/lifecycle.js';

export interface ApplicationServices {
  rejectBinding: RejectBindingOperation;
  persistBinding: PersistBindingOperation;
  bindIdentity: BindIdentityOperation;
  checkLogin: CheckLoginOperation;
  requireLogin: RequireLoginOperation;
  readAccountPage: ReadAccountPageOperation;
  collectedAccountDataset: CollectedAccountDatasetOperation;
  refsFor: RefsForOperation;
  unavailableNativeView: UnavailableNativeViewOperation;
  publicJob: PublicJobOperation;
  isExplicitBodyRead: IsExplicitBodyReadOperation;
  explicitBodyReadView: ExplicitBodyReadViewOperation;
  jobManifest: JobManifestOperation;
  nativeOriginalContext: NativeOriginalContextOperation;
  nativeReconciliationContext: NativeReconciliationContextOperation;
  nativeClosureContext: NativeClosureContextOperation;
  unavailableDirectoryProjection: UnavailableDirectoryProjectionOperation;
  directoryView: DirectoryViewOperation;
  evidenceView: EvidenceViewOperation;
  outputJob: OutputJobOperation;
  listedJob: ListedJobOperation;
  completed: CompletedOperation;
  wait: WaitOperation;
  manifestView: ManifestViewOperation;
  snapshot: SnapshotOperation;
  collect: CollectOperation;
  refresh: RefreshOperation;
  nativeBoundAccount: NativeBoundAccountOperation;
  capabilities: CapabilitiesOperation;
  status: StatusOperation;
  platformAccount: PlatformAccountOperation;
  genericCapture: GenericCaptureOperation;
  modernShortProfile: ModernShortProfileOperation;
  beginGenericShortStatus: BeginGenericShortStatusOperation;
  advanceGenericShortStatus: AdvanceGenericShortStatusOperation;
  bindGenericShortTarget: BindGenericShortTargetOperation;
  persistGenericShortObservation: PersistGenericShortObservationOperation;
  genericCanonicalResult: GenericCanonicalResultOperation;
  genericShortRun: GenericShortRunOperation;
  retainGenericShortContext: RetainGenericShortContextOperation;
  genericBusinessExecution: GenericBusinessExecutionOperation;
  writeOptions: WriteOptionsOperation;
  runtimeTarget: RuntimeTargetOperation;
  executeWrite: ExecuteWriteOperation;
  executeNativeShortBodyWrite: ExecuteNativeShortBodyWriteOperation;
  submissionOptions: SubmissionOptionsOperation;
  executeNativeShortSubmissionWrite: ExecuteNativeShortSubmissionWriteOperation;
  executeNativeShortTrialWrite: ExecuteNativeShortTrialWriteOperation;
  executeNativeShortCoverWrite: ExecuteNativeShortCoverWriteOperation;
  executeNativeShortMetadataWrite: ExecuteNativeShortMetadataWriteOperation;
  bookWriteOptions: BookWriteOptionsOperation;
  executeBookMetadataWrite: ExecuteBookMetadataWriteOperation;
  resumeCreateDraft: ResumeCreateDraftOperation;
  repairCreatedDraft: RepairCreatedDraftOperation;
  nativeAuditBeforeRead: NativeAuditBeforeReadOperation;
  reconcileNativeShortMetadata: ReconcileNativeShortMetadataOperation;
  reconcileNativeCompensation: ReconcileNativeCompensationOperation;
  reconcileBookMetadata: ReconcileBookMetadataOperation;
  requireEditorWritesEnabled: RequireEditorWritesEnabledOperation;
  receiveCover: ReceiveCoverOperation;
  captureSubmissionToolInput: CaptureSubmissionToolInputOperation;
  rawTrialToolSignal: RawTrialToolSignalOperation;
  captureTrialToolInput: CaptureTrialToolInputOperation;
  rawBodyToolSignal: RawBodyToolSignalOperation;
  captureBodyToolInput: CaptureBodyToolInputOperation;
  captureDirectoryToolInput: CaptureDirectoryToolInputOperation;
  tool: ToolOperation;
  enqueueNativeShortMetadataRead: EnqueueNativeShortMetadataReadOperation;
  call: CallOperation;
  abortForLeaseLoss: AbortForLeaseLossOperation;
  closeOwned: CloseOwnedOperation;
}
