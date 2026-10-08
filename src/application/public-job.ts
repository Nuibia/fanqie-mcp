import { type Config } from '../config.js';
import { Store, RuntimeError, type Job } from '../runtime/store.js';
import { type PublicJobOperation } from './contracts/evidence-context.js';

interface Dependencies {
  store: Store;
  config: Config;
}

export function createPublicJob(deps: Dependencies): PublicJobOperation {
  function publicJob(id: string): Job | null {
    return deps.store.memoPublicProjection('publicJob', [id], () => {
      try {
        return deps.store.getJobForPublicProjection(id, deps.config.accountId);
      } catch (error) {
        if (error instanceof RuntimeError) throw error;
        throw new RuntimeError('capability_unavailable', 'Saved data is unavailable.');
      }
    });
  }
  return publicJob;
}
