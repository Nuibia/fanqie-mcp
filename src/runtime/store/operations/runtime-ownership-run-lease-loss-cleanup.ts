import { PublicReadCoordinator } from '../../public-read.js';
import {
  type RunLeaseLossCleanupOperation,
  type PrepareOperation,
  type EnsureOpenOperation,
  type HasLostServiceLeaseOperation,
  type DeliverLeaseLossOperation,
  type OnServiceLeaseLostOperation,
  type LoseOwnershipOperation,
  type LostLeaseErrorOperation,
  type AssertOwnershipOperation,
  type AssertLeaseOwnershipOperation,
  type TransactionOperation,
  type RenewLeaseOperation,
  type CloseOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';
import { DatabaseSync } from 'node:sqlite';
import { type BindExistingSqlReadOperation } from '../contracts/jobs-api-with-public-projection-read.js';

import { RuntimeError } from '../runtime-error.js';

import { type ServiceLeaseLostSignal } from '../native-closure-signal.js';

import { type Store } from '../authority.js';

interface RunLeaseLossCleanupDependencies {
  publicReads: PublicReadCoordinator;
}

export function createRunLeaseLossCleanup(
  deps: RunLeaseLossCleanupDependencies,
): RunLeaseLossCleanupOperation {
  function runLeaseLossCleanup<T>(action: () => T): T {
    return deps.publicReads.hasContext() ? deps.publicReads.runFatalCleanup(action) : action();
  }
  return runLeaseLossCleanup;
}

interface PrepareDependencies {
  publicReads: PublicReadCoordinator;
  bindExistingSqlRead: BindExistingSqlReadOperation;
  db: DatabaseSync;
}

export function createPrepare(deps: PrepareDependencies): PrepareOperation {
  function prepare(sql: string): ReturnType<DatabaseSync['prepare']> {
    deps.publicReads.assertReadAllowed();
    return {
      get: (...params: unknown[]) => deps.bindExistingSqlRead(sql, 'get', params).tracked(),
      all: (...params: unknown[]) => deps.bindExistingSqlRead(sql, 'all', params).tracked(),
      run: (...params: unknown[]) => {
        deps.publicReads.assertMutationAllowed();
        const statement = deps.db.prepare(sql);
        return (statement.run as Function).apply(statement, params);
      },
    } as unknown as ReturnType<DatabaseSync['prepare']>;
  }
  return prepare;
}

interface EnsureOpenDependencies {
  publicReads: PublicReadCoordinator;
  closed: boolean;
}

export function createEnsureOpen(deps: EnsureOpenDependencies): EnsureOpenOperation {
  function ensureOpen(): void {
    deps.publicReads.assertReadAllowed();
    if (deps.closed) throw new RuntimeError('store_closed', 'The runtime store is closed.');
  }
  return ensureOpen;
}

interface HasLostServiceLeaseDependencies {
  ownershipLost: boolean;
}

export function createHasLostServiceLease(
  deps: HasLostServiceLeaseDependencies,
): HasLostServiceLeaseOperation {
  function hasLostServiceLease(): boolean {
    return deps.ownershipLost;
  }
  return hasLostServiceLease;
}

interface OnServiceLeaseLostDependencies {
  publicReads: PublicReadCoordinator;
  lossListeners: Set<{ listener(signal: ServiceLeaseLostSignal): void; delivered: boolean }>;
  lossAnnounced: boolean;
  deliverLeaseLoss: DeliverLeaseLossOperation;
}

export function createOnServiceLeaseLost(
  deps: OnServiceLeaseLostDependencies,
): OnServiceLeaseLostOperation {
  function onServiceLeaseLost(listener: (signal: ServiceLeaseLostSignal) => void): () => void {
    deps.publicReads.assertMutationAllowed();
    const entry = { listener, delivered: false };
    deps.lossListeners.add(entry);
    if (deps.lossAnnounced) queueMicrotask(() => deps.deliverLeaseLoss(entry));
    return () => {
      deps.publicReads.assertLifecycleCleanupAllowed();
      deps.lossListeners.delete(entry);
    };
  }
  return onServiceLeaseLost;
}

interface DeliverLeaseLossDependencies {
  lossListeners: Set<{ listener(signal: ServiceLeaseLostSignal): void; delivered: boolean }>;
  serviceLeaseLostSignal: ServiceLeaseLostSignal;
}

export function createDeliverLeaseLoss(
  deps: DeliverLeaseLossDependencies,
): DeliverLeaseLossOperation {
  function deliverLeaseLoss(entry: {
    listener(signal: ServiceLeaseLostSignal): void;
    delivered: boolean;
  }): void {
    if (entry.delivered || !deps.lossListeners.has(entry)) return;
    entry.delivered = true;
    try {
      void Promise.resolve(entry.listener(deps.serviceLeaseLostSignal)).catch(() => {});
    } catch {
      /* A subscriber cannot undo permanent fencing. */
    }
  }
  return deliverLeaseLoss;
}

interface LoseOwnershipDependencies {
  ownershipLost: boolean;
  publicReads: PublicReadCoordinator;
  lossNotificationQueued: boolean;
  lossAnnounced: boolean;
  lossListeners: Set<{ listener(signal: ServiceLeaseLostSignal): void; delivered: boolean }>;
  deliverLeaseLoss: DeliverLeaseLossOperation;
}

export function createLoseOwnership(deps: LoseOwnershipDependencies): LoseOwnershipOperation {
  function loseOwnership(): void {
    deps.ownershipLost = true;
    try {
      deps.publicReads.invalidateForLeaseLoss();
    } catch {
      /* Permanent loss must still publish its once signal; unresolved rollback cannot authorize close. */
    }
    if (deps.lossNotificationQueued) return;
    deps.lossNotificationQueued = true;
    // A failed transaction has unwound/rolled back before subscribers can close resources.
    queueMicrotask(() => {
      deps.lossAnnounced = true;
      for (const entry of deps.lossListeners) deps.deliverLeaseLoss(entry);
    });
  }
  return loseOwnership;
}

interface LostLeaseErrorDependencies {}

export function createLostLeaseError(deps: LostLeaseErrorDependencies): LostLeaseErrorOperation {
  function lostLeaseError(): RuntimeError {
    return new RuntimeError(
      'service_lease_lost',
      'This service no longer owns the runtime; no further writes are allowed.',
    );
  }
  return lostLeaseError;
}

interface AssertOwnershipDependencies {
  ensureOpen: EnsureOpenOperation;
  ownershipLost: boolean;
  lostLeaseError: LostLeaseErrorOperation;
  db: DatabaseSync;
  ownerId: `${string}-${string}-${string}-${string}-${string}`;
  loseOwnership: LoseOwnershipOperation;
}

export function createAssertOwnership(deps: AssertOwnershipDependencies): AssertOwnershipOperation {
  function assertOwnership(): void {
    deps.ensureOpen();
    if (deps.ownershipLost) throw deps.lostLeaseError();
    const lease = deps.db
      .prepare('SELECT owner_id, expires_at FROM service_lease WHERE id = 1')
      .get() as { owner_id: string; expires_at: number } | undefined;
    if (
      deps.ownershipLost ||
      !lease ||
      lease.owner_id !== deps.ownerId ||
      lease.expires_at <= Date.now()
    ) {
      deps.loseOwnership();
      throw deps.lostLeaseError();
    }
  }
  return assertOwnership;
}

interface AssertLeaseOwnershipDependencies {
  assertOwnership: AssertOwnershipOperation;
}

export function createAssertLeaseOwnership(
  deps: AssertLeaseOwnershipDependencies,
): AssertLeaseOwnershipOperation {
  function assertLeaseOwnership(): void {
    deps.assertOwnership();
  }
  return assertLeaseOwnership;
}

interface TransactionDependencies {
  publicReads: PublicReadCoordinator;
  ensureOpen: EnsureOpenOperation;
  ownershipLost: boolean;
  lostLeaseError: LostLeaseErrorOperation;
  db: DatabaseSync;
  assertOwnership: AssertOwnershipOperation;
}

export function createTransaction(deps: TransactionDependencies): TransactionOperation {
  function transaction<T>(action: () => T): T {
    deps.publicReads.assertMutationAllowed();
    deps.ensureOpen();
    if (deps.ownershipLost) throw deps.lostLeaseError();
    deps.db.exec('BEGIN IMMEDIATE');
    try {
      deps.assertOwnership();
      const result = action();
      deps.db.exec('COMMIT');
      return result;
    } catch (error) {
      deps.db.exec('ROLLBACK');
      throw error;
    }
  }
  return transaction;
}

interface RenewLeaseDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  prepare: PrepareOperation;
  leaseDurationMs: number;
  ownerId: `${string}-${string}-${string}-${string}-${string}`;
}

