import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import {
  createAssertOwnership,
  createAssertLeaseOwnership,
  createTransaction,
  createRenewLease,
  createClose,
} from './operations/runtime-ownership-run-lease-loss-cleanup.js';

import { createDecodeJob } from './operations/jobs-api-with-public-projection-read.js';
export function composeAssertOwnership(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.assertOwnership = createAssertOwnership({
    get ensureOpen() {
      return owner.ensureOpen.bind(owner);
    },
    get ownershipLost() {
      return owner.ownershipLost;
    },
    set ownershipLost(value) {
      owner.ownershipLost = value;
    },
    get lostLeaseError() {
      return owner.lostLeaseError.bind(owner);
    },
    get db() {
      return owner.db;
    },
    set db(value) {
      owner.db = value;
    },
    get ownerId() {
      return owner.ownerId;
    },
    set ownerId(value) {
      owner.ownerId = value;
    },
    get loseOwnership() {
      return owner.loseOwnership.bind(owner);
    },
  });
  operations.assertLeaseOwnership = createAssertLeaseOwnership({
    get assertOwnership() {
      return owner.assertOwnership.bind(owner);
    },
  });
  operations.transaction = createTransaction({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get ensureOpen() {
      return owner.ensureOpen.bind(owner);
    },
    get ownershipLost() {
      return owner.ownershipLost;
    },
    set ownershipLost(value) {
      owner.ownershipLost = value;
    },
    get lostLeaseError() {
      return owner.lostLeaseError.bind(owner);
    },
    get db() {
      return owner.db;
    },
    set db(value) {
      owner.db = value;
    },
    get assertOwnership() {
      return owner.assertOwnership.bind(owner);
    },
  });
  operations.renewLease = createRenewLease({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get transaction() {
      return owner.transaction.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get leaseDurationMs() {
      return owner.leaseDurationMs;
    },
    set leaseDurationMs(value) {
      owner.leaseDurationMs = value;
    },
    get ownerId() {
      return owner.ownerId;
    },
    set ownerId(value) {
      owner.ownerId = value;
    },
  });
  operations.close = createClose({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get closed() {
      return owner.closed;
    },
    set closed(value) {
      owner.closed = value;
    },
    nativeShortBodyStores: globals.nativeShortBodyStores,
    owner: store,
    get heartbeatTimer() {
      return owner.heartbeatTimer;
    },
    set heartbeatTimer(value) {
      owner.heartbeatTimer = value;
    },
    get db() {
      return owner.db;
    },
    set db(value) {
      owner.db = value;
    },
    get ownerId() {
      return owner.ownerId;
    },
    set ownerId(value) {
      owner.ownerId = value;
    },
  });
  operations.decodeJob = createDecodeJob({});
}
