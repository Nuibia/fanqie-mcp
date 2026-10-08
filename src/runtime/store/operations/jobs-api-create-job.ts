import { RuntimeError, type Job, type JobStatus, type RuntimeFailure } from '../runtime-error.js';
import {
  canonicalJson,
  identifier,
  type NewJob,
  datasetName,
  hash,
  timestamp,
} from '../native-closure-signal.js';
import { randomUUID } from 'node:crypto';
import { PublicReadCoordinator } from '../../public-read.js';
import { captureShortStatusJson } from '../../../platform/short-status.js';
import {
  type TransactionOperation,
  type PrepareOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';
import {
  type FindIdempotentOperation,
  type GetJobOperation,
  type CreateJobOperation,
  type RunningJobOperation,
  type StartJobOperation,
  type AssertNotCancelledOperation,
  type RequestCancellationOperation,
  type MarkPlatformReadStartedOperation,
  type MarkPlatformWriteStartedOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';

interface CreateJobDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  findIdempotent: FindIdempotentOperation;
  prepare: PrepareOperation;
  ownerId: `${string}-${string}-${string}-${string}-${string}`;
  getJob: GetJobOperation;
  newGenericJobs: Map<string, Job>;
}

export function createCreateJob(deps: CreateJobDependencies): CreateJobOperation {
  function createJob(input: NewJob): { job: Job; created: boolean } {
    deps.publicReads.assertMutationAllowed();
    const datasets = [...new Set(input.datasets ?? [])].sort();
    const scope = input.scope ?? 'account';
    for (const [name, value] of [
      ['accountId', input.accountId],
      ['operation', input.operation],
      ['scope', scope],
    ] as const) {
      if (!identifier.test(value))
        throw new RuntimeError('invalid_request', `${name} has an invalid format.`);
    }
    if (datasets.some((dataset) => !datasetName.test(dataset)))
      throw new RuntimeError('invalid_request', 'Invalid dataset name.');
    if (input.kind === 'read' && (datasets.length === 0 || datasets.includes('write-intent')))
      throw new RuntimeError(
        'invalid_request',
        'Read jobs require observational datasets; local write-intent is not a read dataset.',
      );
    if (input.kind === 'write' && (!input.idempotencyKey || !input.inputHash))
      throw new RuntimeError(
        'invalid_request',
        'Write jobs require an idempotency key and input hash.',
      );
    if (
      input.idempotencyKey !== undefined &&
      (input.idempotencyKey.length < 1 || input.idempotencyKey.length > 200)
    )
      throw new RuntimeError('invalid_request', 'Invalid idempotency key.');
    const inputHash =
      input.inputHash ?? hash(canonicalJson({ operation: input.operation, scope, datasets }));
    const timeoutMs = input.timeoutMs ?? 120_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
      throw new RuntimeError(
        'invalid_request',
        'timeoutMs must be a positive supported timer duration.',
      );
    if (!/^[a-f0-9]{64}$/.test(inputHash))
      throw new RuntimeError('invalid_request', 'inputHash must be a SHA-256 hex digest.');
    return deps.transaction(() => {
      const previous = input.idempotencyKey
        ? deps.findIdempotent(input.accountId, input.kind, input.operation, input.idempotencyKey)
        : null;
      if (previous) {
        if (
          previous.inputHash !== inputHash ||
          previous.scope !== scope ||
          canonicalJson(previous.datasets) !== canonicalJson(datasets)
        ) {
          throw new RuntimeError(
            'idempotency_conflict',
            'The idempotency key already identifies different input.',
            { jobId: previous.id },
          );
        }
        return { job: previous, created: false };
      }
      const id = randomUUID();
      const now = timestamp();
      deps
        .prepare(
          'INSERT INTO jobs(id, account_id, owner_id, kind, operation, scope, datasets_json, idempotency_key, input_hash, status, requested_at, updated_at, timeout_ms) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          input.accountId,
          deps.ownerId,
          input.kind,
          input.operation,
          scope,
          JSON.stringify(datasets),
          input.idempotencyKey ?? null,
          inputHash,
          'queued',
          now,
          now,
          timeoutMs,
        );
      const job = deps.getJob(id)!;
      deps.newGenericJobs.set(id, captureShortStatusJson(job) as Job);
      return { job, created: true };
    });
  }
  return createJob;
}

interface RunningJobDependencies {
  getJob: GetJobOperation;
  ownerId: `${string}-${string}-${string}-${string}-${string}`;
}

export function createRunningJob(deps: RunningJobDependencies): RunningJobOperation {
  function runningJob(id: string): Job {
    const job = deps.getJob(id);
    if (!job || job.status !== 'running' || job.ownerId !== deps.ownerId)
      throw new RuntimeError('invalid_job_state', 'The job is not running under this service.', {
        jobId: id,
      });
    return job;
  }
  return runningJob;
}

interface StartJobDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  getJob: GetJobOperation;
  ownerId: `${string}-${string}-${string}-${string}-${string}`;
  prepare: PrepareOperation;
}

