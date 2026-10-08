import { type Config } from '../config.js';
import { AppError } from '../errors.js';
import { Store, RuntimeError, type GenericShortTrustedContext } from '../runtime/store.js';
import { JobQueue, type JobContext } from '../runtime/jobs.js';
import { BrowserSession } from '../platform/browser.js';
import * as writes from '../platform/writes.js';
import { hash, jsonValue } from './shared.js';
import { type ExecuteWriteOperation, type WriteOptionsOperation } from './contracts/maintenance.js';
import { type RequireLoginOperation } from './contracts/identity.js';
import { type PlatformAccountOperation } from './contracts/capabilities.js';

import {
  type GenericCanonicalResultOperation,
  type AdvanceGenericShortStatusOperation,
  type GenericCaptureOperation,
  type ModernShortProfileOperation,
  type GenericShortRunOperation,
  type GenericBusinessExecutionOperation,
  type RetainGenericShortContextOperation,
} from './contracts/generic-write.js';

import { type WaitOperation } from './contracts/query.js';

interface Dependencies {
  store: Store;
  config: Config;
  queue: JobQueue;
  requireLogin: RequireLoginOperation;
  platformAccount: PlatformAccountOperation;
  browser: BrowserSession;
  writeOptions: WriteOptionsOperation;
  genericCanonicalResult: GenericCanonicalResultOperation;
  genericShortContexts: Map<
    string,
    {
      context: GenericShortTrustedContext;
      witness: Record<string, unknown>;
      sticky: 'capture_failed' | 'persist_failed' | null;
    }
  >;
  advanceGenericShortStatus: AdvanceGenericShortStatusOperation;
  genericCapture: GenericCaptureOperation;
  modernShortProfile: ModernShortProfileOperation;
  genericShortRun: GenericShortRunOperation;
  genericBusinessExecution: GenericBusinessExecutionOperation;
  wait: WaitOperation;
  retainGenericShortContext: RetainGenericShortContextOperation;
}

export function createExecuteWrite(deps: Dependencies): ExecuteWriteOperation {
  function executeWrite(
    operation: string,
    args: Record<string, unknown>,
    kind: 'short' | 'chapter',
    run: (
      page: Parameters<Parameters<BrowserSession['withPage']>[0]>[0],
      ctx: JobContext,
      options: writes.WriteOptions,
      accountId: string,
    ) => Promise<writes.WriteResult>,
  ) {
    deps.store.assertPublicReadMutationAllowed();
    if (!deps.config.writesEnabled)
      throw new AppError(
        'writes_disabled',
        'Platform writes are disabled for this deployment',
        403,
      );
    const { idempotencyKey, ...businessInput } = args;
    const handle = deps.queue.enqueueWrite({
      accountId: deps.config.accountId,
      operation,
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
        if (typeof args.clientReference === 'string')
          ctx.addMetadata({
            clientReferenceHash: hash({ kind, clientReference: args.clientReference }),
          });
        await deps.requireLogin(ctx);
        const accountId = deps.platformAccount();
        const execute = async () => {
          const raw = await deps.browser.withPage(
            (page) => run(page, ctx, deps.writeOptions(ctx, kind), accountId),
            { signal: ctx.signal },
          );
          const result = deps.genericCanonicalResult(ctx, raw);
          if (result.status === 'uncertain')
            throw new RuntimeError(
              'outcome_unknown',
              result.reason ?? 'The platform result is unknown',
              jsonValue(result),
            );
          if (deps.genericShortContexts.has(ctx.jobId))
            deps.advanceGenericShortStatus(ctx, 'completed');
          ctx.saveEvidence(
            'write-result',
            deps.genericShortContexts.has(ctx.jobId)
              ? deps.genericCapture(result)
              : jsonValue(result),
          );
          return result;
        };
        return kind === 'short' &&
          deps.modernShortProfile() &&
          ['create_draft', 'update_draft'].includes(operation)
          ? deps.genericShortRun(ctx, deps.genericBusinessExecution(ctx, operation, args), execute)
          : execute();
      },
    });
    return deps.wait(deps.retainGenericShortContext(handle));
  }
  return executeWrite;
}
