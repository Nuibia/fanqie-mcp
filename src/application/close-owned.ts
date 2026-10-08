import { Store, RuntimeError } from '../runtime/store.js';
import { JobQueue } from '../runtime/jobs.js';
import { BrowserSession } from '../platform/browser.js';
import {
  type CloseOwnedOperation,
  type AbortForLeaseLossOperation,
} from './contracts/lifecycle.js';

interface Dependencies {
  store: Store;
  abortForLeaseLoss: AbortForLeaseLossOperation;
  closing: Promise<void> | undefined;
  queue: JobQueue;
  leaseLossShutdown: boolean;
  browser: BrowserSession;
}

export function createCloseOwned(deps: Dependencies): CloseOwnedOperation {
  function closeOwned(reason?: 'lease_lost'): Promise<void> {
    if (reason === 'lease_lost' || deps.store.hasLostServiceLease()) deps.abortForLeaseLoss();
    if (deps.closing) return deps.closing;
    deps.closing = (async () => {
      let queueClosed = false,
        browserClosed = false;
      try {
        await deps.queue.drainAndStop(deps.leaseLossShutdown ? { reason: 'lease_lost' } : {});
        queueClosed = true;
      } catch (error) {
        if (!deps.leaseLossShutdown && !deps.store.hasLostServiceLease()) throw error;
        deps.abortForLeaseLoss();
      }
      try {
        await deps.browser.close();
        browserClosed = true;
      } catch (error) {
        if (!deps.leaseLossShutdown && !deps.store.hasLostServiceLease()) throw error;
        deps.abortForLeaseLoss();
      }
      // A local rejection/timeout never proves release of the callback or borrowed browser.
      if (!queueClosed || !browserClosed)
        throw new RuntimeError('shutdown_incomplete', 'Service resource cleanup did not complete.');
      deps.store.close();
    })().catch((error) => {
      // A rejected normal cleanup may be retried once its owned resources recover.
      // Permanent loss keeps the failed attempt sticky for the fatal deadline.
      if (!deps.leaseLossShutdown && !deps.store.hasLostServiceLease()) deps.closing = undefined;
      throw error;
    });
    return deps.closing;
  }
  return closeOwned;
}
