import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import {
  createGenericCreationPrior,
  createGenericCreationPriorView,
  createGenericCreationEnvelopeInGraph,
  createGenericCreationUnknown,
  createGenericCreationResumeClaim,
  createGenericCreationAncestor,
} from './operations/creation-recovery-generic-creation-prior.js';

export function composeGenericCreationPrior(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.genericCreationPrior = createGenericCreationPrior({});
  operations.genericCreationPriorView = createGenericCreationPriorView({});
  operations.genericCreationEnvelopeInGraph = createGenericCreationEnvelopeInGraph({});
  operations.genericCreationUnknown = createGenericCreationUnknown({});
  operations.genericCreationResumeClaim = createGenericCreationResumeClaim({
    get genericCreationUnknown() {
      return owner.genericCreationUnknown.bind(owner);
    },
    get genericQualifyWrite() {
      return owner.genericQualifyWrite.bind(owner);
    },
    get genericCreationPrior() {
      return owner.genericCreationPrior.bind(owner);
    },
    get genericCreationEnvelopeInGraph() {
      return owner.genericCreationEnvelopeInGraph.bind(owner);
    },
  });
  operations.genericCreationAncestor = createGenericCreationAncestor({
    get genericCreationUnknown() {
      return owner.genericCreationUnknown.bind(owner);
    },
    get genericQualifyWrite() {
      return owner.genericQualifyWrite.bind(owner);
    },
    get genericCreationEnvelopeInGraph() {
      return owner.genericCreationEnvelopeInGraph.bind(owner);
    },
  });
}
