import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import { createGenericLedger } from './operations/generic-status-generic-ledger.js';
import {
  createGenericQualifyWrite,
  createGenericEffectHistory,
} from './operations/generic-status-generic-qualify-write.js';

import { createGenericAssociation } from './operations/generic-status-generic-association.js';
import {
  createGenericUnobservedRead,
  createGenericSelect,
} from './operations/generic-status-generic-unobserved-read.js';

export function composeGenericLedger(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.genericLedger = createGenericLedger({
    get genericReadComplete() {
      return owner.genericReadComplete.bind(owner);
    },
    get genericValidateAudit() {
      return owner.genericValidateAudit.bind(owner);
    },
    get genericSettlementError() {
      return owner.genericSettlementError.bind(owner);
    },
  });
  operations.genericQualifyWrite = createGenericQualifyWrite({
    get genericModernObservations() {
      return owner.genericModernObservations.bind(owner);
    },
    get ownerId() {
      return owner.ownerId;
    },
    set ownerId(value) {
      owner.ownerId = value;
    },
    get genericHistorical() {
      return owner.genericHistorical.bind(owner);
    },
    get genericLedger() {
      return owner.genericLedger.bind(owner);
    },
    get genericQualifyWrite() {
      return owner.genericQualifyWrite.bind(owner);
    },
    get genericRootAnchor() {
      return owner.genericRootAnchor.bind(owner);
    },
  });
  operations.genericEffectHistory = createGenericEffectHistory({
    get genericQualifyWrite() {
      return owner.genericQualifyWrite.bind(owner);
    },
    get genericPointer() {
      return owner.genericPointer.bind(owner);
    },
    get genericPrefix() {
      return owner.genericPrefix.bind(owner);
    },
  });
  operations.genericAssociation = createGenericAssociation({
    get genericAuditPrior() {
      return owner.genericAuditPrior.bind(owner);
    },
    get genericPointer() {
      return owner.genericPointer.bind(owner);
    },
    get genericPrefix() {
      return owner.genericPrefix.bind(owner);
    },
  });
  operations.genericUnobservedRead = createGenericUnobservedRead({
    get genericModernObservations() {
      return owner.genericModernObservations.bind(owner);
    },
    get ownerId() {
      return owner.ownerId;
    },
    set ownerId(value) {
      owner.ownerId = value;
    },
  });
  operations.genericSelect = createGenericSelect({
    get genericUnobservedRead() {
      return owner.genericUnobservedRead.bind(owner);
    },
    get genericReadComplete() {
      return owner.genericReadComplete.bind(owner);
    },
    get genericModernObservations() {
      return owner.genericModernObservations.bind(owner);
    },
    get genericAuditPrior() {
      return owner.genericAuditPrior.bind(owner);
    },
    get genericValidateAudit() {
      return owner.genericValidateAudit.bind(owner);
    },
    get genericCreationEvent() {
      return owner.genericCreationEvent.bind(owner);
    },
    get genericTuple() {
      return owner.genericTuple.bind(owner);
    },
    get genericQualifyWrite() {
      return owner.genericQualifyWrite.bind(owner);
    },
    get genericRootAnchor() {
      return owner.genericRootAnchor.bind(owner);
    },
    get genericAssociation() {
      return owner.genericAssociation.bind(owner);
    },
  });
}
