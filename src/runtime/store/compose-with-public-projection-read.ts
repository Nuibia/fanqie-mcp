import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import {
  createWithPublicProjectionRead,
  createMemoPublicProjection,
  createAssertPublicReadEntryAllowed,
  createAssertPublicReadMutationAllowed,
} from './operations/jobs-api-with-public-projection-read.js';

import { createRunLeaseLossCleanup } from './operations/runtime-ownership-run-lease-loss-cleanup.js';
import { createPublicEvidenceFileSize } from './operations/evidence-public-evidence-file-size.js';
export function composeWithPublicProjectionRead(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.withPublicProjectionRead = createWithPublicProjectionRead({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get genericReadScope() {
      return owner.genericReadScope;
    },
    set genericReadScope(value) {
      owner.genericReadScope = value;
    },
    get prefetchPublicRows() {
      return owner.prefetchPublicRows.bind(owner);
    },
  });
  operations.memoPublicProjection = createMemoPublicProjection({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
  });
  operations.assertPublicReadEntryAllowed = createAssertPublicReadEntryAllowed({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
  });
  operations.assertPublicReadMutationAllowed = createAssertPublicReadMutationAllowed({
    get ownershipLost() {
      return owner.ownershipLost;
    },
    set ownershipLost(value) {
      owner.ownershipLost = value;
    },
    get lostLeaseError() {
      return owner.lostLeaseError.bind(owner);
    },
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
  });
  operations.runLeaseLossCleanup = createRunLeaseLossCleanup({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
  });
  operations.publicEvidenceFileSize = createPublicEvidenceFileSize({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
  });
}
