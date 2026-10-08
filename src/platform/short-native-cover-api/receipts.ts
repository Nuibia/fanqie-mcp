import {
  type NativeShortCoverPhase,
  type NativeShortCoverReceiptStage,
  type NativeShortCoverReceiptFields,
  type NativeShortCoverReceipt,
  type NativeShortCoverHeldIntent,
  type NativeShortCoverAcknowledgement,
  type OwnedNativeShortCoverRunOwner,
  type OwnedNativeShortCoverRunGlobals,
} from '../short-native-cover-api.js';

import { type NativeShortMetadataSnapshot } from '../short-native-metadata.js';

import {
  NATIVE_SHORT_COVER_SCOPE,
  NATIVE_SHORT_COVER_HASH_BASES,
  type NativeShortCoverPlan,
} from '../short-native-cover.js';

export function createOwnedNativeShortCoverRunReceipts(
  deps: Pick<
    OwnedNativeShortCoverRunOwner,
    | 'check'
    | 'activeConfirmation'
    | 'minted'
    | 'fail'
    | 'result'
    | 'workId'
    | 'transport'
    | 'refs'
    | 'receiptIdentity'
    | 'brands'
    | 'confirm'
    | 'track'
    | 'options'
    | 'reason'
    | 'stop'
    | 'businessRequest'
  >,
  globals: Pick<
    OwnedNativeShortCoverRunGlobals,
    'fields' | 'copyRef' | 'UUID' | 'sameData' | 'time' | 'freeze'
  >,
) {
  function confirm(
    input: NativeShortCoverReceiptFields,
    phase: NativeShortCoverPhase,
    stage: NativeShortCoverReceiptStage,
    held: NativeShortCoverHeldIntent,
    observation?: NativeShortCoverAcknowledgement,
  ): NativeShortCoverReceipt {
    deps.check();
    const key = `${phase}:${stage}`;
    if (deps.activeConfirmation !== key || deps.minted.has(key)) deps.fail('durability_unverified');
    try {
      const value = globals.fields(input, [
        'phase',
        'stage',
        'accountId',
        'jobId',
        'target',
        'binding',
        'scope',
        'hashBases',
        'baseline',
        'evidence',
        'sourceVersionHash',
        'assetHash',
        'intentHash',
        'uploadAckHash',
        'preSaveVersionHash',
        'desiredContentHash',
        'ordinal',
        'transport',
        'eventAt',
      ]);
      const baseline = globals.copyRef(value.baseline),
        evidence = globals.copyRef(value.evidence);
      const previous =
        stage === 'intent'
          ? phase === 'save'
            ? deps.result.upload.acknowledgementReceipt
            : null
          : stage === 'attempt'
            ? deps.result[phase].intentReceipt
            : deps.result[phase].attemptReceipt;
      const expectedAck = observation?.uploadAckHash ?? held.expectation?.uploadAckHash ?? null;
      const expectedDesired = observation?.desiredContentHash ?? held.desiredContentHash;
      const preSaveVersion = phase === 'save' ? held.snapshot.snapshotVersionHash : null;
      const eventAt =
        stage === 'intent'
          ? held.checkedAt
          : stage === 'acknowledgement'
            ? observation!.acknowledgedAt
            : value.eventAt;
      if (
        value.phase !== phase ||
        value.stage !== stage ||
        typeof value.accountId !== 'string' ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value.accountId) ||
        typeof value.jobId !== 'string' ||
        !globals.UUID.test(value.jobId) ||
        !globals.sameData(value.target, { kind: 'short-story', id: deps.workId }) ||
        !globals.sameData(value.binding, held.uploadIntent.binding) ||
        value.scope !== NATIVE_SHORT_COVER_SCOPE ||
        !globals.sameData(value.hashBases, NATIVE_SHORT_COVER_HASH_BASES) ||
        value.sourceVersionHash !== held.uploadIntent.sourceVersionHash ||
        value.assetHash !== held.uploadIntent.assetHash ||
        value.intentHash !== held.uploadIntent.intentHash ||
        value.uploadAckHash !== expectedAck ||
        value.preSaveVersionHash !== preSaveVersion ||
        value.desiredContentHash !== expectedDesired ||
        value.ordinal !== (stage === 'attempt' ? 1 : null) ||
        !globals.sameData(value.transport, stage === 'attempt' ? deps.transport(phase) : null) ||
        !globals.time(value.eventAt) ||
        value.eventAt !== eventAt ||
        value.eventAt > new Date().toISOString() ||
        evidence.capturedAt < value.eventAt ||
        evidence.capturedAt > new Date().toISOString() ||
        baseline.capturedAt < deps.result.phases.before.proof.proofCapturedAt! ||
        baseline.capturedAt > evidence.capturedAt ||
        baseline.id === evidence.id ||
        deps.refs.has(evidence.id) ||
        (previous &&
          (value.eventAt < previous.evidence.capturedAt ||
            evidence.capturedAt < previous.evidence.capturedAt)) ||
        (deps.receiptIdentity &&
          (value.accountId !== deps.receiptIdentity.accountId ||
            value.jobId !== deps.receiptIdentity.jobId ||
            !globals.sameData(baseline, deps.receiptIdentity.baseline)))
      )
        deps.fail('durability_unverified');
      if (!deps.receiptIdentity) {
        deps.receiptIdentity = { accountId: value.accountId, jobId: value.jobId, baseline };
        deps.refs.add(baseline.id);
      }
      if (deps.refs.has(evidence.id)) deps.fail('durability_unverified');
      const receipt = globals.freeze({
        schema: `native-short-cover-${phase}-${stage}-receipt/v1` as const,
        phase,
        stage,
        accountId: value.accountId,
        jobId: value.jobId,
        target: { kind: 'short-story' as const, id: deps.workId },
        binding: held.uploadIntent.binding,
        scope: NATIVE_SHORT_COVER_SCOPE,
        hashBases: NATIVE_SHORT_COVER_HASH_BASES,
        baseline,
        evidence,
        sourceVersionHash: held.uploadIntent.sourceVersionHash,
        assetHash: held.uploadIntent.assetHash,
        intentHash: held.uploadIntent.intentHash,
        uploadAckHash: expectedAck,
        preSaveVersionHash: preSaveVersion,
        desiredContentHash: expectedDesired,
        ordinal: stage === 'attempt' ? (1 as const) : null,
        transport: stage === 'attempt' ? deps.transport(phase) : null,
        eventAt: value.eventAt,
      });
      const brand = new WeakSet<object>();
      brand.add(receipt);
      deps.brands.set(key, brand);
      deps.minted.add(key);
      deps.refs.add(evidence.id);
      return receipt;
    } catch {
      deps.fail('durability_unverified');
    }
  }
  async function callback(
    phase: NativeShortCoverPhase,
    stage: NativeShortCoverReceiptStage,
    held: NativeShortCoverHeldIntent,
    observation?: NativeShortCoverAcknowledgement,
  ): Promise<NativeShortCoverReceipt> {
    deps.check();
    const key = `${phase}:${stage}`;
    deps.activeConfirmation = key;
    try {
      const confirm = (input: NativeShortCoverReceiptFields) =>
        deps.confirm(input, phase, stage, held, observation);
      const candidate = await deps.track(
        Promise.resolve().then(() => {
          deps.check();
          return stage === 'intent'
            ? deps.options.onDurableIntent(held, confirm)
            : stage === 'attempt'
              ? deps.options.onBeforePlatformWrite(deps.result[phase].intentReceipt!, confirm)
              : deps.options.onDurableAcknowledgement(observation!, confirm);
        }),
      );
      deps.check();
      if (
        !candidate ||
        !deps.brands.get(key)?.has(candidate) ||
        candidate.schema !== `native-short-cover-${phase}-${stage}-receipt/v1`
      )
        deps.fail('durability_unverified');
      return candidate;
    } catch {
      if (!deps.reason) deps.stop('callback_failed');
      throw Error('Cover callback unavailable');
    } finally {
      deps.activeConfirmation = null;
    }
  }
  function held(
    phase: NativeShortCoverPhase,
    snapshot: NativeShortMetadataSnapshot,
    plan?: NativeShortCoverPlan,
  ): NativeShortCoverHeldIntent {
    return globals.freeze({
      schema: 'native-short-cover-held-intent/v1',
      phase,
      snapshot,
      businessRequest: deps.businessRequest!,
      uploadIntent: deps.result.uploadIntent!,
      expectation: plan?.expectation ?? null,
      uploadAcknowledgement: phase === 'save' ? deps.result.upload.observation : null,
      desiredContentHash: plan?.desiredContentHash ?? null,
      read: deps.result.phases[phase === 'upload' ? 'before' : 'preSave'],
      checkedAt: new Date().toISOString(),
    });
  }
  function observation(
    phase: NativeShortCoverPhase,
    plan: NativeShortCoverPlan,
    picUri: string | null,
    picUrl: string | null,
  ): NativeShortCoverAcknowledgement {
    const state = deps.result[phase],
      at = new Date().toISOString();
    state.post.acknowledged = true;
    state.post.acknowledgedAt = at;
    state.outcome = 'acknowledged';
    return globals.freeze({
      schema: 'native-short-cover-acknowledgement-observation/v1',
      phase,
      binding: deps.result.uploadIntent!.binding,
      scope: NATIVE_SHORT_COVER_SCOPE,
      hashBases: NATIVE_SHORT_COVER_HASH_BASES,
      sourceVersionHash: deps.result.uploadIntent!.sourceVersionHash,
      assetHash: deps.result.uploadIntent!.assetHash,
      intentHash: deps.result.uploadIntent!.intentHash,
      uploadAckHash: plan.uploadAckHash,
      preSaveVersionHash:
        phase === 'save' ? deps.result.save.held!.snapshot.snapshotVersionHash : null,
      desiredContentHash: plan.desiredContentHash,
      acknowledgedAt: at,
      picUri,
      picUrl,
    });
  }
  return { confirm, callback, held, observation };
}
