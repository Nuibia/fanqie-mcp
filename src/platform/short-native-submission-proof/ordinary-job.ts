import { type Job } from '../../runtime/store.js';

import {
  exact,
  NATIVE_SHORT_SUBMISSION_OPERATION,
  UUID,
  HASH,
  same,
  fail,
  time,
  order,
  integer,
  type NativeShortSubmissionStage,
  STAGES,
  type NativeShortSubmissionContext,
  verifyRef,
  object,
  NATIVE_SHORT_SUBMISSION_DATASETS,
  provenance,
  ORIGIN,
  type NativeShortSubmissionWriteResultEvidence,
  refLink,
  type NativeShortSubmissionProjection,
  copy,
  freeze,
} from './fail.js';

import {
  hasReservedNativeShortSubmissionSignal,
  type State,
  checkedContext,
  validateNativeShortSubmissionBusinessInput,
  nativeShortSubmissionBusinessInputHash,
  held,
  validatePreparationLink,
  transport,
} from './source-fields.js';

import { NATIVE_SHORT_SUBMISSION_SCOPE } from '../short-native-submission.js';

import {
  linkBase,
  intentPayload,
  acknowledgement,
  apiResult,
  resultPayload,
  receiptFields,
} from './link-base.js';

import { projectState } from './create-native-short-submission-stage-evidence.js';

import {
  type NativeShortSubmissionReceiptStage,
  type NativeShortSubmissionReceiptFields,
} from '../short-native-submission-api.js';

