import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import {
  createGenericReadFailure,
  createGenericShortPublication,
  createGenericShortEvidenceRows,
  createGenericShortProjection,
} from './operations/generic-status-get-generic-short-original-audit.js';

import {
  createGenericShortCreationEventProjection,
  createGenericShortPublicJob,
} from './operations/generic-status-generic-short-creation-event-projection.js';

export function composeGenericReadFailure(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.genericReadFailure = createGenericReadFailure({
    get ownershipLost() {
      return owner.ownershipLost;
    },
    set ownershipLost(value) {
      owner.ownershipLost = value;
    },
    get lostLeaseError() {
      return owner.lostLeaseError.bind(owner);
    },
  });
  operations.genericShortPublication = createGenericShortPublication({
    get captureGenericShortPublicationGraph() {
      return owner.captureGenericShortPublicationGraph.bind(owner);
    },
    get genericSelect() {
      return owner.genericSelect.bind(owner);
    },
    get rereadGenericShortPublicationGraph() {
      return owner.rereadGenericShortPublicationGraph.bind(owner);
    },
    get genericReadScope() {
      return owner.genericReadScope;
    },
    set genericReadScope(value) {
      owner.genericReadScope = value;
    },
    get withPublicProjectionRead() {
      return owner.withPublicProjectionRead.bind(owner);
    },
    get genericReadFailure() {
      return owner.genericReadFailure.bind(owner);
    },
  });
  operations.genericShortEvidenceRows = createGenericShortEvidenceRows({
    get genericModernObservations() {
      return owner.genericModernObservations.bind(owner);
    },
    get genericHistorical() {
      return owner.genericHistorical.bind(owner);
    },
    get genericTuple() {
      return owner.genericTuple.bind(owner);
    },
  });
  operations.genericShortProjection = createGenericShortProjection({
    get captureGenericShortPublicationGraph() {
      return owner.captureGenericShortPublicationGraph.bind(owner);
    },
    get genericSelect() {
      return owner.genericSelect.bind(owner);
    },
    get rereadGenericShortPublicationGraph() {
      return owner.rereadGenericShortPublicationGraph.bind(owner);
    },
    get genericShortPublicJob() {
      return owner.genericShortPublicJob.bind(owner);
    },
    get genericShortEvidenceRows() {
      return owner.genericShortEvidenceRows.bind(owner);
    },
    get genericReadScope() {
      return owner.genericReadScope;
    },
    set genericReadScope(value) {
      owner.genericReadScope = value;
    },
    get withPublicProjectionRead() {
      return owner.withPublicProjectionRead.bind(owner);
    },
    get genericReadFailure() {
      return owner.genericReadFailure.bind(owner);
    },
  });
  operations.genericShortCreationEventProjection = createGenericShortCreationEventProjection({
    get captureGenericShortPublicationGraph() {
      return owner.captureGenericShortPublicationGraph.bind(owner);
    },
    get genericCreationEvent() {
      return owner.genericCreationEvent.bind(owner);
    },
    get rereadGenericShortPublicationGraph() {
      return owner.rereadGenericShortPublicationGraph.bind(owner);
    },
    get genericShortPublicJob() {
      return owner.genericShortPublicJob.bind(owner);
    },
    get genericShortEvidenceRows() {
      return owner.genericShortEvidenceRows.bind(owner);
    },
    get genericReadScope() {
      return owner.genericReadScope;
    },
    set genericReadScope(value) {
      owner.genericReadScope = value;
    },
    get withPublicProjectionRead() {
      return owner.withPublicProjectionRead.bind(owner);
    },
    get genericReadFailure() {
      return owner.genericReadFailure.bind(owner);
    },
  });
  operations.genericShortPublicJob = createGenericShortPublicJob({});
}
