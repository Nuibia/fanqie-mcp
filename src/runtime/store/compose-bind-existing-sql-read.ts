import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import {
  createBindExistingSqlRead,
  createRawAccountAttemptRows,
} from './operations/jobs-api-with-public-projection-read.js';
import {
  createBindEvidenceRead,
  createPrefetchPublicRows,
  createEnsurePublicEvidenceIndex,
} from './operations/evidence-public-evidence-file-size.js';
import { createPrepare } from './operations/runtime-ownership-run-lease-loss-cleanup.js';

export function composeBindExistingSqlRead(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.bindExistingSqlRead = createBindExistingSqlRead({
    get ensureOpen() {
      return owner.ensureOpen.bind(owner);
    },
    get genericReadScope() {
      return owner.genericReadScope;
    },
    set genericReadScope(value) {
      owner.genericReadScope = value;
    },
    get db() {
      return owner.db;
    },
    set db(value) {
      owner.db = value;
    },
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
  });
  operations.bindEvidenceRead = createBindEvidenceRead({
    get genericReadScope() {
      return owner.genericReadScope;
    },
    set genericReadScope(value) {
      owner.genericReadScope = value;
    },
    get bindExistingSqlRead() {
      return owner.bindExistingSqlRead.bind(owner);
    },
    get readEvidenceFresh() {
      return owner.readEvidenceFresh.bind(owner);
    },
    get ensureOpen() {
      return owner.ensureOpen.bind(owner);
    },
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
  });
  operations.prepare = createPrepare({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get bindExistingSqlRead() {
      return owner.bindExistingSqlRead.bind(owner);
    },
    get db() {
      return owner.db;
    },
    set db(value) {
      owner.db = value;
    },
  });
  operations.rawAccountAttemptRows = createRawAccountAttemptRows({
    get bindExistingSqlRead() {
      return owner.bindExistingSqlRead.bind(owner);
    },
  });
  operations.prefetchPublicRows = createPrefetchPublicRows({
    get rawAccountAttemptRows() {
      return owner.rawAccountAttemptRows.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get bindExistingSqlRead() {
      return owner.bindExistingSqlRead.bind(owner);
    },
  });
  operations.ensurePublicEvidenceIndex = createEnsurePublicEvidenceIndex({
    get db() {
      return owner.db;
    },
    set db(value) {
      owner.db = value;
    },
  });
}
