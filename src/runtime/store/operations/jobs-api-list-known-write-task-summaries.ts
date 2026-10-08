import {
  type JobStatus,
  RuntimeError,
  type SavedWriteTaskSummaryList,
  KNOWN_WRITE_TASK_OPERATIONS,
  writeTaskUuid,
  type KnownWriteTaskOperation,
  writeTaskTime,
  WRITE_TASK_SUMMARY_CAP,
  type Job,
  existingGenericReads,
  type JobKind,
} from '../runtime-error.js';
import { identifier } from '../native-closure-signal.js';
import { PublicReadCoordinator } from '../../public-read.js';
import {
  type EnsureOpenOperation,
  type PrepareOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';

import {
  type ListKnownWriteTaskSummariesOperation,
  type GetJobOperation,
  type ListJobsOperation,
  type DecodeJobOperation,
  type GetJobForPublicProjectionOperation,
  type ListJobsForPublicProjectionOperation,
  type FindIdempotentOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';

interface ListKnownWriteTaskSummariesDependencies {
  publicReads: PublicReadCoordinator;
  ensureOpen: EnsureOpenOperation;
  prepare: PrepareOperation;
  WRITE_TASK_STATUSES: Set<JobStatus>;
}

export function createListKnownWriteTaskSummaries(
  deps: ListKnownWriteTaskSummariesDependencies,
): ListKnownWriteTaskSummariesOperation {
  function listKnownWriteTaskSummaries(accountId: string): SavedWriteTaskSummaryList {
    return deps.publicReads.memo('store.listKnownWriteTaskSummaries', [accountId], () => {
      deps.ensureOpen();
      if (typeof accountId !== 'string' || !identifier.test(accountId))
        throw new RuntimeError('invalid_request', 'accountId has an invalid format.');
      try {
        const rows = deps
          .prepare(
            `SELECT id, kind, operation, status AS recordedTaskStatus,
        requested_at AS requestedAt, ended_at AS endedAt
        FROM jobs WHERE account_id = ? AND kind = 'write'
        AND operation IN (${KNOWN_WRITE_TASK_OPERATIONS.map(() => '?').join(',')})
        ORDER BY requested_at DESC, id DESC LIMIT 257`,
          )
          .all(accountId, ...KNOWN_WRITE_TASK_OPERATIONS);
        const tasks = rows.map((row) => {
          if (
            !writeTaskUuid(row.id) ||
            row.kind !== 'write' ||
            typeof row.operation !== 'string' ||
            !KNOWN_WRITE_TASK_OPERATIONS.includes(row.operation as KnownWriteTaskOperation) ||
            typeof row.recordedTaskStatus !== 'string' ||
            !deps.WRITE_TASK_STATUSES.has(row.recordedTaskStatus as JobStatus) ||
            !writeTaskTime(row.requestedAt) ||
            (row.endedAt !== null && (!writeTaskTime(row.endedAt) || row.endedAt < row.requestedAt))
          )
            throw new Error('invalid_task_record_scalar');
          return {
            id: row.id,
            kind: 'write' as const,
            operation: row.operation as KnownWriteTaskOperation,
            recordedTaskStatus: row.recordedTaskStatus as JobStatus,
            requestedAt: row.requestedAt,
            endedAt: row.endedAt as string | null,
          };
        });
        return {
          schema: 'fanqie-job-summaries/v1',
          sourceMode: 'saved',
          purpose: 'task-state-only',
          authoritative: false,
          bodyIncluded: false,
          scope: 'known_write_tasks/v1',
          tasks: tasks.slice(0, WRITE_TASK_SUMMARY_CAP),
          truncated: tasks.length > WRITE_TASK_SUMMARY_CAP,
        };
      } catch {
        throw new RuntimeError('capability_unavailable', 'Saved task records are unavailable.');
      }
    });
  }
  return listKnownWriteTaskSummaries;
}

interface ListJobsDependencies {
  publicReads: PublicReadCoordinator;
  ensureOpen: EnsureOpenOperation;
  prepare: PrepareOperation;
  getJob: GetJobOperation;
}

export function createListJobs(deps: ListJobsDependencies): ListJobsOperation {
  function listJobs(accountId?: string): Job[] {
    return deps.publicReads.memo('store.listJobs', [accountId], () => {
      deps.ensureOpen();
      const rows =
        accountId === undefined
          ? deps.prepare('SELECT * FROM jobs ORDER BY requested_at DESC, rowid DESC').all()
          : deps
              .prepare(
                'SELECT * FROM jobs WHERE account_id = ? ORDER BY requested_at DESC, rowid DESC',
              )
              .all(accountId);
      return rows.map((row) => deps.getJob(String(row.id))!);
    });
  }
  return listJobs;
}

interface GetJobForPublicProjectionDependencies {
  publicReads: PublicReadCoordinator;
  getJob: GetJobOperation;
  prepare: PrepareOperation;
  decodeJob: DecodeJobOperation;
}

export function createGetJobForPublicProjection(
  deps: GetJobForPublicProjectionDependencies,
): GetJobForPublicProjectionOperation {
  function getJobForPublicProjection(id: string, accountId: string): Job | null {
    return deps.publicReads.memo('store.getJobForPublicProjection', [id, accountId], () => {
      try {
        return deps.getJob(id, accountId);
      } catch (error) {
        if (
          error instanceof RuntimeError &&
          error.code === 'capability_unavailable' &&
          error.message === 'Short draft directory is unavailable.'
        ) {
          const directoryRow = deps
            .prepare(existingGenericReads.compactFilteredJob)
            .get(id, accountId);
          if (!directoryRow) return null;
          try {
            return deps.decodeJob(directoryRow as Record<string, unknown>);
          } catch {
            return deps.decodeJob({
              ...directoryRow,
              datasets_json: '["short_drafts"]',
              result_json: null,
              target_json: null,
              metadata_json: '{"shortDraftDirectorySchema":"short-draft-directory-unvalidated/v1"}',
              error_json: null,
              cancellation_reason_json: null,
            } as Record<string, unknown>);
          }
        }
        if (
          !(error instanceof RuntimeError) ||
          error.code !== 'capability_unavailable' ||
          (!error.message.startsWith('Native short trial') &&
            !error.message.startsWith('Native short body') &&
            !/^Native (?:short )?submission/.test(error.message))
        )
          throw error;
        const bodyFailure = error.message.startsWith('Native short body'),
          submissionFailure = /^Native (?:short )?submission/.test(error.message);
        // Account filtering occurs in SQL before any evidence is consulted.
        const row = deps.prepare(existingGenericReads.compactFilteredJob).get(id, accountId);
        if (!row) return null;
        try {
          return deps.decodeJob(row as Record<string, unknown>);
        } catch {
          // Corrupt JSON cannot become a result, target or error message in a DTO.
          return deps.decodeJob({
            ...row,
            datasets_json: '[]',
            result_json: null,
            target_json: null,
            metadata_json: submissionFailure
              ? '{"schema":"native-short-submission-unvalidated/v1"}'
              : bodyFailure ||
                  String(row.scope).startsWith('short_native_body') ||
                  String(row.operation).includes('short_body')
                ? '{"schema":"native-short-body-unvalidated/v1"}'
                : '{"schema":"native-short-trial-unvalidated/v1"}',
            error_json: null,
            cancellation_reason_json: null,
          } as Record<string, unknown>);
        }
      }
    });
  }
  return getJobForPublicProjection;
}

interface ListJobsForPublicProjectionDependencies {
  publicReads: PublicReadCoordinator;
  ensureOpen: EnsureOpenOperation;
  prepare: PrepareOperation;
  getJobForPublicProjection: GetJobForPublicProjectionOperation;
}

export function createListJobsForPublicProjection(
  deps: ListJobsForPublicProjectionDependencies,
): ListJobsForPublicProjectionOperation {
  function listJobsForPublicProjection(accountId: string): Job[] {
    return deps.publicReads.memo('store.listJobsForPublicProjection', [accountId], () => {
      deps.ensureOpen();
      return deps
        .prepare(existingGenericReads.accountIds)
        .all(accountId)
        .map((row) => deps.getJobForPublicProjection(String(row.id), accountId)!)
        .filter(Boolean);
    });
  }
  return listJobsForPublicProjection;
}

interface FindIdempotentDependencies {
  publicReads: PublicReadCoordinator;
  ensureOpen: EnsureOpenOperation;
  prepare: PrepareOperation;
  getJob: GetJobOperation;
}

export function createFindIdempotent(deps: FindIdempotentDependencies): FindIdempotentOperation {
  function findIdempotent(
    accountId: string,
    kind: JobKind,
    operation: string,
    key: string,
  ): Job | null {
    deps.publicReads.assertMutationAllowed();
    deps.ensureOpen();
    const row = deps
      .prepare(
        'SELECT * FROM jobs WHERE account_id = ? AND kind = ? AND operation = ? AND idempotency_key = ?',
      )
      .get(accountId, kind, operation, key);
    return row ? deps.getJob(String(row.id)) : null;
  }
  return findIdempotent;
}
