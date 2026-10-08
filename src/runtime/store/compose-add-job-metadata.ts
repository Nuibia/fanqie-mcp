import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import {
  createAddJobMetadata,
  createRecordTarget,
} from './operations/jobs-api-add-job-metadata.js';

import {
  createSaveEvidence,
  createInsertPhysicalEvidence,
  createListEvidence,
} from './operations/evidence-save-evidence.js';
import { createPreparePhysicalEvidence } from './operations/runtime-ownership-prepare-native-short-body-reconciliation.js';

export function composeAddJobMetadata(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.addJobMetadata = createAddJobMetadata({
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
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get genericWitness() {
      return owner.genericWitness.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get rawJob() {
      return owner.rawJob.bind(owner);
    },
    get ownerId() {
      return owner.ownerId;
    },
    set ownerId(value) {
      owner.ownerId = value;
    },
  });
  operations.recordTarget = createRecordTarget({
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
    get prepare() {
      return owner.prepare.bind(owner);
    },
  });
  operations.saveEvidence = createSaveEvidence({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get assertOwnership() {
      return owner.assertOwnership.bind(owner);
    },
    get runningJob() {
      return owner.runningJob.bind(owner);
    },
    get nativeShortSubmissionEvidenceMode() {
      return owner.nativeShortSubmissionEvidenceMode;
    },
    set nativeShortSubmissionEvidenceMode(value) {
      owner.nativeShortSubmissionEvidenceMode = value;
    },
    get genericShortStatusContext() {
      return owner.genericShortStatusContext;
    },
    set genericShortStatusContext(value) {
      owner.genericShortStatusContext = value;
    },
    get evidenceMode() {
      return owner.evidenceMode;
    },
    set evidenceMode(value) {
      owner.evidenceMode = value;
    },
    get explicitBodyReadEvidenceMode() {
      return owner.explicitBodyReadEvidenceMode;
    },
    set explicitBodyReadEvidenceMode(value) {
      owner.explicitBodyReadEvidenceMode = value;
    },
    get evidenceDirectory() {
      return owner.evidenceDirectory;
    },
    set evidenceDirectory(value) {
      owner.evidenceDirectory = value;
    },
    get transaction() {
      return owner.transaction.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
  });
  operations.preparePhysicalEvidence = createPreparePhysicalEvidence({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get evidenceMode() {
      return owner.evidenceMode;
    },
    set evidenceMode(value) {
      owner.evidenceMode = value;
    },
    get evidenceDirectory() {
      return owner.evidenceDirectory;
    },
    set evidenceDirectory(value) {
      owner.evidenceDirectory = value;
    },
  });
  operations.insertPhysicalEvidence = createInsertPhysicalEvidence({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
  });
  operations.listEvidence = createListEvidence({
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
}
