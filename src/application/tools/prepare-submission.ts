import * as submissionRuntime from '../../platform/short-native-submission-runtime.js';
import * as z from 'zod/v4';
import { type Config } from '../../config.js';
import { AppError } from '../../errors.js';
import { Store, RuntimeError } from '../../runtime/store.js';
import { JobQueue } from '../../runtime/jobs.js';
import { BrowserSession } from '../../platform/browser.js';
import * as writes from '../../platform/writes.js';
import { datasets, AccountBinding, hashSchema, versionBase, hash, jsonValue } from '../shared.js';
import {
  type ToolOperation,
  type RequireEditorWritesEnabledOperation,
} from '../contracts/tool-input.js';
import { type WaitOperation } from '../contracts/query.js';
import {
  type NativeBoundAccountOperation,
  type PlatformAccountOperation,
} from '../contracts/capabilities.js';
import { type SubmissionOptionsOperation } from '../contracts/maintenance.js';

import {
  type RequireLoginOperation,
  type ReadAccountPageOperation,
} from '../contracts/identity.js';

interface Dependencies {
  tool: ToolOperation;
  wait: WaitOperation;
  queue: JobQueue;
  config: Config;
  nativeBoundAccount: NativeBoundAccountOperation;
  store: Store;
  browser: BrowserSession;
  submissionOptions: SubmissionOptionsOperation;
  requireEditorWritesEnabled: RequireEditorWritesEnabledOperation;
  requireLogin: RequireLoginOperation;
  readAccountPage: ReadAccountPageOperation;
  platformAccount: PlatformAccountOperation;
  writeProfiles:
    | (Partial<Record<'short' | 'chapter', writes.UiWriteProfile>> & {
        'long-book'?: writes.UiLongBookMetadataProfile;
      })
    | undefined;
  bound: AccountBinding | undefined;
}

export function registerPrepareSubmissionTool(deps: Dependencies): void {
  deps.tool(
    'prepare_submission',
    '原生短故事只读重读当前版本、固定入口源码与发布条款并保存准备记录，写开关关闭仍可用；legacy编辑器准备可能触发自动保存，仍需写开关。',
    z
      .object({
        ...versionBase,
        expectedContentHash: hashSchema.optional(),
        snapshotScope: z.string().optional(),
        hashBasis: z.string().optional(),
        expectedSnapshotVersionHash: hashSchema.optional(),
        useAi: z.union([z.literal(1), z.literal(2)]).optional(),
      })
      .strict(),
    false,
    async (args) => {
      if (args.snapshotScope !== undefined) {
        const business = submissionRuntime.captureNativeShortSubmissionBusinessInput(args);
        return deps.wait(
          deps.queue.enqueueRead({
            accountId: deps.config.accountId,
            operation: submissionRuntime.NATIVE_SHORT_SUBMISSION_READ_OPERATION,
            scope: submissionRuntime.nativeShortSubmissionScope(business.target.workId),
            datasets: [submissionRuntime.NATIVE_SHORT_SUBMISSION_READ_DATASET],
            inputHash: submissionRuntime.nativeShortSubmissionPreparationInputHash(business),
            run: async (ctx) => {
              const owner = deps.nativeBoundAccount();
              if (owner === null)
                throw new RuntimeError(
                  'capability_unavailable',
                  'Native short submission preparation is unavailable',
                );
              return submissionRuntime.runNativeShortSubmissionReadJob(
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
      if (
        !Object.hasOwn(args, 'expectedContentHash') ||
        args.hashBasis !== undefined ||
        args.expectedSnapshotVersionHash !== undefined ||
        args.useAi !== undefined
      )
        throw new AppError(
          'invalid_input',
          'Legacy preparation requires its exact content version',
          400,
        );
      deps.requireEditorWritesEnabled();
      return deps.wait(
        deps.queue.enqueueRead({
          accountId: deps.config.accountId,
          operation: 'prepare_submission',
          scope: 'preparation',
          datasets: ['preparation'],
          inputHash: hash(args),
          run: async (ctx) => {
            await deps.requireLogin(ctx);
            const target = args.target as writes.WriteTarget;
            const prepared = await deps.readAccountPage(ctx, (page) =>
              writes.prepareSubmission(
                page,
                {
                  accountId: deps.platformAccount(),
                  target,
                  expectedContentHash: String(args.expectedContentHash),
                  expectedState: args.expectedState as writes.PlatformState,
                },
                {
                  profile: deps.writeProfiles?.[target.kind],
                  uploadRoot: deps.config.uploadDir,
                  verifyAccount: (page) => deps.browser.verifyCurrentAccount(page),
                  identityType: deps.bound?.platformIdType ?? 'account',
                },
              ),
            );
            return [ctx.saveEvidence('preparation', jsonValue(prepared))];
          },
        }),
      );
    },
  );
}
