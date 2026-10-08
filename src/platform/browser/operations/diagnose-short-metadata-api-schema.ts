import { type BrowserContext } from 'playwright';
import {
  type ShortMetadataApiResult,
  type ShortMetadataApiOptions,
  unavailableShortMetadataApi,
  OwnedShortMetadataApiRun,
} from '../../short-metadata-api-schema.js';
import { BrowserSessionError } from '../errors.js';
import { type BrowserSessionConfig, type BrowserCallOptions } from '../contracts.js';
import { type DiagnoseShortMetadataApiSchemaOperation } from '../contracts/diagnose-short-metadata-api-schema.js';
interface Dependencies {
  config: BrowserSessionConfig;
  queue: Promise<void>;
  apiQuarantined: boolean;
  closed: boolean;
  context: BrowserContext | null;
  identityEpoch: number;
  activeShortMetadataApi: { stop(): void; done: Promise<ShortMetadataApiResult> } | null;
}
export function createDiagnoseShortMetadataApiSchema(
  deps: Dependencies,
): DiagnoseShortMetadataApiSchemaOperation {
  async function diagnoseShortMetadataApiSchema(
    workId: string,
    options: Omit<ShortMetadataApiOptions, 'deadline' | 'assertBorrowedActive' | 'onQuarantine'> &
      BrowserCallOptions,
  ): Promise<ShortMetadataApiResult> {
    const timeoutMs = options.timeoutMs ?? deps.config.operationTimeoutMs ?? 120_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
      throw new BrowserSessionError(
        'invalid_config',
        'API metadata operation timeout must be a positive supported timer value',
      );
    let release!: () => void;
    const previous = deps.queue;
    deps.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      if (deps.apiQuarantined) return unavailableShortMetadataApi('cleanup_failed');
      if (deps.closed || options.signal?.aborted) return unavailableShortMetadataApi('cancelled');
      const context = deps.context,
        browser = context?.browser();
      if (!context || !browser || !browser.isConnected())
        return unavailableShortMetadataApi('context_unavailable');
      const epoch = deps.identityEpoch;
      const owned = new OwnedShortMetadataApiRun(context, workId, {
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
              'The owned API source session changed',
            );
        },
        onQuarantine: () => {
          deps.apiQuarantined = true;
        },
      });
      // Install stop synchronously before run enters cookies/newContext's first await.
      let resolve!: (value: ShortMetadataApiResult) => void, reject!: (error: unknown) => void;
      const done = new Promise<ShortMetadataApiResult>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const active = { stop: () => owned.stop('cancelled'), done };
      deps.activeShortMetadataApi = active;
      void owned.run().then(resolve, reject);
      try {
        return await done;
      } finally {
        if (deps.activeShortMetadataApi === active) deps.activeShortMetadataApi = null;
      }
    } finally {
      release();
    }
  }
  return diagnoseShortMetadataApiSchema;
}
