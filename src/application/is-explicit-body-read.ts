import { NATIVE_SHORT_READ_OPERATION } from '../platform/short-native-metadata-proof.js';
import { type Job } from '../runtime/store.js';
import { type IsExplicitBodyReadOperation } from './contracts/evidence-context.js';

interface Dependencies {
  explicitBodyReadKey: 'explicit_body_read.';
}

export function createIsExplicitBodyRead(deps: Dependencies): IsExplicitBodyReadOperation {
  function isExplicitBodyRead(job: Job | null): boolean {
    return (
      !!job &&
      ((job.kind === 'read' &&
        job.operation === NATIVE_SHORT_READ_OPERATION &&
        typeof job.idempotencyKey === 'string' &&
        job.idempotencyKey.startsWith(deps.explicitBodyReadKey)) ||
        Object.hasOwn(job.metadata ?? {}, 'explicitBodyRead'))
    );
  }
  return isExplicitBodyRead;
}
