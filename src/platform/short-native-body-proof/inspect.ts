import {
  type Inspected,
  capturedFixtureStage,
  NEXT,
  sameMode,
  nativeShortBodyHashBasesHash,
  cleanup,
  clean,
} from './same-mode.js';

import {
  fail,
  exact,
  copy,
  MIB,
  BAD_UNICODE,
  digest,
  freeze,
  type NativeShortBodyFixtureTrace,
  type NativeShortBodyFixtureStageKind,
  type Data,
  storedNative,
  sourceError,
  NativeShortBodyProofError,
  same,
  time,
  REASONS,
  type Reason,
  hash,
  type NativeShortBodyFixtureProjection,
} from './fail.js';

import {
  NATIVE_SHORT_BODY_SCOPE,
  type NativeShortBodyPlan,
  validateNativeShortBodyBusinessInput,
  nativeShortBodyBusinessInputHash,
  nativeShortBodyWriteRequest,
  NativeShortBodyError,
  compareNativeShortBodyReadback,
} from '../short-native-body.js';

import { type StoredBodySnapshot, storedBodyMath } from '../short-native-legacy-codec.js';

function inspect(input: unknown, mode: 'prefix' | 'complete'): Inspected {
  if (mode !== 'prefix' && mode !== 'complete') fail('invalid_shape');
  const d = exact(copy(input, 32 * MIB), [
    'schema',
    'scope',
    'provenance',
    'accountId',
    'workId',
    'inputHash',
    'stages',
    'simulatedAttemptOrdinal',
  ]);
  const p = exact(d.provenance, ['mode', 'executor']);
  if (
    d.schema !== 'native-short-body-fixture-trace/v1' ||
    d.scope !== NATIVE_SHORT_BODY_SCOPE ||
    p.mode !== 'fixture' ||
    p.executor !== 'dependency-injected-body-owned-run/v1'
  )
    fail('invalid_shape');
  if (
    typeof d.accountId !== 'string' ||
    !d.accountId.length ||
    BAD_UNICODE.test(d.accountId) ||
    /[\r\n\u0000]/u.test(d.accountId) ||
    Buffer.byteLength(d.accountId, 'utf8') > 1024 ||
    typeof d.workId !== 'string' ||
    !/^[1-9][0-9]{9,21}$/.test(d.workId)
  )
    fail('invalid_shape');
  digest(d.inputHash);
  if (
    !Array.isArray(d.stages) ||
    d.stages.length > 7 ||
    (d.simulatedAttemptOrdinal !== null && d.simulatedAttemptOrdinal !== 1)
  )
    fail('invalid_trace');
  const stages = d.stages.map(capturedFixtureStage);
  const trace = freeze({ ...d, stages }) as unknown as NativeShortBodyFixtureTrace;
  const state: Inspected = {
    trace,
    hashes: [],
    baseline: false,
    preSave: false,
    attempted: false,
    acknowledged: false,
    after: false,
    matched: false,
    final: null,
  };
  let previous: NativeShortBodyFixtureStageKind | null = null,
    priorAt: string | null = null;
  let baseline: StoredBodySnapshot | null = null,
    plan: NativeShortBodyPlan | null = null,
    noChange = false;
  for (let index = 0; index < stages.length; index++) {
    const stage = stages[index]!,
      payload = stage.payload as Data;
    if (
      stage.sequence !== index + 1 ||
      stage.priorStageHash !== (state.hashes.at(-1) ?? null) ||
      (priorAt !== null && stage.eventAt < priorAt) ||
      !(previous === null
        ? ['baseline', 'result'].includes(stage.kind)
        : NEXT[previous].includes(stage.kind))
    )
      fail('invalid_trace');
    switch (stage.kind) {
      case 'baseline': {
        baseline = storedNative(payload.native);
        state.baseline = true;
        try {
          const business = validateNativeShortBodyBusinessInput(payload.businessInput);
          if (
            business.target.workId !== trace.workId ||
            baseline.snapshot.binding.work.id !== trace.workId ||
            payload.inputHash !== trace.inputHash ||
            nativeShortBodyBusinessInputHash(trace.accountId, business) !== trace.inputHash
          )
            fail('source_mismatch');
          try {
            plan = storedBodyMath.planUpdate(baseline, nativeShortBodyWriteRequest(business));
          } catch (error) {
            if (!(error instanceof NativeShortBodyError)) sourceError(error);
            noChange = error.code === 'no_change';
          }
        } catch (error) {
          if (error instanceof NativeShortBodyProofError) throw error;
          sourceError(error);
        }
        break;
      }
      case 'preSave': {
        if (
          !baseline ||
          !plan ||
          payload.sourceVersionHash !== plan.expectation.sourceVersionHash ||
          payload.desiredContentHash !== plan.desiredContentHash
        )
          fail('source_mismatch');
        const current = sameMode(storedNative(payload.native), baseline);
        try {
          storedBodyMath.assertPreSave(current, plan);
        } catch (error) {
          sourceError(error);
        }
        if (Buffer.byteLength(plan.request.body, 'utf8') > 32 * MIB) fail('resource_limit');
        state.preSave = true;
        break;
      }
      case 'intent':
        if (
          !plan ||
          !state.preSave ||
          payload.sourceVersionHash !== plan.expectation.sourceVersionHash ||
          payload.desiredContentHash !== plan.desiredContentHash ||
          payload.hashBasesHash !== nativeShortBodyHashBasesHash(plan.expectation.writeRequest)
        )
          fail('source_mismatch');
        break;
      case 'attempt':
        if (
          !plan ||
          payload.simulatedOrdinal !== 1 ||
          payload.eventAt !== stage.eventAt ||
          state.attempted
        )
          fail('invalid_trace');
        state.attempted = true;
        break;
      case 'acknowledgement': {
        const a = exact(payload.observation, [
          'schema',
          'binding',
          'scope',
          'sourceVersionHash',
          'desiredContentHash',
          'acknowledgedAt',
        ]);
        if (
          !plan ||
          a.schema !== 'native-short-body-fixture-acknowledgement/v1' ||
          a.scope !== NATIVE_SHORT_BODY_SCOPE ||
          !same(a.binding, plan.expectation.binding) ||
          a.sourceVersionHash !== plan.expectation.sourceVersionHash ||
          a.desiredContentHash !== plan.desiredContentHash ||
          a.acknowledgedAt !== stage.eventAt
        )
          fail('source_mismatch');
        time(a.acknowledgedAt);
        state.acknowledged = true;
        break;
      }
      case 'after': {
        if (
          !plan ||
          !state.attempted ||
          (payload.native === null) !== (payload.comparison === null)
        )
          fail('invalid_trace');
        if (payload.native !== null) {
          const observed = sameMode(storedNative(payload.native), baseline!);
          let expected: ReturnType<typeof compareNativeShortBodyReadback>;
          try {
            expected = storedBodyMath.compareReadback(plan.expectation, observed);
          } catch (error) {
            sourceError(error);
          }
          if (!same(payload.comparison, expected)) fail('source_mismatch');
          state.after = true;
          state.matched = expected.matches;
        }
        break;
      }
      case 'result': {
        if (
          typeof payload.outcome !== 'string' ||
          !['not_attempted', 'fixture_unknown', 'fixture_matched'].includes(payload.outcome) ||
          typeof payload.reason !== 'string' ||
          !REASONS.includes(payload.reason as Reason)
        )
          fail('invalid_trace');
        const c = cleanup(payload.cleanup, stage.eventAt, priorAt),
          reason = payload.reason as Reason,
          outcome = payload.outcome as string;
        if (outcome === 'not_attempted' ? state.attempted : !state.attempted) fail('invalid_trace');
        if (outcome === 'fixture_matched') {
          if (
            !state.baseline ||
            !state.preSave ||
            !state.acknowledged ||
            !state.after ||
            !state.matched ||
            !clean(c) ||
            stages.length !== 7 ||
            reason !== 'fixture_not_live'
          )
            fail('invalid_trace');
        } else if (reason === 'fixture_not_live') fail('invalid_trace');
        if (
          reason === 'no_change' &&
          (outcome !== 'not_attempted' ||
            !noChange ||
            stages.length !== 2 ||
            previous !== 'baseline' ||
            !clean(c))
        )
          fail('invalid_trace');
        state.final = { outcome, reason, cleanup: c };
        break;
      }
    }
    state.hashes.push(hash(stage));
    previous = stage.kind;
    priorAt = stage.eventAt;
  }
  if (
    trace.simulatedAttemptOrdinal !== (state.attempted ? 1 : null) ||
    (mode === 'complete' && !state.final)
  )
    fail('invalid_trace');
  return state;
}

