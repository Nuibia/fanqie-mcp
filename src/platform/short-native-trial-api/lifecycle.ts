import {
  type NativeShortTrialApiReason,
  type OwnedNativeShortTrialRunOwner,
  type OwnedNativeShortTrialRunGlobals,
} from '../short-native-trial-api.js';

export function createOwnedNativeShortTrialRunLifecycle(
  deps: Pick<
    OwnedNativeShortTrialRunOwner,
    | 'pending'
    | 'reason'
    | 'startDispose'
    | 'result'
    | 'options'
    | 'api'
    | 'disposing'
    | 'track'
    | 'disposalFailed'
    | 'stop'
    | 'fail'
  >,
  globals: Pick<OwnedNativeShortTrialRunGlobals, never>,
) {
  function track<T>(promise: Promise<T>): Promise<T> {
    deps.pending.add(promise);
    void promise.then(
      () => deps.pending.delete(promise),
      () => deps.pending.delete(promise),
    );
    return promise;
  }
  function stop(reason: NativeShortTrialApiReason = 'cancelled'): void {
    deps.reason ??= reason;
    deps.startDispose();
  }
  function disposalFailed(): void {
    deps.result.cleanup.disposalFailures++;
    deps.reason = 'cleanup_failed';
    if (!deps.result.cleanup.quarantined) {
      deps.result.cleanup.quarantined = true;
      try {
        deps.options.onQuarantine();
      } catch {}
    }
  }
  function startDispose(): void {
    if (!deps.api || deps.disposing) return;
    const api = deps.api;
    deps.disposing = deps.track(
      (async () => {
        try {
          await api.dispose();
          deps.result.cleanup.sessionDisposed = true;
        } catch {
          deps.disposalFailed();
        }
      })(),
    );
  }
  function fail(reason: NativeShortTrialApiReason): never {
    deps.stop(reason);
    throw Error('Owned trial run unavailable');
  }
  function check(): void {
    if (deps.options.signal?.aborted) deps.stop('cancelled');
    if (performance.now() >= deps.options.deadline) deps.stop('timeout');
    if (deps.reason) throw Error('Owned trial run stopped');
    try {
      deps.options.assertLease();
    } catch {
      deps.fail('lease_unavailable');
    }
    try {
      deps.options.assertBorrowedActive();
    } catch {
      deps.fail('source_changed');
    }
  }
  return { track, stop, disposalFailed, startDispose, fail, check };
}
