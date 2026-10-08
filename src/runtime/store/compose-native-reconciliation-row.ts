import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import { createNativeReconciliationRow } from './operations/native-compensation-reconcile-native-compensation.js';
import {
  createNativeLaterRead,
  createAssertNativeLiveSettlement,
} from './operations/jobs-api-native-registration-signal.js';
import { createNativeOriginalEvidence } from './operations/evidence-native-bounded-references.js';

import {
  createValidateNativeReconciliationRow,
  createValidateNativeClosure,
} from './operations/jobs-api-validate-native-reconciliation-row.js';

export function composeNativeReconciliationRow(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.nativeReconciliationRow = createNativeReconciliationRow({
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
  operations.nativeLaterRead = createNativeLaterRead({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get rawJob() {
      return owner.rawJob.bind(owner);
    },
    get nativeBoundedReferences() {
      return owner.nativeBoundedReferences.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
  });
  operations.nativeOriginalEvidence = createNativeOriginalEvidence({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get nativeBoundedReferences() {
      return owner.nativeBoundedReferences.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
  });
  operations.assertNativeLiveSettlement = createAssertNativeLiveSettlement({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
  });
  operations.validateNativeReconciliationRow = createValidateNativeReconciliationRow({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get nativeLaterRead() {
      return owner.nativeLaterRead.bind(owner);
    },
    get nativeReconciliationRow() {
      return owner.nativeReconciliationRow.bind(owner);
    },
    get nativeBoundedReferences() {
      return owner.nativeBoundedReferences.bind(owner);
    },
    get assertNativeLiveSettlement() {
      return owner.assertNativeLiveSettlement.bind(owner);
    },
  });
  operations.validateNativeClosure = createValidateNativeClosure({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get nativeReconciliationRow() {
      return owner.nativeReconciliationRow.bind(owner);
    },
    get nativeOriginalEvidence() {
      return owner.nativeOriginalEvidence.bind(owner);
    },
    get validateNativeReconciliationRow() {
      return owner.validateNativeReconciliationRow.bind(owner);
    },
  });
}
