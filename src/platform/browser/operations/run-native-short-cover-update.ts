import { type BrowserContext } from 'playwright';
import {
  type NativeShortCoverApiResult,
  type NativeShortCoverApiOptions,
  captureNativeShortCoverWriteRequest,
  unavailableNativeShortCoverApi,
  OwnedNativeShortCoverRun,
} from '../../short-native-cover-api.js';
import { BrowserSessionError } from '../errors.js';
import { type BrowserSessionConfig, type BrowserCallOptions } from '../contracts.js';
import { type RunNativeShortCoverUpdateOperation } from '../contracts/run-native-short-cover-update.js';
interface Dependencies {
  config: BrowserSessionConfig;
  queue: Promise<void>;
  apiQuarantined: boolean;
  closed: boolean;
  context: BrowserContext | null;
  identityEpoch: number;
  activeNativeShortCover: { stop(): void; done: Promise<NativeShortCoverApiResult> } | null;
}
export function createRunNativeShortCoverUpdate(
  deps: Dependencies,
): RunNativeShortCoverUpdateOperation {
  async function runNativeShortCoverUpdate(
    workId: string,
    options: Omit<
      NativeShortCoverApiOptions,
      'deadline' | 'assertBorrowedActive' | 'onQuarantine'
    > &
      BrowserCallOptions,
  ): Promise<NativeShortCoverApiResult> {
    // Capture descriptor-only business data, owner and callback references before FIFO.
    options = {
      ...options,
      expectedOwner: { ...options.expectedOwner },
      businessRequest: captureNativeShortCoverWriteRequest(
        options.businessRequest,
      ) as NativeShortCoverApiOptions['businessRequest'],
    };
    const timeoutMs = options.timeoutMs ?? deps.config.operationTimeoutMs ?? 120_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
      throw new BrowserSessionError(
        'invalid_config',
        'Native cover timeout must be a positive supported timer value',
      );
    const { timeoutMs: _timeoutMs, ...ownedOptions } = options;
    let release!: () => void;
    const previous = deps.queue;
    deps.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      if (deps.apiQuarantined) return unavailableNativeShortCoverApi('cleanup_failed');
      if (deps.closed || options.signal?.aborted)
        return unavailableNativeShortCoverApi('cancelled');
      const context = deps.context,
        browser = context?.browser();
      if (!context || !browser || !browser.isConnected())
        return unavailableNativeShortCoverApi('context_unavailable');
      const epoch = deps.identityEpoch;
      const owned = new OwnedNativeShortCoverRun(context, workId, {
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
              'The native cover source changed',
            );
        },
        onQuarantine: () => {
          deps.apiQuarantined = true;
        },
      });
      // Install before run enters image preparation, cookies or newContext's first await.
      let resolve!: (value: NativeShortCoverApiResult) => void, reject!: (error: unknown) => void;
      const done = new Promise<NativeShortCoverApiResult>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const active = { stop: () => owned.stop(), done };
      deps.activeNativeShortCover = active;
      void owned.run().then(resolve, reject);
      try {
        return await done;
      } finally {
        if (deps.activeNativeShortCover === active) deps.activeNativeShortCover = null;
      }
    } finally {
      release();
    }
  }
  return runNativeShortCoverUpdate;
}
