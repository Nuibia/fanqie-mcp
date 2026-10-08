import {
  type NativeShortTrialEvidenceContext,
  type NativeShortTrialProjection,
  fail,
  type NativeShortTrialWriteResultEvidence,
  same,
  copy,
  freeze,
  type AuditSnapshot,
  type Data,
  type NativeShortTrialStage,
  exact,
  provenance,
  ORIGIN,
  order,
  UUID,
  HASH,
  NATIVE_SHORT_TRIAL_READ_OPERATION,
  NATIVE_SHORT_TRIAL_READ_DATASET,
  time,
} from './fail.js';

import { stateFor, businessResult, allowedNext, resultPayload } from './business-result.js';

import {
  createNativeShortMetadataSnapshot,
  type NativeShortMetadataSnapshot,
  type LegacyNativeShortMetadataSnapshot,
} from '../short-native-metadata.js';

import { safeSnapshot, apiResult } from './api-result.js';

import { type EvidenceRef, type Manifest } from '../../runtime/store.js';

import {
  type State,
  stageKind,
  receiptFields,
  modernHeld,
  cleanHeld,
  linkBase,
  intentPayload,
  transport,
  acknowledgement,
  cleanResult,
} from './stored-native-snapshot.js';

import {
  type NativeShortTrialReceiptStage,
  type NativeShortTrialReceiptFields,
} from '../short-native-trial-api.js';

import {
  sourceFields,
  validateNativeShortTrialBusinessInput,
  nativeShortTrialBusinessInputHash,
  assertExpected,
  trialSnapshot,
} from './read-phase.js';

import { NATIVE_SHORT_TRIAL_SCOPE } from '../short-native-trial.js';

import { isCanonicalNativeTime } from '../short-native-metadata-proof.js';

export function validateNativeShortTrialEvidenceContext(
  context: NativeShortTrialEvidenceContext,
  mode: 'prefix' | 'complete' = 'prefix',
): NativeShortTrialProjection {
  try {
    return projectState(stateFor(context, mode === 'complete'));
  } catch {
    fail();
  }
}

export const validateNativeShortTrialPrefix = (context: NativeShortTrialEvidenceContext) =>
  validateNativeShortTrialEvidenceContext(context, 'prefix');

export function validateNativeShortTrialCompletion(
  context: NativeShortTrialEvidenceContext,
  returned?: unknown,
): NativeShortTrialWriteResultEvidence {
  try {
    const state = stateFor(context, true);
    if (returned !== undefined && !same(copy(returned, 128 * 1024), state.result)) fail();
    return freeze(state.result!);
  } catch {
    fail();
  }
}

export function publicSnapshot(s: AuditSnapshot): Data {
  const native = createNativeShortMetadataSnapshot({
    binding: s.native.binding,
    editData: s.native.editData,
    categoryData: s.native.categoryData,
  });
  return { ...safeSnapshot(s), state: native.state, statusFacts: native.statusFacts };
}

export function observation(
  s: AuditSnapshot,
  phase: 'read' | 'baseline' | 'pre_save' | 'after' | 'later_read',
  ref: EvidenceRef,
): Data {
  return nativeObservation(s.native, phase, ref);
}

