import * as trialRuntime from '../platform/short-native-trial-runtime.js';
import { type NativeShortProvenance } from '../platform/short-native-metadata-proof.js';
import { type Config } from '../config.js';
import { AppError } from '../errors.js';
import { Store, RuntimeError } from '../runtime/store.js';
import { JobQueue } from '../runtime/jobs.js';
import { BrowserSession, type LoginState } from '../platform/browser.js';
import { type ExecuteNativeShortTrialWriteOperation } from './contracts/maintenance.js';
import { type WaitOperation } from './contracts/query.js';
import { type NativeBoundAccountOperation } from './contracts/capabilities.js';
import { type BindIdentityOperation } from './contracts/identity.js';
interface Dependencies {
  store: Store;
  config: Config;
  wait: WaitOperation;
  queue: JobQueue;
  nativeBoundAccount: NativeBoundAccountOperation;
  browser: BrowserSession;
  nativeProvenance: NativeShortProvenance;
  bindIdentity: BindIdentityOperation;
  login: LoginState | null;
}

export function createExecuteNativeShortTrialWrite(
  deps: Dependencies,
): ExecuteNativeShortTrialWriteOperation {
  function executeNativeShortTrialWrite(
    business: trialRuntime.NativeShortTrialBusinessInput,
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
        operation: trialRuntime.NATIVE_SHORT_TRIAL_OPERATION,
        scope: trialRuntime.nativeShortTrialScope(business.target.workId),
        idempotencyKey,
        inputHash: trialRuntime.nativeShortTrialBusinessInputHash(business),
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
          const expectedPlatformAccount = deps.nativeBoundAccount();
          if (expectedPlatformAccount === null)
            throw new RuntimeError('capability_unavailable', 'Native short trial is unavailable');
          return trialRuntime.runNativeShortTrialJob(deps.store, deps.browser, ctx, business, {
            timeoutMs: deps.config.timeoutMs,
            expectedPlatformAccount,
            provenance: deps.nativeProvenance,
            currentPlatformAccount: deps.nativeBoundAccount,
            onVerifiedAccount: (accountId, checkedAt) => {
              const state: LoginState = {
                status: 'authenticated',
                identity: {
                  accountId,
                  authorId: null,
                  displayName: null,
                  evidenceSource: 'https://fanqienovel.com/api/user/info/v2',
                },
                sourceUrl: 'https://fanqienovel.com/api/user/info/v2',
                checkedAt,
              };
              deps.bindIdentity(state);
              deps.login = state;
            },
          });
        },
      }),
    );
  }
  return executeNativeShortTrialWrite;
}
