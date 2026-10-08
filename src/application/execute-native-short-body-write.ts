import * as bodyRuntime from '../platform/short-native-body-runtime.js';
import * as bodyModel from '../platform/short-native-body.js';
import { type Config } from '../config.js';
import { AppError } from '../errors.js';
import { Store, RuntimeError } from '../runtime/store.js';
import { JobQueue } from '../runtime/jobs.js';
import { BrowserSession, type LoginState } from '../platform/browser.js';
import { type ExecuteNativeShortBodyWriteOperation } from './contracts/maintenance.js';
import { type WaitOperation } from './contracts/query.js';
import { type NativeBoundAccountOperation } from './contracts/capabilities.js';
import { type BindIdentityOperation } from './contracts/identity.js';
interface Dependencies {
  store: Store;
  config: Config;
  bodyExecutorEligible: boolean;
  wait: WaitOperation;
  queue: JobQueue;
  browser: BrowserSession;
  nativeBoundAccount: NativeBoundAccountOperation;
  bindIdentity: BindIdentityOperation;
  login: LoginState | null;
}

export function createExecuteNativeShortBodyWrite(
  deps: Dependencies,
): ExecuteNativeShortBodyWriteOperation {
  function executeNativeShortBodyWrite(
    business: bodyModel.NativeShortBodyBusinessInput,
    idempotencyKey: string,
  ) {
    deps.store.assertPublicReadMutationAllowed();
    if (!deps.config.writesEnabled)
      throw new AppError(
        'writes_disabled',
        'Platform writes are disabled for this deployment',
        403,
      );
    if (!deps.bodyExecutorEligible)
      throw new AppError('capability_unavailable', 'Native short body is unavailable.', 409);
    return deps.wait(
      deps.queue.enqueueWrite({
        accountId: deps.config.accountId,
        operation: bodyRuntime.NATIVE_SHORT_BODY_OPERATION,
        scope: bodyRuntime.nativeShortBodyScope(business.target.workId),
        idempotencyKey,
        inputHash: bodyModel.nativeShortBodyBusinessInputHash(deps.config.accountId, business),
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
          return bodyRuntime.runNativeShortBodyJob(deps.store, deps.browser, ctx, business, {
            timeoutMs: deps.config.timeoutMs,
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
  return executeNativeShortBodyWrite;
}
