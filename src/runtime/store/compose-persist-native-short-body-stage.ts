import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import {
  createPersistNativeShortBodyStage,
  createGetNativeShortBodyRecoveryContext,
} from './operations/jobs-api-list-native-short-body-attempts.js';
import {
  createNativeShortBodyIssuer,
  createNativeShortBodyRecoveryFreshRead,
  createNativeShortBodyRecoveryFromPayload,
} from './operations/native-body-native-short-body-signal.js';

import { createPrepareNativeShortBodyReconciliation } from './operations/runtime-ownership-prepare-native-short-body-reconciliation.js';
export function composePersistNativeShortBodyStage(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.persistNativeShortBodyStage = createPersistNativeShortBodyStage({
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
    get ownerId() {
      return owner.ownerId;
    },
    set ownerId(value) {
      owner.ownerId = value;
    },
    get nativeShortBodyStage() {
      return owner.nativeShortBodyStage.bind(owner);
    },
    get preparePhysicalEvidence() {
      return owner.preparePhysicalEvidence.bind(owner);
    },
    get insertPhysicalEvidence() {
      return owner.insertPhysicalEvidence.bind(owner);
    },
    get nativeShortBodyContext() {
      return owner.nativeShortBodyContext.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
  });
  operations.nativeShortBodyIssuer = createNativeShortBodyIssuer({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    nativeShortBodyStores: globals.nativeShortBodyStores,
    owner: store,
    get assertOwnership() {
      return owner.assertOwnership.bind(owner);
    },
    get evidenceMode() {
      return owner.evidenceMode;
    },
    set evidenceMode(value) {
      owner.evidenceMode = value;
    },
    get nativeShortBodySource() {
      return owner.nativeShortBodySource;
    },
    set nativeShortBodySource(value) {
      owner.nativeShortBodySource = value;
    },
  });
  operations.nativeShortBodyRecoveryFreshRead = createNativeShortBodyRecoveryFreshRead({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get rawJob() {
      return owner.rawJob.bind(owner);
    },
    get getManifestForJob() {
      return owner.getManifestForJob.bind(owner);
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get listNativeShortBodyAttempts() {
      return owner.listNativeShortBodyAttempts.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
  });
  operations.nativeShortBodyRecoveryFromPayload = createNativeShortBodyRecoveryFromPayload({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get nativeShortBodyRecoveryFreshRead() {
      return owner.nativeShortBodyRecoveryFreshRead.bind(owner);
    },
  });
  operations.getNativeShortBodyRecoveryContext = createGetNativeShortBodyRecoveryContext({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get ensureOpen() {
      return owner.ensureOpen.bind(owner);
    },
    get rawJob() {
      return owner.rawJob.bind(owner);
    },
    get nativeShortBodyRecoveryFromPayload() {
      return owner.nativeShortBodyRecoveryFromPayload.bind(owner);
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
  });
  operations.prepareNativeShortBodyReconciliation = createPrepareNativeShortBodyReconciliation({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get nativeShortBodyIssuer() {
      return owner.nativeShortBodyIssuer.bind(owner);
    },
    get rawJob() {
      return owner.rawJob.bind(owner);
    },
    get nativeShortBodyContext() {
      return owner.nativeShortBodyContext.bind(owner);
    },
    get validateNativeShortBodyHistory() {
      return owner.validateNativeShortBodyHistory.bind(owner);
    },
    get ownerId() {
      return owner.ownerId;
    },
    set ownerId(value) {
      owner.ownerId = value;
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get getCurrent() {
      return owner.getCurrent.bind(owner);
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
    get nativeShortBodyRecoveryFreshRead() {
      return owner.nativeShortBodyRecoveryFreshRead.bind(owner);
    },
    get getNativeShortBodyOriginalAudit() {
      return owner.getNativeShortBodyOriginalAudit.bind(owner);
    },
  });
}