export function nativeObservation(
  native: NativeShortMetadataSnapshot | LegacyNativeShortMetadataSnapshot,
  phase: 'read' | 'baseline' | 'pre_save' | 'after' | 'later_read',
  ref: EvidenceRef,
): Data {
  const snapshot = createNativeShortMetadataSnapshot({
    binding: native.binding,
    editData: native.editData,
    categoryData: native.categoryData,
  });
  return {
    state: snapshot.state,
    statusFacts: snapshot.statusFacts,
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

function projectState(state: State): NativeShortTrialProjection {
  const business = state.baseline
    ? {
        ...(state.context.job.status === 'succeeded'
          ? state.result!.business
          : businessResult(
              state,
              state.context.job.status === 'uncertain' ? 'uncertain' : 'capability_unavailable',
              'outcome_not_verified',
            )),
        before: publicSnapshot(state.baseline.snapshot),
        after: state.after?.snapshot ? publicSnapshot(state.after.snapshot) : null,
        ...statusObservation(state),
      }
    : null;
  return {
    validated: state.baseline !== null,
    result:
      state.context.job.status === 'succeeded' ? { ...state.result!, business: business! } : null,
    evidence: state.context.refs
      .filter((r) => r.dataset !== 'write-intent')
      .map(safeNativeShortTrialRef),
    data: business ? [business] : [],
    collectionMode: state.provenance?.mode ?? null,
  };
}

export function projectNativeShortTrialEvidenceContext(
  context: NativeShortTrialEvidenceContext,
): NativeShortTrialProjection {
  try {
    return freeze(projectState(stateFor(context)));
  } catch {
    return { validated: false, result: null, evidence: [], data: [], collectionMode: null };
  }
}

export function nativeShortTrialReceiptFields(
  context: NativeShortTrialEvidenceContext,
  stage: NativeShortTrialReceiptStage,
): NativeShortTrialReceiptFields {
  try {
    const state = stateFor(context);
    if (state.mode !== 'modern' || state.kinds.at(-1) !== stageKind(stage)) fail();
    return freeze(receiptFields(state, stage));
  } catch {
    fail();
  }
}

/** Builders own no durable authority: every ref is fsynced/reread and ledger-linked by runtime. */
export function createNativeShortTrialStageEvidence(
  kind: NativeShortTrialStage,
  input: unknown,
  context: NativeShortTrialEvidenceContext,
): any {
  try {
    const state = stateFor(context, false, kind === 'attempt');
    if (!allowedNext(state.kinds, kind)) fail();
    const value = sourceFields(
      input,
      kind === 'baseline'
        ? ['held', 'business', 'provenance']
        : ['preSave', 'intent'].includes(kind)
          ? ['held']
          : kind === 'attempt'
            ? ['eventAt']
            : kind === 'acknowledgement'
              ? ['observation']
              : kind === 'after'
                ? ['result']
                : [],
    );
    if (state.mode !== null && state.mode !== 'modern') fail();
    if (kind === 'baseline') {
      const d = exact(value, ['held', 'business', 'provenance']),
        b = validateNativeShortTrialBusinessInput(d.business),
        p = provenance(copy(d.provenance, 4096)),
        h = modernHeld(d.held, b);
      if (
        nativeShortTrialBusinessInputHash(b) !== context.job.inputHash ||
        h.snapshot.binding.work.id !== /^short_native_trial\.(.+)$/.exec(context.job.scope)?.[1]
      )
        fail();
      return freeze({
        schema: 'native-short-trial-baseline-evidence/v1',
        scope: NATIVE_SHORT_TRIAL_SCOPE,
        held: cleanHeld(h),
        businessInput: b,
        source: { origin: ORIGIN, mode: p.mode },
        provenance: p,
      });
    }
    if (!state.baseline) fail();
    if (kind === 'preSave') {
      const d = exact(value, ['held']);
      return freeze({
        ...linkBase(state, kind),
        held: cleanHeld(modernHeld(d.held, state.business!, state.baseline)),
      });
    }
    if (kind === 'intent') {
      const d = exact(value, ['held']);
      if (!state.preSave) fail();
      assertExpected(d.held, state.preSave);
      return freeze(intentPayload(state));
    }
    if (kind === 'attempt') {
      const d = exact(value, ['eventAt']);
      if (
        context.job.platformWriteStartedAt !== d.eventAt ||
        state.context.attempts.length !== 0 ||
        state.kinds.at(-1) !== 'intent'
      )
        fail();
      order([context.refs.at(-1)!.capturedAt, d.eventAt]);
      return freeze({
        ...linkBase(state, kind),
        stage: 'attempt',
        ordinal: 1,
        eventAt: d.eventAt,
        transport: transport(state.business!.target.workId),
      });
    }
    if (kind === 'acknowledgement') {
      const d = exact(value, ['observation']),
        a = acknowledgement(copy(d.observation, 16 * 1024), state);
      order([context.refs.at(-1)!.capturedAt, a.acknowledgedAt]);
      return freeze({ ...linkBase(state, kind), observation: a });
    }
    if (kind === 'after') {
      const d = exact(value, ['result']),
        raw = sourceFields(d.result, [
          'schema',
          'mode',
          'status',
          'reason',
          'plan',
          'expectation',
          'snapshot',
          'comparison',
          'desiredContentHash',
          'observedContentHash',
          'phases',
          'snapshots',
          'save',
          'proof',
          'cleanup',
        ]);
      for (const s of [
        raw.snapshot,
        ...Object.values(sourceFields(raw.snapshots, ['before', 'preSave', 'after'])),
      ])
        if (s !== null) trialSnapshot(s);
      return freeze({ ...linkBase(state, kind), result: cleanResult(apiResult(raw, state)) });
    }
    exact(value, []);
    return freeze(resultPayload(state));
  } catch {
    fail();
  }
}

export function scalar(object: unknown, key: string): unknown {
  try {
    const d =
      object && typeof object === 'object'
        ? Object.getOwnPropertyDescriptor(object, key)
        : undefined;
    return d && Object.hasOwn(d, 'value') ? d.value : null;
  } catch {
    return null;
  }
}

export function safeString(value: unknown, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

export function safeNativeShortTrialRef(ref: EvidenceRef): Record<string, unknown> {
  return {
    id: safeString(scalar(ref, 'id'), UUID),
    accountId: safeString(scalar(ref, 'accountId'), /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
    jobId: safeString(scalar(ref, 'jobId'), UUID),
    dataset: safeString(
      scalar(ref, 'dataset'),
      /^(short_native_trial(?:_[a-z_]+)?|reconciliation|write-result)$/,
    ),
    capturedAt: isCanonicalNativeTime(scalar(ref, 'capturedAt')) ? scalar(ref, 'capturedAt') : null,
    sha256: safeString(scalar(ref, 'sha256'), HASH),
  };
}

export function safeNativeShortTrialManifest(manifest: Manifest): Record<string, unknown> {
  try {
    const d = copy(manifest, 64 * 1024),
      reconciliation = d.operation === 'reconcile_write';
    return {
      schemaVersion: 1,
      id: safeString(d.id, UUID),
      accountId: safeString(d.accountId, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
      jobId: safeString(d.jobId, UUID),
      operation: reconciliation ? 'reconcile_write' : NATIVE_SHORT_TRIAL_READ_OPERATION,
      scope: reconciliation
        ? 'reconciliation'
        : safeString(d.scope, /^short_native_trial\.[1-9][0-9]{9,21}$/),
      datasets: reconciliation ? ['reconciliation'] : [NATIVE_SHORT_TRIAL_READ_DATASET],
      requestedAt: time(d.requestedAt),
      platformReadStartedAt: time(d.platformReadStartedAt),
      committedAt: time(d.committedAt),
      evidence: Array.isArray(d.evidence) ? d.evidence.map(safeNativeShortTrialRef) : [],
    };
  } catch {
    return {
      schemaVersion: 1,
      id: null,
      accountId: null,
      jobId: null,
      operation: null,
      scope: null,
      datasets: [],
      evidence: [],
    };
  }
}
