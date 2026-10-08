import {
  type NativeShortCoverApiReason,
  type OwnedNativeShortCoverRunOwner,
  type OwnedNativeShortCoverRunGlobals,
} from '../short-native-cover-api.js';

export function createOwnedNativeShortCoverRunLifecycle(
  deps: Pick<
    OwnedNativeShortCoverRunOwner,
    | 'pending'
    | 'reason'
    | 'imageAbortController'
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
  globals: Pick<OwnedNativeShortCoverRunGlobals, never>,
) {
  function track<T>(promise: Promise<T>): Promise<T> {
    deps.pending.add(promise);
    void promise.then(
      () => deps.pending.delete(promise),
      () => deps.pending.delete(promise),
    );
    return promise;
  }
  function stop(reason: NativeShortCoverApiReason = 'cancelled'): void {
    deps.reason ??= reason;
    deps.imageAbortController.abort();
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
    deps.disposing = deps.track(
      Promise.resolve().then(async () => {
        try {
          await deps.api!.dispose();
          deps.result.cleanup.sessionDisposed = true;
        } catch {
          deps.disposalFailed();
        }
      }),
    );
  }
  function check(): void {
    if (
      deps.options.signal &&
      Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!.call(
        deps.options.signal,
      )
    )
      deps.stop('cancelled');
    if (performance.now() >= deps.options.deadline) deps.stop('timeout');
    if (deps.reason) throw Error('Owned cover run stopped');
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
    if (performance.now() >= deps.options.deadline) deps.stop('timeout');
    if (deps.reason) throw Error('Owned cover run stopped');
  }
  function fail(reason: NativeShortCoverApiReason): never {
    deps.stop(reason);
    throw Error('Owned cover run unavailable');
  }
  return { track, stop, disposalFailed, startDispose, check, fail };
}
