import { Store, type GenericShortTrustedContext } from '../runtime/store.js';
import { type JobContext } from '../runtime/jobs.js';
import * as writes from '../platform/writes.js';
import { GenericShortExecution } from './shared.js';
import {
  type GenericShortRunOperation,
  type BeginGenericShortStatusOperation,
  type AdvanceGenericShortStatusOperation,
} from './contracts/generic-write.js';

interface Dependencies {
  beginGenericShortStatus: BeginGenericShortStatusOperation;
  genericShortContexts: Map<
    string,
    {
      context: GenericShortTrustedContext;
      witness: Record<string, unknown>;
      sticky: 'capture_failed' | 'persist_failed' | null;
    }
  >;
  advanceGenericShortStatus: AdvanceGenericShortStatusOperation;
  store: Store;
}

export function createGenericShortRun(deps: Dependencies): GenericShortRunOperation {
  async function genericShortRun<T>(
    ctx: JobContext,
    execution: GenericShortExecution,
    run: () => Promise<T>,
  ): Promise<T> {
    deps.beginGenericShortStatus(ctx, execution);
    try {
      return await run();
    } catch (error) {
      const active = deps.genericShortContexts.get(ctx.jobId)!;
      if (writes.isGenericShortCaptureFailure(error)) active.sticky = 'capture_failed';
      if (active.sticky) {
        try {
          deps.advanceGenericShortStatus(ctx, active.sticky, {
            kind: active.sticky,
            at: new Date().toISOString(),
          });
        } catch {}
      } else if ((active.witness.observations as unknown[]).length === 0) {
        try {
          deps.advanceGenericShortStatus(ctx, 'source_unavailable', {
            kind: 'source_unavailable',
            at: new Date().toISOString(),
          });
        } catch {}
      } else if (
        deps.store.getJob(ctx.jobId)?.platformWriteStartedAt === null ||
        active.witness.stage === 'final_observed'
      ) {
        try {
          deps.advanceGenericShortStatus(ctx, 'precondition_blocked', {
            kind: 'precondition_blocked',
            at: new Date().toISOString(),
          });
        } catch {}
      }
      throw error;
    }
  }
  return genericShortRun;
}
