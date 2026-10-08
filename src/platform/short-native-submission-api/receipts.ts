import {
  type NativeShortSubmissionReceiptStage,
  type NativeShortSubmissionReceiptFields,
  type NativeShortSubmissionReceipt,
  type NativeShortSubmissionHeldIntent,
  type NativeShortSubmissionApiSubmitOptions,
  type OwnedNativeShortSubmissionRunOwner,
  type OwnedNativeShortSubmissionRunGlobals,
} from '../short-native-submission-api.js';

import { type NativeShortMetadataSnapshot } from '../short-native-metadata.js';
import { type NativeShortMetadataWriteReadPhase } from '../short-native-metadata-api.js';
import {
  NATIVE_SHORT_SUBMISSION_SCOPE,
  type NativeShortSubmissionContract,
  type NativeShortSubmissionPlan,
} from '../short-native-submission.js';

export function createOwnedNativeShortSubmissionRunReceipts(
  deps: Pick<
    OwnedNativeShortSubmissionRunOwner,
    | 'options'
    | 'check'
    | 'activeConfirmation'
    | 'minted'
    | 'fail'
    | 'result'
    | 'workId'
    | 'transport'
    | 'references'
    | 'receiptIdentity'
    | 'brands'
    | 'checkFreshPublication'
    | 'confirm'
    | 'wait'
    | 'reason'
  >,
  globals: Pick<
    OwnedNativeShortSubmissionRunGlobals,
    | 'freeze'
    | 'fields'
    | 'ref'
    | 'UUID'
    | 'same'
    | 'NATIVE_SHORT_SUBMISSION_RECEIPT_HASH_BASES'
    | 'time'
    | 'STOPPED'
  >,
) {
  function held(
    beforeSnapshot: NativeShortMetadataSnapshot,
    snapshot: NativeShortMetadataSnapshot,
    contract: NativeShortSubmissionContract,
    plan: NativeShortSubmissionPlan,
    read: NativeShortMetadataWriteReadPhase,
  ): NativeShortSubmissionHeldIntent {
    const options = deps.options as NativeShortSubmissionApiSubmitOptions;
    return globals.freeze({
      schema: 'native-short-submission-held-intent/v1',
      beforeSnapshot,
      snapshot,
      contract,
      businessRequest: options.businessRequest,
      servicePrepared: options.servicePrepared,
      plan,
      expectation: plan.expectation,
      desiredSubmissionHash: plan.prepared.desiredSubmissionHash,
      read,
      checkedAt: new Date().toISOString(),
    });
  }
  function confirm(
    input: NativeShortSubmissionReceiptFields,
    stage: NativeShortSubmissionReceiptStage,
  ): NativeShortSubmissionReceipt {
    deps.check();
    if (deps.activeConfirmation !== stage || deps.minted.has(stage))
      deps.fail('durability_unverified');
    try {
      const r = globals.fields(input, [
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
          'desiredSubmissionHash',
          'preparationJobId',
          'preparationEvidence',
          'termsHash',
          'contractHash',
          'useAi',
          'ordinal',
          'transport',
          'eventAt',
        ]),
        held = deps.result.publish.held!,
        prepared = held.servicePrepared,
        baseline = globals.ref(r.baseline),
        evidence = globals.ref(r.evidence),
        previous =
          stage === 'intent'
            ? null
            : stage === 'attempt'
              ? deps.result.publish.intentReceipt
              : deps.result.publish.attemptReceipt;
      if (
        r.stage !== stage ||
        typeof r.accountId !== 'string' ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(r.accountId) ||
        typeof r.jobId !== 'string' ||
        !globals.UUID.test(r.jobId) ||
        r.jobId === prepared.preparationJobId ||
        !globals.same(r.target, { kind: 'short-story', id: deps.workId }) ||
        !globals.same(r.binding, held.expectation.binding) ||
        r.scope !== NATIVE_SHORT_SUBMISSION_SCOPE ||
        !globals.same(r.hashBases, globals.NATIVE_SHORT_SUBMISSION_RECEIPT_HASH_BASES) ||
        r.sourceVersionHash !== held.expectation.sourceVersionHash ||
        r.desiredSubmissionHash !== held.desiredSubmissionHash ||
        r.preparationJobId !== prepared.preparationJobId ||
        !globals.same(globals.ref(r.preparationEvidence), prepared.preparationEvidence) ||
        r.termsHash !== held.contract.terms.sha256 ||
        r.contractHash !== held.contract.sourceHash ||
        r.useAi !== held.expectation.useAi ||
        r.ordinal !== (stage === 'attempt' ? 1 : null) ||
        !globals.same(r.transport, stage === 'attempt' ? deps.transport() : null) ||
        !globals.time(r.eventAt) ||
        r.eventAt > new Date().toISOString() ||
        evidence.capturedAt < r.eventAt ||
        evidence.capturedAt > new Date().toISOString() ||
        baseline.id === evidence.id ||
        deps.references.has(evidence.id) ||
        baseline.capturedAt > held.read.proof.readStartedAt! ||
        (stage === 'intent' && r.eventAt !== held.checkedAt) ||
        (stage === 'acknowledgement' &&
          r.eventAt !== deps.result.publish.observation!.acknowledgedAt) ||
        (previous &&
          (r.eventAt < previous.evidence.capturedAt ||
            evidence.capturedAt < previous.evidence.capturedAt)) ||
        (deps.receiptIdentity &&
          (r.accountId !== deps.receiptIdentity.accountId ||
            r.jobId !== deps.receiptIdentity.jobId ||
            !globals.same(baseline, deps.receiptIdentity.baseline)))
      )
        deps.fail('durability_unverified');
      if (!deps.receiptIdentity) {
        deps.receiptIdentity = { accountId: r.accountId, jobId: r.jobId, baseline };
        deps.references.add(baseline.id);
      }
      const receipt = globals.freeze({
        ...r,
        schema: `native-short-submission-${stage}-receipt/v1`,
        baseline,
        evidence,
        preparationEvidence: prepared.preparationEvidence,
      }) as unknown as NativeShortSubmissionReceipt;
      const brand = new WeakSet<object>();
      brand.add(receipt);
      deps.brands.set(stage, brand);
      deps.minted.add(stage);
      deps.references.add(evidence.id);
      return receipt;
    } catch {
      deps.fail('durability_unverified');
    }
  }
  async function callback(
    stage: NativeShortSubmissionReceiptStage,
  ): Promise<NativeShortSubmissionReceipt> {
    deps.check();
    if (stage === 'attempt') deps.checkFreshPublication();
    deps.activeConfirmation = stage;
    try {
      const options = deps.options as NativeShortSubmissionApiSubmitOptions,
        confirm = (r: NativeShortSubmissionReceiptFields) => deps.confirm(r, stage),
        candidate = await deps.wait(
          Promise.resolve().then(() => {
            deps.check();
            return stage === 'intent'
              ? options.onDurableIntent(deps.result.publish.held!, confirm)
              : stage === 'attempt'
                ? options.onBeforePlatformWrite(deps.result.publish.intentReceipt!, confirm)
                : options.onDurableAcknowledgement(deps.result.publish.observation!, confirm);
          }),
        );
      if (!candidate || !deps.brands.get(stage)?.has(candidate)) deps.fail('durability_unverified');
      return candidate;
    } catch {
      if (!deps.reason) deps.fail('callback_failed');
      throw globals.STOPPED;
    } finally {
      deps.activeConfirmation = null;
    }
  }
  return { held, confirm, callback };
}
