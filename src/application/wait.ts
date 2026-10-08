import { type Config } from '../config.js';
import { Store } from '../runtime/store.js';
import { type JobHandle } from '../runtime/jobs.js';
import { GenericReadPurpose } from './shared.js';
import { type WaitOperation, type CompletedOperation } from './contracts/query.js';

interface Dependencies {
  store: Store;
  config: Config;
  completed: CompletedOperation;
}

export function createWait(deps: Dependencies): WaitOperation {
  async function wait(handle: JobHandle, purpose: GenericReadPurpose = 'current') {
    const previous = deps.store.getJob(handle.jobId, deps.config.accountId);
    const retrievalMode = previous?.status === 'queued' ? 'live' : 'saved';
    return deps.completed(await handle.completion, retrievalMode, purpose);
  }
  return wait;
}
