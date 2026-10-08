import {
  type NativeShortBodyApiReason,
  type FixtureRunOwner,
  type FixtureRunGlobals,
} from '../short-native-body-api.js';
import { type APIResponse } from 'playwright';

export function createFixtureRunLifecycle(
  deps: Pick<
    FixtureRunOwner,
    | 'pending'
    | 'drain'
    | 'track'
    | 'stopped'
    | 'check'
    | 'reason'
    | 'notifyStop'
    | 'cleanupRequested'
    | 'result'
    | 'options'
    | 'quarantine'
    | 'stop'
    | 'fail'
    | 'binding'
    | 'responses'
    | 'disposeResponse'
    | 'disposalFailed'
    | 'api'
    | 'disposal'
    | 'cleanupResolved'
    | 'finishCleanup'
  >,
  globals: Pick<FixtureRunGlobals, 'STOPPED' | 'NATIVE_SHORT_BODY_API_REASONS' | 'signalAborted'>,
) {
  function track<T>(promise: Promise<T>): Promise<T> {
    deps.pending.add(promise);
    void promise.then(
      () => {
        deps.pending.delete(promise);
        deps.drain();
      },
      () => {
        deps.pending.delete(promise);
        deps.drain();
      },
    );
    return promise;
  }
  async function wait<T>(promise: Promise<T>): Promise<T> {
    const result = await Promise.race([deps.track(promise), deps.stopped]);
    if (result === globals.STOPPED) throw globals.STOPPED;
    deps.check();
    return result as T;
  }
  function fail(reason: NativeShortBodyApiReason): never {
    deps.reason ??= reason;
    throw globals.STOPPED;
  }
  function stop(reason: NativeShortBodyApiReason = 'cancelled'): void {
    deps.reason ??= (globals.NATIVE_SHORT_BODY_API_REASONS as readonly string[]).includes(reason)
      ? reason
      : 'cancelled';
    deps.notifyStop();
    deps.cleanupRequested = true;
    deps.drain();
  }
  function quarantine(): void {
    deps.result.cleanup.quarantined = true;
    try {
      deps.options?.onQuarantine();
    } catch {
      /* The fixed fence remains set. */
    }
  }
  function disposalFailed(): void {
    deps.result.cleanup.disposalFailures++;
    deps.quarantine();
    deps.stop('cleanup_failed');
  }
  function check(): void {
    if (deps.reason) throw globals.STOPPED;
    if (!deps.options) deps.fail('invalid_input');
    if (globals.signalAborted(deps.options.signal)) {
      deps.stop('cancelled');
      throw globals.STOPPED;
    }
    if (performance.now() >= deps.options.deadline) {
      deps.stop('timeout');
      throw globals.STOPPED;
    }
    try {
      deps.options.assertLease();
    } catch {
      deps.stop('lease_unavailable');
      throw globals.STOPPED;
    }
    try {
      deps.options.assertBorrowedActive();
    } catch {
      deps.stop('source_changed');
      throw globals.STOPPED;
    }
    if (deps.binding) {
      if (Date.now() >= Date.parse(deps.binding.deadlineAt)) {
        deps.stop('timeout');
        throw globals.STOPPED;
      }
      try {
        deps.binding.check();
      } catch {
        deps.stop('durability_unverified');
        throw globals.STOPPED;
      }
    }
  }
  function ownResponse(response: APIResponse, disposed: () => void): APIResponse {
    deps.responses.set(response, { dispose: null, disposed });
    if (deps.cleanupRequested) deps.disposeResponse(response);
    return response;
  }
  function disposeResponse(response: APIResponse): Promise<void> {
    const record = deps.responses.get(response);
    if (!record) return Promise.resolve();
    if (record.dispose) return record.dispose;
    // Track the actual disposal promise; failures leave an unverified ownership record.
    record.dispose = deps.track(
      Promise.resolve()
        .then(() => response.dispose())
        .then(
          () => {
            record.disposed();
            deps.responses.delete(response);
          },
          () => {
            deps.disposalFailed();
          },
        ),
    );
    return record.dispose;
  }
  function drain(): void {
    if (!deps.cleanupRequested) return;
    for (const response of deps.responses.keys()) void deps.disposeResponse(response);
    if (deps.api && !deps.disposal) {
      deps.disposal = deps.track(
        Promise.resolve()
          .then(() => deps.api!.dispose())
          .then(
            () => {
              deps.result.cleanup.sessionDisposed = true;
            },
            () => {
              deps.disposalFailed();
            },
          ),
      );
    }
    if (
      !deps.pending.size &&
      !deps.responses.size &&
      (!deps.result.cleanup.sessionCreated || deps.result.cleanup.sessionDisposed) &&
      !deps.result.cleanup.disposalFailures &&
      !deps.cleanupResolved
    ) {
      deps.cleanupResolved = true;
      deps.finishCleanup();
    }
  }
  return {
    track,
    wait,
    fail,
    stop,
    quarantine,
    disposalFailed,
    check,
    ownResponse,
    disposeResponse,
    drain,
  };
}
