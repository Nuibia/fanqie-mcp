import {
  type JobStatus,
  RuntimeError,
  type StoreReadPort,
  type EvidenceObservation,
  type Job,
  type GenericShortTrustedContext,
} from './runtime-error.js';

import {
  type NativeShortBodyAuthorityBinding,
  type ServiceLeaseLostSignal,
} from './native-closure-signal.js';

import * as bodyProof from '../../platform/short-native-body-proof.js';

import { randomUUID } from 'node:crypto';

import { DatabaseSync } from 'node:sqlite';

import { PublicReadCoordinator, assertNoPublicReadEntry } from '../public-read.js';

import { type APIRequest, request } from 'playwright';

import path from 'node:path';

import { mkdirSync } from 'node:fs';

const WRITE_TASK_STATUSES = new Set<JobStatus>([
  'queued',
  'running',
  'waiting_for_login',
  'succeeded',
  'partial',
  'failed',
  'uncertain',
  'cancelled',
]);

const terminal = new Set<JobStatus>([
  'waiting_for_login',
  'succeeded',
  'partial',
  'failed',
  'uncertain',
  'cancelled',
]);

const nativeCompensationExecutionInventoryHash =
  '8b651ddfd339d1d0139de427aed885017b7987404b7a26f98705a6fb688e0a3b';

const nativeCompensationSourcePaths = [
  'src/application.ts',
  'src/config.ts',
  'src/errors.ts',
  'src/index.ts',
  'src/platform/browser.ts',
  'src/platform/chapter-body.ts',
  'src/platform/chapter-directory.ts',
  'src/platform/public.ts',
  'src/platform/reads.ts',
  'src/platform/short-metadata-api-schema.ts',
  'src/platform/short-metadata-schema.ts',
  'src/platform/short-native-metadata-api.ts',
  'src/platform/short-native-metadata-proof.ts',
  'src/platform/short-native-metadata.ts',
  'src/platform/writes.ts',
  'src/runtime/jobs.ts',
  'src/runtime/login-fallback.ts',
  'src/runtime/store.ts',
  'src/transport/http.ts',
  'src/transport/mcp.ts',
  'test/application.test.ts',
  'test/chapter-body.test.ts',
  'test/chapter-directory.test.ts',
  'test/current-chapter-tab-structure.test.ts',
  'test/login-fallback.test.ts',
  'test/manifest-commit-crash.test.ts',
  'test/platform-reads.test.ts',
  'test/platform-writes.test.ts',
  'test/public-content-fingerprint.test.ts',
  'test/runtime-readiness.test.ts',
  'test/runtime.test.ts',
  'test/short-native-metadata-api.test.ts',
  'test/short-native-metadata-integration.test.ts',
  'test/short-native-metadata.test.ts',
  'test/transport.test.ts',
] as const;

declare const nativeShortBodyAuthorityIdentity: unique symbol;

declare const nativeShortBodyAttemptIdentity: unique symbol;

export interface NativeShortBodyStoreAuthority {
  readonly [nativeShortBodyAuthorityIdentity]: true;
}

export interface NativeShortBodyAttemptPermit {
  readonly [nativeShortBodyAttemptIdentity]: true;
}

const nativeShortBodyStores = new WeakSet<Store>();

const nativeShortBodyAuthorities = new WeakMap<object, NativeShortBodyAuthorityBinding>();

const nativeShortBodyPermits = new WeakMap<
  object,
  { store: Store; jobId: string; ref: bodyProof.NativeShortBodyRefLink; consumed: boolean }
>();

export function resolveNativeShortBodyStoreAuthority(
  authority: unknown,
  expected: { accountId: string; workId: string; inputHash: string },
): NativeShortBodyAuthorityBinding | null {
  if (!authority || typeof authority !== 'object') return null;
  const binding = nativeShortBodyAuthorities.get(authority);
  if (
    !binding ||
    binding.accountId !== expected.accountId ||
    binding.workId !== expected.workId ||
    binding.inputHash !== expected.inputHash
  )
    return null;
  try {
    binding.check();
    return binding;
  } catch {
    return null;
  }
}

const serviceLeaseLostSignal: ServiceLeaseLostSignal = Object.freeze({
  code: 'service_lease_lost',
});
import { StoreApi } from './store-api.js';
import { type StoreOwner } from './owner.js';
import { composeStoreOperations } from './compose.js';
import { initializeStoreSchema } from './initialize-schema.js';
export class Store extends StoreApi {
  readonly databasePath: string;

