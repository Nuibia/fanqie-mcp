import { type BrowserContext } from 'playwright';
import {
  type NativeShortTrialApiResult,
  type NativeShortTrialApiWriteOptions,
  captureNativeShortTrialWriteRequest,
  unavailableNativeShortTrialApi,
  OwnedNativeShortTrialRun,
} from '../../short-native-trial-api.js';
import { BrowserSessionError } from '../errors.js';
import { type BrowserSessionConfig, type BrowserCallOptions } from '../contracts.js';
import { type RunNativeShortTrialUpdateOperation } from '../contracts/run-native-short-trial-update.js';
interface Dependencies {
  config: BrowserSessionConfig;
  queue: Promise<void>;
  apiQuarantined: boolean;
  closed: boolean;
  context: BrowserContext | null;
  identityEpoch: number;
  activeNativeShortTrial: { stop(): void; done: Promise<NativeShortTrialApiResult> } | null;
}
export function createRunNativeShortTrialUpdate(
  deps: Dependencies,
): RunNativeShortTrialUpdateOperation {
  async function runNativeShortTrialUpdate(
    workId: string,
    options: Omit<
      NativeShortTrialApiWriteOptions,
      'deadline' | 'assertBorrowedActive' | 'onQuarantine'
    > &
      BrowserCallOptions,
  ): Promise<NativeShortTrialApiResult> {
    // Capture descriptor-only business data, owner and callback references before FIFO.
    options = {
      ...options,
      expectedOwner: { ...options.expectedOwner },
      businessRequest: captureNativeShortTrialWriteRequest(
        options.businessRequest,
      ) as NativeShortTrialApiWriteOptions['businessRequest'],
    };
    const timeoutMs = options.timeoutMs ?? deps.config.operationTimeoutMs ?? 120_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
      throw new BrowserSessionError(
        'invalid_config',
        'Native trial timeout must be a positive supported timer value',
      );
    const { timeoutMs: _timeoutMs, ...ownedOptions } = options;
    let release!: () => void;
    const previous = deps.queue;
    deps.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      if (deps.apiQuarantined) return unavailableNativeShortTrialApi('cleanup_failed');
      if (deps.closed || options.signal?.aborted)
        return unavailableNativeShortTrialApi('cancelled');
      const context = deps.context,
        browser = context?.browser();
      if (!context || !browser || !browser.isConnected())
        return unavailableNativeShortTrialApi('context_unavailable');
      const epoch = deps.identityEpoch;
      const owned = new OwnedNativeShortTrialRun(context, workId, {
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
              'The native trial source changed',
            );
        },
        onQuarantine: () => {
          deps.apiQuarantined = true;
        },
      });
      // Install before run enters cookies or newContext's first await.
      let resolve!: (value: NativeShortTrialApiResult) => void, reject!: (error: unknown) => void;
      const done = new Promise<NativeShortTrialApiResult>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const active = { stop: () => owned.stop(), done };
      deps.activeNativeShortTrial = active;
      void owned.run().then(resolve, reject);
      try {
        return await done;
      } finally {
        if (deps.activeNativeShortTrial === active) deps.activeNativeShortTrial = null;
      }
    } finally {
      release();
    }
  }
  return runNativeShortTrialUpdate;
}
