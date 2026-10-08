import { type NativeShortReconciliationContext } from '../platform/short-native-metadata-proof.js';
import { type Config } from '../config.js';
import { Store, type Job } from '../runtime/store.js';
import { record } from './shared.js';
import {
  type NativeClosureContextOperation,
  type RefsForOperation,
  type NativeReconciliationContextOperation,
  type JobManifestOperation,
} from './contracts/evidence-context.js';

interface Dependencies {
  store: Store;
  config: Config;
  refsFor: RefsForOperation;
  nativeReconciliationContext: NativeReconciliationContextOperation;
  jobManifest: JobManifestOperation;
}

export function createNativeClosureContext(deps: Dependencies): NativeClosureContextOperation {
  function nativeClosureContext(original: Job): NativeShortReconciliationContext {
    return deps.store.memoPublicProjection('nativeClosureContext', [original], () => {
      const closure = record(original.result);
      if (
        !['native-short-metadata-closure/v1', 'native-short-metadata-closure/v2'].includes(
          String(closure.schema),
        ) ||
        typeof closure.reconciliationJobId !== 'string'
      )
        throw new Error('Invalid native closure link');
      const read = deps.store.getJob(closure.reconciliationJobId, deps.config.accountId);
      if (!read || read.accountId !== deps.config.accountId)
        throw new Error('Missing native later read');
      const refs = deps.refsFor(read);
      return deps.nativeReconciliationContext(
        original,
        read,
        deps.jobManifest(read),
        refs,
        refs.map((ref) => deps.store.readEvidence(ref)),
      );
    });
  }
  return nativeClosureContext;
}