function ordinaryJob(job: Job, accountId: string): string {
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
  const workId = /^short_native_submission\.([1-9][0-9]{9,21})$/.exec(job.scope)?.[1];
  if (
    !workId ||
    job.operation !== NATIVE_SHORT_SUBMISSION_OPERATION ||
    job.kind !== 'write' ||
    job.accountId !== accountId ||
    !UUID.test(job.id) ||
    !UUID.test(job.ownerId) ||
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
    hasReservedNativeShortSubmissionSignal({
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

export function allowedNext(
  kinds: NativeShortSubmissionStage[],
  k: NativeShortSubmissionStage,
): boolean {
  return (
    !kinds.includes(k) &&
    (k === STAGES[kinds.length] ||
      (k === 'after' && kinds.length > 0) ||
      (k === 'result' && kinds.at(-1) === 'after'))
  );
}

export function stateFor(
  input: NativeShortSubmissionContext,
  complete = false,
  marked = false,
): State {
  const c = checkedContext(input),
    { job, refs, documents, attempts } = c,
    id = ordinaryJob(job, c.accountId);
  if (
    c.manifest !== null ||
    refs.length !== documents.length ||
    refs.length > 7 ||
    new Set(refs.map((r) => r.id)).size !== refs.length ||
    attempts.length > 1
  )
    fail();
  const s: State = {
    context: c,
    kinds: [],
    payloads: [],
    baseline: null,
    business: null,
    provenance: null,
    preSubmit: null,
    plan: null,
    after: null,
    result: null,
  };
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i]!,
      doc = documents[i]!;
    verifyRef(ref, doc, c.accountId, job.id);
    if (i) order([refs[i - 1]!.capturedAt, ref.capturedAt]);
    const p = object(doc.payload),
      k = STAGES.find(
        (x) =>
          p.schema ===
          (x === 'result'
            ? 'native-short-submission-write-result/v1'
            : `native-short-submission-${x.replace(/[A-Z]/g, (l) => `-${l.toLowerCase()}`)}-evidence/v1`),
      );
    if (!k || !allowedNext(s.kinds, k) || ref.dataset !== NATIVE_SHORT_SUBMISSION_DATASETS[k])
      fail();
    const prior = {
      ...s,
      context: { ...c, refs: refs.slice(0, i), documents: documents.slice(0, i) },
    };
    if (k === 'baseline') {
      exact(p, ['schema', 'scope', 'held', 'businessInput', 'source', 'provenance']);
      if (p.scope !== NATIVE_SHORT_SUBMISSION_SCOPE) fail();
      s.business = validateNativeShortSubmissionBusinessInput(p.businessInput);
      s.provenance = provenance(p.provenance);
      if (
        !same(p.source, { origin: ORIGIN, mode: s.provenance.mode }) ||
        (s.provenance.mode === 'live' && doc.collectionMode !== 'live') ||
        s.business.target.workId !== id ||
        nativeShortSubmissionBusinessInputHash(s.business) !== job.inputHash
      )
        fail();
      s.baseline = held(p.held, s.business);
      s.plan = s.baseline.plan;
      validatePreparationLink(c, s.business, s.baseline);
      if (!same(job.target, { kind: 'short-story', id })) fail();
      order([
        job.requestedAt,
        job.startedAt,
        job.platformReadStartedAt,
        s.baseline.read.proof.readStartedAt,
        s.baseline.checkedAt,
        ref.capturedAt,
      ]);
    } else {
      if (!s.baseline || doc.collectionMode !== documents[0]!.collectionMode) fail();
      let expected: unknown;
      if (k === 'preSubmit') {
        s.preSubmit = held(p.held, s.business!, s.baseline);
        order([
          refs[i - 1]!.capturedAt,
          s.preSubmit.read.proof.readStartedAt,
          s.preSubmit.checkedAt,
          ref.capturedAt,
        ]);
        expected = { ...linkBase(prior, k), held: s.preSubmit };
      } else if (k === 'intent') expected = intentPayload(prior);
      else if (k === 'attempt') {
        time(p.eventAt);
        order([refs[i - 1]!.capturedAt, p.eventAt, ref.capturedAt]);
        if (job.platformWriteStartedAt !== p.eventAt) fail();
        expected = {
          ...linkBase(prior, k),
          stage: 'attempt',
          ordinal: 1,
          eventAt: p.eventAt,
          transport: transport(id),
        };
      } else if (k === 'acknowledgement') {
        const a = acknowledgement(p.observation, s);
        order([refs[i - 1]!.capturedAt, a.acknowledgedAt, ref.capturedAt]);
        expected = { ...linkBase(prior, k), observation: a };
      } else if (k === 'after') {
        s.after = apiResult(p.result, s);
        order([s.after.cleanup.checkedAt, ref.capturedAt]);
        if (s.after.proof.proofCapturedAt) order([s.after.proof.proofCapturedAt, ref.capturedAt]);
        expected = { ...linkBase(prior, k), result: s.after };
      } else {
        expected = resultPayload(prior);
        s.result = expected as NativeShortSubmissionWriteResultEvidence;
      }
      if (!same(p, expected)) fail();
    }
    s.kinds.push(k);
    s.payloads.push(p);
  }
  const ai = s.kinds.indexOf('attempt'),
    rows =
      ai < 0
        ? []
        : [
            {
              jobId: job.id,
              accountId: c.accountId,
              ordinal: 1,
              evidence: refLink(refs[ai]!),
              eventAt: s.payloads[ai]!.eventAt,
            },
          ];
  if (
    (!same(attempts, rows) &&
      !(
        marked &&
        ['running', 'uncertain'].includes(job.status) &&
        s.kinds.at(-1) === 'attempt' &&
        attempts.length === 0
      )) ||
    (ai < 0 &&
      job.platformWriteStartedAt !== null &&
      !(marked && s.kinds.at(-1) === 'intent' && ['running', 'uncertain'].includes(job.status)))
  )
    fail();
  const done = s.result !== null && ['succeeded', 'failed'].includes(job.status);
  if (job.result !== null && !done && !same(job.result, { evidence: refs })) fail();
  if (refs.length && job.endedAt !== null) order([refs.at(-1)!.capturedAt, job.endedAt]);
  if (done) {
    if (
      !same(job.result, s.result) ||
      job.status !== s.result!.business.status ||
      job.cancellationRequestedAt !== null ||
      (job.status === 'succeeded' && job.error !== null) ||
      (job.status === 'failed' && job.error?.code !== 'native_submission_rejected')
    )
      fail();
  }
  if (
    (job.status === 'succeeded' && !done) ||
    (complete &&
      (!s.result ||
        refs.length !== 7 ||
        job.platformWriteStartedAt === null ||
        s.after?.status !== 'success' ||
        job.cancellationRequestedAt !== null ||
        !['running', 'succeeded', 'failed'].includes(job.status)))
  )
    fail();
  return s;
}

export function validateNativeShortSubmissionEvidenceContext(
  c: NativeShortSubmissionContext,
  mode: 'prefix' | 'complete' = 'prefix',
): NativeShortSubmissionProjection {
  return projectState(stateFor(c, mode === 'complete', mode === 'prefix'));
}

export function validateNativeShortSubmissionCompletion(
  c: NativeShortSubmissionContext,
  returned?: unknown,
): NativeShortSubmissionWriteResultEvidence {
  const s = stateFor(c, true);
  if (returned !== undefined && !same(copy(returned), s.result)) fail();
  return freeze(s.result!);
}

export function nativeShortSubmissionReceiptFields(
  c: NativeShortSubmissionContext,
  stage: NativeShortSubmissionReceiptStage,
): NativeShortSubmissionReceiptFields {
  const s = stateFor(c);
  if (s.kinds.at(-1) !== stage) fail();
  return freeze(receiptFields(s, stage));
}
