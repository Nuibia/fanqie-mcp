import {
  type NativeShortCoverEvidenceContext,
  fail,
  order,
  object,
  STAGES,
  NATIVE_SHORT_COVER_DATASETS,
  exact,
  validateNativeShortCoverBusinessInput,
  provenance,
  same,
  ORIGIN,
  nativeShortCoverBusinessInputHash,
  time,
  type NativeShortCoverWriteResultEvidence,
  type NativeShortCoverAttemptRow,
  refLink,
  type NativeShortCoverProjection,
  copy,
  freeze,
  type AuditSnapshot,
  type Data,
} from './fail.js';

import {
  type State,
  held,
  storedSnapshot,
  acknowledgement,
} from './has-reserved-native-short-cover-signal.js';

import { checkedContext, ordinaryJob, verifyRef } from './ordinary-job.js';

import { NATIVE_SHORT_COVER_SCOPE } from '../short-native-cover.js';

import {
  intentPayload,
  linkBase,
  transport,
  expandResult,
  cleanResult,
  stageFor,
} from './transport.js';

import { storedCoverMath } from '../short-native-legacy-codec.js';

import { apiResult, resultPayload, businessResult } from './api-result.js';

import { safeNativeShortCoverRef } from './project-native-short-cover-evidence-context.js';

import { type EvidenceRef } from '../../runtime/store.js';

import { createNativeShortMetadataSnapshot } from '../short-native-metadata.js';

export function stateFor(input: NativeShortCoverEvidenceContext, complete = false): State {
  const context = checkedContext(input),
    { job, refs, documents, attempts } = context,
    workId = ordinaryJob(job, context.accountId);
  if (
    context.manifest !== null ||
    !Array.isArray(refs) ||
    refs.length !== documents.length ||
    refs.length > 10 ||
    new Set(refs.map((r) => r.id)).size !== refs.length ||
    !Array.isArray(attempts) ||
    attempts.length > 2
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
    uploadAck: null,
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
            ? 'native-short-cover-write-result/v1'
            : `native-short-cover-${k.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-evidence/v1`),
      );
    if (!kind || state.kinds.includes(kind) || ref.dataset !== NATIVE_SHORT_COVER_DATASETS[kind])
      fail();
    const expectedKind = STAGES[state.kinds.length];
    if (
      (kind !== expectedKind && kind !== 'after') ||
      (state.kinds.includes('after') && kind !== 'result')
    )
      fail();
    const prior = {
      ...state,
      context: { ...context, refs: refs.slice(0, i), documents: documents.slice(0, i) },
    };
    if (kind === 'baseline') {
      exact(p, ['schema', 'scope', 'held', 'businessInput', 'source', 'provenance']);
      if (p.scope !== NATIVE_SHORT_COVER_SCOPE) fail();
      state.business = validateNativeShortCoverBusinessInput(p.businessInput);
      state.provenance = provenance(p.provenance);
      if (
        !same(p.source, { origin: ORIGIN, mode: state.provenance.mode }) ||
        (state.provenance.mode === 'live' && document.collectionMode !== 'live') ||
        state.business.target.workId !== workId ||
        nativeShortCoverBusinessInputHash(state.business) !== job.inputHash
      )
        fail();
      state.baseline = held(p.held, 'upload', state.business);
      state.mode = storedSnapshot(state.baseline.snapshot).mode;
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
      if (kind === 'uploadIntent' || kind === 'saveIntent')
        expected = intentPayload(prior, kind === 'uploadIntent' ? 'upload' : 'save');
      else if (kind === 'uploadAttempt' || kind === 'saveAttempt') {
        const phase = kind === 'uploadAttempt' ? 'upload' : 'save';
        time(p.eventAt);
        order([refs[i - 1]!.capturedAt, p.eventAt, ref.capturedAt]);
        expected = {
          ...linkBase(prior, kind),
          phase,
          stage: 'attempt',
          ordinal: 1,
          eventAt: p.eventAt,
          transport: transport(phase, workId),
        };
        if (phase === 'upload' && job.platformWriteStartedAt !== p.eventAt) fail();
      } else if (kind === 'uploadAck' || kind === 'saveAck') {
        const phase = kind === 'uploadAck' ? 'upload' : 'save',
          a = acknowledgement(p.observation, phase, state);
        order([refs[i - 1]!.capturedAt, a.acknowledgedAt, ref.capturedAt]);
        expected = { ...linkBase(prior, kind), observation: a };
        if (phase === 'upload') {
          state.uploadAck = a;
          state.plan = storedCoverMath.planSave(
            storedSnapshot(state.baseline.snapshot, state.mode),
            state.baseline.uploadIntent,
            { picUri: a.picUri!, picUrl: a.picUrl! },
          );
        }
      } else if (kind === 'preSave') {
        if (!state.uploadAck) fail();
        state.preSave = held(p.held, 'save', state.business!, state.baseline, state.uploadAck);
        order([
          refs[i - 1]!.capturedAt,
          state.preSave.read.proof.readStartedAt,
          state.preSave.checkedAt,
          ref.capturedAt,
        ]);
        state.plan = storedCoverMath.planSave(
          storedSnapshot(state.preSave.snapshot, state.mode),
          state.baseline.uploadIntent,
          { picUri: state.uploadAck.picUri!, picUrl: state.uploadAck.picUrl! },
        );
        expected = { ...linkBase(prior, kind), held: state.preSave };
      } else if (kind === 'after') {
        const clean = exact(p.result, [
          'schema',
          'status',
          'reason',
          'snapshot',
          'comparison',
          'desiredContentHash',
          'observedContentHash',
          'observedPreSaveSnapshot',
          'observedSaveHeld',
          'phases',
          'upload',
          'save',
          'proof',
          'cleanup',
        ]);
        exact(clean.upload, [
          'intentReceipt',
          'attemptReceipt',
          'acknowledgementReceipt',
          'observation',
          'post',
          'outcome',
        ]);
        exact(clean.save, [
          'intentReceipt',
          'attemptReceipt',
          'acknowledgementReceipt',
          'observation',
          'post',
          'outcome',
        ]);
        state.after = apiResult(expandResult(clean, state), state);
        order([state.after.cleanup.checkedAt, ref.capturedAt]);
        if (state.after.proof.proofCapturedAt)
          order([state.after.proof.proofCapturedAt, ref.capturedAt]);
        expected = { ...linkBase(prior, kind), result: cleanResult(state.after) };
      } else {
        expected = resultPayload(prior);
        state.result = expected as NativeShortCoverWriteResultEvidence;
      }
      if (!same(p, expected)) fail();
    }
    state.kinds.push(kind);
    state.payloads.push(p);
  }
  const expectedRows: NativeShortCoverAttemptRow[] = [];
  for (const phase of ['upload', 'save'] as const) {
    const i = state.kinds.indexOf(stageFor(phase, 'attempt'));
    if (i >= 0)
      expectedRows.push({
        jobId: job.id,
        accountId: context.accountId,
        phase,
        ordinal: 1,
        evidence: refLink(refs[i]!),
        eventAt: state.payloads[i]!.eventAt,
      });
  }
  if (!same(attempts, expectedRows)) fail();
  if (job.result !== null && job.status !== 'succeeded') {
    if (!same(job.result, { evidence: refs })) fail();
  }
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
      refs.length !== 10 ||
      job.platformWriteStartedAt === null ||
      state.after?.status !== 'success' ||
      job.cancellationRequestedAt !== null ||
      !['running', 'succeeded'].includes(job.status))
  )
    fail();
  return state;
}

