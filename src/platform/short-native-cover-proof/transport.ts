import {
  type NativeShortCoverPhase,
  type NativeShortCoverReceiptStage,
  type NativeShortCoverReceiptFields,
  type NativeShortCoverAcknowledgement,
} from '../short-native-cover-api.js';

import {
  UPLOAD_URL,
  type NativeShortCoverStage,
  fail,
  refLink,
  type AuditResult,
  type Data,
  type AuditHeld,
  exact,
} from './fail.js';

import { nativeShortMetadataEndpoints } from '../short-native-metadata.js';

import { type State, storedSnapshot } from './has-reserved-native-short-cover-signal.js';

import { NATIVE_SHORT_COVER_SCOPE, NATIVE_SHORT_COVER_HASH_BASES } from '../short-native-cover.js';

import { storedCoverMath } from '../short-native-legacy-codec.js';

export function transport(phase: NativeShortCoverPhase, workId: string) {
  return {
    schema: `native-short-cover-${phase}-transport/v1`,
    provenance: 'static-unobserved',
    method: 'POST',
    url: phase === 'upload' ? UPLOAD_URL : nativeShortMetadataEndpoints(workId).save,
    encoding:
      phase === 'upload'
        ? 'multipart-file-temp-image-jpeg'
        : 'application/x-www-form-urlencoded;charset=UTF-8',
  };
}

export const stageFor = (
  phase: NativeShortCoverPhase,
  stage: NativeShortCoverReceiptStage,
): NativeShortCoverStage =>
  `${phase}${stage === 'acknowledgement' ? 'Ack' : stage === 'intent' ? 'Intent' : 'Attempt'}` as NativeShortCoverStage;

export function receiptFields(
  state: State,
  phase: NativeShortCoverPhase,
  stage: NativeShortCoverReceiptStage,
): NativeShortCoverReceiptFields {
  const kind = stageFor(phase, stage),
    index = state.kinds.indexOf(kind);
  if (index < 0 || !state.baseline) fail();
  const h = phase === 'upload' ? state.baseline : state.preSave;
  if (!h) fail();
  const payload = state.payloads[index]!,
    intent = state.baseline.uploadIntent;
  const a =
    stage === 'acknowledgement' ? (payload.observation as NativeShortCoverAcknowledgement) : null;
  return {
    phase,
    stage,
    accountId: state.context.accountId,
    jobId: state.context.job.id,
    target: { kind: 'short-story', id: intent.binding.work.id },
    binding: intent.binding,
    scope: NATIVE_SHORT_COVER_SCOPE,
    hashBases: NATIVE_SHORT_COVER_HASH_BASES,
    baseline: refLink(state.context.refs[0]!),
    evidence: refLink(state.context.refs[index]!),
    sourceVersionHash: intent.sourceVersionHash,
    assetHash: intent.assetHash,
    intentHash: intent.intentHash,
    uploadAckHash: a?.uploadAckHash ?? h.expectation?.uploadAckHash ?? null,
    preSaveVersionHash: phase === 'save' ? h.snapshot.snapshotVersionHash : null,
    desiredContentHash: a?.desiredContentHash ?? h.desiredContentHash,
    ordinal: stage === 'attempt' ? 1 : null,
    transport:
      stage === 'attempt'
        ? (transport(phase, intent.binding.work.id) as NativeShortCoverReceiptFields['transport'])
        : null,
    eventAt:
      stage === 'intent' ? h.checkedAt : stage === 'attempt' ? payload.eventAt : a!.acknowledgedAt,
  };
}

export function linkBase(state: State, kind: NativeShortCoverStage) {
  return {
    schema: `native-short-cover-${kind.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-evidence/v1`,
    scope: NATIVE_SHORT_COVER_SCOPE,
    baselineEvidence: refLink(state.context.refs[0]!),
    previousEvidence: refLink(state.context.refs.at(-1)!),
  };
}

export function intentPayload(state: State, phase: NativeShortCoverPhase) {
  const h = phase === 'upload' ? state.baseline! : state.preSave!;
  return {
    ...linkBase(state, stageFor(phase, 'intent')),
    phase,
    binding: h.uploadIntent.binding,
    hashBases: NATIVE_SHORT_COVER_HASH_BASES,
    sourceVersionHash: h.uploadIntent.sourceVersionHash,
    assetHash: h.uploadIntent.assetHash,
    intentHash: h.uploadIntent.intentHash,
    uploadAckHash: h.expectation?.uploadAckHash ?? null,
    preSaveVersionHash: phase === 'save' ? h.snapshot.snapshotVersionHash : null,
    desiredContentHash: h.desiredContentHash,
    checkedAt: h.checkedAt,
  };
}

export function cleanResult(raw: AuditResult): Data {
  const {
    asset: _asset,
    uploadIntent: _intent,
    expectation: _expectation,
    snapshots,
    upload,
    save,
    ...rest
  } = raw;
  const { held: _uploadHeld, ...u } = upload,
    { held: saveHeld, ...s } = save;
  return {
    ...rest,
    observedPreSaveSnapshot: snapshots.preSave,
    observedSaveHeld: saveHeld ? { read: saveHeld.read, checkedAt: saveHeld.checkedAt } : null,
    upload: u,
    save: s,
  };
}

export function expandResult(clean: Data, state: State): AuditResult {
  const { observedPreSaveSnapshot, observedSaveHeld, ...rest } = clean;
  let saveHeld: AuditHeld | null = null;
  if (observedSaveHeld !== null) {
    exact(observedSaveHeld, ['read', 'checkedAt']);
    if (!state.uploadAck || observedPreSaveSnapshot === null) fail();
    const plan = storedCoverMath.planSave(
      storedSnapshot(observedPreSaveSnapshot, state.mode),
      state.baseline!.uploadIntent,
      { picUri: state.uploadAck.picUri!, picUrl: state.uploadAck.picUrl! },
    );
    saveHeld = {
      schema: 'native-short-cover-held-intent/v1',
      phase: 'save',
      snapshot: observedPreSaveSnapshot,
      businessRequest: state.baseline!.businessRequest,
      uploadIntent: state.baseline!.uploadIntent,
      expectation: plan.expectation,
      uploadAcknowledgement: state.uploadAck,
      desiredContentHash: plan.desiredContentHash,
      read: observedSaveHeld.read,
      checkedAt: observedSaveHeld.checkedAt,
    };
  }
  return {
    ...rest,
    asset: state.baseline!.uploadIntent.asset,
    uploadIntent: state.baseline!.uploadIntent,
    expectation: saveHeld?.expectation ?? null,
    snapshots: {
      before: state.baseline!.snapshot,
      preSave: observedPreSaveSnapshot,
      after: clean.snapshot,
    },
    upload: { ...clean.upload, held: state.baseline },
    save: { ...clean.save, held: saveHeld },
  } as AuditResult;
}
