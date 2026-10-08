import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import { createResolveOperatorEntryInvestigation } from './operations/jobs-api-resolve-operator-entry-investigation.js';
import {
  createValidateNativeCompensationSourceIdentity,
  createValidateNativeCompensationInstalledSource,
} from './operations/native-compensation-validate-native-compensation-source-identity.js';

import { createNativeBoundedReferences } from './operations/evidence-native-bounded-references.js';
import {
  createNativeRegistrationSignal,
  createNativeRegistrationRows,
} from './operations/jobs-api-native-registration-signal.js';

export function composeResolveOperatorEntryInvestigation(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.resolveOperatorEntryInvestigation = createResolveOperatorEntryInvestigation({
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
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get assertOwnership() {
      return owner.assertOwnership.bind(owner);
    },
  });
  operations.validateNativeCompensationSourceIdentity =
    createValidateNativeCompensationSourceIdentity({
      get publicReads() {
        return owner.publicReads;
      },
      set publicReads(value) {
        owner.publicReads = value;
      },
      nativeCompensationExecutionInventoryHash: globals.nativeCompensationExecutionInventoryHash,
      nativeCompensationSourcePaths: globals.nativeCompensationSourcePaths,
    });
  operations.validateNativeCompensationInstalledSource =
    createValidateNativeCompensationInstalledSource({
      get publicReads() {
        return owner.publicReads;
      },
      set publicReads(value) {
        owner.publicReads = value;
      },
      get validateNativeCompensationSourceIdentity() {
        return owner.validateNativeCompensationSourceIdentity.bind(owner);
      },
      nativeCompensationSourcePaths: globals.nativeCompensationSourcePaths,
    });
  operations.nativeBoundedReferences = createNativeBoundedReferences({
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
  operations.nativeRegistrationSignal = createNativeRegistrationSignal({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
  });
  operations.nativeRegistrationRows = createNativeRegistrationRows({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get decodeJob() {
      return owner.decodeJob.bind(owner);
    },
  });
}
