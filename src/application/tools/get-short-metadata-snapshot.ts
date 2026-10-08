import * as trialRuntime from '../../platform/short-native-trial-runtime.js';
import { type NativeShortProvenance } from '../../platform/short-native-metadata-proof.js';
import * as z from 'zod/v4';
import { type Config } from '../../config.js';
import { AppError } from '../../errors.js';
import { Store, RuntimeError } from '../../runtime/store.js';
import { JobQueue } from '../../runtime/jobs.js';
import { BrowserSession, type LoginState } from '../../platform/browser.js';
import { datasets } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type NativeBoundAccountOperation } from '../contracts/capabilities.js';
import { type BindIdentityOperation } from '../contracts/identity.js';
import {
  type CompletedOperation,
  type EnqueueNativeShortMetadataReadOperation,
} from '../contracts/query.js';

interface Dependencies {
  tool: ToolOperation;
  queue: JobQueue;
  config: Config;
  nativeBoundAccount: NativeBoundAccountOperation;
  store: Store;
  browser: BrowserSession;
  nativeProvenance: NativeShortProvenance;
  bindIdentity: BindIdentityOperation;
  login: LoginState | null;
  completed: CompletedOperation;
  enqueueNativeShortMetadataRead: EnqueueNativeShortMetadataReadOperation;
}

export function registerGetShortMetadataSnapshotTool(deps: Dependencies): void {
  deps.tool(
    'get_short_metadata_snapshot',
    'API-only读取本人短故事草稿的原生标题、分类与版本；可选short-native-trial/v1返回无正文试读边界摘要；不导航、不写入，完整私有原件仅供后续维护校验。',
    z
      .object({
        workId: z.string().regex(/^[1-9][0-9]{9,21}$/),
        snapshotScope: z.string().optional(),
      })
      .strict(),
    true,
    async (args) => {
      const workId = String(args.workId);
      if (Object.hasOwn(args, 'snapshotScope')) {
        if (args.snapshotScope !== 'short-native-trial/v1')
          throw new AppError('invalid_input', 'Unsupported native short snapshot scope', 400);
        const handle = deps.queue.enqueueRead({
          accountId: deps.config.accountId,
          operation: trialRuntime.NATIVE_SHORT_TRIAL_READ_OPERATION,
          scope: trialRuntime.nativeShortTrialScope(workId),
          datasets: [trialRuntime.NATIVE_SHORT_TRIAL_READ_DATASET],
          inputHash: trialRuntime.nativeShortTrialReadInputHash(workId),
          run: (ctx) => {
            const expectedPlatformAccount = deps.nativeBoundAccount();
            if (expectedPlatformAccount === null)
              throw new RuntimeError('capability_unavailable', 'Native short trial is unavailable');
            return trialRuntime.runNativeShortTrialReadJob(deps.store, deps.browser, ctx, workId, {
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
        });
        return deps.completed(await handle.completion, 'live');
      }
      const handle = deps.enqueueNativeShortMetadataRead(workId);
      return deps.completed(await handle.completion, 'live');
    },
  );
}
