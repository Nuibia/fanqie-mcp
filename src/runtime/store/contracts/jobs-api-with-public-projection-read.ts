import { type PublicReadPurpose } from '../../public-read.js';
import {
  type StoreReadPort,
  type Job,
  type SavedWriteTaskSummaryList,
  type JobKind,
  type RuntimeFailure,
  type EvidenceRef,
  type PlatformTarget,
  type Manifest,
  type EvidenceDocument,
} from '../runtime-error.js';
import { DatabaseSync } from 'node:sqlite';

import { type NewJob, type NativeReconciliationRow } from '../native-closure-signal.js';

import * as bodyProof from '../../../platform/short-native-body-proof.js';
import {
  type NativeShortBodyBusinessInput,
  type NativeShortBodyExpectation,
} from '../../../platform/short-native-body.js';
import { type NativeShortBodyStoreAuthority } from '../authority.js';

import {
  type NativeShortSubmissionAttemptRow,
  type NativeShortSubmissionOriginalAudit,
  type NativeShortSubmissionClosure,
  type NativeShortSubmissionReconciliationContext,
} from '../../../platform/short-native-submission-proof.js';

import { type NativeShortTrialAttemptRow } from '../../../platform/short-native-trial-proof.js';
import { type NativeShortCoverAttemptRow } from '../../../platform/short-native-cover-proof.js';

import {
  validateNativeShortReconciliationContext,
  type NativeShortClosure,
  type NativeShortOriginalAudit,
} from '../../../platform/short-native-metadata-proof.js';

export type WithPublicProjectionReadOperation = <T>(
  accountId: string,
  purpose: PublicReadPurpose,
  callback: () => T,
) => T;
export type MemoPublicProjectionOperation = <T>(
  namespace: string,
  key: unknown,
  compute: () => T,
) => T;
export type AssertPublicReadEntryAllowedOperation = () => void;
export type AssertPublicReadMutationAllowedOperation = () => void;

export type BindExistingSqlReadOperation = <T = unknown>(
  sql: string,
  mode: 'get' | 'all',
  params: readonly unknown[],
) => StoreReadPort<T>;

export type RawAccountAttemptRowsOperation = (
  accountId: string,
  mode?: 'tracked' | 'native',
) => ReturnType<ReturnType<DatabaseSync['prepare']>['all']>;

export type DecodeJobOperation = (row: Record<string, unknown>) => Job;

export type RawJobOperation = (id: string) => Job | null;

export type GetJobOperation = (id: string, accountId?: string) => Job | null;

export type ListKnownWriteTaskSummariesOperation = (accountId: string) => SavedWriteTaskSummaryList;

export type ListJobsOperation = (accountId?: string) => Job[];

export type GetJobForPublicProjectionOperation = (id: string, accountId: string) => Job | null;

export type ListJobsForPublicProjectionOperation = (accountId: string) => Job[];

export type FindIdempotentOperation = (
  accountId: string,
  kind: JobKind,
  operation: string,
  key: string,
) => Job | null;

export type CreateJobOperation = (input: NewJob) => { job: Job; created: boolean };

export type RunningJobOperation = (id: string) => Job;

export type StartJobOperation = (id: string) => Job;

export type AssertNotCancelledOperation = (job: Job) => void;

export type RequestCancellationOperation = (id: string, reason?: RuntimeFailure) => Job;
export type MarkPlatformReadStartedOperation = (id: string) => string;
export type MarkPlatformWriteStartedOperation = (id: string) => string;

export type ListNativeShortBodyAttemptsOperation = (
  jobId: string,
  accountId: string,
) => bodyProof.NativeShortBodyAttemptRow[];

export type PersistNativeShortBodyStageOperation = (
  jobId: string,
  kind: bodyProof.NativeShortBodyStageKind,
  payload: unknown,
  eventAt?: string,
) => bodyProof.NativeShortBodyRefLink;

export type GetNativeShortBodyRecoveryContextOperation = (
  jobId: string,
  accountId: string,
) => bodyProof.NativeShortBodyRecoveryContextV2 | undefined;

export type IssueNativeShortBodyWriteAuthorityOperation = (
  jobId: string,
  accountId: string,
  input: NativeShortBodyBusinessInput,
  expectedPlatformAccount: string,
) => NativeShortBodyStoreAuthority;

export type IssueNativeShortBodyReconciliationAuthorityOperation = (
  readJobId: string,
  accountId: string,
  originalJobId: string,
  audit: bodyProof.NativeShortBodyOriginalAudit,
  expectedPlatformAccount: string,
  recoveryContext?: bodyProof.NativeShortBodyRecoveryContextV2,
  comparisonPolicy?: 'native-short-body-derived-word-number/v2',
) => NativeShortBodyStoreAuthority;