  readonly evidenceDirectory: string;

  readonly ownerId = randomUUID();

  private readonly db: DatabaseSync;

  private readonly leaseDurationMs: number;

  private readonly evidenceMode: 'live' | 'fixture';

  private readonly nativeShortSubmissionEvidenceMode: 'live' | 'fixture';

  private readonly explicitBodyReadEvidenceMode: 'live' | 'fixture';

  private heartbeatTimer?: ReturnType<typeof setInterval>;

  private closed = false;

  private ownershipLost = false;

  private lossNotificationQueued = false;

  private lossAnnounced = false;

  private readonly lossListeners = new Set<{
    listener(signal: ServiceLeaseLostSignal): void;
    delivered: boolean;
  }>();

  private readonly nativeShortBodyWriteEnabled: boolean;

  private readonly publicReads = new PublicReadCoordinator({
    begin: () => this.db.exec('BEGIN DEFERRED'),
    commit: () => this.db.exec('COMMIT'),
    rollback: () => this.db.exec('ROLLBACK'),
    assertLease: () => (this as unknown as StoreOwner).assertOwnership(),
    isLeaseLost: () => this.ownershipLost,
    leaseLostError: () => (this as unknown as StoreOwner).lostLeaseError(),
    unavailable: () =>
      new RuntimeError('capability_unavailable', 'Public overview data is unavailable.'),
  });

  private genericReadScope: {
    token: object;
    accountId: string;
    open: boolean;
    ports: Map<string, StoreReadPort<unknown>>;
    files: Map<string, StoreReadPort<EvidenceObservation>>;
  } | null = null;

  private readonly newGenericJobs = new Map<string, Job>();

  private readonly genericShortStatusContext?: (jobId: string) => GenericShortTrustedContext | null;

  private readonly nativeShortBodyFactory: Pick<APIRequest, 'newContext'>;

  private readonly nativeShortBodySource: bodyProof.NativeShortBodySource;

