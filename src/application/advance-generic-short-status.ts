import { RuntimeError, type GenericShortTrustedContext } from '../runtime/store.js';
import { type JobContext } from '../runtime/jobs.js';
import {
  type AdvanceGenericShortStatusOperation,
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

export function createAdvanceGenericShortStatus(
  deps: Dependencies,
): AdvanceGenericShortStatusOperation {
  function advanceGenericShortStatus(
    ctx: JobContext,
    stage: string,
    failure?: { kind: string; at: string },
  ): void {
    const active = deps.genericShortContexts.get(ctx.jobId);
    if (!active) return;
    if (active.sticky && stage !== active.sticky)
      throw new RuntimeError(
        'capability_unavailable',
        'The generic short attempt has a sticky evidence failure.',
      );
    const witness = deps.genericCapture({
      ...active.witness,
      stage,
      ...(failure ? { failure } : {}),
    });
    active.witness = witness;
    try {
      ctx.addMetadata({ genericShortStatus: witness });
    } catch (error) {
      active.sticky = 'persist_failed';
      throw error;
    }
  }
  return advanceGenericShortStatus;
}
