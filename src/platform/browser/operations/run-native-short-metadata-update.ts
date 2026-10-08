import { type BrowserContext } from 'playwright';
import {
  type NativeShortMetadataApiWriteResult,
  type NativeShortMetadataApiWriteOptions,
  captureNativeShortMetadataWriteRequest,
  unavailableNativeShortMetadataWriteApi,
  OwnedNativeShortMetadataWriteRun,
} from '../../short-native-metadata-api.js';
import { BrowserSessionError } from '../errors.js';
import { type BrowserSessionConfig, type BrowserCallOptions } from '../contracts.js';
import { type RunNativeShortMetadataUpdateOperation } from '../contracts/run-native-short-metadata-update.js';
interface Dependencies {
  config: BrowserSessionConfig;
  queue: Promise<void>;
  apiQuarantined: boolean;
  closed: boolean;
  context: BrowserContext | null;
  identityEpoch: number;
  activeNativeShortMetadataWrite: {
    stop(): void;
    done: Promise<NativeShortMetadataApiWriteResult>;
  } | null;
}
export function createRunNativeShortMetadataUpdate(
  deps: Dependencies,
): RunNativeShortMetadataUpdateOperation {
  async function runNativeShortMetadataUpdate(
    workId: string,
    options: Omit<
      NativeShortMetadataApiWriteOptions,
      'deadline' | 'assertBorrowedActive' | 'onQuarantine'
    > &
      BrowserCallOptions,
  ): Promise<NativeShortMetadataApiWriteResult> {
    // Preserve request presence and typed owner before queued callers can mutate aliases.
    options = {
      ...options,
      expectedOwner: { ...options.expectedOwner },
      businessRequest: captureNativeShortMetadataWriteRequest(
        options.businessRequest,
      ) as NativeShortMetadataApiWriteOptions['businessRequest'],
    };
    const timeoutMs = options.timeoutMs ?? deps.config.operationTimeoutMs ?? 120_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
      throw new BrowserSessionError(
        'invalid_config',
        'Native metadata write timeout must be a positive supported timer value',
      );
    let release!: () => void;
    const previous = deps.queue;
    deps.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      if (deps.apiQuarantined) return unavailableNativeShortMetadataWriteApi('cleanup_failed');
      if (deps.closed || options.signal?.aborted)
        return unavailableNativeShortMetadataWriteApi('cancelled');
      const context = deps.context,
        browser = context?.browser();
      if (!context || !browser || !browser.isConnected())
        return unavailableNativeShortMetadataWriteApi('context_unavailable');
      const epoch = deps.identityEpoch;
      const owned = new OwnedNativeShortMetadataWriteRun(context, workId, {
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
              'The native metadata write source changed',
            );
        },
        onQuarantine: () => {
          deps.apiQuarantined = true;
        },
      });
      // A close during the very first cookies await must already own stop/done.
      let resolve!: (value: NativeShortMetadataApiWriteResult) => void,
        reject!: (error: unknown) => void;
      const done = new Promise<NativeShortMetadataApiWriteResult>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const active = { stop: () => owned.stop(), done };
      deps.activeNativeShortMetadataWrite = active;
      void owned.run().then(resolve, reject);
      try {
        return await done;
      } finally {
        if (deps.activeNativeShortMetadataWrite === active)
          deps.activeNativeShortMetadataWrite = null;
      }
    } finally {
      release();
    }
  }
  return runNativeShortMetadataUpdate;
}