  constructor(options: {
    genericShortStatusContext?: (jobId: string) => GenericShortTrustedContext | null;
    databasePath: string;
    evidenceDirectory: string;
    leaseDurationMs?: number;
    evidenceMode?: 'live' | 'fixture';
    nativeShortSubmissionEvidenceMode?: 'live' | 'fixture';
    explicitBodyReadEvidenceMode?: 'live' | 'fixture';
    nativeShortBodyWriteEnabled?: boolean;
    nativeShortBodyFixtureFactory?: Pick<APIRequest, 'newContext'>;
  }) {
    super();
    const owner = this as unknown as StoreOwner;
    this.initializeOperations(
      composeStoreOperations(owner, this, {
        WRITE_TASK_STATUSES,
        terminal,
        nativeCompensationExecutionInventoryHash,
        nativeCompensationSourcePaths,
        nativeShortBodyStores,
        nativeShortBodyAuthorities,
        nativeShortBodyPermits,
        serviceLeaseLostSignal,
      }),
    );

    assertNoPublicReadEntry();
    this.genericShortStatusContext = options.genericShortStatusContext;
    this.databasePath = path.resolve(options.databasePath);
    this.evidenceDirectory = path.resolve(options.evidenceDirectory);
    this.leaseDurationMs = options.leaseDurationMs ?? 30_000;
    this.evidenceMode = options.evidenceMode ?? 'fixture';
    this.nativeShortSubmissionEvidenceMode =
      options.nativeShortSubmissionEvidenceMode ?? this.evidenceMode;
    // App captures the dependency origin; this only labels explicit body reads.
    this.explicitBodyReadEvidenceMode = options.explicitBodyReadEvidenceMode ?? this.evidenceMode;
    this.nativeShortBodyWriteEnabled = options.nativeShortBodyWriteEnabled === true;
    if (options.nativeShortBodyFixtureFactory !== undefined && this.evidenceMode !== 'fixture')
      throw new RuntimeError(
        'invalid_configuration',
        'A synthetic body factory requires fixture evidence mode.',
      );
    const fixtureFactory = options.nativeShortBodyFixtureFactory;
    if (
      fixtureFactory !== undefined &&
      (!fixtureFactory ||
        typeof fixtureFactory !== 'object' ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(fixtureFactory)) ||
        Object.getOwnPropertySymbols(fixtureFactory).length)
    )
      throw new RuntimeError(
        'invalid_configuration',
        'A synthetic body factory requires a fixed data function.',
      );
    const factoryDescriptor =
      fixtureFactory === undefined
        ? null
        : Object.getOwnPropertyDescriptor(fixtureFactory, 'newContext');
    if (
      fixtureFactory !== undefined &&
      (Object.keys(Object.getOwnPropertyDescriptors(fixtureFactory)).length !== 1 ||
        !factoryDescriptor?.enumerable ||
        !Object.hasOwn(factoryDescriptor, 'value') ||
        typeof factoryDescriptor.value !== 'function')
    )
      throw new RuntimeError(
        'invalid_configuration',
        'A synthetic body factory requires a fixed data function.',
      );
    const fixtureNewContext = factoryDescriptor?.value as APIRequest['newContext'] | undefined;
    this.nativeShortBodySource = Object.freeze(
      fixtureFactory === undefined
        ? ({ mode: 'live', executor: 'default-body-owned-api/v1' } as const)
        : ({ mode: 'fixture', executor: 'sqlite-owned-body-fixture/v1' } as const),
    );
    // The wrapper captures the constructor source; no caller policy or setter exists.
    this.nativeShortBodyFactory = Object.freeze({
      newContext: (...args: Parameters<APIRequest['newContext']>) => {
        this.publicReads.assertMutationAllowed();
        return fixtureFactory === undefined
          ? request.newContext(...args)
          : fixtureNewContext!.call(fixtureFactory, ...args);
      },
    });
    if (!Number.isFinite(this.leaseDurationMs) || this.leaseDurationMs < 100) {
      throw new RuntimeError(
        'invalid_configuration',
        'leaseDurationMs must be at least 100 milliseconds.',
      );
    }
    mkdirSync(path.dirname(this.databasePath), { recursive: true, mode: 0o700 });
    mkdirSync(this.evidenceDirectory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(this.databasePath);
    initializeStoreSchema(this.db);
    const columns = owner
      .prepare('PRAGMA table_info(jobs)')
      .all()
      .map((row) => String(row.name));
    if (!columns.includes('target_json'))
      this.db.exec('ALTER TABLE jobs ADD COLUMN target_json TEXT');
    if (!columns.includes('metadata_json'))
      this.db.exec("ALTER TABLE jobs ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'");
    if (!columns.includes('timeout_ms'))
      this.db.exec('ALTER TABLE jobs ADD COLUMN timeout_ms INTEGER NOT NULL DEFAULT 120000');
    if (!columns.includes('deadline_at'))
      this.db.exec('ALTER TABLE jobs ADD COLUMN deadline_at TEXT');
    if (!columns.includes('cancellation_requested_at'))
      this.db.exec('ALTER TABLE jobs ADD COLUMN cancellation_requested_at TEXT');
    if (!columns.includes('cancellation_reason_json'))
      this.db.exec('ALTER TABLE jobs ADD COLUMN cancellation_reason_json TEXT');
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const lease = this.db
        .prepare('SELECT owner_id, expires_at FROM service_lease WHERE id = 1')
        .get() as { owner_id: string; expires_at: number } | undefined;
      if (lease && lease.expires_at > Date.now()) {
        throw new RuntimeError(
          'service_already_running',
          'Another active service owns this data directory.',
          { retryAfterMs: lease.expires_at - Date.now() },
        );
      }
      this.db
        .prepare(
          'INSERT INTO service_lease(id, owner_id, expires_at) VALUES(1, ?, ?) ON CONFLICT(id) DO UPDATE SET owner_id = excluded.owner_id, expires_at = excluded.expires_at',
        )
        .run(this.ownerId, Date.now() + this.leaseDurationMs);
      owner.assertOwnership();
      owner.ensurePublicEvidenceIndex();
      owner.assertOwnership();
      this.db.exec('COMMIT');
      owner.recoverInterrupted();
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* No active transaction. */
      }
      this.db.close();
      throw error;
    }
    this.heartbeatTimer = setInterval(
      () => {
        try {
          owner.renewLease();
        } catch {
          owner.loseOwnership();
        }
      },
      Math.max(25, Math.floor(this.leaseDurationMs / 3)),
    );
    this.heartbeatTimer.unref();
    nativeShortBodyStores.add(this);
  }
}
