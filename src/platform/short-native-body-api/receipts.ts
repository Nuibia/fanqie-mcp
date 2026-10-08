import { type NativeShortBodySnapshot } from '../short-native-body.js';
import {
  createNativeShortBodyFixtureStageEvidence,
  projectNativeShortBodyFixtureTrace,
  validateNativeShortBodyFixtureTrace,
  type NativeShortBodyFixtureStageKind,
} from '../short-native-body-proof.js';

import { type FixtureRunOwner, type FixtureRunGlobals } from '../short-native-body-api.js';
export function createFixtureRunReceipts(
  deps: Pick<
    FixtureRunOwner,
    'binding' | 'links' | 'result' | 'fail' | 'trace' | 'options' | 'wait' | 'reason' | 'workId'
  >,
  globals: Pick<FixtureRunGlobals, 'STOPPED'>,
) {
  async function emit(
    kind: NativeShortBodyFixtureStageKind,
    payload: Readonly<Record<string, unknown>>,
    eventAt = new Date().toISOString(),
    observe = true,
  ): Promise<void> {
    if (deps.binding) {
      try {
        if (kind === 'baseline')
          deps.links.baseline = deps.binding.recordBaseline(
            payload.native,
            deps.result.phases.before,
          );
        else if (kind === 'preSave')
          deps.links.preSave = deps.binding.recordPreSave(
            payload.native,
            deps.result.phases.preSave,
          );
        else if (kind === 'intent') deps.links.intent = deps.binding.recordIntent();
        else if (kind === 'acknowledgement')
          deps.links.acknowledgement = deps.binding.recordAcknowledgement(payload.observation);
        else if (kind === 'after')
          deps.links.after = deps.binding.recordAfter(
            payload.native ?? null,
            deps.result.phases.after,
            payload.comparison ?? null,
          );
        else throw globals.STOPPED;
      } catch {
        deps.fail('durability_unverified');
      }
      return;
    }
    if (!deps.trace) deps.fail('durability_unverified');
    const prior =
      projectNativeShortBodyFixtureTrace(deps.trace, 'prefix').stageHashes.at(-1) ?? null;
    const stage = createNativeShortBodyFixtureStageEvidence({
      schema: 'native-short-body-fixture-stage/v1',
      kind,
      sequence: deps.trace.stages.length + 1,
      eventAt,
      priorStageHash: prior,
      payload,
    });
    deps.trace = validateNativeShortBodyFixtureTrace(
      {
        ...deps.trace,
        stages: [...deps.trace.stages, stage],
        simulatedAttemptOrdinal: kind === 'attempt' ? 1 : deps.trace.simulatedAttemptOrdinal,
      },
      kind === 'result' ? 'complete' : 'prefix',
    );
    if (observe && deps.options?.onStage) {
      try {
        await deps.wait(Promise.resolve().then(() => deps.options!.onStage!(stage)));
      } catch {
        deps.reason ??= 'callback_failed';
        throw globals.STOPPED;
      }
    }
  }
  function ack(root: Record<string, unknown>, before: NativeShortBodySnapshot): void {
    const data = root.data;
    if (data !== undefined && data !== null && (typeof data !== 'object' || Array.isArray(data)))
      deps.fail('acknowledgement_unverified');
    for (const part of [
      root,
      data && typeof data === 'object' ? (data as Record<string, unknown>) : null,
    ]) {
      if (!part) continue;
      if (Object.hasOwn(part, 'item_id') && part.item_id !== deps.workId)
        deps.fail('acknowledgement_unverified');
      if (
        Object.hasOwn(part, 'latest_version') &&
        (typeof part.latest_version !== 'number' ||
          !Number.isSafeInteger(part.latest_version) ||
          Object.is(part.latest_version, -0) ||
          part.latest_version !== Number(before.native.editData.latest_version) + 1)
      )
        deps.fail('acknowledgement_unverified');
      if (
        Object.hasOwn(part, 'modify_time') &&
        (typeof part.modify_time !== 'string' ||
          !/^[0-9]{10}$/.test(part.modify_time) ||
          part.modify_time < String(before.native.editData.modify_time))
      )
        deps.fail('acknowledgement_unverified');
    }
  }
  return { emit, ack };
}