export function createStartJob(deps: StartJobDependencies): StartJobOperation {
  function startJob(id: string): Job {
    deps.publicReads.assertMutationAllowed();
    return deps.transaction(() => {
      const job = deps.getJob(id);
      if (!job || job.status !== 'queued' || job.ownerId !== deps.ownerId)
        throw new RuntimeError(
          'invalid_job_state',
          'Only a queued job owned by this service can start.',
        );
      const now = timestamp();
      const deadlineAt = new Date(Date.parse(now) + job.timeoutMs).toISOString();
      deps
        .prepare(
          'UPDATE jobs SET status = ?, started_at = ?, updated_at = ?, deadline_at = ? WHERE id = ?',
        )
        .run('running', now, now, deadlineAt, id);
      return deps.getJob(id)!;
    });
  }
  return startJob;
}

interface AssertNotCancelledDependencies {}

export function createAssertNotCancelled(
  deps: AssertNotCancelledDependencies,
): AssertNotCancelledOperation {
  function assertNotCancelled(job: Job): void {
    if (job.cancellationRequestedAt) {
      const reason = job.cancellationReason ?? {
        code: 'cancelled',
        message: 'Job cancellation was requested.',
      };
      throw new RuntimeError(reason.code, reason.message);
    }
  }
  return assertNotCancelled;
}

interface RequestCancellationDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  getJob: GetJobOperation;
  terminal: Set<JobStatus>;
  ownerId: `${string}-${string}-${string}-${string}-${string}`;
  prepare: PrepareOperation;
}

export function createRequestCancellation(
  deps: RequestCancellationDependencies,
): RequestCancellationOperation {
  function requestCancellation(
    id: string,
    reason: RuntimeFailure = { code: 'cancelled', message: 'Job cancellation was requested.' },
  ): Job {
    deps.publicReads.assertMutationAllowed();
    if (!['cancelled', 'timeout', 'shutdown'].includes(reason.code))
      throw new RuntimeError('invalid_cancellation', 'Unsupported cancellation reason.');
    return deps.transaction(() => {
      const job = deps.getJob(id);
      if (!job) throw new RuntimeError('job_not_found', 'Job does not exist.');
      if (
        job.status !== 'waiting_for_login' &&
        (deps.terminal.has(job.status) || job.cancellationRequestedAt)
      )
        return job;
      if (job.status !== 'waiting_for_login' && job.ownerId !== deps.ownerId)
        throw new RuntimeError(
          'invalid_job_state',
          'Only the owning service may cancel an active job.',
        );
      const now = timestamp();
      if (job.status === 'queued' || job.status === 'waiting_for_login') {
        deps
          .prepare(
            'UPDATE jobs SET status = ?, cancellation_requested_at = ?, cancellation_reason_json = ?, ended_at = ?, updated_at = ?, error_json = ? WHERE id = ?',
          )
          .run('cancelled', now, canonicalJson(reason), now, now, canonicalJson(reason), id);
      } else {
        // Running stays running until the actual browser callback settles and releases its resources.
        deps
          .prepare(
            'UPDATE jobs SET cancellation_requested_at = ?, cancellation_reason_json = ?, updated_at = ? WHERE id = ?',
          )
          .run(now, canonicalJson(reason), now, id);
      }
      return deps.getJob(id)!;
    });
  }
  return requestCancellation;
}

interface MarkPlatformReadStartedDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  runningJob: RunningJobOperation;
  assertNotCancelled: AssertNotCancelledOperation;
  prepare: PrepareOperation;
}

export function createMarkPlatformReadStarted(
  deps: MarkPlatformReadStartedDependencies,
): MarkPlatformReadStartedOperation {
  function markPlatformReadStarted(id: string): string {
    deps.publicReads.assertMutationAllowed();
    return deps.transaction(() => {
      const job = deps.runningJob(id);
      deps.assertNotCancelled(job);
      if (job.platformReadStartedAt) return job.platformReadStartedAt;
      const now = timestamp();
      deps
        .prepare('UPDATE jobs SET read_started_at = ?, updated_at = ? WHERE id = ?')
        .run(now, now, id);
      return now;
    });
  }
  return markPlatformReadStarted;
}

interface MarkPlatformWriteStartedDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  runningJob: RunningJobOperation;
  assertNotCancelled: AssertNotCancelledOperation;
  prepare: PrepareOperation;
}

export function createMarkPlatformWriteStarted(
  deps: MarkPlatformWriteStartedDependencies,
): MarkPlatformWriteStartedOperation {
  function markPlatformWriteStarted(id: string): string {
    deps.publicReads.assertMutationAllowed();
    return deps.transaction(() => {
      const job = deps.runningJob(id);
      deps.assertNotCancelled(job);
      if (job.kind !== 'write')
        throw new RuntimeError('invalid_job_state', 'Read jobs cannot perform platform writes.');
      if (job.platformWriteStartedAt) return job.platformWriteStartedAt;
      const now = timestamp();
      deps
        .prepare('UPDATE jobs SET write_started_at = ?, updated_at = ? WHERE id = ?')
        .run(now, now, id);
      return now;
    });
  }
  return markPlatformWriteStarted;
}