export function validateNativeShortCoverEvidenceContext(
  context: NativeShortCoverEvidenceContext,
  mode: 'prefix' | 'complete' = 'prefix',
): NativeShortCoverProjection {
  try {
    const state = stateFor(context, mode === 'complete');
    return projectState(state);
  } catch {
    fail();
  }
}

export const validateNativeShortCoverPrefix = (context: NativeShortCoverEvidenceContext) =>
  validateNativeShortCoverEvidenceContext(context, 'prefix');

export function validateNativeShortCoverCompletion(
  context: NativeShortCoverEvidenceContext,
  returned?: unknown,
): NativeShortCoverWriteResultEvidence {
  try {
    const state = stateFor(context, true);
    if (returned !== undefined && !same(copy(returned, 64 * 1024), state.result)) fail();
    return freeze(state.result!);
  } catch {
    fail();
  }
}

export function projectState(state: State): NativeShortCoverProjection {
  const visible = state.context.refs
    .filter((ref) => ref.dataset !== 'write-intent')
    .map(safeNativeShortCoverRef);
  const business = state.baseline
    ? {
        ...(state.context.job.status === 'succeeded'
          ? state.result!.business
          : businessResult(
              state,
              state.context.job.status === 'uncertain' ? 'uncertain' : 'capability_unavailable',
              'outcome_not_verified',
            )),
        ...statusObservation(state),
      }
    : null;
  return {
    validated: state.baseline !== null,
    result:
      state.context.job.status === 'succeeded' ? { ...state.result!, business: business! } : null,
    evidence: visible,
    data: business ? [business] : [],
    collectionMode: state.provenance?.mode ?? null,
  };
}

export function observation(
  native: AuditSnapshot,
  phase: 'baseline' | 'pre_save' | 'after' | 'later_read',
  ref: EvidenceRef,
): Data {
  const rebuilt = createNativeShortMetadataSnapshot({
    binding: native.binding,
    editData: native.editData,
    categoryData: native.categoryData,
  });
  return {
    state: rebuilt.state,
    statusFacts: rebuilt.statusFacts,
    statusSource: {
      phase,
      sourceRef: ref.id,
      evidenceHash: ref.sha256,
      evidenceCapturedAt: ref.capturedAt,
    },
  };
}

export function statusObservation(state: State): Data {
  const afterIndex = state.kinds.indexOf('after');
  if (state.after?.snapshot)
    return observation(state.after.snapshot, 'after', state.context.refs[afterIndex]!);
  if (state.after?.snapshots.preSave)
    return observation(state.after.snapshots.preSave, 'pre_save', state.context.refs[afterIndex]!);
  if (state.preSave)
    return observation(
      state.preSave.snapshot,
      'pre_save',
      state.context.refs[state.kinds.indexOf('preSave')]!,
    );
  if (state.baseline)
    return observation(state.baseline.snapshot, 'baseline', state.context.refs[0]!);
  return { state: 'unknown', statusFacts: null, statusSource: null };
}
