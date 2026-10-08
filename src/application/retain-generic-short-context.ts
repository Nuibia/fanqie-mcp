import { type GenericShortTrustedContext } from '../runtime/store.js';
import { type JobHandle } from '../runtime/jobs.js';
import { type RetainGenericShortContextOperation } from './contracts/generic-write.js';

interface Dependencies {
  genericShortContexts: Map<
    string,
    {
      context: GenericShortTrustedContext;
      witness: Record<string, unknown>;
      sticky: 'capture_failed' | 'persist_failed' | null;
    }
  >;
}

export function createRetainGenericShortContext(
  deps: Dependencies,
): RetainGenericShortContextOperation {
  function retainGenericShortContext(handle: JobHandle): JobHandle {
    void handle.completion.then(
      () => deps.genericShortContexts.delete(handle.jobId),
      () => deps.genericShortContexts.delete(handle.jobId),
    );
    return handle;
  }
  return retainGenericShortContext;
}
