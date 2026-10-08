import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import {
  createEnsureOpen,
  createHasLostServiceLease,
  createOnServiceLeaseLost,
  createDeliverLeaseLoss,
  createLoseOwnership,
  createLostLeaseError,
} from './operations/runtime-ownership-run-lease-loss-cleanup.js';

export function composeEnsureOpen(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.ensureOpen = createEnsureOpen({
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
  });
  operations.hasLostServiceLease = createHasLostServiceLease({
    get ownershipLost() {
      return owner.ownershipLost;
    },
    set ownershipLost(value) {
      owner.ownershipLost = value;
    },
  });
  operations.onServiceLeaseLost = createOnServiceLeaseLost({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get lossListeners() {
      return owner.lossListeners;
    },
    set lossListeners(value) {
      owner.lossListeners = value;
    },
    get lossAnnounced() {
      return owner.lossAnnounced;
    },
    set lossAnnounced(value) {
      owner.lossAnnounced = value;
    },
    get deliverLeaseLoss() {
      return owner.deliverLeaseLoss.bind(owner);
    },
  });
  operations.deliverLeaseLoss = createDeliverLeaseLoss({
    get lossListeners() {
      return owner.lossListeners;
    },
    set lossListeners(value) {
      owner.lossListeners = value;
    },
    serviceLeaseLostSignal: globals.serviceLeaseLostSignal,
  });
  operations.loseOwnership = createLoseOwnership({
    get ownershipLost() {
      return owner.ownershipLost;
    },
    set ownershipLost(value) {
      owner.ownershipLost = value;
    },
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get lossNotificationQueued() {
      return owner.lossNotificationQueued;
    },
    set lossNotificationQueued(value) {
      owner.lossNotificationQueued = value;
    },
    get lossAnnounced() {
      return owner.lossAnnounced;
    },
    set lossAnnounced(value) {
      owner.lossAnnounced = value;
    },
    get lossListeners() {
      return owner.lossListeners;
    },
    set lossListeners(value) {
      owner.lossListeners = value;
    },
    get deliverLeaseLoss() {
      return owner.deliverLeaseLoss.bind(owner);
    },
  });
  operations.lostLeaseError = createLostLeaseError({});
}
