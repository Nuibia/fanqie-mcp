import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import { createCompleteCreationRecovery } from './operations/jobs-api-complete-creation-recovery.js';
import { createGetCreationRepairSuccessor } from './operations/creation-recovery-generic-creation-event.js';
import {
  createCreationRepairJobs,
  createCreationRepairPrior,
  createGetCreationRepairAncestorIds,
  createVerifyUnknownRepairChain,
} from './operations/creation-recovery-creation-repair-jobs.js';

export function composeCompleteCreationRecovery(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.completeCreationRecovery = createCompleteCreationRecovery({
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
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
    get genericWitness() {
      return owner.genericWitness.bind(owner);
    },
  });
  operations.getCreationRepairSuccessor = createGetCreationRepairSuccessor({
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
  operations.creationRepairJobs = createCreationRepairJobs({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get getJob() {
      return owner.getJob.bind(owner);
    },
  });
  operations.creationRepairPrior = createCreationRepairPrior({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
  });
  operations.getCreationRepairAncestorIds = createGetCreationRepairAncestorIds({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get creationRepairJobs() {
      return owner.creationRepairJobs.bind(owner);
    },
  });
  operations.verifyUnknownRepairChain = createVerifyUnknownRepairChain({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get creationRepairPrior() {
      return owner.creationRepairPrior.bind(owner);
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
    get getJob() {
      return owner.getJob.bind(owner);
    },
  });
}
