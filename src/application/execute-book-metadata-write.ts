import { type Config } from '../config.js';
import { Store, RuntimeError } from '../runtime/store.js';
import { JobQueue } from '../runtime/jobs.js';
import { BrowserSession } from '../platform/browser.js';
import * as writes from '../platform/writes.js';
import { hash, jsonValue } from './shared.js';
import {
  type ExecuteBookMetadataWriteOperation,
  type BookWriteOptionsOperation,
} from './contracts/maintenance.js';
import { type RequireEditorWritesEnabledOperation } from './contracts/tool-input.js';
import { type WaitOperation } from './contracts/query.js';
import { type RequireLoginOperation } from './contracts/identity.js';
import { type PlatformAccountOperation } from './contracts/capabilities.js';

interface Dependencies {
  store: Store;
  requireEditorWritesEnabled: RequireEditorWritesEnabledOperation;
  wait: WaitOperation;
  queue: JobQueue;
  config: Config;
  requireLogin: RequireLoginOperation;
  platformAccount: PlatformAccountOperation;
  browser: BrowserSession;
  bookWriteOptions: BookWriteOptionsOperation;
}

export function createExecuteBookMetadataWrite(
  deps: Dependencies,
): ExecuteBookMetadataWriteOperation {
  function executeBookMetadataWrite(args: Record<string, unknown>) {
    deps.store.assertPublicReadMutationAllowed();
    deps.requireEditorWritesEnabled();
    const { idempotencyKey, ...businessInput } = args;
    return deps.wait(
      deps.queue.enqueueWrite({
        accountId: deps.config.accountId,
        operation: 'update_work_metadata',
        idempotencyKey: String(idempotencyKey),
        inputHash: hash(businessInput),
        run: async (ctx) => {
          const unresolved = deps.store
            .listJobs(deps.config.accountId)
            .find((job) => job.kind === 'write' && job.status === 'uncertain');
          if (unresolved)
            throw new RuntimeError(
              'unresolved_write',
              'Reconcile the prior unknown write before another platform write',
              { jobId: unresolved.id },
            );
          await deps.requireLogin(ctx);
          const accountId = deps.platformAccount();
          const result = await deps.browser.withPage(
            (page) =>
              writes.updateLongBookMetadata(
                page,
                {
                  accountId,
                  target: args.target as writes.LongBookMetadataTarget,
                  expectedContentHash: String(args.expectedContentHash),
                  expectedState: args.expectedState as writes.PlatformState,
                  metadata: args.metadata as writes.DraftMetadata,
                  title: args.title as string | undefined,
                },
                deps.bookWriteOptions(ctx),
              ),
            { signal: ctx.signal },
          );
          if (result.status === 'uncertain')
            throw new RuntimeError(
              'outcome_unknown',
              result.reason ?? 'The platform metadata result is unknown',
              jsonValue(result),
            );
          ctx.saveEvidence('write-result', jsonValue(result));
          return result;
        },
      }),
    );
  }
  return executeBookMetadataWrite;
}
