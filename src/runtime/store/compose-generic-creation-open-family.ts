import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import {
  createGenericCreationOpenFamily,
  createGenericCreationEventAssociations,
} from './operations/creation-recovery-generic-creation-open-family.js';

import { createGenericCreationEvent } from './operations/creation-recovery-generic-creation-event.js';
import {
  createGenericTuple,
  createGenericMutationGraph,
} from './operations/generic-status-generic-unobserved-read.js';

import { createGetGenericShortOriginalAudit } from './operations/generic-status-get-generic-short-original-audit.js';
export function composeGenericCreationOpenFamily(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.genericCreationOpenFamily = createGenericCreationOpenFamily({
    get genericCreationResumeClaim() {
      return owner.genericCreationResumeClaim.bind(owner);
    },
    get genericCreationAncestor() {
      return owner.genericCreationAncestor.bind(owner);
    },
    get genericCreationPrior() {
      return owner.genericCreationPrior.bind(owner);
    },
    get genericQualifyWrite() {
      return owner.genericQualifyWrite.bind(owner);
    },
  });
  operations.genericCreationEventAssociations = createGenericCreationEventAssociations({
    get genericAssociation() {
      return owner.genericAssociation.bind(owner);
    },
    get genericQualifyWrite() {
      return owner.genericQualifyWrite.bind(owner);
    },
    get genericUnobservedRead() {
      return owner.genericUnobservedRead.bind(owner);
    },
    get genericReadComplete() {
      return owner.genericReadComplete.bind(owner);
    },
    get genericAuditPrior() {
      return owner.genericAuditPrior.bind(owner);
    },
    get genericValidateAudit() {
      return owner.genericValidateAudit.bind(owner);
    },
  });
  operations.genericCreationEvent = createGenericCreationEvent({
    get genericSelect() {
      return owner.genericSelect.bind(owner);
    },
    get genericRootAnchor() {
      return owner.genericRootAnchor.bind(owner);
    },
    get genericCreationPriorView() {
      return owner.genericCreationPriorView.bind(owner);
    },
    get genericCreationResumeClaim() {
      return owner.genericCreationResumeClaim.bind(owner);
    },
    get genericCreationAncestor() {
      return owner.genericCreationAncestor.bind(owner);
    },
    get genericCreationPrior() {
      return owner.genericCreationPrior.bind(owner);
    },
    get genericQualifyWrite() {
      return owner.genericQualifyWrite.bind(owner);
    },
    get genericCreationOpenFamily() {
      return owner.genericCreationOpenFamily.bind(owner);
    },
    get genericCreationEventAssociations() {
      return owner.genericCreationEventAssociations.bind(owner);
    },
  });
  operations.genericTuple = createGenericTuple({});
  operations.genericMutationGraph = createGenericMutationGraph({
    get genericReadGraph() {
      return owner.genericReadGraph.bind(owner);
    },
  });
  operations.getGenericShortOriginalAudit = createGetGenericShortOriginalAudit({
    get ensureOpen() {
      return owner.ensureOpen.bind(owner);
    },
    get genericMutationGraph() {
      return owner.genericMutationGraph.bind(owner);
    },
    get genericRootAnchor() {
      return owner.genericRootAnchor.bind(owner);
    },
    get genericQualifyWrite() {
      return owner.genericQualifyWrite.bind(owner);
    },
    get genericEffectHistory() {
      return owner.genericEffectHistory.bind(owner);
    },
    get genericPrefix() {
      return owner.genericPrefix.bind(owner);
    },
    get genericPointer() {
      return owner.genericPointer.bind(owner);
    },
  });
}
