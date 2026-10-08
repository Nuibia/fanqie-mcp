import { type StoredTrialSnapshot, storedTrialMath } from '../short-native-legacy-codec.js';

import {
  fail,
  type NativeShortTrialBusinessInput,
  type AuditHeld,
  copy,
  time,
  order,
  freeze,
  type Data,
  exact,
  type NativeShortTrialEvidenceContext,
  type NativeShortTrialStage,
  type AuditResult,
  type NativeShortTrialWriteResultEvidence,
  same,
  refLink,
  hash,
} from './fail.js';

import {
  sourceFields,
  nativeShortTrialWriteRequest,
  assertExpected,
  storedSnapshot,
  readPhase,
  trialSnapshot,
} from './read-phase.js';

import {
  type NativeShortTrialHeldIntent,
  type NativeShortTrialReceiptStage,
  type NativeShortTrialAcknowledgement,
  type NativeShortTrialReceiptFields,
} from '../short-native-trial-api.js';

import { type NativeShortProvenance } from '../short-native-metadata-proof.js';

import {
  type NativeShortTrialPlan,
  NATIVE_SHORT_TRIAL_SCOPE,
  NATIVE_SHORT_TRIAL_HASH_BASES,
} from '../short-native-trial.js';

import { nativeShortMetadataEndpoints } from '../short-native-metadata.js';

export function storedNativeSnapshot(
  value: unknown,
  mode?: StoredTrialSnapshot['mode'] | null,
): StoredTrialSnapshot {
  try {
    const decoded = storedTrialMath.decodeNativeSnapshot(value);
    if (mode && decoded.mode !== mode) fail();
    return decoded;
  } catch {
    fail();
  }
}

export function held(
  input: unknown,
  business: NativeShortTrialBusinessInput,
  baseline?: AuditHeld,
): AuditHeld {
  const h = sourceFields(input, [
    'schema',
    'snapshot',
    'beforeSnapshot',
    'businessRequest',
    'plan',
    'expectation',
    'desiredContentHash',
    'read',
    'checkedAt',
  ]);
  if (h.schema !== 'native-short-trial-held-intent/v1') fail();
  const request = nativeShortTrialWriteRequest(business);
  assertExpected(h.businessRequest, request);
  const decodedBefore = storedSnapshot(
      h.beforeSnapshot,
      baseline ? storedSnapshot(baseline.snapshot).mode : null,
    ),
    decodedCurrent = storedSnapshot(h.snapshot, decodedBefore.mode),
    before = decodedBefore.snapshot,
    current = decodedCurrent.snapshot;
  if (before.binding.work.id !== business.target.workId) fail();
  if (baseline) assertExpected(before, baseline.beforeSnapshot);
  const plan = storedTrialMath.planUpdate(decodedBefore, request);
  storedTrialMath.assertPreSave(decodedCurrent, plan.expectation);
  assertExpected(h.plan, plan);
  assertExpected(h.expectation, plan.expectation);
  assertExpected(current, before);
  if (h.desiredContentHash !== plan.desiredContentHash) fail();
  const read = readPhase(copy(h.read, 64 * 1024), true),
    checkedAt = time(h.checkedAt);
  order([read.proof.proofCapturedAt, checkedAt]);
  return freeze({
    schema: 'native-short-trial-held-intent/v1',
    snapshot: current,
    beforeSnapshot: before,
    businessRequest: request,
    plan,
    expectation: plan.expectation,
    desiredContentHash: plan.desiredContentHash,
    read,
    checkedAt,
  });
}

export function modernHeld(
  input: unknown,
  business: NativeShortTrialBusinessInput,
  baseline?: AuditHeld,
): NativeShortTrialHeldIntent {
  const h = sourceFields(input, [
    'schema',
    'snapshot',
    'beforeSnapshot',
    'businessRequest',
    'plan',
    'expectation',
    'desiredContentHash',
    'read',
    'checkedAt',
  ]);
  trialSnapshot(h.beforeSnapshot);
  trialSnapshot(h.snapshot);
  if (baseline) trialSnapshot(baseline.snapshot);
  return held(h, business, baseline) as NativeShortTrialHeldIntent;
}

/** Durable source stores the original authenticated native bytes once; derived structures are rebuilt. */
export function cleanHeld(h: AuditHeld): Data {
  return {
    schema: 'native-short-trial-held-source/v1',
    nativeSnapshot: h.snapshot.native,
    businessRequest: h.businessRequest,
    read: h.read,
    checkedAt: h.checkedAt,
  };
}

export function expandHeld(
  input: unknown,
  business: NativeShortTrialBusinessInput,
  baseline?: AuditHeld,
): AuditHeld {
  const d = exact(input, ['schema', 'nativeSnapshot', 'businessRequest', 'read', 'checkedAt']);
  if (d.schema !== 'native-short-trial-held-source/v1') fail();
  const decoded = storedNativeSnapshot(
      d.nativeSnapshot,
      baseline ? storedSnapshot(baseline.snapshot).mode : null,
    ),
    current = decoded.snapshot,
    before = baseline?.beforeSnapshot ?? current;
  const plan = storedTrialMath.planUpdate(
    storedSnapshot(before, decoded.mode),
    nativeShortTrialWriteRequest(business),
  );
  return held(
    {
      schema: 'native-short-trial-held-intent/v1',
      snapshot: current,
      beforeSnapshot: before,
      businessRequest: d.businessRequest,
      plan,
      expectation: plan.expectation,
      desiredContentHash: plan.desiredContentHash,
      read: d.read,
      checkedAt: d.checkedAt,
    },
    business,
    baseline,
  );
}

