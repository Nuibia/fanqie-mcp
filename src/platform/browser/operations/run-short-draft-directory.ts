import { type BrowserContext, type APIRequest } from 'playwright';
import {
  type ShortDraftDirectoryResult,
  type ShortDraftDirectoryOptions,
  unavailableShortDraftDirectory,
  OwnedShortDraftDirectoryRun,
} from '../../short-draft-directory.js';
import { BrowserSessionError } from '../errors.js';
import { type BrowserSessionConfig, type BrowserCallOptions } from '../contracts.js';
import { type RunShortDraftDirectoryOperation } from '../contracts/run-short-draft-directory.js';
interface Dependencies {
  config: BrowserSessionConfig;
  queue: Promise<void>;
  apiQuarantined: boolean;
  closed: boolean;
  context: BrowserContext | null;
  identityEpoch: number;
  activeShortDraftDirectory: { stop(): void; done: Promise<ShortDraftDirectoryResult> } | null;
}
export function createRunShortDraftDirectory(deps: Dependencies): RunShortDraftDirectoryOperation {
  async function runShortDraftDirectory(
    options: Omit<
      ShortDraftDirectoryOptions,
      'deadline' | 'assertBorrowedActive' | 'onQuarantine'
    > &
      BrowserCallOptions,
    fixtureFactory?: Pick<APIRequest, 'newContext'>,
  ): Promise<ShortDraftDirectoryResult> {
    // Capture descriptor values before FIFO; a getter or later mutation cannot replace owner/callback/factory.
    const capture = (value: unknown, required: string[], optional: string[] = []) => {
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        Object.getOwnPropertySymbols(value).length
      )
        throw new BrowserSessionError(
          'capability_unavailable',
          'Short draft directory is unavailable.',
        );
      const d = Object.getOwnPropertyDescriptors(value);
      if (
        required.some((key) => !Object.hasOwn(d, key)) ||
        Object.keys(d).some(
          (key) =>
            (!required.includes(key) && !optional.includes(key)) ||
            !Object.hasOwn(d[key]!, 'value') ||
            !d[key]!.enumerable,
        )
      )
        throw new BrowserSessionError(
          'capability_unavailable',
          'Short draft directory is unavailable.',
        );
      return Object.fromEntries(
        Object.entries(d).map(([key, descriptor]) => [key, descriptor.value]),
      );
    };
    const value = capture(
      options,
      ['mode', 'expectedOwner', 'assertLease', 'onBeforePlatformRead', 'onVerifiedAccount'],
      ['signal', 'timeoutMs'],
    );
    const owner = capture(value.expectedOwner, ['kind', 'id']);
    if (
      value.mode !== 'read' ||
      owner.kind !== 'account' ||
      typeof owner.id !== 'string' ||
      !/^[0-9]{1,30}$/.test(owner.id) ||
      ['assertLease', 'onBeforePlatformRead', 'onVerifiedAccount'].some(
        (key) => typeof value[key] !== 'function',
      ) ||
      (value.signal !== undefined && !(value.signal instanceof AbortSignal))
    )
      throw new BrowserSessionError(
        'capability_unavailable',
        'Short draft directory is unavailable.',
      );
    const timeoutMs = value.timeoutMs ?? deps.config.operationTimeoutMs ?? 120_000;
    if (
      typeof timeoutMs !== 'number' ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 2_147_483_647
    )
      throw new BrowserSessionError('invalid_config', 'Short draft directory timeout is invalid.');
    const captured = {
      mode: 'read' as const,
      expectedOwner: { kind: 'account' as const, id: owner.id },
      signal: value.signal as AbortSignal | undefined,
      assertLease: value.assertLease as () => void,
      onBeforePlatformRead: value.onBeforePlatformRead as () => void,
      onVerifiedAccount: value.onVerifiedAccount as ShortDraftDirectoryOptions['onVerifiedAccount'],
    };
    let factory: Pick<APIRequest, 'newContext'> | undefined;
    if (fixtureFactory !== undefined) {
      const f = capture(fixtureFactory, ['newContext']);
      if (typeof f.newContext !== 'function')
        throw new BrowserSessionError(
          'capability_unavailable',
          'Short draft directory is unavailable.',
        );
      factory = Object.freeze({
        newContext: (f.newContext as APIRequest['newContext']).bind(fixtureFactory),
      });
    }
    let release!: () => void;
    const previous = deps.queue;
    deps.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      if (deps.apiQuarantined) return unavailableShortDraftDirectory('cleanup_failed');
      if (deps.closed || captured.signal?.aborted)
        return unavailableShortDraftDirectory('cancelled');
      const context = deps.context,
        browser = context?.browser();
      if (!context || !browser || !browser.isConnected())
        return unavailableShortDraftDirectory('context_unavailable');
      const epoch = deps.identityEpoch;
      const owned = new OwnedShortDraftDirectoryRun(
        context,
        {
          ...captured,
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
                'Short draft directory source changed.',
              );
          },
          onQuarantine: () => {
            deps.apiQuarantined = true;
          },
        },
        factory,
      );
      let resolve!: (value: ShortDraftDirectoryResult) => void, reject!: (error: unknown) => void;
      const done = new Promise<ShortDraftDirectoryResult>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const active = { stop: () => owned.stop(), done };
      deps.activeShortDraftDirectory = active;
      // Registration precedes cookies/newContext's first await; cleanup owns the FIFO until done.
      void owned.run().then(resolve, reject);
      try {
        return await done;
      } finally {
        if (deps.activeShortDraftDirectory === active) deps.activeShortDraftDirectory = null;
      }
    } finally {
      release();
    }
  }
  return runShortDraftDirectory;
}
