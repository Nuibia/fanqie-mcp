import { type BrowserContext, type Page, type APIRequest } from 'playwright';
import {
  type NativeShortSubmissionApiResult,
  type NativeShortSubmissionBrowserOptions,
  unavailableNativeShortSubmissionApi,
  captureNativeShortSubmissionOptions,
  OwnedNativeShortSubmissionRun,
  type NativeShortSubmissionApiOptions,
  createOwnedNativeShortSubmissionFixtureRun,
} from '../../short-native-submission-api.js';
import { BrowserSessionError } from '../errors.js';
import { type BrowserSessionConfig } from '../contracts.js';
import {
  type NativeShortSubmissionContract,
  validateNativeShortSubmissionContract,
} from '../../short-native-submission.js';
import { type EnsurePageOperation } from '../contracts/ensure-page.js';
import { type RunNativeShortSubmissionOwnedOperation } from '../contracts/run-native-short-submission-owned.js';
interface Dependencies {
  config: BrowserSessionConfig;
  queue: Promise<void>;
  apiQuarantined: boolean;
  closed: boolean;
  activeNativeShortSubmission: {
    stop(): void;
    done: Promise<NativeShortSubmissionApiResult>;
    cleanupDone: Promise<void>;
  } | null;
  context: BrowserContext | null;
  ensurePage: EnsurePageOperation;
  page: Page | null;
  identityEpoch: number;
}
export function createRunNativeShortSubmissionOwned(
  deps: Dependencies,
): RunNativeShortSubmissionOwnedOperation {
  async function runNativeShortSubmissionOwned(
    workId: string,
    input: NativeShortSubmissionBrowserOptions,
    fixture?: { factory: Pick<APIRequest, 'newContext'>; contract: NativeShortSubmissionContract },
  ): Promise<NativeShortSubmissionApiResult> {
    // Capture all business descriptors and callback references before entering FIFO.
    if (!input || typeof input !== 'object' || Array.isArray(input))
      return unavailableNativeShortSubmissionApi('invalid_input');
    const ds = Object.getOwnPropertyDescriptors(input),
      rawTimeout =
        ds.timeoutMs && Object.hasOwn(ds.timeoutMs, 'value')
          ? ds.timeoutMs.value
          : (deps.config.operationTimeoutMs ?? 120_000);
    const timeoutMs = typeof rawTimeout === 'number' ? rawTimeout : Number.NaN;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
      throw new BrowserSessionError(
        'invalid_config',
        'Native submission timeout must be a positive supported timer value',
      );
    if (
      Object.getOwnPropertySymbols(input).length ||
      ['deadline', 'assertBorrowedActive', 'onQuarantine'].some((key) => Object.hasOwn(ds, key))
    )
      return unavailableNativeShortSubmissionApi('invalid_input');
    const supplied = Object.fromEntries(
      Object.entries(ds)
        .filter(([key]) => key !== 'timeoutMs')
        .map(([key, descriptor]) => {
          if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
            throw new BrowserSessionError(
              'capability_unavailable',
              'Native submission options must be descriptor data',
            );
          return [key, descriptor.value];
        }),
    );
    const captured = captureNativeShortSubmissionOptions({
      ...supplied,
      deadline: performance.now() + timeoutMs,
      assertBorrowedActive() {},
      onQuarantine() {},
    });
    if (!captured)
      return unavailableNativeShortSubmissionApi(
        'invalid_input',
        supplied.mode === 'prepare' || supplied.mode === 'read' ? supplied.mode : 'submit',
      );
    let capturedFixture:
      | { factory: Pick<APIRequest, 'newContext'>; contract: NativeShortSubmissionContract }
      | undefined;
    if (fixture) {
      try {
        const fd = Object.getOwnPropertyDescriptors(fixture.factory);
        if (
          Object.getOwnPropertySymbols(fixture.factory).length ||
          Object.keys(fd).length !== 1 ||
          !fd.newContext?.enumerable ||
          !Object.hasOwn(fd.newContext, 'value') ||
          typeof fd.newContext.value !== 'function'
        )
          return unavailableNativeShortSubmissionApi('invalid_input', captured.mode);
        capturedFixture = {
          factory: { newContext: fd.newContext.value.bind(fixture.factory) },
          contract: validateNativeShortSubmissionContract(fixture.contract),
        };
      } catch {
        return unavailableNativeShortSubmissionApi('invalid_input', captured.mode);
      }
    }
    let release!: () => void;
    const previous = deps.queue;
    deps.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      if (deps.apiQuarantined)
        return unavailableNativeShortSubmissionApi('cleanup_failed', captured.mode);
      if (deps.closed || captured.signal?.aborted)
        return unavailableNativeShortSubmissionApi('cancelled', captured.mode);
      try {
        captured.assertLease();
      } catch {
        return unavailableNativeShortSubmissionApi('lease_unavailable', captured.mode);
      }
      const deadline = performance.now() + timeoutMs,
        controller = new AbortController();
      let halt: 'cancelled' | 'timeout' | null = null,
        owned: OwnedNativeShortSubmissionRun | null = null;
      let notifyHalt!: () => void;
      const halted = new Promise<void>((resolve) => {
        notifyHalt = resolve;
      });
      const stop = (reason: 'cancelled' | 'timeout' = 'cancelled') => {
        halt ??= reason;
        owned?.stop(reason);
        controller.abort();
        notifyHalt();
      };
      const onAbort = () => stop('cancelled');
      captured.signal?.addEventListener('abort', onAbort, { once: true });
      let resolve!: (value: NativeShortSubmissionApiResult) => void;
      const done = new Promise<NativeShortSubmissionApiResult>((yes) => {
        resolve = yes;
      });
      let finishCleanup!: () => void;
      const cleanupDone = new Promise<void>((yes) => {
        finishCleanup = yes;
      });
      const active = { stop, done, cleanupDone };
      deps.activeNativeShortSubmission = active;
      const timer = setTimeout(() => stop('timeout'), Math.max(1, deadline - performance.now()));
      // This slot owns cold launch as well as cookies/newContext. close cannot bypass a late context.
      const execute = async () => {
        let returned = false;
        const result = (
          reason:
            | 'cancelled'
            | 'timeout'
            | 'context_unavailable'
            | 'lease_unavailable'
            | 'cleanup_failed',
          pending = false,
        ) => {
          const value = unavailableNativeShortSubmissionApi(reason, captured.mode);
          if (pending) {
            deps.apiQuarantined = true;
            value.cleanup.quarantined = true;
            value.cleanup.pendingAtEnd = 1;
            value.cleanup.checkedAt = new Date().toISOString();
          }
          returned = true;
          resolve(value);
        };
        try {
          // ensurePage only creates/attaches a persistent context and an inert page; no goto/withPage.
          if (!deps.context) {
            const initializing = deps.ensurePage(true);
            const opened = await Promise.race([
              initializing.then(
                () => true,
                () => false,
              ),
              halted.then(() => null),
            ]);
            if (opened === null) {
              result(halt ?? 'cancelled', true);
              // Retain actual launch ownership after the bounded result; no new work may borrow it.
              await initializing.catch(() => undefined);
              const lateContext = deps.context as BrowserContext | null;
              if (lateContext) {
                await lateContext.close();
                deps.context = null;
                deps.page = null;
              }
              return;
            }
            if (!opened) {
              const failedContext = deps.context as BrowserContext | null;
              if (failedContext) {
                // Initialization may fail after launch succeeds. Its single
                // close remains owned, but cannot extend the public deadline.
                const closing = Promise.resolve()
                  .then(() => failedContext.close())
                  .then(
                    () => {
                      if (deps.context === failedContext) {
                        deps.context = null;
                        deps.page = null;
                      }
                      return true;
                    },
                    () => false,
                  );
                const closed = await Promise.race([closing, halted.then(() => null)]);
                if (closed === null) {
                  result(halt ?? 'cancelled', true);
                  await closing; // Actual drain, including a late failure; no second close.
                  return;
                }
                if (!closed) {
                  result('cleanup_failed', true);
                  return;
                }
              }
              result(halt ?? 'context_unavailable');
              return;
            }
          }
          if (halt || deps.closed || captured.signal?.aborted) {
            result(halt ?? 'cancelled');
            return;
          }
          try {
            captured.assertLease();
          } catch {
            result('lease_unavailable');
            return;
          }
          const context = deps.context,
            browser = context?.browser();
          if (!context || !browser || !browser.isConnected()) {
            result('context_unavailable');
            return;
          }
          const epoch = deps.identityEpoch;
          const options = {
            ...captured,
            signal: controller.signal,
            deadline,
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
                  'The native submission source changed',
                );
            },
            onQuarantine: () => {
              deps.apiQuarantined = true;
            },
          } as NativeShortSubmissionApiOptions;
          owned = capturedFixture
            ? createOwnedNativeShortSubmissionFixtureRun(
                context,
                workId,
                options,
                capturedFixture.factory,
                capturedFixture.contract,
              )
            : new OwnedNativeShortSubmissionRun(context, workId, options);
          // Active stop/done above is already installed before the first Owned await.
          const value = await owned.run();
          returned = true;
          resolve(value);
          await owned.cleanupDone;
        } catch {
          deps.apiQuarantined = true;
          if (!returned) result(halt ?? 'cleanup_failed', true);
        } finally {
          clearTimeout(timer);
          captured.signal?.removeEventListener('abort', onAbort);
          finishCleanup();
          if (deps.activeNativeShortSubmission === active) deps.activeNativeShortSubmission = null;
        }
      };
      void execute();
      return await done;
    } finally {
      release();
    }
  }
  return runNativeShortSubmissionOwned;
}
