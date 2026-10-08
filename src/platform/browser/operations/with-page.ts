import { type BrowserContext, type Page } from 'playwright';
import { AsyncLocalStorage } from 'node:async_hooks';
import { type BrowserPageSlot } from '../body-options.js';
import { type PlatformIdentity } from '../own-identity.js';
import { BrowserSessionError } from '../errors.js';
import { type BrowserSessionConfig, type BrowserCallOptions } from '../contracts.js';
import { type AssertAccountUsableOperation } from '../contracts/assert-account-usable.js';
import { type EnsurePageOperation } from '../contracts/ensure-page.js';
import { type WithPageOperation } from '../contracts/with-page.js';
interface Dependencies {
  assertAccountUsable: AssertAccountUsableOperation;
  config: BrowserSessionConfig;
  queue: Promise<void>;
  identityEpoch: number;
  identity: PlatformIdentity | null;
  page: Page | null;
  qrLoginPage: Page | null;
  context: BrowserContext | null;
  ensurePage: EnsurePageOperation;
  activePageSlot: BrowserPageSlot | null;
  activeReaderPage: Page | null;
  pageSlots: AsyncLocalStorage<BrowserPageSlot>;
  closed: boolean;
}
export function createWithPage(deps: Dependencies): WithPageOperation {
  async function withPage<T>(
    reader: (page: Page) => Promise<T>,
    options: BrowserCallOptions = {},
  ): Promise<T> {
    deps.assertAccountUsable();
    const timeoutMs = options.timeoutMs ?? deps.config.operationTimeoutMs ?? 120_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1)
      throw new BrowserSessionError(
        'invalid_config',
        'Browser operation timeout must be a positive number',
      );
    let release!: () => void;
    const previous = deps.queue;
    deps.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    let activePage: Page | null = null;
    let activeSlot: BrowserPageSlot | null = null;
    let interrupted: 'cancelled' | 'timeout' | null = null;
    let closeActive: Promise<void> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const interrupt = (code: 'cancelled' | 'timeout') => {
      interrupted ??= code;
      if (activePage && !closeActive) {
        deps.identityEpoch += 1;
        deps.identity = null;
        if (deps.page === activePage) deps.page = null;
        if (deps.qrLoginPage === activePage) deps.qrLoginPage = null;
        closeActive = activePage.close({ runBeforeUnload: false }).catch(async () => {
          await deps.context?.close().catch(() => undefined);
          deps.context = null;
          deps.page = null;
        });
      }
    };
    const onAbort = () => interrupt('cancelled');
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    try {
      await previous;
      if (interrupted)
        throw new BrowserSessionError(
          interrupted,
          'Browser operation was cancelled before it started',
        );
      timer = setTimeout(() => interrupt('timeout'), timeoutMs);
      activePage = await deps.ensurePage();
      if (interrupted) {
        interrupt(interrupted);
        throw new BrowserSessionError(
          interrupted,
          'Browser operation was interrupted while opening its page',
        );
      }
      activeSlot = { page: activePage, context: activePage.context() };
      deps.activePageSlot = activeSlot;
      deps.activeReaderPage = activePage;
      deps.assertAccountUsable();
      const result = await deps.pageSlots.run(activeSlot, () => reader(activePage!));
      deps.assertAccountUsable();
      if (interrupted)
        throw new BrowserSessionError(
          interrupted,
          'Browser operation was interrupted; its page was closed',
        );
      if (deps.closed)
        throw new BrowserSessionError(
          'browser_closed',
          'Browser session closed before the operation completed',
        );
      return result;
    } catch (error) {
      if (interrupted)
        throw new BrowserSessionError(
          interrupted,
          'Browser operation was interrupted; its page was closed',
        );
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      if (activeSlot && deps.activePageSlot === activeSlot) {
        deps.activePageSlot = null;
        if (deps.activeReaderPage === activePage) deps.activeReaderPage = null;
      }
      options.signal?.removeEventListener('abort', onAbort);
      // Never release this account/browser FIFO while the reader is still running.
      if (closeActive) await closeActive;
      release();
    }
  }
  return withPage;
}
