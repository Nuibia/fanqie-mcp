import {
  type NativeShortSubmissionApiReason,
  type OwnedNativeShortSubmissionRunOwner,
  type OwnedNativeShortSubmissionRunGlobals,
} from '../short-native-submission-api.js';

import { type APIResponse } from 'playwright';

export function createOwnedNativeShortSubmissionRunLifecycle(
  deps: Pick<
    OwnedNativeShortSubmissionRunOwner,
    | 'reason'
    | 'notifyStopped'
    | 'cleanupRequested'
    | 'drain'
    | 'stop'
    | 'options'
    | 'fail'
    | 'result'
    | 'pending'
    | 'track'
    | 'stopped'
    | 'check'
    | 'responses'
    | 'disposeResponse'
    | 'quarantine'
    | 'api'
    | 'disposal'
    | 'cleanupResolved'
    | 'finishCleanup'
  >,
  globals: Pick<OwnedNativeShortSubmissionRunGlobals, 'STOPPED'>,
) {
  function stop(reason: NativeShortSubmissionApiReason = 'cancelled'): void {
    deps.reason ??= reason;
    deps.notifyStopped();
    deps.cleanupRequested = true;
    deps.drain();
  }
  function fail(reason: NativeShortSubmissionApiReason): never {
    deps.stop(reason);
    throw globals.STOPPED;
  }
  function check(): void {
    if (deps.reason) throw globals.STOPPED;
    if (!deps.options) deps.fail('invalid_input');
    if (deps.options.signal?.aborted) deps.fail('cancelled');
    if (performance.now() >= deps.options.deadline) deps.fail('timeout');
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
  function quarantine(): void {
    deps.result.cleanup.quarantined = true;
    try {
      deps.options?.onQuarantine();
    } catch {}
  }
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
    const value = await Promise.race([deps.track(promise), deps.stopped]);
    if (value === globals.STOPPED) throw globals.STOPPED;
    deps.check();
    return value as T;
  }
  function ownResponse(response: APIResponse, disposed: () => void): APIResponse {
    deps.responses.set(response, { promise: null, disposed });
    if (deps.cleanupRequested) deps.disposeResponse(response);
    return response;
  }
  function disposeResponse(response: APIResponse): Promise<void> {
    const owned = deps.responses.get(response);
    if (!owned) return Promise.resolve();
    if (!owned.promise) {
      owned.promise = deps.track(
        Promise.resolve()
          .then(() => response.dispose())
          .then(
            () => {
              owned.disposed();
              deps.responses.delete(response);
            },
            () => {
              deps.result.cleanup.disposalFailures++;
              deps.quarantine();
              deps.stop('cleanup_failed');
              deps.responses.delete(response);
            },
          ),
      );
    }
    return owned.promise;
  }
  function drain(): void {
    if (!deps.cleanupRequested) return;
    for (const response of deps.responses.keys()) void deps.disposeResponse(response);
    if (deps.api && !deps.disposal) {
      const api = deps.api;
      deps.disposal = deps.track(
        Promise.resolve()
          .then(() => api.dispose())
          .then(
            () => {
              deps.result.cleanup.sessionDisposed = true;
            },
            () => {
              deps.result.cleanup.disposalFailures++;
              deps.quarantine();
              deps.stop('cleanup_failed');
            },
          ),
      );
    }
    if (
      !deps.pending.size &&
      !deps.responses.size &&
      !deps.cleanupResolved &&
      (!deps.api || deps.disposal !== null)
    ) {
      deps.cleanupResolved = true;
      deps.finishCleanup();
    }
  }
  function begin(): void {
    deps.check();
    if (!deps.result.proof.platformStarted) {
      try {
        deps.options!.onBeforePlatformRead();
      } catch {
        deps.fail('callback_failed');
      }
      deps.check();
      deps.result.proof.platformStarted = true;
    }
  }
  return { stop, fail, check, quarantine, track, wait, ownResponse, disposeResponse, drain, begin };
}
