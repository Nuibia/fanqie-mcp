import {
  type DurableState,
  contextCopy,
  ordinaryBodyJob,
  verifyBodyRef,
  resultShape,
} from './context-copy.js';

import { fail, type Data, hash, storedNative, sourceError, same, exact } from './fail.js';

import {
  account,
  capturedBodyStage,
  ordered,
  source,
  bodyRead,
  bodyRefLink,
  bodyTransport,
  durableTime,
  BODY_RESULT_LINKS,
} from './native-short-body-scope.js';

import { NATIVE_SHORT_BODY_DATASETS } from './inspect.js';

import { NEXT, sameMode, nativeShortBodyHashBasesHash, clean } from './same-mode.js';

import {
  type NativeShortBodyBusinessInput,
  validateNativeShortBodyBusinessInput,
  nativeShortBodyBusinessInputHash,
  nativeShortBodyWriteRequest,
  NativeShortBodyError,
  NATIVE_SHORT_BODY_SCOPE,
} from '../short-native-body.js';

import { storedBodyMath } from '../short-native-legacy-codec.js';

import { isBodyClosure } from './validate-native-short-body-evidence-context.js';

export function inspectBody(input: unknown, mode: 'prefix' | 'complete'): DurableState {
  if (mode !== 'prefix' && mode !== 'complete') fail('invalid_shape');
  const c = contextCopy(input),
    workId = ordinaryBodyJob(c.job, account(c.accountId)),
    { job, refs, documents, attempts } = c;
  if (
    c.manifest !== null ||
    !Array.isArray(refs) ||
    !Array.isArray(attempts) ||
    refs.length !== documents.length ||
    refs.length > 7 ||
    attempts.length > 1 ||
    new Set(refs.map((ref) => ref.id)).size !== refs.length
  )
    fail('invalid_trace');
  if (
    job.target === null &&
    (refs.length ||
      attempts.length ||
      job.platformReadStartedAt !== null ||
      job.platformWriteStartedAt !== null)
  )
    fail('source_mismatch');
  const state: DurableState = {
    context: c,
    workId,
    stages: [],
    source: null,
    baseline: null,
    plan: null,
    business: null,
    noChange: false,
    after: null,
    comparison: null,
    result: null,
  };
  let priorAt: string | null = null,
    baselineVersionConflict = false;
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i]!,
      doc = documents[i]!;
    verifyBodyRef(ref, doc, c.accountId, job.id);
    const stage = capturedBodyStage(doc.payload),
      p = stage.payload as Data;
    const previous = state.stages.at(-1);
    if (
      stage.accountId !== c.accountId ||
      stage.jobId !== job.id ||
      stage.inputHash !== job.inputHash ||
      ref.dataset !== NATIVE_SHORT_BODY_DATASETS[stage.kind] ||
      stage.sequence !== i + 1 ||
      stage.priorStageHash !== (previous ? hash(previous) : null) ||
      !(previous
        ? NEXT[previous.kind].includes(stage.kind)
        : ['baseline', 'result'].includes(stage.kind))
    )
      fail('invalid_trace');
    ordered([...(priorAt === null ? [] : [priorAt]), stage.eventAt, ref.capturedAt]);
    if (baselineVersionConflict && stage.kind !== 'result') fail('invalid_trace');
    if (stage.kind === 'baseline') {
      state.source = source(p.source);
      state.baseline = storedNative(p.native);
      let business: NativeShortBodyBusinessInput;
      try {
        business = validateNativeShortBodyBusinessInput(p.businessInput);
      } catch (error) {
        sourceError(error);
      }
      const read = bodyRead(p.read, true);
      state.business = business;
      if (
        business.target.workId !== workId ||
        state.baseline.snapshot.binding.work.id !== workId ||
        nativeShortBodyBusinessInputHash(c.accountId, business) !== job.inputHash ||
        !same(job.target, { kind: 'short-story', id: workId }) ||
        job.platformReadStartedAt === null
      )
        fail('source_mismatch');
      ordered([
        job.requestedAt,
        job.startedAt,
        job.platformReadStartedAt,
        read.proof.readStartedAt,
        read.proof.readFinishedAt,
        read.proof.proofCapturedAt,
        stage.eventAt,
      ]);
      try {
        state.plan = storedBodyMath.planUpdate(
          state.baseline,
          nativeShortBodyWriteRequest(business),
        );
      } catch (error) {
        if (!(error instanceof NativeShortBodyError)) sourceError(error);
        if (error.code === 'no_change') state.noChange = true;
        else if (error.code === 'source_version_mismatch') baselineVersionConflict = true;
        else sourceError(error);
      }
    } else if (stage.kind === 'preSave') {
      if (!state.plan || !state.baseline) fail('invalid_trace');
      const snapshot = sameMode(storedNative(p.native), state.baseline),
        read = bodyRead(p.read, true);
      try {
        storedBodyMath.assertPreSave(snapshot, state.plan);
      } catch (error) {
        sourceError(error);
      }
      if (
        p.sourceVersionHash !== state.plan.expectation.sourceVersionHash ||
        p.desiredContentHash !== state.plan.desiredContentHash
      )
        fail('source_mismatch');
      ordered([
        priorAt,
        read.proof.readStartedAt,
        read.proof.readFinishedAt,
        read.proof.proofCapturedAt,
        stage.eventAt,
      ]);
    } else if (stage.kind === 'intent') {
      if (!state.plan || previous?.kind !== 'preSave') fail('invalid_trace');
      const e = state.plan.expectation;
      const expected = {
        hashBasesHash: nativeShortBodyHashBasesHash(state.plan.expectation.writeRequest),
        target: { kind: 'short-story', id: workId },
        binding: e.binding,
        inputHash: job.inputHash,
        sourceVersionHash: e.sourceVersionHash,
        desiredContentHash: state.plan.desiredContentHash,
        baselineEvidence: bodyRefLink(refs[0]!),
        preSaveEvidence: bodyRefLink(refs[i - 1]!),
        expectationHash: hash(e),
        transport: bodyTransport(p.transport, workId),
      };
      if (!same(p, expected)) fail('source_mismatch');
      const forbidden =
        /^(?:body|content|text|html|args|headers|credentials|cookie|authorization|token|password)$/i;
      const stack: unknown[] = [p];
      while (stack.length) {
        const v = stack.pop();
        if (v && typeof v === 'object')
          for (const [key, value] of Object.entries(v)) {
            if (forbidden.test(key)) fail('invalid_trace');
            if (value && typeof value === 'object') stack.push(value);
          }
      }
    } else if (stage.kind === 'attempt') {
      if (
        !state.plan ||
        p.ordinal !== 1 ||
        p.eventAt !== stage.eventAt ||
        job.platformWriteStartedAt !== stage.eventAt ||
        !same(p.intentEvidence, bodyRefLink(refs[i - 1]!))
      )
        fail('invalid_trace');
      bodyTransport(p.transport, workId);
    } else if (stage.kind === 'acknowledgement') {
      if (
        !state.plan ||
        !same(
          p.attemptEvidence,
          bodyRefLink(refs[state.stages.findIndex((s) => s.kind === 'attempt')]!),
        )
      )
        fail('source_mismatch');
      const a = exact(p.observation, [
        'schema',
        'binding',
        'scope',
        'sourceVersionHash',
        'desiredContentHash',
        'acknowledgedAt',
      ]);
      if (
        a.schema !== 'native-short-body-acknowledgement/v1' ||
        a.scope !== NATIVE_SHORT_BODY_SCOPE ||
        !same(a.binding, state.plan.expectation.binding) ||
        a.sourceVersionHash !== state.plan.expectation.sourceVersionHash ||
        a.desiredContentHash !== state.plan.desiredContentHash ||
        a.acknowledgedAt !== stage.eventAt
      )
        fail('source_mismatch');
      durableTime(a.acknowledgedAt);
    } else if (stage.kind === 'after') {
      if (
        !state.plan ||
        !state.stages.some((s) => s.kind === 'attempt') ||
        (p.native === null) !== (p.comparison === null)
      )
        fail('invalid_trace');
      const read = bodyRead(p.read, p.native !== null);
      ordered([
        priorAt,
        ...[read.proof.readStartedAt, read.proof.readFinishedAt, read.proof.proofCapturedAt].filter(
          (t) => t !== null,
        ),
        stage.eventAt,
      ]);
      if (p.native !== null) {
        state.after = sameMode(storedNative(p.native), state.baseline!);
        try {
          state.comparison = storedBodyMath.compareReadback(state.plan.expectation, state.after);
        } catch (error) {
          sourceError(error);
        }
        if (!same(p.comparison, state.comparison)) fail('source_mismatch');
      }
    } else {
      const r = resultShape(p, stage.eventAt, priorAt);
      if (state.source === null) state.source = source(r.source);
      if (!same(r.source, state.source)) fail('source_mismatch');
      if (r.hashBasesHash !== nativeShortBodyHashBasesHash(state.business ?? undefined))
        fail('source_mismatch');
      const expectedLinks = Object.fromEntries(
        BODY_RESULT_LINKS.map((kind) => {
          const index = state.stages.findIndex((s) => s.kind === kind);
          return [kind, index < 0 ? null : bodyRefLink(refs[index]!)];
        }),
      );
      if (
        !same(r.evidence, expectedLinks) ||
        r.desiredContentHash !== (state.plan?.desiredContentHash ?? null) ||
        r.preservationHash !== (state.plan?.expectation.preservationHash ?? null)
      )
        fail('source_mismatch');
      const attempted = state.stages.some((s) => s.kind === 'attempt'),
        acknowledged = state.stages.some((s) => s.kind === 'acknowledgement');
      if (r.outcome === 'not_attempted' ? attempted : !attempted) fail('invalid_trace');
      if (
        (r.post.attempts === 1 && !attempted) ||
        r.post.acknowledged !== acknowledged ||
        (acknowledged &&
          r.post.acknowledgedAt !== state.stages.find((s) => s.kind === 'acknowledgement')!.eventAt)
      )
        fail('invalid_trace');
      if (r.post.startedAt !== null)
        ordered([
          job.platformWriteStartedAt,
          r.post.startedAt,
          ...[r.post.acknowledgedAt].filter((t) => t !== null),
          stage.eventAt,
        ]);
      if (
        baselineVersionConflict &&
        (i !== 1 ||
          previous?.kind !== 'baseline' ||
          r.reason !== 'version_conflict' ||
          r.outcome !== 'not_attempted' ||
          r.desiredContentHash !== null ||
          r.preservationHash !== null ||
          !same(r.post, {
            attempts: 0,
            disposed: 0,
            startedAt: null,
            acknowledgedAt: null,
            acknowledged: false,
          }))
      )
        fail('invalid_trace');
      if (r.outcome === 'matched') {
        if (
          !state.baseline ||
          !state.plan ||
          !state.comparison?.matches ||
          !clean(r.cleanup) ||
          r.ownerCheckedAt === null ||
          !acknowledged ||
          r.post.attempts !== 1 ||
          r.post.disposed !== 1 ||
          r.post.startedAt === null ||
          i !== 6 ||
          r.reason !== (state.source.mode === 'live' ? 'match' : 'fixture_not_live')
        )
          fail('invalid_trace');
      } else if (r.reason === 'match' || r.reason === 'fixture_not_live') fail('invalid_trace');
      if (
        r.reason === 'no_change' &&
        (!state.noChange ||
          i !== 1 ||
          previous?.kind !== 'baseline' ||
          r.outcome !== 'not_attempted' ||
          !clean(r.cleanup) ||
          r.ownerCheckedAt === null ||
          r.post.attempts !== 0)
      )
        fail('invalid_trace');
      if (r.ownerCheckedAt !== null && state.baseline)
        ordered([job.platformReadStartedAt, r.ownerCheckedAt, r.cleanup.checkedAt]);
      state.result = r;
    }
    if (state.source && doc.collectionMode !== state.source.mode) fail('source_mismatch');
    state.stages.push(stage);
    priorAt = ref.capturedAt;
  }
  const ai = state.stages.findIndex((stage) => stage.kind === 'attempt'),
    expectedAttempts =
      ai < 0
        ? []
        : [
            {
              jobId: job.id,
              accountId: c.accountId,
              ordinal: 1,
              evidence: bodyRefLink(refs[ai]!),
              eventAt: state.stages[ai]!.eventAt,
            },
          ];
  if (!same(attempts, expectedAttempts) || ai < 0 !== (job.platformWriteStartedAt === null))
    fail('invalid_trace');
  if (refs.length && job.endedAt !== null) ordered([refs.at(-1)!.capturedAt, job.endedAt]);
  if (
    job.result !== null &&
    job.status !== 'succeeded' &&
    !(typeof job.result === 'object' && job.result !== null && isBodyClosure(job.result)) &&
    !same(job.result, { evidence: refs })
  )
    fail('source_mismatch');
  if (
    job.status === 'succeeded' &&
    !(typeof job.result === 'object' && job.result !== null && isBodyClosure(job.result)) &&
    (!state.result ||
      !same(job.result, state.result) ||
      job.error !== null ||
      job.cancellationRequestedAt !== null ||
      !(state.result.outcome === 'matched' || state.result.reason === 'no_change'))
  )
    fail('invalid_trace');
  if (mode === 'complete' && !state.result) fail('invalid_trace');
  return state;
}
