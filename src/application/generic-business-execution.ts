import { createHash } from 'node:crypto';
import { Store } from '../runtime/store.js';
import { type JobContext } from '../runtime/jobs.js';
import * as writes from '../platform/writes.js';
import { hash, GenericShortExecution } from './shared.js';
import { type GenericBusinessExecutionOperation } from './contracts/generic-write.js';
import { type RuntimeTargetOperation } from './contracts/maintenance.js';
interface Dependencies {
  store: Store;
  runtimeTarget: RuntimeTargetOperation;
}

export function createGenericBusinessExecution(
  deps: Dependencies,
): GenericBusinessExecutionOperation {
  function genericBusinessExecution(
    ctx: JobContext,
    operation: string,
    args: Record<string, unknown>,
  ): GenericShortExecution {
    const job = deps.store.getJob(ctx.jobId)!,
      content = args.content as writes.DraftContent;
    return operation === 'create_draft'
      ? {
          target: null,
          creationContext: null,
          requestBindings: {
            inputHash: job.inputHash,
            clientReferenceHash: hash({ kind: 'short', clientReference: args.clientReference }),
            requestedContentHash: writes.hashDraftContent(content),
            requestedTitleHash: createHash('sha256').update(content.title).digest('hex'),
            requestedBodyHash: createHash('sha256')
              .update(writes.normalizeBody(content.body))
              .digest('hex'),
          },
        }
      : {
          target: deps.runtimeTarget(args.target as writes.WriteTarget),
          creationContext: null,
          requestBindings: {
            inputHash: job.inputHash,
            expectedContentHash: String(args.expectedContentHash),
            desiredContentHash: writes.hashDraftContent(content),
          },
        };
  }
  return genericBusinessExecution;
}
