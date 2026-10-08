import {
  type State,
  expandHeld,
  linkBase,
  cleanHeld,
  intentPayload,
  transport,
  acknowledgement,
  cleanResult,
} from './stored-native-snapshot.js';

import {
  NATIVE_SHORT_TRIAL_DATASETS,
  type NativeShortTrialWriteResultEvidence,
  fail,
  refLink,
  exact,
  NATIVE_SHORT_TRIAL_OPERATION,
  UUID,
  HASH,
  same,
  time,
  order,
  integer,
  type NativeShortTrialStage,
  STAGES,
  type NativeShortTrialEvidenceContext,
  object,
  provenance,
  ORIGIN,
  type NativeShortTrialAttemptRow,
} from './fail.js';

import { NATIVE_SHORT_TRIAL_SCOPE, NATIVE_SHORT_TRIAL_HASH_BASES } from '../short-native-trial.js';

import { safeSnapshot, apiResult } from './api-result.js';

import { type Job } from '../../runtime/store.js';

import {
  hasReservedNativeShortTrialSignal,
  checkedContext,
  verifyRef,
  validateNativeShortTrialBusinessInput,
  nativeShortTrialBusinessInputHash,
  storedSnapshot,
} from './read-phase.js';

import { expandResult } from './expand-result.js';

export function businessResult(
  state: State,
  status = 'succeeded',
  reason: string | null = null,
): Record<string, unknown> {
  const plan = state.plan!,
    raw = state.after;
  return {
    schema: 'fanqie-short-native-trial-write-business/v1',
    dataset: NATIVE_SHORT_TRIAL_DATASETS.after,
    status,
    reason,
    accountId: state.context.accountId,
    target: { kind: 'short-story', id: state.business!.target.workId },
    inputHash: state.context.job.inputHash,
    scope: NATIVE_SHORT_TRIAL_SCOPE,
    hashBases: NATIVE_SHORT_TRIAL_HASH_BASES,
    sourceVersionHash: plan.expectation.sourceVersionHash,
    sourceDocumentHash: plan.expectation.sourceDocumentHash,
    desiredContentHash: plan.desiredContentHash,
    observedContentHash: raw?.observedContentHash ?? null,
    expectedDocumentHash: plan.expectation.expectedDocumentHash,
    expectedSavedFieldsHash: plan.expectation.expectedSavedFieldsHash,
    expectedTrialDocumentHash: plan.expectation.trialDocumentHash,
    bodyHash: plan.expectation.bodyHash,
    paragraphsHash: plan.expectation.paragraphsHash,
    attempted: state.kinds.includes('attempt'),
    durableAcknowledged: state.kinds.includes('acknowledgement'),
    originalAcknowledged: raw?.save.post.acknowledged ?? state.kinds.includes('acknowledgement'),
    originalOutcome: raw?.save.outcome ?? 'unknown',
    bodyIncluded: false,
    before: safeSnapshot(state.baseline!.snapshot),
    after: raw?.snapshot ? safeSnapshot(raw.snapshot) : null,
    provenance: state.provenance,
  };
}

