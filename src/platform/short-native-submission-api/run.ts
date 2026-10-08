import {
  type NativeShortSubmissionApiSubmitOptions,
  type NativeShortSubmissionApiResult,
  type OwnedNativeShortSubmissionRunOwner,
  type OwnedNativeShortSubmissionRunGlobals,
} from '../short-native-submission-api.js';

import { request } from 'playwright';

import {
  createNativeShortPreparedSubmission,
  planNativeShortSubmission,
  compareNativeShortSubmissionReadback,
  type NativeShortSubmissionPlan,
} from '../short-native-submission.js';

export function createOwnedNativeShortSubmissionRunRun(
  deps: Pick<
    OwnedNativeShortSubmissionRunOwner,
    | 'started'
    | 'owner'
    | 'result'
    | 'stop'
    | 'options'
    | 'timer'
    | 'workId'
    | 'fail'
    | 'check'
    | 'wait'
    | 'borrowed'
    | 'api'
    | 'cleanupRequested'
    | 'drain'
    | 'read'
    | 'sources'
    | 'json'
    | 'business'
    | 'held'
    | 'reason'
    | 'callback'
    | 'post'
    | 'cleanupDone'
    | 'stopped'
    | 'pending'
    | 'responses'
    | 'quarantine'
    | 'postFailure'
  >,
  globals: Pick<
    OwnedNativeShortSubmissionRunGlobals,
    'FIXTURES' | 'WORK' | 'cookieCopy' | 'ORIGIN' | 'STOPPED' | 'copy'
  >,
) {
  async function run(): Promise<NativeShortSubmissionApiResult> {
    if (deps.started) throw Error('Owned submission run is single-use');
    deps.started = true;
    const fixture = globals.FIXTURES.get(deps.owner);
    globals.FIXTURES.delete(deps.owner);
    if (fixture) {
      globals.FIXTURES.set(deps.owner, fixture);
      deps.result.provenance = {
        mode: 'fixture',
        executor: 'dependency-injected-submission-owned-run/v1',
      };
    }
    const abort = () => deps.stop('cancelled');
    if (deps.options?.signal)
      EventTarget.prototype.addEventListener.call(deps.options.signal, 'abort', abort, {
        once: true,
      });
    deps.timer = setTimeout(
      () => deps.stop('timeout'),
      Math.max(1, (deps.options?.deadline ?? performance.now()) - performance.now()),
    );
    try {
      if (!globals.WORK.test(deps.workId)) deps.fail('invalid_input');
      deps.check();
      const cookies = globals.cookieCopy(await deps.wait(deps.borrowed.cookies(globals.ORIGIN)));
      deps.check();
      const creation = (fixture?.factory ?? request)
        .newContext({ storageState: { cookies, origins: [] } })
        .then((api) => {
          deps.api = api;
          deps.result.cleanup.sessionCreated = true;
          if (deps.cleanupRequested) deps.drain();
          return api;
        });
      await deps.wait(creation);
      deps.check();
      if (deps.options!.mode === 'read')
        deps.result.snapshots.after = deps.result.snapshot = await deps.read('after', false);
      else {
        const before = await deps.read('before', true);
        deps.result.snapshots.before = before;
        const contract = await deps.sources();
        deps.result.contract = contract;
        // Recheck owned identity after source reads before preparing or authorizing a write.
        const owner = await deps.json('before', 'own');
        if (owner.id !== deps.options!.expectedOwner.id) deps.fail('owner_changed');
        if (deps.options!.mode === 'prepare') {
          try {
            deps.result.prepared = createNativeShortPreparedSubmission(
              before,
              contract,
              deps.business(),
              new Date().toISOString(),
            );
          } catch {
            deps.fail('unsupported_schema');
          }
          deps.result.snapshot = before;
        } else {
          const options = deps.options as NativeShortSubmissionApiSubmitOptions;
          let plan: NativeShortSubmissionPlan;
          try {
            plan = planNativeShortSubmission(
              before,
              contract,
              deps.business(),
              options.servicePrepared.prepared,
              new Date().toISOString(),
            );
          } catch {
            deps.fail('version_conflict');
          }
          if ((!fixture && !plan.request.liveAllowed) || (fixture && plan.request.liveAllowed))
            deps.fail('source_changed');
          deps.result.plan = plan;
          deps.result.prepared = plan.prepared;
          deps.result.expectation = plan.expectation;
          const initial = deps.held(before, before, contract, plan, deps.result.phases.before);
          try {
            await deps.wait(Promise.resolve().then(() => options.onBaseline(initial)));
          } catch {
            if (!deps.reason) deps.fail('callback_failed');
            throw globals.STOPPED;
          }
          const preSubmit = await deps.read('preSubmit', true);
          deps.result.snapshots.preSubmit = preSubmit;
          try {
            planNativeShortSubmission(
              preSubmit,
              contract,
              deps.business(),
              options.servicePrepared.prepared,
              new Date().toISOString(),
            );
          } catch {
            deps.fail('version_conflict');
          }
          deps.result.publish.held = deps.held(
            before,
            preSubmit,
            contract,
            plan,
            deps.result.phases.preSubmit,
          );
          deps.result.publish.intentReceipt = await deps.callback('intent');
          deps.result.publish.attemptReceipt = await deps.callback('attempt');
          deps.result.publish.post.markedAt = deps.result.publish.attemptReceipt.eventAt;
          deps.result.publish.outcome = 'unknown';
          await deps.post();
          if (deps.result.publish.observation)
            deps.result.publish.acknowledgementReceipt = await deps.callback('acknowledgement');
          deps.check();
          deps.result.snapshots.after = deps.result.snapshot = await deps.read('after', false);
          deps.result.comparison = compareNativeShortSubmissionReadback(
            plan.expectation,
            deps.result.snapshot,
          );
        }
      }
      deps.check();
      const checkedAt = new Date().toISOString();
      try {
        await deps.wait(
          Promise.resolve().then(() =>
            deps.options!.onVerifiedAccount(deps.options!.expectedOwner.id, checkedAt),
          ),
        );
      } catch {
        if (!deps.reason) deps.fail('callback_failed');
        throw globals.STOPPED;
      }
      deps.result.proof.ownerCallback = true;
      deps.result.proof.proofCapturedAt = checkedAt;
    } catch {
      deps.reason ??= 'response_unavailable';
    } finally {
      deps.cleanupRequested = true;
      deps.drain();
      try {
        const value = await Promise.race([deps.cleanupDone, deps.stopped]);
        if (value === globals.STOPPED) {
          await new Promise<void>((resolve) => setImmediate(resolve));
          deps.drain();
        }
      } catch {
        deps.reason ??= 'cleanup_failed';
      }
      deps.result.cleanup.pendingAtEnd = deps.pending.size;
      deps.result.cleanup.checkedAt = new Date().toISOString();
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
      globals.FIXTURES.delete(deps.owner);
    }
    const clean =
      deps.result.cleanup.sessionCreated &&
      deps.result.cleanup.sessionDisposed &&
      !deps.result.cleanup.pendingAtEnd &&
      !deps.result.cleanup.disposalFailures &&
      !deps.result.cleanup.quarantined;
    if (
      !deps.reason &&
      !deps.postFailure &&
      clean &&
      deps.result.proof.ownerCallback &&
      deps.result.snapshot &&
      (deps.options!.mode !== 'submit' || deps.result.publish.acknowledgementReceipt)
    ) {
      deps.result.status = 'success';
      deps.result.reason = null;
      if (
        deps.options!.mode === 'submit' &&
        deps.result.publish.observation!.accepted &&
        deps.result.comparison?.matches &&
        ['reviewing', 'published'].includes(deps.result.comparison.observedStatus)
      )
        deps.result.publish.outcome = 'verified';
    } else deps.result.reason = deps.postFailure ?? deps.reason ?? 'cleanup_failed';
    // Return a detached immutable observation: late drain updates never mutate a returned result.
    return globals.copy(deps.result);
  }
  return { run };
}
