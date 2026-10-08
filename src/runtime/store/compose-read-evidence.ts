import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import {
  createReadEvidence,
  createReadEvidenceFresh,
} from './operations/evidence-save-evidence.js';

import { createCompleteReadJob } from './operations/jobs-api-complete-read-job.js';
import {
  createCompleteWriteJob,
  createFailJob,
  createRecoverInterrupted,
} from './operations/jobs-api-complete-write-job.js';

export function composeReadEvidence(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.readEvidence = createReadEvidence({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get bindEvidenceRead() {
      return owner.bindEvidenceRead.bind(owner);
    },
  });
  operations.readEvidenceFresh = createReadEvidenceFresh({
    get ensureOpen() {
      return owner.ensureOpen.bind(owner);
    },
    get evidenceDirectory() {
      return owner.evidenceDirectory;
    },
    set evidenceDirectory(value) {
      owner.evidenceDirectory = value;
    },
  });
  operations.completeReadJob = createCompleteReadJob({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get transaction() {
      return owner.transaction.bind(owner);
    },
    get runningJob() {
      return owner.runningJob.bind(owner);
    },
    get assertNotCancelled() {
      return owner.assertNotCancelled.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
    get getJob() {
      return owner.getJob.bind(owner);
    },
    get getNativeShortSubmissionOriginalAudit() {
      return owner.getNativeShortSubmissionOriginalAudit.bind(owner);
    },
    get nativeShortSubmissionContext() {
      return owner.nativeShortSubmissionContext.bind(owner);
    },
    get nativeShortBodyRecoveryFromPayload() {
      return owner.nativeShortBodyRecoveryFromPayload.bind(owner);
    },
    get rawJob() {
      return owner.rawJob.bind(owner);
    },
    get getNativeShortBodyOriginalAudit() {
      return owner.getNativeShortBodyOriginalAudit.bind(owner);
    },
    get nativeShortBodyContext() {
      return owner.nativeShortBodyContext.bind(owner);
    },
    get getNativeShortTrialOriginalAudit() {
      return owner.getNativeShortTrialOriginalAudit.bind(owner);
    },
    get nativeShortTrialContext() {
      return owner.nativeShortTrialContext.bind(owner);
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get getCurrent() {
      return owner.getCurrent.bind(owner);
    },
    get genericWitness() {
      return owner.genericWitness.bind(owner);
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
  operations.completeWriteJob = createCompleteWriteJob({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get transaction() {
      return owner.transaction.bind(owner);
    },
    get runningJob() {
      return owner.runningJob.bind(owner);
    },
    get assertNotCancelled() {
      return owner.assertNotCancelled.bind(owner);
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
    get nativeShortSubmissionContext() {
      return owner.nativeShortSubmissionContext.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get getJob() {
      return owner.getJob.bind(owner);
    },
    get nativeShortBodySignal() {
      return owner.nativeShortBodySignal.bind(owner);
    },
    get nativeShortBodyContext() {
      return owner.nativeShortBodyContext.bind(owner);
    },
    get nativeShortTrialContext() {
      return owner.nativeShortTrialContext.bind(owner);
    },
    get nativeShortCoverContext() {
      return owner.nativeShortCoverContext.bind(owner);
    },
    get genericWitness() {
      return owner.genericWitness.bind(owner);
    },
    get genericMutationGraph() {
      return owner.genericMutationGraph.bind(owner);
    },
    get genericQualifyWrite() {
      return owner.genericQualifyWrite.bind(owner);
    },
  });
  operations.failJob = createFailJob({
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
    terminal: globals.terminal,
    get ownerId() {
      return owner.ownerId;
    },
    set ownerId(value) {
      owner.ownerId = value;
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
  });
  operations.recoverInterrupted = createRecoverInterrupted({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get transaction() {
      return owner.transaction.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get ownerId() {
      return owner.ownerId;
    },
    set ownerId(value) {
      owner.ownerId = value;
    },
    get decodeJob() {
      return owner.decodeJob.bind(owner);
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
  });
}
