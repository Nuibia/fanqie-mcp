import { RuntimeError, type Job, type RuntimeFailure, type Manifest } from '../runtime-error.js';
import { PublicReadCoordinator } from '../../public-read.js';
import { type NativeShortSubmissionContext } from '../../../platform/short-native-submission-proof.js';
import {
  type ListEvidenceOperation,
  type ReadEvidenceOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

import {
  type ListNativeShortSubmissionAttemptsOperation,
  type GetNativeShortSubmissionPreparationOperation,
  type ListNativeShortTrialAttemptsOperation,
  type ListNativeShortCoverAttemptsOperation,
  type RawJobOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';

import {
  type NativeShortSubmissionContextOperation,
  type NativeShortTrialContextOperation,
  type NativeShortCoverContextOperation,
  type NativeShortSubmissionSettlementErrorOperation,
  type NativeShortSubmissionLaterReadOperation,
  type NativeShortTrialSettlementErrorOperation,
  type NativeShortTrialLaterReadOperation,
  type NativeShortCoverSettlementErrorOperation,
  type NativeShortCoverLaterReadOperation,
} from '../contracts/native-states-native-short-submission-context.js';
import { type NativeShortTrialContext } from '../../../platform/short-native-trial-proof.js';

import { type NativeShortCoverContext } from '../../../platform/short-native-cover-proof.js';

import { type PrepareOperation } from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';

interface NativeShortSubmissionContextDependencies {
  publicReads: PublicReadCoordinator;
  listEvidence: ListEvidenceOperation;
  readEvidence: ReadEvidenceOperation;
  listNativeShortSubmissionAttempts: ListNativeShortSubmissionAttemptsOperation;
  getNativeShortSubmissionPreparation: GetNativeShortSubmissionPreparationOperation;
}

export function createNativeShortSubmissionContext(
  deps: NativeShortSubmissionContextDependencies,
): NativeShortSubmissionContextOperation {
  function nativeShortSubmissionContext(job: Job): NativeShortSubmissionContext {
    return deps.publicReads.memo('store.nativeShortSubmissionContext', [job], () => {
      const refs = deps.listEvidence(job.id);
      if (refs.length > 16)
        throw new RuntimeError(
          'capability_unavailable',
          'Native short submission evidence is unavailable.',
        );
      const documents = refs.map((ref) => deps.readEvidence(ref));
      const preparationJobId = (documents[0]?.payload as any)?.businessInput?.preparationJobId;
      return {
        accountId: job.accountId,
        job,
        manifest: null,
        refs,
        documents,
        attempts: deps.listNativeShortSubmissionAttempts(job.id),
        preparation:
          typeof preparationJobId === 'string'
            ? deps.getNativeShortSubmissionPreparation(preparationJobId, job.accountId)
            : null,
      };
    });
  }
  return nativeShortSubmissionContext;
}

interface NativeShortTrialContextDependencies {
  publicReads: PublicReadCoordinator;
  listEvidence: ListEvidenceOperation;
  readEvidence: ReadEvidenceOperation;
  listNativeShortTrialAttempts: ListNativeShortTrialAttemptsOperation;
}

export function createNativeShortTrialContext(
  deps: NativeShortTrialContextDependencies,
): NativeShortTrialContextOperation {
  function nativeShortTrialContext(job: Job): NativeShortTrialContext {
    return deps.publicReads.memo('store.nativeShortTrialContext', [job], () => {
      const refs = deps.listEvidence(job.id);
      if (refs.length > 16)
        throw new RuntimeError(
          'capability_unavailable',
          'Native short trial evidence is unavailable.',
        );
      return {
        accountId: job.accountId,
        job,
        manifest: null,
        refs,
        documents: refs.map((ref) => deps.readEvidence(ref)),
        attempts: deps.listNativeShortTrialAttempts(job.id),
      };
    });
  }
  return nativeShortTrialContext;
}

interface NativeShortCoverContextDependencies {
  publicReads: PublicReadCoordinator;
  listEvidence: ListEvidenceOperation;
  readEvidence: ReadEvidenceOperation;
  listNativeShortCoverAttempts: ListNativeShortCoverAttemptsOperation;
}

export function createNativeShortCoverContext(
  deps: NativeShortCoverContextDependencies,
): NativeShortCoverContextOperation {
  function nativeShortCoverContext(job: Job): NativeShortCoverContext {
    return deps.publicReads.memo('store.nativeShortCoverContext', [job], () => {
      const refs = deps.listEvidence(job.id);
      if (refs.length > 16)
        throw new RuntimeError(
          'capability_unavailable',
          'Native short cover evidence is unavailable.',
        );
      return {
        accountId: job.accountId,
        job,
        manifest: null,
        refs,
        documents: refs.map((ref) => deps.readEvidence(ref)),
        attempts: deps.listNativeShortCoverAttempts(job.id),
      };
    });
  }
  return nativeShortCoverContext;
}

interface NativeShortSubmissionSettlementErrorDependencies {}

export function createNativeShortSubmissionSettlementError(
  deps: NativeShortSubmissionSettlementErrorDependencies,
): NativeShortSubmissionSettlementErrorOperation {
  function nativeShortSubmissionSettlementError(
    status: 'succeeded' | 'failed' | 'uncertain',
  ): RuntimeFailure | null {
    return status === 'succeeded'
      ? null
      : status === 'failed'
        ? {
            code: 'native_submission_rejected',
            message: 'The platform rejected this submission; the attempt will not be replayed.',
          }
        : {
            code: 'outcome_unknown',
            message: 'The later platform read still cannot determine the submission write outcome.',
          };
  }
  return nativeShortSubmissionSettlementError;
}

interface NativeShortSubmissionLaterReadDependencies {
  publicReads: PublicReadCoordinator;
  rawJob: RawJobOperation;
  listEvidence: ListEvidenceOperation;
  prepare: PrepareOperation;
  readEvidence: ReadEvidenceOperation;
}

export function createNativeShortSubmissionLaterRead(
  deps: NativeShortSubmissionLaterReadDependencies,
): NativeShortSubmissionLaterReadOperation {
  function nativeShortSubmissionLaterRead(readId: string) {
    return deps.publicReads.memo('store.nativeShortSubmissionLaterRead', [readId], () => {
      const readJob = deps.rawJob(readId),
        refs = deps.listEvidence(readId);
      const rows = deps
        .prepare('SELECT manifest_json FROM manifests WHERE job_id = ? LIMIT 2')
        .all(readId);
      if (
        !readJob ||
        refs.length !== 1 ||
        refs[0]!.dataset !== 'reconciliation' ||
        rows.length !== 1
      )
        throw Error('Invalid submission read');
      return {
        readJob,
        manifest: JSON.parse(String(rows[0]!.manifest_json)) as Manifest,
        ref: refs[0]!,
        document: deps.readEvidence(refs[0]!),
      };
    });
  }
  return nativeShortSubmissionLaterRead;
}

interface NativeShortTrialSettlementErrorDependencies {}

export function createNativeShortTrialSettlementError(
  deps: NativeShortTrialSettlementErrorDependencies,
): NativeShortTrialSettlementErrorOperation {
  function nativeShortTrialSettlementError(
    status: 'succeeded' | 'failed' | 'uncertain',
  ): RuntimeFailure | null {
    return status === 'succeeded'
      ? null
      : status === 'failed'
        ? {
            code: 'native_trial_not_saved',
            message: 'The later platform read confirms the trial change was not saved.',
          }
        : {
            code: 'outcome_unknown',
            message: 'The later platform read still cannot determine the trial write outcome.',
          };
  }
  return nativeShortTrialSettlementError;
}

interface NativeShortTrialLaterReadDependencies {
  publicReads: PublicReadCoordinator;
  rawJob: RawJobOperation;
  listEvidence: ListEvidenceOperation;
  prepare: PrepareOperation;
  readEvidence: ReadEvidenceOperation;
}

export function createNativeShortTrialLaterRead(
  deps: NativeShortTrialLaterReadDependencies,
): NativeShortTrialLaterReadOperation {
  function nativeShortTrialLaterRead(readId: string) {
    return deps.publicReads.memo('store.nativeShortTrialLaterRead', [readId], () => {
      const readJob = deps.rawJob(readId),
        refs = deps.listEvidence(readId);
      const rows = deps
        .prepare('SELECT manifest_json FROM manifests WHERE job_id = ? LIMIT 2')
        .all(readId);
      if (
        !readJob ||
        refs.length !== 1 ||
        refs[0]!.dataset !== 'reconciliation' ||
        rows.length !== 1
      )
        throw Error('Invalid trial read');
      return {
        readJob,
        manifest: JSON.parse(String(rows[0]!.manifest_json)) as Manifest,
        ref: refs[0]!,
        document: deps.readEvidence(refs[0]!),
      };
    });
  }
  return nativeShortTrialLaterRead;
}

interface NativeShortCoverSettlementErrorDependencies {}

export function createNativeShortCoverSettlementError(
  deps: NativeShortCoverSettlementErrorDependencies,
): NativeShortCoverSettlementErrorOperation {
  function nativeShortCoverSettlementError(
    status: 'succeeded' | 'failed' | 'uncertain',
  ): RuntimeFailure | null {
    return status === 'succeeded'
      ? null
      : status === 'failed'
        ? {
            code: 'native_cover_save_not_attempted',
            message:
              'The image was uploaded but draft saving was not attempted; an orphan may remain.',
          }
        : {
            code: 'outcome_unknown',
            message: 'The later platform read still cannot determine the cover write outcome.',
          };
  }
  return nativeShortCoverSettlementError;
}

interface NativeShortCoverLaterReadDependencies {
  publicReads: PublicReadCoordinator;
  rawJob: RawJobOperation;
  listEvidence: ListEvidenceOperation;
  prepare: PrepareOperation;
  readEvidence: ReadEvidenceOperation;
}

export function createNativeShortCoverLaterRead(
  deps: NativeShortCoverLaterReadDependencies,
): NativeShortCoverLaterReadOperation {
  function nativeShortCoverLaterRead(readId: string) {
    return deps.publicReads.memo('store.nativeShortCoverLaterRead', [readId], () => {
      const readJob = deps.rawJob(readId),
        refs = deps.listEvidence(readId);
      const rows = deps
        .prepare('SELECT manifest_json FROM manifests WHERE job_id = ? LIMIT 2')
        .all(readId);
      if (
        !readJob ||
        refs.length !== 1 ||
        refs[0]!.dataset !== 'reconciliation' ||
        rows.length !== 1
      )
        throw Error('Invalid cover read');
      return {
        readJob,
        manifest: JSON.parse(String(rows[0]!.manifest_json)) as Manifest,
        ref: refs[0]!,
        document: deps.readEvidence(refs[0]!),
      };
    });
  }
  return nativeShortCoverLaterRead;
}
