import {
  genericUnavailable,
  genericObject,
  genericJobKeys,
} from '../has-generic-short-status-signal.js';
import { type JobStatus, type Job, writeTaskTime } from '../runtime-error.js';
import { identifier, datasetName } from '../native-closure-signal.js';

export function validateGenericJobLifecycle(job: Job, statuses: Set<JobStatus>) {
  genericObject(job, genericJobKeys);

  if (
    !['read', 'write'].includes(job.kind) ||
    !statuses.has(job.status) ||
    !identifier.test(job.accountId) ||
    !identifier.test(job.scope) ||
    !Array.isArray(job.datasets) ||
    job.datasets.some((dataset) => !datasetName.test(dataset)) ||
    new Set(job.datasets).size !== job.datasets.length ||
    !Number.isFinite(job.timeoutMs) ||
    job.timeoutMs <= 0 ||
    (typeof job.idempotencyKey !== 'string' && job.idempotencyKey !== null)
  )
    return genericUnavailable();

  for (const key of [
    'startedAt',
    'platformReadStartedAt',
    'platformWriteStartedAt',
    'endedAt',
    'updatedAt',
    'deadlineAt',
    'cancellationRequestedAt',
  ] as const)
    if (job[key] !== null && !writeTaskTime(job[key])) return genericUnavailable();

  if (
    (job.startedAt && job.startedAt < job.requestedAt) ||
    (job.platformReadStartedAt && (!job.startedAt || job.platformReadStartedAt < job.startedAt)) ||
    (job.platformWriteStartedAt &&
      (!job.startedAt || job.platformWriteStartedAt < job.startedAt)) ||
    (job.endedAt && (job.endedAt < job.requestedAt || job.updatedAt < job.endedAt))
  )
    return genericUnavailable();

  const metadata = genericObject(job.metadata),
    value = metadata.genericShortStatus;

  for (const [key, entry] of Object.entries(metadata))
    if (
      key !== 'genericShortStatus' &&
      (!identifier.test(key) ||
        /^(body|content|text|html|markdown|args|arguments|payload|cookie|cookies|authorization|token|accessToken|refreshToken|password|secret|credentials|headers|storageState|target)$/i.test(
          key.replace(/[_-]/g, ''),
        ) ||
        !(
          entry === null ||
          typeof entry === 'boolean' ||
          (typeof entry === 'number' && Number.isFinite(entry)) ||
          (typeof entry === 'string' && entry.length <= 512)
        ))
    )
      return genericUnavailable();
  return { metadata, value };
}
