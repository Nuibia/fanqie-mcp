import { Store } from '../runtime/store.js';
import { JobQueue } from '../runtime/jobs.js';
import { type AbortForLeaseLossOperation } from './contracts/lifecycle.js';

interface Dependencies {
  store: Store;
  leaseLossShutdown: boolean;
  queue: JobQueue;
}

export function createAbortForLeaseLoss(deps: Dependencies): AbortForLeaseLossOperation {
  const abortForLeaseLoss = () =>
    deps.store.runLeaseLossCleanup(() => {
      deps.leaseLossShutdown = true;
      deps.queue.abortForLeaseLoss();
    });
  return abortForLeaseLoss;
}
