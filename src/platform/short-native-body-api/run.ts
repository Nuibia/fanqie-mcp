import {
  type NativeShortBodyApiResult,
  type FixtureRunOwner,
  type FixtureRunGlobals,
} from '../short-native-body-api.js';

import {
  NATIVE_SHORT_BODY_SCOPE,
  NativeShortBodyError,
  validateNativeShortBodyBusinessInput,
  nativeShortBodyBusinessInputHash,
  planNativeShortBodyUpdate,
  assertNativeShortBodyPreSave,
  compareNativeShortBodyReadback,
  type NativeShortBodyPlan,
} from '../short-native-body.js';
import { nativeShortBodyHashBasesHash } from '../short-native-body-proof.js';

export function createFixtureRunRun(
  deps: Pick<
    FixtureRunOwner,
    | 'started'
    | 'stop'
    | 'check'
    | 'options'
    | 'factory'
    | 'fail'
    | 'timer'
    | 'business'
    | 'workId'
    | 'binding'
    | 'trace'
    | 'wait'
    | 'borrowed'
    | 'api'
    | 'result'
    | 'drain'
    | 'read'
    | 'postReason'
    | 'emit'
    | 'noChange'
    | 'post'
    | 'links'
    | 'reason'
    | 'ownerCheckedAt'
    | 'cleanupRequested'
    | 'cleanupDone'
    | 'stopped'
    | 'pending'
    | 'responses'
    | 'quarantine'
    | 'durableResult'
    | 'snapshotResult'
  >,
  globals: Pick<
    FixtureRunGlobals,
    'freeze' | 'unavailableNativeShortBodyApi' | 'ORIGIN' | 'compact' | 'STOPPED'
  >,
) {
  async function run(): Promise<NativeShortBodyApiResult> {
    if (deps.started)
      return globals.freeze(globals.unavailableNativeShortBodyApi('durability_unverified'));
    deps.started = true;
    const abort = () => deps.stop('cancelled');
    try {
      deps.check();
      if (!deps.options || !deps.factory) deps.fail('invalid_input');
      if (deps.options.signal)
        EventTarget.prototype.addEventListener.call(deps.options.signal, 'abort', abort, {
          once: true,
        });
      deps.timer = setTimeout(
        () => deps.stop('timeout'),
        Math.max(1, Math.ceil(deps.options.deadline - performance.now())),
      );
      deps.business = validateNativeShortBodyBusinessInput({
        ...deps.options.businessRequest,
        target: { kind: 'short', workId: deps.workId },
        snapshotScope: NATIVE_SHORT_BODY_SCOPE,
      });
      const inputHash = nativeShortBodyBusinessInputHash(deps.options.accountId, deps.business);
      if (!deps.binding)
        deps.trace = {
          schema: 'native-short-body-fixture-trace/v1',
          scope: NATIVE_SHORT_BODY_SCOPE,
          provenance: { mode: 'fixture', executor: 'dependency-injected-body-owned-run/v1' },
          accountId: deps.options.accountId,
          workId: deps.workId,
          inputHash,
          stages: [],
          simulatedAttemptOrdinal: null,
        };
      const cookies = (await deps.wait(deps.borrowed.cookies(globals.ORIGIN))).filter(
        (c) => c.domain === 'fanqienovel.com' || c.domain === '.fanqienovel.com',
      );
      deps.check();
      const creation = deps.factory
        .newContext({ storageState: { cookies, origins: [] } })
        .then((api) => {
          deps.api = api;
          deps.result.cleanup.sessionCreated = true;
          deps.drain();
          return api;
        });
      await deps.wait(creation);
      deps.check();
      if (deps.binding?.mode === 'reconcile') {
        const after = await deps.read('after');
        deps.result.snapshots.after = deps.result.snapshot = after;
        const expected = deps.binding.reconciliationExpectation;
        if (!expected) deps.fail('durability_unverified');
        deps.result.expectation = expected;
        deps.result.comparison = compareNativeShortBodyReadback(expected, after);
        if (!deps.result.comparison.matches) deps.postReason ??= 'readback_mismatch';
      } else {
        const before = await deps.read('before');
        deps.result.snapshots.before = before;
        await deps.emit('baseline', {
          native: globals.compact(before),
          businessInput: deps.business,
          inputHash,
        });
        let plan: NativeShortBodyPlan;
        try {
          plan = planNativeShortBodyUpdate(before, deps.options.businessRequest);
        } catch (error) {
          if (error instanceof NativeShortBodyError && error.code === 'no_change') {
            deps.noChange = true;
            throw globals.STOPPED;
          }
          deps.fail(
            error instanceof NativeShortBodyError && error.code === 'source_version_mismatch'
              ? 'version_conflict'
              : 'unsupported_schema',
          );
        }
        deps.result.plan = plan;
        deps.result.expectation = plan.expectation;
        deps.result.desiredContentHash = plan.desiredContentHash;
        const preSave = await deps.read('preSave');
        deps.result.snapshots.preSave = preSave;
        try {
          assertNativeShortBodyPreSave(preSave, plan);
        } catch {
          deps.fail('version_conflict');
        }
        await deps.emit('preSave', {
          native: globals.compact(preSave),
          sourceVersionHash: plan.expectation.sourceVersionHash,
          desiredContentHash: plan.desiredContentHash,
        });
        await deps.emit('intent', {
          sourceVersionHash: plan.expectation.sourceVersionHash,
          desiredContentHash: plan.desiredContentHash,
          hashBasesHash: nativeShortBodyHashBasesHash(deps.business!),
        });
        await deps.post(plan, before);
        deps.check();
        try {
          const after = await deps.read('after');
          deps.result.snapshots.after = deps.result.snapshot = after;
          const comparison = compareNativeShortBodyReadback(plan.expectation, after);
          deps.result.comparison = comparison;
          await deps.emit('after', { native: globals.compact(after), comparison });
          if (!comparison.matches) deps.fail('readback_mismatch');
        } catch {
          if (deps.binding && !deps.links.after) {
            try {
              await deps.emit(
                'after',
                { native: null, comparison: null },
                new Date().toISOString(),
                false,
              );
            } catch {
              /* Keep the first observed transport cause. */
            }
          } else if (deps.trace && deps.trace.stages.at(-1)?.kind !== 'after')
            await deps.emit(
              'after',
              { native: null, comparison: null },
              new Date().toISOString(),
              false,
            );
          throw globals.STOPPED;
        }
      }
    } catch {
      deps.reason ??= deps.noChange ? null : 'response_unavailable';
    } finally {
      if (deps.options && !deps.reason) {
        try {
          const ownerAt = new Date().toISOString();
          await deps.wait(
            Promise.resolve().then(() =>
              deps.options!.onVerifiedAccount(deps.options!.expectedOwner.id, ownerAt),
            ),
          );
          deps.ownerCheckedAt = ownerAt;
          deps.result.proof.ownerCallback = true;
        } catch {
          deps.reason ??= 'callback_failed';
        }
      }
      deps.cleanupRequested = true;
      deps.drain();
      // cleanupDone is an observation of drain, not another owned operation to drain.
      // A protocol failure still owns the same disposal promises. The existing
      // total-deadline timer and abort stop bound this wait; no retry is issued.
      try {
        const finished = await Promise.race([deps.cleanupDone, deps.stopped]);
        if (finished === globals.STOPPED) throw globals.STOPPED;
        if (!deps.reason) deps.check();
      } catch (error) {
        deps.reason ??= 'cleanup_failed';
        if (error === globals.STOPPED) {
          // Observe disposal promise reactions already queued by stop before freezing pending ownership.
          await new Promise<void>((resolve) => setImmediate(resolve));
          deps.drain();
        }
      }
      // Observe a separate real clock tick; never reuse the owner callback's timestamp as cleanup proof.
      let cleanupCheckedAt = new Date().toISOString();
      if (deps.binding && deps.ownerCheckedAt) {
        try {
          while (cleanupCheckedAt <= deps.ownerCheckedAt) {
            deps.check();
            await new Promise<void>((resolve) => setTimeout(resolve, 1));
            deps.check();
            cleanupCheckedAt = new Date().toISOString();
          }
        } catch {
          deps.reason ??= 'cleanup_failed';
        }
      }
      deps.result.cleanup.pendingAtEnd = deps.pending.size;
      deps.result.cleanup.checkedAt = cleanupCheckedAt;
      if (
        deps.pending.size ||
        deps.responses.size ||
        (deps.result.cleanup.sessionCreated && !deps.result.cleanup.sessionDisposed) ||
        deps.result.cleanup.disposalFailures
      ) {
        deps.quarantine();
        deps.reason ??= 'cleanup_failed';
      }
      if (deps.timer) clearTimeout(deps.timer);
      if (deps.options?.signal)
        EventTarget.prototype.removeEventListener.call(deps.options.signal, 'abort', abort);
    }
    const clean =
      deps.result.cleanup.sessionCreated &&
      deps.result.cleanup.sessionDisposed &&
      !deps.result.cleanup.pendingAtEnd &&
      !deps.result.cleanup.disposalFailures &&
      !deps.result.cleanup.quarantined;
    const failed = deps.postReason ?? deps.reason;
    deps.result.status =
      !failed && clean
        ? deps.noChange
          ? 'no_change'
          : 'fixture_complete'
        : 'capability_unavailable';
    deps.result.reason =
      failed ??
      (deps.noChange && clean ? 'no_change' : clean ? 'fixture_not_live' : 'cleanup_failed');
    deps.result.save.outcome =
      deps.trace?.simulatedAttemptOrdinal === 1
        ? deps.result.status === 'fixture_complete'
          ? 'fixture_matched'
          : 'fixture_unknown'
        : 'not_attempted';
    deps.result.proof.proofCapturedAt = deps.result.cleanup.checkedAt;
    if (deps.binding) return deps.durableResult(clean, failed);
    if (deps.trace) {
      try {
        await deps.emit(
          'result',
          {
            outcome: deps.result.save.outcome,
            reason: deps.result.reason,
            cleanup: { ...deps.result.cleanup },
          },
          deps.result.cleanup.checkedAt,
          false,
        );
        deps.result.save.trace = deps.trace;
      } catch {
        deps.result.status = 'capability_unavailable';
        deps.result.reason = 'durability_unverified';
      }
    }
    return deps.snapshotResult();
  }
  return { run };
}
