import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import { createNativeShortCoverContext } from './operations/native-states-native-short-submission-context.js';
import { createRecordNativeShortCoverAttempt } from './operations/jobs-api-list-native-short-cover-attempts.js';
import {
  createGenericRefs,
  createGenericRawNode,
  createGenericReadGraph,
  createCaptureGenericShortPublicationGraph,
} from './operations/generic-status-generic-refs.js';

export function composeNativeShortCoverContext(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.nativeShortCoverContext = createNativeShortCoverContext({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
    get listNativeShortCoverAttempts() {
      return owner.listNativeShortCoverAttempts.bind(owner);
    },
  });
  operations.recordNativeShortCoverAttempt = createRecordNativeShortCoverAttempt({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get transaction() {
      return owner.transaction.bind(owner);
    },
    get runningJob() {
      return owner.runningJob.bind(owner);
    },
    get assertNotCancelled() {
      return owner.assertNotCancelled.bind(owner);
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get readEvidence() {
      return owner.readEvidence.bind(owner);
    },
    get listNativeShortCoverAttempts() {
      return owner.listNativeShortCoverAttempts.bind(owner);
    },
    get nativeShortCoverContext() {
      return owner.nativeShortCoverContext.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
  });
  operations.genericRefs = createGenericRefs({});
  operations.genericRawNode = createGenericRawNode({
    get bindExistingSqlRead() {
      return owner.bindExistingSqlRead.bind(owner);
    },
    get decodeJob() {
      return owner.decodeJob.bind(owner);
    },
    get genericRefs() {
      return owner.genericRefs.bind(owner);
    },
    get bindEvidenceRead() {
      return owner.bindEvidenceRead.bind(owner);
    },
  });
  operations.genericReadGraph = createGenericReadGraph({
    get rawAccountAttemptRows() {
      return owner.rawAccountAttemptRows.bind(owner);
    },
    get bindExistingSqlRead() {
      return owner.bindExistingSqlRead.bind(owner);
    },
    get genericRawNode() {
      return owner.genericRawNode.bind(owner);
    },
  });
  operations.captureGenericShortPublicationGraph = createCaptureGenericShortPublicationGraph({
    get genericReadScope() {
      return owner.genericReadScope;
    },
    set genericReadScope(value) {
      owner.genericReadScope = value;
    },
    get genericReadGraph() {
      return owner.genericReadGraph.bind(owner);
    },
    owner: store,
  });
}
