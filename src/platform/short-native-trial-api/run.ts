import {
  type NativeShortTrialApiWriteOptions,
  type NativeShortTrialApiResult,
  type OwnedNativeShortTrialRunOwner,
  type OwnedNativeShortTrialRunGlobals,
} from '../short-native-trial-api.js';

import {
  NativeShortTrialError,
  planNativeShortTrialUpdate,
  assertNativeShortTrialPreSave,
  compareNativeShortTrialReadback,
  nativeShortTrialDesiredContentHash,
  type NativeShortTrialPlan,
} from '../short-native-trial.js';

export function createOwnedNativeShortTrialRunRun(
  deps: Pick<
    OwnedNativeShortTrialRunOwner,
    | 'started'
    | 'stop'
    | 'options'
    | 'timer'
    | 'optionsValid'
    | 'workId'
    | 'fail'
    | 'businessRequest'
    | 'check'
    | 'track'
    | 'borrowed'
    | 'api'
    | 'factory'
    | 'result'
    | 'reason'
    | 'startDispose'
    | 'read'
    | 'held'
    | 'callback'
    | 'post'
    | 'postFailure'
    | 'pending'
  >,
  globals: Pick<
    OwnedNativeShortTrialRunGlobals,
    'OWNER' | 'WORK' | 'copyCookies' | 'ORIGIN' | 'freeze'
  >,
) {
  async function run(): Promise<NativeShortTrialApiResult> {
    if (deps.started) throw Error('Owned trial run is single-use');
    deps.started = true;
    const abort = () => deps.stop('cancelled');
    if (deps.options.signal)
      EventTarget.prototype.addEventListener.call(deps.options.signal, 'abort', abort, {
        once: true,
      });
    deps.timer = setTimeout(
      () => deps.stop('timeout'),
      Math.max(1, deps.options.deadline - performance.now()),
    );
    try {
      if (
        !deps.optionsValid ||
        deps.options.expectedOwner.kind !== 'account' ||
        typeof deps.options.expectedOwner.id !== 'string' ||
        !globals.OWNER.test(deps.options.expectedOwner.id) ||
        typeof deps.workId !== 'string' ||
        !globals.WORK.test(deps.workId) ||
        !Number.isFinite(deps.options.deadline)
      )
        deps.fail('identity_unverified');
      if (deps.options.mode === 'write' && !deps.businessRequest) deps.fail('unsupported_schema');
      deps.check();
      const cookies = globals.copyCookies(await deps.track(deps.borrowed.cookies(globals.ORIGIN)));
      deps.check();
      deps.api = await deps.track(
        deps.factory.newContext({ storageState: { cookies, origins: [] } }),
      );
      deps.result.cleanup.sessionCreated = true;
      if (deps.reason) deps.startDispose();
      deps.check();
      const before = await deps.read(deps.result.phases.before);
      deps.result.snapshots.before = before;
      deps.check();
      if (deps.options.mode === 'read') deps.result.snapshot = before;
      else {
        let plan: NativeShortTrialPlan;
        try {
          plan = planNativeShortTrialUpdate(before, deps.businessRequest!);
        } catch (error) {
          deps.fail(
            error instanceof NativeShortTrialError && error.code === 'source_version_mismatch'
              ? 'version_conflict'
              : 'unsupported_schema',
          );
        }
        deps.result.plan = plan;
        deps.result.expectation = plan.expectation;
        deps.result.desiredContentHash = plan.desiredContentHash;
        const baseline = deps.held(before, before, plan, deps.result.phases.before);
        try {
          await deps.track(
            Promise.resolve().then(() => {
              deps.check();
              return (deps.options as NativeShortTrialApiWriteOptions).onBaseline(baseline);
            }),
          );
        } catch {
          if (!deps.reason) deps.fail('callback_failed');
          throw Error('Trial baseline unavailable');
        }
        deps.check();
        const preSave = await deps.read(deps.result.phases.preSave);
        deps.result.snapshots.preSave = preSave;
        deps.check();
        try {
          assertNativeShortTrialPreSave(preSave, plan.expectation);
        } catch {
          deps.fail('version_conflict');
        }
        deps.result.save.held = deps.held(preSave, before, plan, deps.result.phases.preSave);
        deps.result.save.intentReceipt = await deps.callback('intent');
        deps.check();
        deps.result.save.attemptReceipt = await deps.callback('attempt');
        deps.check();
        deps.result.save.post.markedAt = deps.result.save.attemptReceipt.eventAt;
        await deps.post(plan);
        deps.check();
        if (deps.result.save.observation) {
          deps.result.save.acknowledgementReceipt = await deps.callback('acknowledgement');
          deps.check();
        }
        const after = await deps.read(deps.result.phases.after);
        deps.result.snapshot = after;
        deps.result.snapshots.after = after;
        deps.check();
        deps.result.comparison = compareNativeShortTrialReadback(plan.expectation, after);
        try {
          deps.result.observedContentHash = nativeShortTrialDesiredContentHash({
            ...plan.expectation,
            binding: after.binding,
            expectedDocumentHash: after.documentHash,
            expectedSavedFieldsHash: after.savedFieldsHash,
            catalogHash: after.catalogHash,
            categorySelectionHash: after.categorySelectionHash,
            preservationHash: deps.result.comparison.actual.preservationHash,
            coversHash: after.coversHash,
            bodyHash: after.bodyHash,
            paragraphsHash: after.paragraphsHash,
            trialDocumentHash: after.trialDocumentHash,
            desiredHtml: after.document.rawHtml,
          });
        } catch {
          deps.result.observedContentHash = null;
        }
        if (deps.postFailure) deps.fail(deps.postFailure);
        if (
          !deps.result.comparison.matches ||
          deps.result.observedContentHash !== plan.desiredContentHash
        )
          deps.fail('readback_mismatch');
      }
    } catch {
      if (!deps.reason) deps.stop('response_unavailable');
    } finally {
      deps.startDispose();
      while (deps.pending.size) await Promise.allSettled([...deps.pending]);
      deps.result.cleanup.pendingAtEnd = deps.pending.size;
      deps.result.cleanup.checkedAt = new Date().toISOString();
    }
    try {
      deps.check();
      if (
        !deps.result.snapshot ||
        !deps.result.cleanup.sessionDisposed ||
        deps.result.cleanup.quarantined ||
        (deps.options.mode === 'write' &&
          (!deps.result.comparison?.matches || !deps.result.save.acknowledgementReceipt))
      )
        deps.fail('cleanup_failed');
      const checkedAt = new Date().toISOString();
      try {
        await deps.track(
          Promise.resolve().then(() => {
            deps.check();
            return deps.options.onVerifiedAccount(deps.options.expectedOwner.id, checkedAt);
          }),
        );
      } catch {
        deps.fail('callback_failed');
      }
      deps.check();
      deps.result.proof.ownerCallback = true;
      deps.result.proof.proofCapturedAt = checkedAt;
      if (deps.options.mode === 'write') deps.result.save.outcome = 'verified';
      deps.result.status = 'success';
      deps.result.reason = null;
    } catch {
      deps.result.reason = deps.reason ?? 'response_unavailable';
    } finally {
      if (deps.timer) clearTimeout(deps.timer);
      if (deps.options.signal)
        EventTarget.prototype.removeEventListener.call(deps.options.signal, 'abort', abort);
    }
    return globals.freeze(deps.result);
  }
  return { run };
}
