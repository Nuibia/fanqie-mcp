import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import {
  createGenericHistorical,
  createGenericLegacySnapshot,
} from './operations/generic-status-generic-pointer.js';

import { createGenericReadComplete } from './operations/generic-status-generic-read-complete.js';
import { createGenericRootAnchor } from './operations/generic-status-generic-root-anchor.js';
import {
  createGenericAuditPrior,
  createGenericValidateAudit,
} from './operations/generic-status-generic-audit-prior.js';

export function composeGenericHistorical(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.genericHistorical = createGenericHistorical({
    get genericLegacySnapshot() {
      return owner.genericLegacySnapshot.bind(owner);
    },
  });
  operations.genericLegacySnapshot = createGenericLegacySnapshot({});
  operations.genericReadComplete = createGenericReadComplete({
    get genericModernObservations() {
      return owner.genericModernObservations.bind(owner);
    },
    get genericHistorical() {
      return owner.genericHistorical.bind(owner);
    },
  });
  operations.genericRootAnchor = createGenericRootAnchor({
    get genericModernObservations() {
      return owner.genericModernObservations.bind(owner);
    },
    get genericHistorical() {
      return owner.genericHistorical.bind(owner);
    },
    get genericQualifyWrite() {
      return owner.genericQualifyWrite.bind(owner);
    },
  });
  operations.genericAuditPrior = createGenericAuditPrior({});
  operations.genericValidateAudit = createGenericValidateAudit({
    get genericAuditPrior() {
      return owner.genericAuditPrior.bind(owner);
    },
    get genericRootAnchor() {
      return owner.genericRootAnchor.bind(owner);
    },
    get genericEffectHistory() {
      return owner.genericEffectHistory.bind(owner);
    },
    get genericSettlementError() {
      return owner.genericSettlementError.bind(owner);
    },
    get genericPointer() {
      return owner.genericPointer.bind(owner);
    },
    get genericPrefix() {
      return owner.genericPrefix.bind(owner);
    },
  });
}