export function resultPayload(state: State): NativeShortTrialWriteResultEvidence {
  if (!state.after || state.after.status !== 'success' || state.kinds.at(-1) !== 'after') fail();
  return {
    schema: 'native-short-trial-write-result/v1',
    scope: NATIVE_SHORT_TRIAL_SCOPE,
    baselineEvidence: refLink(state.context.refs[0]!),
    afterEvidence: refLink(state.context.refs.at(-1)!),
    business: businessResult(state),
  };
}

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
  const workId = /^short_native_trial\.([1-9][0-9]{9,21})$/.exec(job.scope)?.[1];
  if (
    !workId ||
    job.operation !== NATIVE_SHORT_TRIAL_OPERATION ||
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
    hasReservedNativeShortTrialSignal({
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

export function allowedNext(kinds: NativeShortTrialStage[], kind: NativeShortTrialStage): boolean {
  return (
    !kinds.includes(kind) &&
    (kind === STAGES[kinds.length] ||
      (kind === 'after' && kinds.length > 0 && !kinds.includes('after')) ||
      (kind === 'result' && kinds.at(-1) === 'after'))
  );
}

export function stateFor(
  input: NativeShortTrialEvidenceContext,
  complete = false,
  markedTransition = false,
): State {
  const context = checkedContext(input),
    { job, refs, documents, attempts } = context,
    workId = ordinaryJob(job, context.accountId);
  if (
    context.manifest !== null ||
    !Array.isArray(refs) ||
    refs.length !== documents.length ||
    refs.length > 7 ||
    new Set(refs.map((r) => r.id)).size !== refs.length ||
    !Array.isArray(attempts) ||
    attempts.length > 1
  )
    fail();
  const state: State = {
    context,
    mode: null,
    kinds: [],
    payloads: [],
    baseline: null,
    business: null,
    provenance: null,
    preSave: null,
    plan: null,
    after: null,
    result: null,
  };
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i]!,
      document = documents[i]!;
    verifyRef(ref, document, context.accountId, job.id);
    if (i) order([refs[i - 1]!.capturedAt, ref.capturedAt]);
    const p = object(document.payload),
      kind = STAGES.find(
        (k) =>
          p.schema ===
          (k === 'result'
            ? 'native-short-trial-write-result/v1'
            : `native-short-trial-${k.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-evidence/v1`),
      );
    if (
      !kind ||
      !allowedNext(state.kinds, kind) ||
      ref.dataset !== NATIVE_SHORT_TRIAL_DATASETS[kind]
    )
      fail();
    const prior: State = {
      ...state,
      context: { ...context, refs: refs.slice(0, i), documents: documents.slice(0, i) },
    };
    if (kind === 'baseline') {
      exact(p, ['schema', 'scope', 'held', 'businessInput', 'source', 'provenance']);
      if (p.scope !== NATIVE_SHORT_TRIAL_SCOPE) fail();
      state.business = validateNativeShortTrialBusinessInput(p.businessInput);
      state.provenance = provenance(p.provenance);
      if (
        !same(p.source, { origin: ORIGIN, mode: state.provenance.mode }) ||
        (state.provenance.mode === 'live' && document.collectionMode !== 'live') ||
        state.business.target.workId !== workId ||
        nativeShortTrialBusinessInputHash(state.business) !== job.inputHash
      )
        fail();
      state.baseline = expandHeld(p.held, state.business);
      state.mode = storedSnapshot(state.baseline.snapshot).mode;
      state.plan = state.baseline.plan;
      if (!same(job.target, { kind: 'short-story', id: workId })) fail();
      order([
        job.requestedAt,
        job.startedAt,
        job.platformReadStartedAt,
        state.baseline.read.proof.readStartedAt,
        state.baseline.read.proof.proofCapturedAt,
        state.baseline.checkedAt,
        ref.capturedAt,
      ]);
    } else {
      if (!state.baseline || document.collectionMode !== documents[0]!.collectionMode) fail();
      let expected: unknown;
      if (kind === 'preSave') {
        state.preSave = expandHeld(p.held, state.business!, state.baseline);
        order([
          refs[i - 1]!.capturedAt,
          state.preSave.read.proof.readStartedAt,
          state.preSave.checkedAt,
          ref.capturedAt,
        ]);
        expected = { ...linkBase(prior, kind), held: cleanHeld(state.preSave) };
      } else if (kind === 'intent') expected = intentPayload(prior);
      else if (kind === 'attempt') {
        time(p.eventAt);
        order([refs[i - 1]!.capturedAt, p.eventAt, ref.capturedAt]);
        expected = {
          ...linkBase(prior, kind),
          stage: 'attempt',
          ordinal: 1,
          eventAt: p.eventAt,
          transport: transport(workId),
        };
        if (job.platformWriteStartedAt !== p.eventAt) fail();
      } else if (kind === 'acknowledgement') {
        const a = acknowledgement(p.observation, state);
        order([refs[i - 1]!.capturedAt, a.acknowledgedAt, ref.capturedAt]);
        expected = { ...linkBase(prior, kind), observation: a };
      } else if (kind === 'after') {
        state.after = apiResult(expandResult(p.result, state), state);
        order([state.after.cleanup.checkedAt, ref.capturedAt]);
        if (state.after.proof.proofCapturedAt)
          order([state.after.proof.proofCapturedAt, ref.capturedAt]);
        expected = { ...linkBase(prior, kind), result: cleanResult(state.after) };
      } else {
        expected = resultPayload(prior);
        state.result = expected as NativeShortTrialWriteResultEvidence;
      }
      if (!same(p, expected)) fail();
    }
    state.kinds.push(kind);
    state.payloads.push(p);
  }
  const i = state.kinds.indexOf('attempt'),
    rows: NativeShortTrialAttemptRow[] =
      i < 0
        ? []
        : [
            {
              jobId: job.id,
              accountId: context.accountId,
              ordinal: 1,
              evidence: refLink(refs[i]!),
              eventAt: state.payloads[i]!.eventAt,
            },
          ];
  if (
    !same(attempts, rows) ||
    (i < 0 &&
      job.platformWriteStartedAt !== null &&
      !(
        markedTransition &&
        state.kinds.at(-1) === 'intent' &&
        job.status === 'running' &&
        job.result === null
      ))
  )
    fail();
  if (job.result !== null && job.status !== 'succeeded' && !same(job.result, { evidence: refs }))
    fail();
  if (refs.length && job.endedAt !== null) order([refs.at(-1)!.capturedAt, job.endedAt]);
  if (
    job.status === 'succeeded' &&
    (!state.result ||
      !same(job.result, state.result) ||
      job.error !== null ||
      job.cancellationRequestedAt !== null)
  )
    fail();
  if (
    complete &&
    (!state.result ||
      refs.length !== 7 ||
      job.platformWriteStartedAt === null ||
      state.after?.status !== 'success' ||
      job.cancellationRequestedAt !== null ||
      !['running', 'succeeded'].includes(job.status))
  )
    fail();
  return state;
}
