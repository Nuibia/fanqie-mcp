import { type BrowserContext } from 'playwright';
import {
  type NativeShortMetadataApiResult,
  type NativeShortMetadataApiOptions,
  unavailableNativeShortMetadataApi,
  OwnedNativeShortMetadataRun,
} from '../../short-native-metadata-api.js';
import { BrowserSessionError } from '../errors.js';
import { type BrowserSessionConfig, type BrowserCallOptions } from '../contracts.js';
import { type RunNativeShortMetadataOperation } from '../contracts/run-native-short-metadata.js';
interface Dependencies {
  config: BrowserSessionConfig;
  queue: Promise<void>;
  apiQuarantined: boolean;
  closed: boolean;
  context: BrowserContext | null;
  identityEpoch: number;
  activeNativeShortMetadata: { stop(): void; done: Promise<NativeShortMetadataApiResult> } | null;
}
export function createRunNativeShortMetadata(deps: Dependencies): RunNativeShortMetadataOperation {
  async function runNativeShortMetadata(
    workId: string,
    options: Omit<
      NativeShortMetadataApiOptions,
      'deadline' | 'assertBorrowedActive' | 'onQuarantine'
    > &
      BrowserCallOptions,
  ): Promise<NativeShortMetadataApiResult> {
    options = { ...options, expectedOwner: { ...options.expectedOwner } };
    const timeoutMs = options.timeoutMs ?? deps.config.operationTimeoutMs ?? 120_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
      throw new BrowserSessionError(
        'invalid_config',
        'Native metadata timeout must be a positive supported timer value',
      );
    let release!: () => void;
    const previous = deps.queue;
    deps.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      if (deps.apiQuarantined) return unavailableNativeShortMetadataApi('cleanup_failed');
      if (deps.closed || options.signal?.aborted)
        return unavailableNativeShortMetadataApi('cancelled');
      const context = deps.context,
        browser = context?.browser();
      if (!context || !browser || !browser.isConnected())
        return unavailableNativeShortMetadataApi('context_unavailable');
      const epoch = deps.identityEpoch;
      const owned = new OwnedNativeShortMetadataRun(context, workId, {
        ...options,
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
              'The native metadata source changed',
            );
        },
        onQuarantine: () => {
          deps.apiQuarantined = true;
        },
      });
      // Install before run() can enter cookies/newContext's first await.
      let resolve!: (value: NativeShortMetadataApiResult) => void,
        reject!: (error: unknown) => void;
      const done = new Promise<NativeShortMetadataApiResult>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const active = { stop: () => owned.stop(), done };
      deps.activeNativeShortMetadata = active;
      void owned.run().then(resolve, reject);
      try {
        return await done;
      } finally {
        if (deps.activeNativeShortMetadata === active) deps.activeNativeShortMetadata = null;
      }
    } finally {
      release();
    }
  }
  return runNativeShortMetadata;
}
