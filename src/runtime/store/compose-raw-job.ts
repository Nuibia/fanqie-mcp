import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import { createRawJob, createGetJob } from './operations/jobs-api-with-public-projection-read.js';

import {
  createListKnownWriteTaskSummaries,
  createListJobs,
  createGetJobForPublicProjection,
  createListJobsForPublicProjection,
} from './operations/jobs-api-list-known-write-task-summaries.js';

export function composeRawJob(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.rawJob = createRawJob({
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
    get decodeJob() {
      return owner.decodeJob.bind(owner);
    },
  });
  operations.getJob = createGetJob({
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
    get nativeReconciliationRow() {
      return owner.nativeReconciliationRow.bind(owner);
    },
    get decodeJob() {
      return owner.decodeJob.bind(owner);
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
    get validateNativeShortSubmissionHistory() {
      return owner.validateNativeShortSubmissionHistory.bind(owner);
    },
    get nativeShortSubmissionSettlementError() {
      return owner.nativeShortSubmissionSettlementError.bind(owner);
    },
    get nativeShortSubmissionContext() {
      return owner.nativeShortSubmissionContext.bind(owner);
    },
    get nativeShortSubmissionLaterRead() {
      return owner.nativeShortSubmissionLaterRead.bind(owner);
    },
    get rawJob() {
      return owner.rawJob.bind(owner);
    },
    get getNativeShortSubmissionOriginalAudit() {
      return owner.getNativeShortSubmissionOriginalAudit.bind(owner);
    },
    get nativeShortBodySignal() {
      return owner.nativeShortBodySignal.bind(owner);
    },
    get validateNativeShortBodyJob() {
      return owner.validateNativeShortBodyJob.bind(owner);
    },
    get validateNativeShortTrialHistory() {
      return owner.validateNativeShortTrialHistory.bind(owner);
    },
    get nativeShortTrialSettlementError() {
      return owner.nativeShortTrialSettlementError.bind(owner);
    },
    get nativeShortTrialContext() {
      return owner.nativeShortTrialContext.bind(owner);
    },
    get nativeShortTrialLaterRead() {
      return owner.nativeShortTrialLaterRead.bind(owner);
    },
    get getNativeShortTrialOriginalAudit() {
      return owner.getNativeShortTrialOriginalAudit.bind(owner);
    },
    get validateNativeShortCoverHistory() {
      return owner.validateNativeShortCoverHistory.bind(owner);
    },
    get nativeShortCoverSettlementError() {
      return owner.nativeShortCoverSettlementError.bind(owner);
    },
    get nativeShortCoverContext() {
      return owner.nativeShortCoverContext.bind(owner);
    },
    get nativeShortCoverLaterRead() {
      return owner.nativeShortCoverLaterRead.bind(owner);
    },
    get getNativeShortCoverOriginalAudit() {
      return owner.getNativeShortCoverOriginalAudit.bind(owner);
    },
    get nativeRegistrationSignal() {
      return owner.nativeRegistrationSignal.bind(owner);
    },
    get validateNativeRegistrationJob() {
      return owner.validateNativeRegistrationJob.bind(owner);
    },
    get validateNativeCompensatedClosure() {
      return owner.validateNativeCompensatedClosure.bind(owner);
    },
    get validateNativeClosure() {
      return owner.validateNativeClosure.bind(owner);
    },
  });
  operations.listKnownWriteTaskSummaries = createListKnownWriteTaskSummaries({
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
    WRITE_TASK_STATUSES: globals.WRITE_TASK_STATUSES,
  });
  operations.listJobs = createListJobs({
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
    get getJob() {
      return owner.getJob.bind(owner);
    },
  });
  operations.getJobForPublicProjection = createGetJobForPublicProjection({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get getJob() {
      return owner.getJob.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get decodeJob() {
      return owner.decodeJob.bind(owner);
    },
  });
  operations.listJobsForPublicProjection = createListJobsForPublicProjection({
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
    get getJobForPublicProjection() {
      return owner.getJobForPublicProjection.bind(owner);
    },
  });
}