export function validateNativeShortBodyFixtureTrace(
  input: unknown,
  mode: 'prefix' | 'complete',
): NativeShortBodyFixtureTrace {
  return inspect(input, mode).trace;
}

export function projectNativeShortBodyFixtureTrace(
  input: unknown,
  mode: 'prefix' | 'complete' = 'complete',
): NativeShortBodyFixtureProjection {
  const s = inspect(input, mode),
    final = s.final;
  return freeze<NativeShortBodyFixtureProjection>({
    validated: true,
    verifiedLive: false,
    durable: false,
    bodyIncluded: false,
    status:
      final?.outcome === 'fixture_matched'
        ? 'fixture_complete'
        : final?.reason === 'no_change'
          ? 'no_change'
          : 'capability_unavailable',
    reason: final?.reason ?? 'durability_unverified',
    stageHashes: s.hashes,
    summaries: {
      stageCount: s.trace.stages.length,
      simulatedAttemptOrdinal: s.trace.simulatedAttemptOrdinal,
      baselineObserved: s.baseline,
      preSaveVerified: s.preSave,
      postAttempted: s.attempted,
      acknowledged: s.acknowledged,
      afterObserved: s.after,
      desiredMatched: s.matched,
      pendingAtEnd: final?.cleanup.pendingAtEnd ?? 0,
      disposalFailures: final?.cleanup.disposalFailures ?? 0,
      quarantined: final?.cleanup.quarantined ?? false,
    },
  });
}

export function validateNativeShortBodyLiveProof(_input: unknown): never {
  fail('durability_unverified');
}

/** Pure durable graph validation. SQL/file ownership remains exclusively with the real Store. */
export const NATIVE_SHORT_BODY_OPERATION = 'update_short_body' as const;

export const NATIVE_SHORT_BODY_RECONCILE_OPERATION = 'reconcile_short_body_write' as const;

export const NATIVE_SHORT_BODY_DATASETS = Object.freeze({
  baseline: 'short_native_body_baseline',
  preSave: 'short_native_body_pre_save',
  intent: 'write-intent',
  attempt: 'short_native_body_attempt',
  acknowledgement: 'short_native_body_acknowledgement',
  after: 'short_native_body_after',
  result: 'write-result',
  reconciliation: 'short_native_body_reconciliation',
} as const);

export type NativeShortBodyStageKind = Exclude<
  keyof typeof NATIVE_SHORT_BODY_DATASETS,
  'reconciliation'
>;

export interface NativeShortBodySource {
  readonly mode: 'live' | 'fixture';
  readonly executor: 'default-body-owned-api/v1' | 'sqlite-owned-body-fixture/v1';
}

export interface NativeShortBodyRefLink {
  readonly id: string;
  readonly sha256: string;
  readonly capturedAt: string;
}
