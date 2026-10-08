import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import { createGetCreationRepair } from './operations/creation-recovery-creation-repair-jobs.js';
import { createClaimCreationRepair } from './operations/creation-recovery-claim-creation-repair.js';
import { createCompleteCreationRepair } from './operations/creation-recovery-complete-creation-repair.js';
import {
  createGetCurrent,
  createHistory,
} from './operations/jobs-api-complete-creation-recovery.js';
import { createGetManifestForJob } from './operations/evidence-native-bounded-references.js';

export function composeGetCreationRepair(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.getCreationRepair = createGetCreationRepair({
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
  operations.claimCreationRepair = createClaimCreationRepair({
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
    get prepare() {
      return owner.prepare.bind(owner);
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
    get creationRepairJobs() {
      return owner.creationRepairJobs.bind(owner);
    },
    get verifyUnknownRepairChain() {
      return owner.verifyUnknownRepairChain.bind(owner);
    },
    get listJobs() {
      return owner.listJobs.bind(owner);
    },
    get genericRepairEntry() {
      return owner.genericRepairEntry.bind(owner);
    },
    get creationRepairPrior() {
      return owner.creationRepairPrior.bind(owner);
    },
  });
  operations.completeCreationRepair = createCompleteCreationRepair({
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
    get getJob() {
      return owner.getJob.bind(owner);
    },
    get creationRepairJobs() {
      return owner.creationRepairJobs.bind(owner);
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get creationRepairPrior() {
      return owner.creationRepairPrior.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
    get genericWitness() {
      return owner.genericWitness.bind(owner);
    },
  });
  operations.getCurrent = createGetCurrent({
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
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
    get getJob() {
      return owner.getJob.bind(owner);
    },
    get getManifestForJob() {
      return owner.getManifestForJob.bind(owner);
    },
  });
  operations.getManifestForJob = createGetManifestForJob({
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
    get nativeRegistrationSignal() {
      return owner.nativeRegistrationSignal.bind(owner);
    },
  });
  operations.history = createHistory({
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
    get getManifestForJob() {
      return owner.getManifestForJob.bind(owner);
    },
  });
}
