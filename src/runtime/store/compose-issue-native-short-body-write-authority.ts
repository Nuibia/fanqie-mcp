import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import {
  createIssueNativeShortBodyWriteAuthority,
  createIssueNativeShortBodyReconciliationAuthority,
} from './operations/jobs-api-list-native-short-body-attempts.js';

import {
  createNativeShortBodyReconciliationRows,
  createNativeShortBodyLaterRead,
  createNativeShortBodySettlementError,
} from './operations/native-body-native-short-body-reconciliation-rows.js';
import { createCreateNativeShortBodyAuthority } from './operations/jobs-api-create-native-short-body-authority.js';

export function composeIssueNativeShortBodyWriteAuthority(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.issueNativeShortBodyWriteAuthority = createIssueNativeShortBodyWriteAuthority({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get nativeShortBodyIssuer() {
      return owner.nativeShortBodyIssuer.bind(owner);
    },
    get nativeShortBodyWriteEnabled() {
      return owner.nativeShortBodyWriteEnabled;
    },
    set nativeShortBodyWriteEnabled(value) {
      owner.nativeShortBodyWriteEnabled = value;
    },
    get createNativeShortBodyAuthority() {
      return owner.createNativeShortBodyAuthority.bind(owner);
    },
  });
  operations.issueNativeShortBodyReconciliationAuthority =
    createIssueNativeShortBodyReconciliationAuthority({
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
      get getNativeShortBodyOriginalAudit() {
        return owner.getNativeShortBodyOriginalAudit.bind(owner);
      },
      get nativeShortBodyContext() {
        return owner.nativeShortBodyContext.bind(owner);
      },
      get nativeShortBodySource() {
        return owner.nativeShortBodySource;
      },
      set nativeShortBodySource(value) {
        owner.nativeShortBodySource = value;
      },
      get createNativeShortBodyAuthority() {
        return owner.createNativeShortBodyAuthority.bind(owner);
      },
    });
  operations.nativeShortBodyReconciliationRows = createNativeShortBodyReconciliationRows({
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
  operations.createNativeShortBodyAuthority = createCreateNativeShortBodyAuthority({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get nativeShortBodySource() {
      return owner.nativeShortBodySource;
    },
    set nativeShortBodySource(value) {
      owner.nativeShortBodySource = value;
    },
    get nativeShortBodyIssuer() {
      return owner.nativeShortBodyIssuer.bind(owner);
    },
    get ownerId() {
      return owner.ownerId;
    },
    set ownerId(value) {
      owner.ownerId = value;
    },
    get nativeShortBodyRecoveryFreshRead() {
      return owner.nativeShortBodyRecoveryFreshRead.bind(owner);
    },
    get rawJob() {
      return owner.rawJob.bind(owner);
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get listNativeShortBodyAttempts() {
      return owner.listNativeShortBodyAttempts.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get transaction() {
      return owner.transaction.bind(owner);
    },
    get nativeShortBodyReconciliationRows() {
      return owner.nativeShortBodyReconciliationRows.bind(owner);
    },
    get getNativeShortBodyOriginalAudit() {
      return owner.getNativeShortBodyOriginalAudit.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
    get nativeShortBodyContext() {
      return owner.nativeShortBodyContext.bind(owner);
    },
    get nativeShortBodyFactory() {
      return owner.nativeShortBodyFactory;
    },
    set nativeShortBodyFactory(value) {
      owner.nativeShortBodyFactory = value;
    },
    get persistNativeShortBodyStage() {
      return owner.persistNativeShortBodyStage.bind(owner);
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
    nativeShortBodyPermits: globals.nativeShortBodyPermits,
    owner: store,
    nativeShortBodyAuthorities: globals.nativeShortBodyAuthorities,
  });
  operations.nativeShortBodyLaterRead = createNativeShortBodyLaterRead({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get rawJob() {
      return owner.rawJob.bind(owner);
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
  });
  operations.nativeShortBodySettlementError = createNativeShortBodySettlementError({});
}
