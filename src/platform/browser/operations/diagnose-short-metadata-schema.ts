import { type BrowserContext } from 'playwright';
import {
  type ShortMetadataResult,
  type ShortMetadataOptions,
  OwnedShortMetadataRun,
  unavailableShortMetadata,
} from '../../short-metadata-schema.js';
import { BrowserSessionError } from '../errors.js';
import { type BrowserSessionConfig, type BrowserCallOptions } from '../contracts.js';
import { type DiagnoseShortMetadataSchemaOperation } from '../contracts/diagnose-short-metadata-schema.js';
interface Dependencies {
  config: BrowserSessionConfig;
  queue: Promise<void>;
  apiQuarantined: boolean;
  closed: boolean;
  context: BrowserContext | null;
  identityEpoch: number;
  activeShortMetadata: { stop(): void; done: Promise<ShortMetadataResult> } | null;
}
export function createDiagnoseShortMetadataSchema(
  deps: Dependencies,
): DiagnoseShortMetadataSchemaOperation {
  async function diagnoseShortMetadataSchema(
    workId: string,
    options: Omit<ShortMetadataOptions, 'deadline' | 'assertBorrowedActive'> & BrowserCallOptions,
  ): Promise<ShortMetadataResult> {
    const timeoutMs = options.timeoutMs ?? deps.config.operationTimeoutMs ?? 120_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
      throw new BrowserSessionError(
        'invalid_config',
        'Metadata operation timeout must be a positive supported timer value',
      );
    let release!: () => void;
    const previous = deps.queue;
    deps.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    let owned: OwnedShortMetadataRun | null = null;
    try {
      await previous;
      if (deps.apiQuarantined) return unavailableShortMetadata('cleanup_failed');
      if (deps.closed || options.signal?.aborted) return unavailableShortMetadata('cancelled');
      const context = deps.context,
        browser = context?.browser();
      if (!context || !browser || !browser.isConnected())
        return unavailableShortMetadata('context_unavailable');
      const epoch = deps.identityEpoch;
      owned = new OwnedShortMetadataRun(context, browser, workId, {
        ...options,
        deadline: performance.now() + timeoutMs,
        assertBorrowedActive: () => {
          if (
            deps.closed ||
            deps.context !== context ||
            deps.identityEpoch !== epoch ||
            !browser.isConnected()
          )
            throw new BrowserSessionError(
              'capability_unavailable',
              'The owned source session changed',
            );
        },
      });
      // run() may enter cookies() before returning its Promise; install the stop
      // handle first, with a deferred done slot that settles only after real drain.
      let resolve!: (value: ShortMetadataResult) => void, reject!: (error: unknown) => void;
      const done = new Promise<ShortMetadataResult>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const active = { stop: () => owned!.stop('cancelled'), done };
      deps.activeShortMetadata = active;
      void owned.run().then(resolve, reject);
      try {
        return await done;
      } finally {
        if (deps.activeShortMetadata === active) deps.activeShortMetadata = null;
      }
    } finally {
      release();
    }
  }
  return diagnoseShortMetadataSchema;
}
