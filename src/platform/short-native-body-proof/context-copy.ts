import {
  type NativeShortBodyEvidenceContext,
  type NativeShortBodyWriteResultEvidence,
  BODY_PAYLOAD_KEYS,
  type NativeShortBodyStageEvidence,
} from './native-short-body-attempt-row.js';

import {
  fail,
  copy,
  type Data,
  MIB,
  freeze,
  exact,
  digest,
  same,
  time,
  type Json,
  REASONS,
  type Reason,
} from './fail.js';

import { type Job, type EvidenceRef, type EvidenceDocument } from '../../runtime/store.js';

import {
  BODY_JOB_KEYS,
  uuid,
  account,
  durableTime,
  ordered,
  boundedCount,
  physicalCanonical,
  source,
  BODY_RESULT_LINKS,
  link,
  durableCleanup,
} from './native-short-body-scope.js';

import { NATIVE_SHORT_BODY_OPERATION, type NativeShortBodySource } from './inspect.js';

import { createHash } from 'node:crypto';

import { nativeShortBodyHashBasesHash } from './same-mode.js';

import {
  NATIVE_SHORT_BODY_COMPARISON_POLICY_V2,
  type NativeShortBodyPlan,
  type NativeShortBodyBusinessInput,
  type NativeShortBodyComparison,
} from '../short-native-body.js';

import { type StoredBodySnapshot } from '../short-native-legacy-codec.js';

export function contextCopy(input: unknown): NativeShortBodyEvidenceContext {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Object.getOwnPropertySymbols(input).length
  )
    fail('invalid_shape');
  const desc = Object.getOwnPropertyDescriptors(input),
    keys = ['accountId', 'job', 'manifest', 'refs', 'documents', 'attempts'];
  if (
    Object.keys(desc).length !== keys.length ||
    keys.some((key) => !desc[key]?.enumerable || !Object.hasOwn(desc[key]!, 'value'))
  )
    fail('invalid_shape');
  const docs = desc.documents!.value as unknown;
  if (
    !Array.isArray(docs) ||
    Object.getPrototypeOf(docs) !== Array.prototype ||
    Object.getOwnPropertySymbols(docs).length
  )
    fail('invalid_shape');
  const dd = Object.getOwnPropertyDescriptors(docs) as unknown as Record<
      string,
      PropertyDescriptor
    >,
    names = Object.keys(dd).filter((key) => key !== 'length');
  if (
    names.length !== dd.length?.value ||
    names.some(
      (key, i) => key !== String(i) || !dd[key]?.enumerable || !Object.hasOwn(dd[key]!, 'value'),
    ) ||
    names.length > 7
  )
    fail('invalid_shape');
  const meta = copy(
    {
      accountId: desc.accountId!.value,
      job: desc.job!.value,
      manifest: desc.manifest!.value,
      refs: desc.refs!.value,
      attempts: desc.attempts!.value,
    },
    512 * 1024,
    24,
    12000,
  ) as Data;
  let bytes = 0;
  const documents = names.map((key) => {
    const doc = copy(dd[key]!.value, 16 * MIB);
    bytes += Buffer.byteLength(JSON.stringify(doc), 'utf8');
    if (bytes > 32 * MIB) fail('resource_limit');
    return doc;
  });
  return freeze({ ...meta, documents }) as unknown as NativeShortBodyEvidenceContext;
}

export function ordinaryBodyJob(job: Job, accountId: string): string {
  const d = exact(job, BODY_JOB_KEYS);
  uuid(d.id);
  uuid(d.ownerId);
  account(d.accountId);
  digest(d.inputHash);
  const workId = /^short_native_body\.([1-9][0-9]{9,21})$/.exec(job.scope)?.[1];
  if (
    !workId ||
    job.accountId !== accountId ||
    job.kind !== 'write' ||
    job.operation !== NATIVE_SHORT_BODY_OPERATION ||
    !same(job.datasets, []) ||
    typeof job.idempotencyKey !== 'string' ||
    !job.idempotencyKey.length ||
    Buffer.byteLength(job.idempotencyKey, 'utf8') > 256 ||
    /[\r\n\u0000]/u.test(job.idempotencyKey) ||
    !same(job.metadata, {})
  )
    fail('invalid_trace');
  if (
    ![
      'queued',
      'running',
      'waiting_for_login',
      'succeeded',
      'partial',
      'failed',
      'uncertain',
      'cancelled',
    ].includes(job.status)
  )
    fail('invalid_trace');
  durableTime(job.requestedAt);
  durableTime(job.updatedAt);
  for (const stamp of [
    job.startedAt,
    job.platformReadStartedAt,
    job.platformWriteStartedAt,
    job.endedAt,
    job.cancellationRequestedAt,
  ])
    if (stamp !== null) durableTime(stamp);
  ordered([
    job.requestedAt,
    ...[job.startedAt, job.platformReadStartedAt, job.platformWriteStartedAt, job.endedAt].filter(
      (stamp) => stamp !== null,
    ),
  ]);
  if (job.deadlineAt !== null) {
    time(job.deadlineAt);
    if (job.startedAt !== null && job.deadlineAt < job.startedAt) fail('invalid_trace');
  }
  if (
    boundedCount(job.timeoutMs, 2_147_483_647) < 1 ||
    (job.endedAt !== null && job.updatedAt !== job.endedAt)
  )
    fail('invalid_trace');
  if (job.target !== null && !same(job.target, { kind: 'short-story', id: workId }))
    fail('source_mismatch');
  return workId;
}

