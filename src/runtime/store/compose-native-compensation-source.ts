import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import {
  createNativeCompensationSource,
  createGetNativeCompensationContext,
} from './operations/native-compensation-native-compensation-source.js';

import { createValidateNativeRegistrationJob } from './operations/jobs-api-native-registration-signal.js';
import {
  createRegisterNativeCompensationAttestation,
  createValidateNativeCompensatedClosure,
} from './operations/native-compensation-register-native-compensation-attestation.js';

import { createReconcileNativeCompensation } from './operations/native-compensation-reconcile-native-compensation.js';
export function composeNativeCompensationSource(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.nativeCompensationSource = createNativeCompensationSource({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get rawJob() {
      return owner.rawJob.bind(owner);
    },
    get evidenceDirectory() {
      return owner.evidenceDirectory;
    },
    set evidenceDirectory(value) {
      owner.evidenceDirectory = value;
    },
    get publicEvidenceFileSize() {
      return owner.publicEvidenceFileSize.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
    get nativeBoundedReferences() {
      return owner.nativeBoundedReferences.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get validateNativeCompensationSourceIdentity() {
      return owner.validateNativeCompensationSourceIdentity.bind(owner);
    },
    get nativeReconciliationRow() {
      return owner.nativeReconciliationRow.bind(owner);
    },
  });
  operations.getNativeCompensationContext = createGetNativeCompensationContext({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get rawJob() {
      return owner.rawJob.bind(owner);
    },
    get nativeRegistrationRows() {
      return owner.nativeRegistrationRows.bind(owner);
    },
    get nativeCompensationSource() {
      return owner.nativeCompensationSource.bind(owner);
    },
  });
  operations.validateNativeRegistrationJob = createValidateNativeRegistrationJob({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get getNativeCompensationContext() {
      return owner.getNativeCompensationContext.bind(owner);
    },
  });
  operations.registerNativeCompensationAttestation = createRegisterNativeCompensationAttestation({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get transaction() {
      return owner.transaction.bind(owner);
    },
    get rawJob() {
      return owner.rawJob.bind(owner);
    },
    get nativeRegistrationRows() {
      return owner.nativeRegistrationRows.bind(owner);
    },
    get validateNativeCompensationInstalledSource() {
      return owner.validateNativeCompensationInstalledSource.bind(owner);
    },
    get nativeCompensationSource() {
      return owner.nativeCompensationSource.bind(owner);
    },
    get evidenceMode() {
      return owner.evidenceMode;
    },
    set evidenceMode(value) {
      owner.evidenceMode = value;
    },
    get evidenceDirectory() {
      return owner.evidenceDirectory;
    },
    set evidenceDirectory(value) {
      owner.evidenceDirectory = value;
    },
    get assertOwnership() {
      return owner.assertOwnership.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get ownerId() {
      return owner.ownerId;
    },
    set ownerId(value) {
      owner.ownerId = value;
    },
    get getJob() {
      return owner.getJob.bind(owner);
    },
  });
  operations.validateNativeCompensatedClosure = createValidateNativeCompensatedClosure({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get nativeReconciliationRow() {
      return owner.nativeReconciliationRow.bind(owner);
    },
    get getNativeCompensationContext() {
      return owner.getNativeCompensationContext.bind(owner);
    },
    get nativeLaterRead() {
      return owner.nativeLaterRead.bind(owner);
    },
  });
  operations.reconcileNativeCompensation = createReconcileNativeCompensation({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get nativeLaterRead() {
      return owner.nativeLaterRead.bind(owner);
    },
    get assertOwnership() {
      return owner.assertOwnership.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get getJob() {
      return owner.getJob.bind(owner);
    },
  });
}
