import { Store, type Job } from '../runtime/store.js';
import { type RefsForOperation } from './contracts/evidence-context.js';

interface Dependencies {
  store: Store;
}

export function createRefsFor(deps: Dependencies): RefsForOperation {
  const refsFor = (job: Job) => deps.store.listEvidence(job.id);
  return refsFor;
}
