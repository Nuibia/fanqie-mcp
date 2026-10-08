import {
  type NativeShortTrialReceiptStage,
  type NativeShortTrialReceiptFields,
  type NativeShortTrialReceipt,
  type NativeShortTrialHeldIntent,
  type NativeShortTrialApiWriteOptions,
  type OwnedNativeShortTrialRunOwner,
  type OwnedNativeShortTrialRunGlobals,
} from '../short-native-trial-api.js';

import { type NativeShortMetadataWriteReadPhase } from '../short-native-metadata-api.js';
import {
  NATIVE_SHORT_TRIAL_SCOPE,
  NATIVE_SHORT_TRIAL_HASH_BASES,
  type NativeShortTrialSnapshot,
  type NativeShortTrialPlan,
} from '../short-native-trial.js';

export function createOwnedNativeShortTrialRunReceipts(
  deps: Pick<
    OwnedNativeShortTrialRunOwner,
    | 'businessRequest'
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
    | 'options'
    | 'confirm'
    | 'track'
    | 'reason'
    | 'stop'
  >,
  globals: Pick<
    OwnedNativeShortTrialRunGlobals,
    'freeze' | 'fields' | 'copyRef' | 'UUID' | 'sameData' | 'time' | 'PostObservationFailure'
  >,
) {
  function held(
    snapshot: NativeShortTrialSnapshot,
    beforeSnapshot: NativeShortTrialSnapshot,
    plan: NativeShortTrialPlan,
    read: NativeShortMetadataWriteReadPhase,
  ): NativeShortTrialHeldIntent {
    return globals.freeze({
      schema: 'native-short-trial-held-intent/v1',
      snapshot,
      beforeSnapshot,
      businessRequest: deps.businessRequest!,
      plan,
      expectation: plan.expectation,
      desiredContentHash: plan.desiredContentHash,
      read,
      checkedAt: new Date().toISOString(),
    });
  }
  function confirm(
    input: NativeShortTrialReceiptFields,
    stage: NativeShortTrialReceiptStage,
  ): NativeShortTrialReceipt {
    deps.check();
    if (deps.activeConfirmation !== stage || deps.minted.has(stage))
      deps.fail('durability_unverified');
    try {
      const value = globals.fields(input, [
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
        'desiredContentHash',
        'ordinal',
        'transport',
        'eventAt',
      ]);
      const baseline = globals.copyRef(value.baseline),
        evidence = globals.copyRef(value.evidence),
        held = deps.result.save.held!;
      const previous =
        stage === 'intent'
          ? null
          : stage === 'attempt'
            ? deps.result.save.intentReceipt
            : deps.result.save.attemptReceipt;
      const eventAt =
        stage === 'intent'
          ? held.checkedAt
          : stage === 'acknowledgement'
            ? deps.result.save.observation!.acknowledgedAt
            : value.eventAt;
      const now = new Date().toISOString();
      if (
        value.stage !== stage ||
        typeof value.accountId !== 'string' ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value.accountId) ||
        typeof value.jobId !== 'string' ||
        !globals.UUID.test(value.jobId) ||
        !globals.sameData(value.target, { kind: 'short-story', id: deps.workId }) ||
        !globals.sameData(value.binding, held.expectation.binding) ||
        value.scope !== NATIVE_SHORT_TRIAL_SCOPE ||
        !globals.sameData(value.hashBases, NATIVE_SHORT_TRIAL_HASH_BASES) ||
        value.sourceVersionHash !== held.expectation.sourceVersionHash ||
        value.desiredContentHash !== held.desiredContentHash ||
        value.ordinal !== (stage === 'attempt' ? 1 : null) ||
        !globals.sameData(value.transport, stage === 'attempt' ? deps.transport() : null) ||
        !globals.time(value.eventAt) ||
        value.eventAt !== eventAt ||
        value.eventAt > now ||
        evidence.capturedAt < value.eventAt ||
        evidence.capturedAt > now ||
        baseline.capturedAt < deps.result.phases.before.proof.proofCapturedAt! ||
        baseline.capturedAt > deps.result.phases.preSave.proof.readStartedAt! ||
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
      const receipt: NativeShortTrialReceipt = globals.freeze({
        schema: `native-short-trial-${stage}-receipt/v1`,
        stage,
        accountId: value.accountId,
        jobId: value.jobId,
        target: { kind: 'short-story', id: deps.workId },
        binding: held.expectation.binding,
        scope: NATIVE_SHORT_TRIAL_SCOPE,
        hashBases: NATIVE_SHORT_TRIAL_HASH_BASES,
        baseline,
        evidence,
        sourceVersionHash: held.expectation.sourceVersionHash,
        desiredContentHash: held.desiredContentHash,
        ordinal: stage === 'attempt' ? 1 : null,
        transport: stage === 'attempt' ? deps.transport() : null,
        eventAt: value.eventAt,
      });
      const brand = new WeakSet<object>();
      brand.add(receipt);
      deps.brands.set(stage, brand);
      deps.minted.add(stage);
      deps.refs.add(evidence.id);
      return receipt;
    } catch {
      deps.fail('durability_unverified');
    }
  }
  async function callback(stage: NativeShortTrialReceiptStage): Promise<NativeShortTrialReceipt> {
    deps.check();
    deps.activeConfirmation = stage;
    try {
      const options = deps.options as NativeShortTrialApiWriteOptions,
        confirm = (fields: NativeShortTrialReceiptFields) => deps.confirm(fields, stage);
      const candidate = await deps.track(
        Promise.resolve().then(() => {
          deps.check();
          return stage === 'intent'
            ? options.onDurableIntent(deps.result.save.held!, confirm)
            : stage === 'attempt'
              ? options.onBeforePlatformWrite(deps.result.save.intentReceipt!, confirm)
              : options.onDurableAcknowledgement(deps.result.save.observation!, confirm);
        }),
      );
      deps.check();
      if (!candidate || !deps.brands.get(stage)?.has(candidate)) deps.fail('durability_unverified');
      return candidate;
    } catch {
      if (!deps.reason) deps.stop('callback_failed');
      throw Error('Trial durability callback unavailable');
    } finally {
      deps.activeConfirmation = null;
    }
  }
  function assertSaveAcknowledgement(
    envelope: Record<string, unknown>,
    plan: NativeShortTrialPlan,
  ): void {
    // Frozen PublishShort requestSaveDraft/handleClickDraft recognizes code===0;
    // the old metadata/cover save readers likewise do not require ACK data.
    // Optional fields already known from the native edit contract can contradict
    // this attempt, but their absence never invents an additional requirement.
    const sources = [envelope];
    if (envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data))
      sources.push(globals.fields(envelope.data, Object.keys(envelope.data), []));
    const before = plan.expectation.serverRevisionBefore;
    for (const source of sources) {
      if (Object.hasOwn(source, 'item_id') && source.item_id !== deps.workId)
        throw new globals.PostObservationFailure('response_unverified');
      if (
        Object.hasOwn(source, 'latest_version') &&
        (typeof source.latest_version !== 'number' ||
          !Number.isSafeInteger(source.latest_version) ||
          Object.is(source.latest_version, -0) ||
          source.latest_version !== before.latestVersion + 1)
      )
        throw new globals.PostObservationFailure('response_unverified');
      if (
        Object.hasOwn(source, 'modify_time') &&
        (typeof source.modify_time !== 'string' ||
          !/^[0-9]{10}$/.test(source.modify_time) ||
          BigInt(source.modify_time) < BigInt(before.modifyTime))
      )
        throw new globals.PostObservationFailure('response_unverified');
    }
  }
  return { held, confirm, callback, assertSaveAcknowledgement };
}
