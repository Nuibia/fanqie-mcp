import * as submissionRuntime from '../platform/short-native-submission-runtime.js';
import { type Config } from '../config.js';
import { AppError } from '../errors.js';
import { Store, RuntimeError } from '../runtime/store.js';
import { JobQueue } from '../runtime/jobs.js';
import { BrowserSession } from '../platform/browser.js';
import {
  type ExecuteNativeShortSubmissionWriteOperation,
  type SubmissionOptionsOperation,
} from './contracts/maintenance.js';
import { type WaitOperation } from './contracts/query.js';
import { type NativeBoundAccountOperation } from './contracts/capabilities.js';

interface Dependencies {
  store: Store;
  config: Config;
  wait: WaitOperation;
  queue: JobQueue;
  nativeBoundAccount: NativeBoundAccountOperation;
  browser: BrowserSession;
  submissionOptions: SubmissionOptionsOperation;
}

export function createExecuteNativeShortSubmissionWrite(
  deps: Dependencies,
): ExecuteNativeShortSubmissionWriteOperation {
  function executeNativeShortSubmissionWrite(
    business: submissionRuntime.NativeShortSubmissionBusinessInput,
    idempotencyKey: string,
  ) {
    deps.store.assertPublicReadMutationAllowed();
    if (!deps.config.writesEnabled)
      throw new AppError(
        'writes_disabled',
        'Platform writes are disabled for this deployment',
        403,
      );
    return deps.wait(
      deps.queue.enqueueWrite({
        accountId: deps.config.accountId,
        operation: submissionRuntime.NATIVE_SHORT_SUBMISSION_OPERATION,
        scope: submissionRuntime.nativeShortSubmissionScope(business.target.workId),
        idempotencyKey,
        inputHash: submissionRuntime.nativeShortSubmissionBusinessInputHash(business),
        run: async (ctx) => {
          if (
            deps.store
              .listJobs(deps.config.accountId)
              .some((job) => job.kind === 'write' && job.status === 'uncertain')
          )
            throw new RuntimeError(
              'unresolved_write',
              'Reconcile the prior unknown write before another platform write',
            );
          const owner = deps.nativeBoundAccount();
          if (owner === null)
            throw new RuntimeError(
              'capability_unavailable',
              'Native short submission is unavailable',
            );
          return submissionRuntime.runNativeShortSubmissionJob(
            deps.store,
            deps.browser,
            ctx,
            business,
            deps.submissionOptions(owner),
          );
        },
      }),
    );
  }
  return executeNativeShortSubmissionWrite;
}
