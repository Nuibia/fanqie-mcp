import {
  type StoreReadPort,
  type EvidenceObservation,
  existingGenericReads,
  type JobStatus,
  type Job,
  type JobKind,
  type RuntimeFailure,
  type PlatformTarget,
} from '../runtime-error.js';
import { PublicReadCoordinator, type PublicReadPurpose } from '../../public-read.js';
import { type Store } from '../authority.js';
import {
  type PrefetchPublicRowsOperation,
  type ListEvidenceOperation,
  type ReadEvidenceOperation,
} from '../contracts/evidence-public-evidence-file-size.js';
import {
  type WithPublicProjectionReadOperation,
  type MemoPublicProjectionOperation,
  type AssertPublicReadEntryAllowedOperation,
  type AssertPublicReadMutationAllowedOperation,
  type BindExistingSqlReadOperation,
  type RawAccountAttemptRowsOperation,
  type DecodeJobOperation,
  type RawJobOperation,
  type ValidateNativeShortSubmissionHistoryOperation,
  type GetNativeShortSubmissionOriginalAuditOperation,
  type ValidateNativeShortBodyJobOperation,
  type NativeRegistrationSignalOperation,
  type ValidateNativeRegistrationJobOperation,
  type ValidateNativeClosureOperation,
  type GetJobOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';

import {
  type LostLeaseErrorOperation,
  type EnsureOpenOperation,
  type PrepareOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';

import { canonicalJson } from '../native-closure-signal.js';
import { DatabaseSync } from 'node:sqlite';
import { captureShortStatusJson } from '../../../platform/short-status.js';
import { genericUnavailable } from '../has-generic-short-status-signal.js';

import { createJobLoader } from '../jobs/load-job.js';

import {
  type NativeReconciliationRowOperation,
  type ValidateNativeCompensatedClosureOperation,
} from '../contracts/native-compensation-validate-native-compensation-source-identity.js';

import {
  type NativeShortSubmissionSettlementErrorOperation,
  type NativeShortSubmissionContextOperation,
  type NativeShortSubmissionLaterReadOperation,
  type NativeShortTrialSettlementErrorOperation,
  type NativeShortTrialContextOperation,
  type NativeShortTrialLaterReadOperation,
  type NativeShortCoverSettlementErrorOperation,
  type NativeShortCoverContextOperation,
  type NativeShortCoverLaterReadOperation,
} from '../contracts/native-states-native-short-submission-context.js';

import { type NativeShortBodySignalOperation } from '../contracts/native-body-native-short-body-signal.js';

import {
  type ValidateNativeShortTrialHistoryOperation,
  type GetNativeShortTrialOriginalAuditOperation,
  type ValidateNativeShortCoverHistoryOperation,
  type GetNativeShortCoverOriginalAuditOperation,
} from '../contracts/jobs-api-reconcile-native-short-submission-write.js';

interface WithPublicProjectionReadDependencies {
  publicReads: PublicReadCoordinator;
  genericReadScope: {
    token: object;
    accountId: string;
    open: boolean;
    ports: Map<string, StoreReadPort<unknown>>;
    files: Map<string, StoreReadPort<EvidenceObservation>>;
  } | null;
  prefetchPublicRows: PrefetchPublicRowsOperation;
}

export function createWithPublicProjectionRead(
  deps: WithPublicProjectionReadDependencies,
): WithPublicProjectionReadOperation {
  function withPublicProjectionRead<T>(
    accountId: string,
    purpose: PublicReadPurpose,
    callback: () => T,
  ): T {
    let scope: NonNullable<Store['genericReadScope']> | null = null;
    try {
      return deps.publicReads.run(accountId, purpose, () => {
        scope = {
          token: Object.freeze({}),
          accountId,
          open: true,
          ports: new Map(),
          files: new Map(),
        };
        deps.genericReadScope = scope;
        deps.prefetchPublicRows(accountId);
        return callback();
      });
    } finally {
      if (scope && deps.genericReadScope === scope) {
        const current = scope as NonNullable<Store['genericReadScope']>;
        current.open = false;
        current.ports.clear();
        current.files.clear();
        deps.genericReadScope = null;
      }
    }
  }
  return withPublicProjectionRead;
}

interface MemoPublicProjectionDependencies {
  publicReads: PublicReadCoordinator;
}

export function createMemoPublicProjection(
  deps: MemoPublicProjectionDependencies,
): MemoPublicProjectionOperation {
  function memoPublicProjection<T>(namespace: string, key: unknown, compute: () => T): T {
    return deps.publicReads.memo('app.' + namespace, key, compute);
  }
  return memoPublicProjection;
}

interface AssertPublicReadEntryAllowedDependencies {
  publicReads: PublicReadCoordinator;
}

export function createAssertPublicReadEntryAllowed(
  deps: AssertPublicReadEntryAllowedDependencies,
): AssertPublicReadEntryAllowedOperation {
  function assertPublicReadEntryAllowed(): void {
    deps.publicReads.assertEntryAllowed();
  }
  return assertPublicReadEntryAllowed;
}

interface AssertPublicReadMutationAllowedDependencies {
  ownershipLost: boolean;
  lostLeaseError: LostLeaseErrorOperation;
  publicReads: PublicReadCoordinator;
}

export function createAssertPublicReadMutationAllowed(
  deps: AssertPublicReadMutationAllowedDependencies,
): AssertPublicReadMutationAllowedOperation {
  function assertPublicReadMutationAllowed(): void {
    if (deps.ownershipLost) throw deps.lostLeaseError();
    deps.publicReads.assertMutationAllowed();
  }
  return assertPublicReadMutationAllowed;
}

interface BindExistingSqlReadDependencies {
  ensureOpen: EnsureOpenOperation;
  genericReadScope: {
    token: object;
    accountId: string;
    open: boolean;
    ports: Map<string, StoreReadPort<unknown>>;
    files: Map<string, StoreReadPort<EvidenceObservation>>;
  } | null;
  db: DatabaseSync;
  publicReads: PublicReadCoordinator;
}

export function createBindExistingSqlRead(
  deps: BindExistingSqlReadDependencies,
): BindExistingSqlReadOperation {
  function bindExistingSqlRead<T = unknown>(
    sql: string,
    mode: 'get' | 'all',
    params: readonly unknown[],
  ): StoreReadPort<T> {
    deps.ensureOpen();
    const captured = captureShortStatusJson(params) as unknown[],
      key = canonicalJson([sql, mode, captured]),
      scope = deps.genericReadScope;
    const existing = scope?.ports.get(key);
    if (existing) return existing as StoreReadPort<T>;
    const native = (): T => {
      deps.ensureOpen();
      if (scope && (!scope.open || deps.genericReadScope !== scope)) return genericUnavailable();
      const statement = deps.db.prepare(sql);
      return (statement[mode] as Function).apply(statement, captured) as T;
    };
    const port = Object.freeze({
      native,
      tracked: (): T => deps.publicReads.sql(sql, mode, captured, native),
    });
    scope?.ports.set(key, port as StoreReadPort<unknown>);
    return port;
  }
  return bindExistingSqlRead;
}

interface RawAccountAttemptRowsDependencies {
  bindExistingSqlRead: BindExistingSqlReadOperation;
}

export function createRawAccountAttemptRows(
  deps: RawAccountAttemptRowsDependencies,
): RawAccountAttemptRowsOperation {
  function rawAccountAttemptRows(
    accountId: string,
    mode: 'tracked' | 'native' = 'tracked',
  ): ReturnType<ReturnType<DatabaseSync['prepare']>['all']> {
    return deps
      .bindExistingSqlRead<ReturnType<ReturnType<DatabaseSync['prepare']>['all']>>(
        existingGenericReads.accountJobs,
        'all',
        [accountId],
      )
      [mode]();
  }
  return rawAccountAttemptRows;
}

interface DecodeJobDependencies {}

export function createDecodeJob(deps: DecodeJobDependencies): DecodeJobOperation {
  function decodeJob(row: Record<string, unknown>): Job {
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      ownerId: String(row.owner_id),
      kind: row.kind as JobKind,
      operation: String(row.operation),
      scope: String(row.scope),
      datasets: JSON.parse(String(row.datasets_json)) as string[],
      idempotencyKey: row.idempotency_key as string | null,
      inputHash: String(row.input_hash),
      status: row.status as JobStatus,
      requestedAt: String(row.requested_at),
      startedAt: row.started_at as string | null,
      platformReadStartedAt: row.read_started_at as string | null,
      platformWriteStartedAt: row.write_started_at as string | null,
      endedAt: row.ended_at as string | null,
      updatedAt: String(row.updated_at),
      result: row.result_json === null ? null : JSON.parse(String(row.result_json)),
      error:
        row.error_json === null ? null : (JSON.parse(String(row.error_json)) as RuntimeFailure),
      target:
        row.target_json == null ? null : (JSON.parse(String(row.target_json)) as PlatformTarget),
      metadata:
        row.metadata_json == null
          ? {}
          : (JSON.parse(String(row.metadata_json)) as Record<string, unknown>),
      timeoutMs: Number(row.timeout_ms),
      deadlineAt: row.deadline_at as string | null,
      cancellationRequestedAt: row.cancellation_requested_at as string | null,
      cancellationReason:
        row.cancellation_reason_json == null
          ? null
          : (JSON.parse(String(row.cancellation_reason_json)) as RuntimeFailure),
    };
  }
  return decodeJob;
}

interface RawJobDependencies {
  publicReads: PublicReadCoordinator;
  ensureOpen: EnsureOpenOperation;
  prepare: PrepareOperation;
  decodeJob: DecodeJobOperation;
}

export function createRawJob(deps: RawJobDependencies): RawJobOperation {
  function rawJob(id: string): Job | null {
    return deps.publicReads.memo('store.rawJob', [id], () => {
      deps.ensureOpen();
      const row = deps.prepare(existingGenericReads.rawJob).get(id);
      return row ? deps.decodeJob(row as Record<string, unknown>) : null;
    });
  }
  return rawJob;
}

export interface GetJobDependencies {
  publicReads: PublicReadCoordinator;
  ensureOpen: EnsureOpenOperation;
  prepare: PrepareOperation;
  nativeReconciliationRow: NativeReconciliationRowOperation;
  decodeJob: DecodeJobOperation;
  listEvidence: ListEvidenceOperation;
  readEvidence: ReadEvidenceOperation;
  validateNativeShortSubmissionHistory: ValidateNativeShortSubmissionHistoryOperation;
  nativeShortSubmissionSettlementError: NativeShortSubmissionSettlementErrorOperation;
  nativeShortSubmissionContext: NativeShortSubmissionContextOperation;
  nativeShortSubmissionLaterRead: NativeShortSubmissionLaterReadOperation;
  rawJob: RawJobOperation;
  getNativeShortSubmissionOriginalAudit: GetNativeShortSubmissionOriginalAuditOperation;
  nativeShortBodySignal: NativeShortBodySignalOperation;
  validateNativeShortBodyJob: ValidateNativeShortBodyJobOperation;
  validateNativeShortTrialHistory: ValidateNativeShortTrialHistoryOperation;
  nativeShortTrialSettlementError: NativeShortTrialSettlementErrorOperation;
  nativeShortTrialContext: NativeShortTrialContextOperation;
  nativeShortTrialLaterRead: NativeShortTrialLaterReadOperation;
  getNativeShortTrialOriginalAudit: GetNativeShortTrialOriginalAuditOperation;
  validateNativeShortCoverHistory: ValidateNativeShortCoverHistoryOperation;
  nativeShortCoverSettlementError: NativeShortCoverSettlementErrorOperation;
  nativeShortCoverContext: NativeShortCoverContextOperation;
  nativeShortCoverLaterRead: NativeShortCoverLaterReadOperation;
  getNativeShortCoverOriginalAudit: GetNativeShortCoverOriginalAuditOperation;
  nativeRegistrationSignal: NativeRegistrationSignalOperation;
  validateNativeRegistrationJob: ValidateNativeRegistrationJobOperation;
  validateNativeCompensatedClosure: ValidateNativeCompensatedClosureOperation;
  validateNativeClosure: ValidateNativeClosureOperation;
}

export function createGetJob(deps: GetJobDependencies): GetJobOperation {
  function getJob(id: string, accountId?: string): Job | null {
    return deps.publicReads.memo(
      'store.getJob',
      [id, accountId],
      createJobLoader({ deps, accountId, id }),
    );
  }
  return getJob;
}
