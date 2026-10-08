import { type Config } from '../config.js';
import { Store, type Job } from '../runtime/store.js';
import {
  type NativeOriginalContextOperation,
  type RefsForOperation,
} from './contracts/evidence-context.js';

interface Dependencies {
  store: Store;
  refsFor: RefsForOperation;
  config: Config;
}

export function createNativeOriginalContext(deps: Dependencies): NativeOriginalContextOperation {
  function nativeOriginalContext(job: Job) {
    return deps.store.memoPublicProjection('nativeOriginalContext', [job], () => {
      const refs = deps.refsFor(job);
      return {
        accountId: deps.config.accountId,
        job,
        manifest: null,
        refs,
        documents: refs.map((ref) => deps.store.readEvidence(ref)),
      };
    });
  }
  return nativeOriginalContext;
}