export function verifyBodyRef(
  ref: EvidenceRef,
  doc: EvidenceDocument,
  accountId: string,
  jobId: string,
): void {
  exact(ref, ['id', 'accountId', 'jobId', 'dataset', 'capturedAt', 'path', 'sha256']);
  exact(doc, [
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
  uuid(ref.id);
  digest(ref.sha256);
  durableTime(ref.capturedAt);
  if (
    typeof ref.path !== 'string' ||
    !ref.path.length ||
    doc.schemaVersion !== 1 ||
    ref.accountId !== accountId ||
    ref.jobId !== jobId ||
    doc.evidenceId !== ref.id ||
    doc.accountId !== accountId ||
    doc.jobId !== jobId ||
    doc.dataset !== ref.dataset ||
    doc.capturedAt !== ref.capturedAt ||
    !['live', 'fixture'].includes(doc.collectionMode) ||
    doc.evidenceKind !== (ref.dataset === 'write-intent' ? 'local-intent' : 'observation')
  )
    fail('source_mismatch');
  const bytes = physicalCanonical(doc as unknown as Json) + '\n';
  if (Buffer.byteLength(bytes, 'utf8') > (ref.dataset === 'write-intent' ? 16384 : 16 * MIB))
    fail('resource_limit');
  if (createHash('sha256').update(bytes, 'utf8').digest('hex') !== ref.sha256)
    fail('source_mismatch');
}

export function resultShape(
  input: unknown,
  at: string,
  prior: string | null,
): NativeShortBodyWriteResultEvidence {
  const r = exact(copy(input, 256 * 1024), BODY_PAYLOAD_KEYS.result);
  source(r.source);
  if (
    r.schema !== 'native-short-body-write-result/v1' ||
    !['not_attempted', 'unknown', 'matched'].includes(r.outcome as string) ||
    typeof r.reason !== 'string' ||
    ![...REASONS, 'match'].includes(r.reason as Reason | 'match') ||
    r.atomicRevision !== false ||
    ![
      nativeShortBodyHashBasesHash(),
      nativeShortBodyHashBasesHash({ comparisonPolicy: NATIVE_SHORT_BODY_COMPARISON_POLICY_V2 }),
    ].includes(r.hashBasesHash as string)
  )
    fail('invalid_trace');
  for (const key of ['desiredContentHash', 'preservationHash']) if (r[key] !== null) digest(r[key]);
  const e = exact(r.evidence, BODY_RESULT_LINKS);
  for (const key of BODY_RESULT_LINKS) if (e[key] !== null) link(e[key]);
  const p = exact(r.post, ['attempts', 'disposed', 'startedAt', 'acknowledgedAt', 'acknowledged']),
    n = boundedCount(p.attempts, 1),
    disposed = boundedCount(p.disposed, 1);
  if (
    disposed > n ||
    typeof p.acknowledged !== 'boolean' ||
    (p.acknowledgedAt !== null) !== p.acknowledged ||
    (n === 0 && (p.startedAt !== null || p.acknowledged || disposed !== 0)) ||
    (p.acknowledged && n !== 1)
  )
    fail('invalid_trace');
  for (const value of [p.startedAt, p.acknowledgedAt, r.ownerCheckedAt])
    if (value !== null) durableTime(value);
  ordered([p.startedAt, p.acknowledgedAt].filter((value) => value !== null));
  const c = durableCleanup(r.cleanup, at, prior);
  if (r.ownerCheckedAt !== null) ordered([r.ownerCheckedAt, c.checkedAt]);
  return r as unknown as NativeShortBodyWriteResultEvidence;
}

export interface DurableState {
  readonly context: NativeShortBodyEvidenceContext;
  readonly workId: string;
  stages: NativeShortBodyStageEvidence[];
  source: NativeShortBodySource | null;
  baseline: StoredBodySnapshot | null;
  plan: NativeShortBodyPlan | null;
  business: NativeShortBodyBusinessInput | null;
  noChange: boolean;
  after: StoredBodySnapshot | null;
  comparison: NativeShortBodyComparison | null;
  result: NativeShortBodyWriteResultEvidence | null;
}
