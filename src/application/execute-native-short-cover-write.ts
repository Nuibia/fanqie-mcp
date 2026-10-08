import * as coverRuntime from '../platform/short-native-cover-runtime.js';
import { type NativeShortProvenance } from '../platform/short-native-metadata-proof.js';
import { type Config } from '../config.js';
import { AppError } from '../errors.js';
import { Store, RuntimeError } from '../runtime/store.js';
import { JobQueue } from '../runtime/jobs.js';
import { BrowserSession, type LoginState } from '../platform/browser.js';
import { type ExecuteNativeShortCoverWriteOperation } from './contracts/maintenance.js';
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

export function createExecuteNativeShortCoverWrite(
  deps: Dependencies,
): ExecuteNativeShortCoverWriteOperation {
  function executeNativeShortCoverWrite(
    business: coverRuntime.NativeShortCoverBusinessInput,
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
        operation: coverRuntime.NATIVE_SHORT_COVER_OPERATION,
        scope: coverRuntime.nativeShortCoverScope(business.target.workId),
        idempotencyKey,
        inputHash: coverRuntime.nativeShortCoverBusinessInputHash(business),
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
            throw new RuntimeError('capability_unavailable', 'Native short cover is unavailable');
          return coverRuntime.runNativeShortCoverJob(deps.store, deps.browser, ctx, business, {
            uploadDir: deps.config.uploadDir,
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
  return executeNativeShortCoverWrite;
}
