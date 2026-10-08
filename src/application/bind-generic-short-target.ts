import { RuntimeError, type GenericShortTrustedContext } from '../runtime/store.js';
import { type JobContext } from '../runtime/jobs.js';
import { hash } from './shared.js';
import {
  type BindGenericShortTargetOperation,
  type GenericCaptureOperation,
} from './contracts/generic-write.js';

interface Dependencies {
  genericShortContexts: Map<
    string,
    {
      context: GenericShortTrustedContext;
      witness: Record<string, unknown>;
      sticky: 'capture_failed' | 'persist_failed' | null;
    }
  >;
  genericCapture: GenericCaptureOperation;
}

export function createBindGenericShortTarget(deps: Dependencies): BindGenericShortTargetOperation {
  function bindGenericShortTarget(
    ctx: JobContext,
    target: NonNullable<GenericShortTrustedContext['target']>,
  ): void {
    const active = deps.genericShortContexts.get(ctx.jobId);
    if (!active) return;
    const exact = deps.genericCapture(target);
    if (
      exact.kind !== 'short-story' ||
      !/^\d{10,22}$/.test(exact.id) ||
      Object.keys(exact).some((key) => !['kind', 'id'].includes(key))
    )
      throw new RuntimeError(
        'capability_unavailable',
        'The generic short target must be the actual short work.',
      );
    if (active.context.target !== null && hash(active.context.target) !== hash(target))
      throw new RuntimeError(
        'capability_unavailable',
        'The generic short target changed during execution.',
      );
    active.context = deps.genericCapture({ ...active.context, target });
    active.witness = deps.genericCapture({ ...active.witness, target });
    ctx.addMetadata({ genericShortStatus: active.witness });
  }
  return bindGenericShortTarget;
}
