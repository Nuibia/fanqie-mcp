import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import {
  createMarkPlatformReadStarted,
  createMarkPlatformWriteStarted,
} from './operations/jobs-api-create-job.js';

import {
  createNativeShortBodySignal,
  createNativeShortBodyContext,
  createNativeShortBodyStage,
} from './operations/native-body-native-short-body-signal.js';
import { createListNativeShortBodyAttempts } from './operations/jobs-api-list-native-short-body-attempts.js';

export function composeMarkPlatformReadStarted(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.markPlatformReadStarted = createMarkPlatformReadStarted({
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
    get prepare() {
      return owner.prepare.bind(owner);
    },
  });
  operations.markPlatformWriteStarted = createMarkPlatformWriteStarted({
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
    get prepare() {
      return owner.prepare.bind(owner);
    },
  });
  operations.nativeShortBodySignal = createNativeShortBodySignal({
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
  });
  operations.listNativeShortBodyAttempts = createListNativeShortBodyAttempts({
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
    get prepare() {
      return owner.prepare.bind(owner);
    },
  });
  operations.nativeShortBodyContext = createNativeShortBodyContext({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get listEvidence() {
      return owner.listEvidence.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
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
    get listNativeShortBodyAttempts() {
      return owner.listNativeShortBodyAttempts.bind(owner);
    },
  });
  operations.nativeShortBodyStage = createNativeShortBodyStage({
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
  });
}