export function createRenewLease(deps: RenewLeaseDependencies): RenewLeaseOperation {
  function renewLease(): void {
    deps.publicReads.assertMutationAllowed();
    deps.transaction(() => {
      deps
        .prepare('UPDATE service_lease SET expires_at = ? WHERE id = 1 AND owner_id = ?')
        .run(Date.now() + deps.leaseDurationMs, deps.ownerId);
    });
  }
  return renewLease;
}

interface CloseDependencies {
  publicReads: PublicReadCoordinator;
  closed: boolean;
  nativeShortBodyStores: WeakSet<Store>;
  owner: Store;
  heartbeatTimer: NodeJS.Timeout | undefined;
  db: DatabaseSync;
  ownerId: `${string}-${string}-${string}-${string}-${string}`;
}

export function createClose(deps: CloseDependencies): CloseOperation {
  function close(): void {
    deps.publicReads.assertLifecycleCleanupAllowed();
    if (deps.closed) return;
    deps.nativeShortBodyStores.delete(deps.owner);
    if (deps.heartbeatTimer) clearInterval(deps.heartbeatTimer);
    try {
      deps.db.prepare('DELETE FROM service_lease WHERE id = 1 AND owner_id = ?').run(deps.ownerId);
    } finally {
      deps.db.close();
      deps.closed = true;
    }
  }
  return close;
}