export type CreateNativeShortBodyAuthorityOperation = (
  mode: 'write' | 'reconcile',
  jobId: string,
  accountId: string,
  business: NativeShortBodyBusinessInput,
  expectedPlatformAccount: string,
  audit: bodyProof.NativeShortBodyOriginalAudit | null,
  expectation: NativeShortBodyExpectation | null,
  recoveryContext?: bodyProof.NativeShortBodyRecoveryContextV2,
  comparisonPolicy?: 'native-short-body-derived-word-number/v2',
) => NativeShortBodyStoreAuthority;

export type ValidateNativeShortBodyHistoryOperation = (job: Job) => {
  firstAudit: bodyProof.NativeShortBodyOriginalAudit | null;
  last: bodyProof.NativeShortBodyClosure | null;
};

export type GetNativeShortBodyOriginalAuditOperation = (
  jobId: string,
  accountId: string,
  recoveryContext?: bodyProof.NativeShortBodyRecoveryContextV2,
) => bodyProof.NativeShortBodyOriginalAudit;

export type ValidateNativeShortBodyJobOperation = (
  job: Job,
  latest: NativeReconciliationRow | null,
) => void;

export type ReconcileNativeShortBodyWriteOperation = (
  original: Job,
  readJob: Job,
  resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: unknown },
) => Job;
export type GetNativeShortSubmissionPreparationOperation = (
  jobId: string,
  accountId: string,
) => import('../../../platform/short-native-submission-proof.js').NativeShortSubmissionPreparationContext;

export type ListNativeShortSubmissionAttemptsOperation = (
  jobId: string,
) => NativeShortSubmissionAttemptRow[];

export type RecordNativeShortSubmissionAttemptOperation = (
  jobId: string,
  ref: EvidenceRef,
) => NativeShortSubmissionAttemptRow;

export type ListNativeShortTrialAttemptsOperation = (jobId: string) => NativeShortTrialAttemptRow[];

export type RecordNativeShortTrialAttemptOperation = (
  jobId: string,
  ref: EvidenceRef,
) => NativeShortTrialAttemptRow;

export type ListNativeShortCoverAttemptsOperation = (jobId: string) => NativeShortCoverAttemptRow[];

export type RecordNativeShortCoverAttemptOperation = (
  jobId: string,
  phase: 'upload' | 'save',
  ref: EvidenceRef,
) => NativeShortCoverAttemptRow;

export type AddJobMetadataOperation = (id: string, values: Record<string, unknown>) => Job;

export type RecordTargetOperation = (id: string, value: PlatformTarget | string) => PlatformTarget;

export type CompleteReadJobOperation = (jobId: string, references: EvidenceRef[]) => Manifest;

export type CompleteWriteJobOperation = (jobId: string, result: unknown) => Job;

export type FailJobOperation = (jobId: string, error: RuntimeFailure) => Job;
export type RecoverInterruptedOperation = () => number;

export type ResolveOperatorEntryInvestigationOperation = (
  originalId: string,
  readJobId: string,
) => Job;

export type NativeRegistrationSignalOperation = (job: Job) => boolean;

export type NativeRegistrationRowsOperation = (original: Job) => Job[];

export type ValidateNativeRegistrationJobOperation = (job: Job) => void;

export type NativeLaterReadOperation = (
  originalId: string,
  readId: string,
) => { job: Job; manifest: Manifest; ref: EvidenceRef; document: EvidenceDocument };

export type AssertNativeLiveSettlementOperation = (
  checked: ReturnType<typeof validateNativeShortReconciliationContext>,
  documents: EvidenceDocument[],
  later: EvidenceDocument,
) => void;

export type ValidateNativeReconciliationRowOperation = (
  original: Job,
  refs: EvidenceRef[],
  documents: EvidenceDocument[],
  row: NativeReconciliationRow,
  first: NativeReconciliationRow,
) => { closure: NativeShortClosure; audit: NativeShortOriginalAudit };

export type ValidateNativeClosureOperation = (original: Job) => {
  firstAudit: NativeShortOriginalAudit;
  current: NativeShortClosure;
};

export type ReconcileNativeShortWriteOperation = (
  original: Job,
  readJob: Job,
  resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: unknown },
) => Job;

export type ValidateNativeShortSubmissionHistoryOperation = (job: Job) => {
  firstAudit: NativeShortSubmissionOriginalAudit | null;
  last: NativeShortSubmissionClosure | null;
};

export type GetNativeShortSubmissionOriginalAuditOperation = (
  jobId: string,
) => NativeShortSubmissionOriginalAudit;

export type AssertNativeShortSubmissionLiveSettlementOperation = (
  context: NativeShortSubmissionReconciliationContext,
  resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: Record<string, unknown> },
) => void;
