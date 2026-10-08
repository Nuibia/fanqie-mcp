import {
  type Job,
  type EvidenceRef,
  type EvidenceDocument,
  canonicalJson,
} from '../../runtime/store.js';

import {
  exact,
  NATIVE_SHORT_COVER_OPERATION,
  UUID,
  HASH,
  same,
  fail,
  time,
  order,
  integer,
  bytesHash,
  type NativeShortCoverEvidenceContext,
  copy,
} from './fail.js';

import { hasReservedNativeShortCoverSignal } from './has-reserved-native-short-cover-signal.js';

export function ordinaryJob(job: Job, accountId: string): string {
  exact(job, [
    'id',
    'accountId',
    'ownerId',
    'kind',
    'operation',
    'scope',
    'datasets',
    'idempotencyKey',
    'inputHash',
    'status',
    'requestedAt',
    'startedAt',
    'platformReadStartedAt',
    'platformWriteStartedAt',
    'endedAt',
    'updatedAt',
    'result',
    'error',
    'target',
    'metadata',
    'timeoutMs',
    'deadlineAt',
    'cancellationRequestedAt',
    'cancellationReason',
  ]);
  const workId = /^short_native_cover\.([1-9][0-9]{9,21})$/.exec(job.scope)?.[1];
  if (
    !workId ||
    job.operation !== NATIVE_SHORT_COVER_OPERATION ||
    job.kind !== 'write' ||
    job.accountId !== accountId ||
    !UUID.test(job.id) ||
    !UUID.test(job.ownerId) ||
    typeof accountId !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(accountId) ||
    !HASH.test(job.inputHash) ||
    !same(job.datasets, []) ||
    ![
      'queued',
      'running',
      'failed',
      'cancelled',
      'waiting_for_login',
      'uncertain',
      'succeeded',
    ].includes(job.status) ||
    !same(job.metadata, {}) ||
    typeof job.idempotencyKey !== 'string' ||
    !job.idempotencyKey ||
    job.idempotencyKey.length > 200 ||
    hasReservedNativeShortCoverSignal({
      error: job.error,
      cancellationReason: job.cancellationReason,
    })
  )
    fail();
  time(job.requestedAt);
  time(job.updatedAt);
  if (job.updatedAt > new Date().toISOString()) fail();
  if (job.startedAt !== null) order([job.requestedAt, job.startedAt, job.updatedAt]);
  if (job.endedAt !== null) {
    order([job.requestedAt, job.endedAt]);
    if (job.updatedAt !== job.endedAt || ['queued', 'running'].includes(job.status)) fail();
  }
  for (const t of [
    job.platformReadStartedAt,
    job.platformWriteStartedAt,
    job.deadlineAt,
    job.cancellationRequestedAt,
  ])
    if (t !== null) time(t);
  if (
    integer(job.timeoutMs, 2_147_483_647) < 1 ||
    (job.platformWriteStartedAt !== null && job.platformReadStartedAt === null)
  )
    fail();
  return workId;
}

export function verifyRef(
  ref: EvidenceRef,
  document: EvidenceDocument,
  accountId: string,
  jobId: string,
): void {
  exact(ref, ['id', 'accountId', 'jobId', 'dataset', 'capturedAt', 'path', 'sha256']);
  exact(document, [
    'schemaVersion',
    'evidenceId',
    'accountId',
    'jobId',
    'dataset',
    'capturedAt',
    'collectionMode',
    'evidenceKind',
    'payload',
  ]);
  if (
    !UUID.test(ref.id) ||
    !HASH.test(ref.sha256) ||
    typeof ref.path !== 'string' ||
    ref.accountId !== accountId ||
    ref.jobId !== jobId ||
    document.schemaVersion !== 1 ||
    document.evidenceId !== ref.id ||
    document.accountId !== accountId ||
    document.jobId !== jobId ||
    document.dataset !== ref.dataset ||
    document.capturedAt !== ref.capturedAt ||
    !['live', 'fixture'].includes(document.collectionMode) ||
    document.evidenceKind !== (ref.dataset === 'write-intent' ? 'local-intent' : 'observation')
  )
    fail();
  time(ref.capturedAt);
  if (
    ref.capturedAt > new Date().toISOString() ||
    bytesHash(`${canonicalJson(document)}\n`) !== ref.sha256
  )
    fail();
}

export function checkedContext(input: unknown): NativeShortCoverEvidenceContext {
  // Individual documents own their resource budget; duplicate source snapshots do not reduce it.
  const descriptors = Object.getOwnPropertyDescriptors(input),
    keys = ['accountId', 'job', 'manifest', 'refs', 'documents', 'attempts'];
  if (
    !input ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Object.getOwnPropertySymbols(input).length ||
    Object.keys(descriptors).length !== keys.length ||
    keys.some((k) => !descriptors[k]?.enumerable || !Object.hasOwn(descriptors[k]!, 'value'))
  )
    fail();
  const docs = descriptors.documents!.value;
  if (!Array.isArray(docs)) fail();
  const d = Object.getOwnPropertyDescriptors(docs) as Record<string, PropertyDescriptor>,
    names = Object.keys(d).filter((k) => k !== 'length');
  if (
    Object.getPrototypeOf(docs) !== Array.prototype ||
    Object.getOwnPropertySymbols(docs).length ||
    names.length !== d.length!.value ||
    names.some((k, i) => k !== String(i) || !d[k]!.enumerable || !Object.hasOwn(d[k]!, 'value')) ||
    names.length > 10
  )
    fail();
  const envelope = copy(
    {
      accountId: descriptors.accountId!.value,
      job: descriptors.job!.value,
      manifest: descriptors.manifest!.value,
      refs: descriptors.refs!.value,
      attempts: descriptors.attempts!.value,
    },
    512 * 1024,
  );
  return { ...envelope, documents: names.map((k) => copy(d[k]!.value, 32 * 1024 * 1024)) };
}
