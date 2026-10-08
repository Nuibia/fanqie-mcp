import { type BrowserContext, type APIRequest } from 'playwright';
import {
  type NativeShortBodyApiResult,
  unavailableNativeShortBodyApi,
  type NativeShortBodyProductionStart,
  type NativeShortBodyApiOptions,
  createOwnedNativeShortBodyFixtureRun,
  createOwnedNativeShortBodyRun,
} from '../../short-native-body-api.js';
import { type BodyFixtureBrowserOptions, bodySignalAborted } from '../body-options.js';
import { BrowserSessionError } from '../errors.js';
import { type BrowserSessionConfig } from '../contracts.js';
import { type RunNativeShortBodyOwnedOperation } from '../contracts/run-native-short-body-owned.js';
interface Dependencies {
  config: BrowserSessionConfig;
  queue: Promise<void>;
  apiQuarantined: boolean;
  closed: boolean;
  context: BrowserContext | null;
  identityEpoch: number;
  activeNativeShortBody: {
    stop(): void;
    done: Promise<NativeShortBodyApiResult>;
    cleanupDone: Promise<void>;
  } | null;
}
export function createRunNativeShortBodyOwned(
  deps: Dependencies,
): RunNativeShortBodyOwnedOperation {
  async function runNativeShortBodyOwned(
    workId: string,
    options: BodyFixtureBrowserOptions,
    execution:
      | { kind: 'fixture'; factory: Pick<APIRequest, 'newContext'> }
      | { kind: 'production'; start: NativeShortBodyProductionStart },
  ): Promise<NativeShortBodyApiResult> {
    const timeoutMs = options.timeoutMs ?? deps.config.operationTimeoutMs ?? 120_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
      return unavailableNativeShortBodyApi('invalid_input');
    const { timeoutMs: _timeout, ...ownedOptions } = options;
    let release!: () => void;
    const previous = deps.queue;
    deps.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      if (deps.apiQuarantined) return unavailableNativeShortBodyApi('cleanup_failed');
      if (deps.closed || bodySignalAborted(options.signal))
        return unavailableNativeShortBodyApi('cancelled');
      const context = deps.context,
        browser = context?.browser();
      if (!context || !browser || !browser.isConnected())
        return unavailableNativeShortBodyApi('context_unavailable');
      const epoch = deps.identityEpoch;
      const lifecycleOptions: NativeShortBodyApiOptions = {
        ...ownedOptions,
        deadline: performance.now() + timeoutMs,
        assertBorrowedActive: () => {
          if (
            deps.closed ||
            deps.apiQuarantined ||
            deps.context !== context ||
            deps.identityEpoch !== epoch ||
            !browser.isConnected()
          )
            throw new BrowserSessionError(
              'capability_unavailable',
              'The native body source changed',
            );
        },
        onQuarantine: () => {
          deps.apiQuarantined = true;
        },
      };
      const owned =
        execution.kind === 'fixture'
          ? createOwnedNativeShortBodyFixtureRun(
              context,
              workId,
              lifecycleOptions,
              execution.factory,
            )
          : createOwnedNativeShortBodyRun(execution.start, context, workId, lifecycleOptions);
      let resolve!: (value: NativeShortBodyApiResult) => void, reject!: (error: unknown) => void;
      const done = new Promise<NativeShortBodyApiResult>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const active = { stop: () => owned.stop(), done, cleanupDone: owned.cleanupDone };
      deps.activeNativeShortBody = active;
      // Keep late client/response ownership after run returns until drain is proven.
      void active.cleanupDone.then(() => {
        if (deps.activeNativeShortBody === active) deps.activeNativeShortBody = null;
      });
      void owned.run().then(resolve, reject);
      return await done;
    } finally {
      release();
    }
  }
  return runNativeShortBodyOwned;
}