export interface State {
  context: NativeShortTrialEvidenceContext;
  mode: StoredTrialSnapshot['mode'] | null;
  kinds: NativeShortTrialStage[];
  payloads: Data[];
  baseline: AuditHeld | null;
  business: NativeShortTrialBusinessInput | null;
  provenance: NativeShortProvenance | null;
  preSave: AuditHeld | null;
  plan: NativeShortTrialPlan | null;
  after: AuditResult | null;
  result: NativeShortTrialWriteResultEvidence | null;
}

export function transport(workId: string) {
  return {
    schema: 'native-short-trial-save-transport/v1' as const,
    provenance: 'static-unobserved' as const,
    method: 'POST' as const,
    url: nativeShortMetadataEndpoints(workId).save,
    encoding: 'application/x-www-form-urlencoded;charset=UTF-8' as const,
  };
}

export const stageKind = (stage: NativeShortTrialReceiptStage): NativeShortTrialStage => stage;

export function acknowledgement(input: unknown, state: State): NativeShortTrialAcknowledgement {
  const a = exact(input, [
    'schema',
    'binding',
    'scope',
    'hashBases',
    'sourceVersionHash',
    'desiredContentHash',
    'acknowledgedAt',
  ]);
  if (
    !state.plan ||
    a.schema !== 'native-short-trial-acknowledgement-observation/v1' ||
    !same(a.binding, state.plan.expectation.binding) ||
    a.scope !== NATIVE_SHORT_TRIAL_SCOPE ||
    !same(a.hashBases, NATIVE_SHORT_TRIAL_HASH_BASES) ||
    a.sourceVersionHash !== state.plan.expectation.sourceVersionHash ||
    a.desiredContentHash !== state.plan.desiredContentHash
  )
    fail();
  time(a.acknowledgedAt);
  return a as NativeShortTrialAcknowledgement;
}

export function receiptFields(
  state: State,
  stage: NativeShortTrialReceiptStage,
): NativeShortTrialReceiptFields {
  const index = state.kinds.indexOf(stageKind(stage));
  if (index < 0 || !state.baseline || !state.preSave || !state.plan) fail();
  const payload = state.payloads[index]!,
    observation = stage === 'acknowledgement' ? acknowledgement(payload.observation, state) : null;
  return {
    stage,
    accountId: state.context.accountId,
    jobId: state.context.job.id,
    target: { kind: 'short-story', id: state.business!.target.workId },
    binding: state.plan.expectation.binding,
    scope: NATIVE_SHORT_TRIAL_SCOPE,
    hashBases: NATIVE_SHORT_TRIAL_HASH_BASES,
    baseline: refLink(state.context.refs[0]!),
    evidence: refLink(state.context.refs[index]!),
    sourceVersionHash: state.plan.expectation.sourceVersionHash,
    desiredContentHash: state.plan.desiredContentHash,
    ordinal: stage === 'attempt' ? 1 : null,
    transport: stage === 'attempt' ? transport(state.business!.target.workId) : null,
    eventAt:
      stage === 'intent'
        ? state.preSave.checkedAt
        : stage === 'attempt'
          ? payload.eventAt
          : observation!.acknowledgedAt,
  };
}

export function linkBase(state: State, kind: NativeShortTrialStage) {
  return {
    schema: `native-short-trial-${kind.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-evidence/v1`,
    scope: NATIVE_SHORT_TRIAL_SCOPE,
    baselineEvidence: refLink(state.context.refs[0]!),
    previousEvidence: refLink(state.context.refs.at(-1)!),
  };
}

export function intentPayload(state: State) {
  if (!state.preSave || !state.plan) fail();
  // The fixed basis dictionary includes the key "body". Local write intents
  // retain the Store's content-field ban and bind the complete dictionary by
  // an independently rebuilt digest; external receipts retain the full bases.
  const hashBasesHash = hash({
    basis: 'native-short-trial-full-hash-bases/v1',
    hashBases: NATIVE_SHORT_TRIAL_HASH_BASES,
  });
  return {
    ...linkBase(state, 'intent'),
    binding: state.plan.expectation.binding,
    hashBasesHash,
    sourceVersionHash: state.plan.expectation.sourceVersionHash,
    desiredContentHash: state.plan.desiredContentHash,
    checkedAt: state.preSave.checkedAt,
  };
}

export function cleanResult(raw: AuditResult): Data {
  const { plan: _plan, expectation: _expectation, snapshot, snapshots, save, ...rest } = raw;
  const { held: saveHeld, ...saveObservations } = save;
  return {
    ...rest,
    snapshot: snapshot?.native ?? null,
    observedPreSaveSnapshot: snapshots.preSave?.native ?? null,
    observedSaveHeld: saveHeld ? { read: saveHeld.read, checkedAt: saveHeld.checkedAt } : null,
    save: saveObservations,
  };
}
