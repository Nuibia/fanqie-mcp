import { type Job, type Manifest } from '../runtime-error.js';
import {
  type NativeShortTrialOriginalAudit,
  type NativeShortTrialClosure,
  type NativeShortTrialReconciliationContext,
} from '../../../platform/short-native-trial-proof.js';

import {
  type NativeShortCoverOriginalAudit,
  type NativeShortCoverClosure,
  type NativeShortCoverReconciliationContext,
} from '../../../platform/short-native-cover-proof.js';

export type ReconcileNativeShortSubmissionWriteOperation = (
  originalJob: Job,
  readJob: Job,
  resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: unknown },
) => Job;

export type ValidateNativeShortTrialHistoryOperation = (job: Job) => {
  firstAudit: NativeShortTrialOriginalAudit | null;
  last: NativeShortTrialClosure | null;
};

export type GetNativeShortTrialOriginalAuditOperation = (
  jobId: string,
) => NativeShortTrialOriginalAudit;

export type AssertNativeShortTrialLiveSettlementOperation = (
  context: NativeShortTrialReconciliationContext,
) => void;

export type ReconcileNativeShortTrialWriteOperation = (
  originalJob: Job,
  readJob: Job,
  resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: unknown },
) => Job;

export type ValidateNativeShortCoverHistoryOperation = (job: Job) => {
  firstAudit: NativeShortCoverOriginalAudit | null;
  last: NativeShortCoverClosure | null;
};

export type GetNativeShortCoverOriginalAuditOperation = (
  jobId: string,
) => NativeShortCoverOriginalAudit;

export type AssertNativeShortCoverLiveSettlementOperation = (
  context: NativeShortCoverReconciliationContext,
) => void;

export type ReconcileNativeShortCoverWriteOperation = (
  originalJob: Job,
  readJob: Job,
  resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: unknown },
) => Job;

export type ReconcileWriteJobOperation = (
  originalId: string,
  reconciliationJobId: string,
  resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: unknown },
) => Job;
export type GetCreationRecoveryOperation = (
  originalId: string,
) => { resumeJobId: string; closedAt: string | null } | null;

export type ClaimCreationRecoveryOperation = (
  originalId: string,
  resumeJobId: string,
  bindings: {
    accountId: string;
    originalInputHash: string;
    resumeInputHash: string;
    clientReferenceHash: string;
    requestedContentHash: string;
  },
) => Job;

export type CompleteCreationRecoveryOperation = (originalId: string, resumeJobId: string) => Job;

export type GetCurrentOperation = (accountId: string, scope?: string) => Manifest | null;

export type HistoryOperation = (accountId: string, scope?: string) => Manifest[];
