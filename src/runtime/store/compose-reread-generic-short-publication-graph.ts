import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import { createRereadGenericShortPublicationGraph } from './operations/generic-status-reread-generic-short-publication-graph.js';
import { createGenericWitness } from './operations/generic-status-generic-witness.js';
import {
  createGenericPointer,
  createGenericPrefix,
  createGenericSettlementError,
  createGenericModernObservations,
} from './operations/generic-status-generic-pointer.js';

export function composeRereadGenericShortPublicationGraph(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.rereadGenericShortPublicationGraph = createRereadGenericShortPublicationGraph({
    get genericReadScope() {
      return owner.genericReadScope;
    },
    set genericReadScope(value) {
      owner.genericReadScope = value;
    },
    owner: store,
    get genericReadGraph() {
      return owner.genericReadGraph.bind(owner);
    },
  });
  operations.genericWitness = createGenericWitness({
    WRITE_TASK_STATUSES: globals.WRITE_TASK_STATUSES,
    get newGenericJobs() {
      return owner.newGenericJobs;
    },
    set newGenericJobs(value) {
      owner.newGenericJobs = value;
    },
    get genericShortStatusContext() {
      return owner.genericShortStatusContext;
    },
    set genericShortStatusContext(value) {
      owner.genericShortStatusContext = value;
    },
    get ownerId() {
      return owner.ownerId;
    },
    set ownerId(value) {
      owner.ownerId = value;
    },
  });
  operations.genericPointer = createGenericPointer({});
  operations.genericPrefix = createGenericPrefix({
    get genericPointer() {
      return owner.genericPointer.bind(owner);
    },
  });
  operations.genericSettlementError = createGenericSettlementError({});
  operations.genericModernObservations = createGenericModernObservations({
    get genericWitness() {
      return owner.genericWitness.bind(owner);
    },
  });
}
