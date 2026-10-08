import * as z from 'zod/v4';
import { type Config } from '../../config.js';
import { AppError } from '../../errors.js';
import { RuntimeError } from '../../runtime/store.js';
import { JobQueue } from '../../runtime/jobs.js';
import { BrowserSession, type LoginState } from '../../platform/browser.js';
import { type DatasetResult } from '../../platform/reads.js';
import { datasets, AccountBinding, hash, jsonValue } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type WaitOperation } from '../contracts/query.js';
import { type RequireLoginOperation, type BindIdentityOperation } from '../contracts/identity.js';

interface Dependencies {
  tool: ToolOperation;
  wait: WaitOperation;
  queue: JobQueue;
  config: Config;
  requireLogin: RequireLoginOperation;
  bound: AccountBinding | undefined;
  browser: BrowserSession;
  login: LoginState | null;
  bindIdentity: BindIdentityOperation;
}

export function registerListChapterDraftsTool(deps: Dependencies): void {
  deps.tool(
    'list_chapter_drafts',
    '本次只读既有长篇草稿箱目录，完整分页仅推进该作品草稿目录范围；不读取正文或编辑控件。',
    z.object({ workId: z.string().regex(/^\d{10,30}$/) }).strict(),
    true,
    async (args) =>
      deps.wait(
        deps.queue.enqueueRead({
          accountId: deps.config.accountId,
          operation: 'list_chapter_drafts',
          scope: `chapter_drafts.${args.workId}`,
          datasets: ['chapter_drafts'],
          inputHash: hash(args),
          run: async (ctx) => {
            await deps.requireLogin(ctx);
            if (!deps.bound)
              throw new RuntimeError(
                'capability_unavailable',
                'A fixed own-account binding is required for draft-directory reads',
              );
            const expectedOwner = {
              kind: deps.bound.platformIdType ?? 'account',
              id: deps.bound.platformId,
            };
            let ownerObserved = false;
            let result: DatasetResult<unknown>;
            try {
              result = await deps.browser.withPage(
                (page) =>
                  deps.browser.collectCurrentChapterDraftDirectory(page, String(args.workId), {
                    jobId: ctx.jobId,
                    signal: ctx.signal,
                    expectedOwner,
                    onVerifiedOwner: (state) => {
                      if (
                        ctx.signal.aborted ||
                        expectedOwner.kind !== 'account' ||
                        state.status !== 'authenticated' ||
                        state.identity?.accountId !== expectedOwner.id
                      )
                        throw new RuntimeError(
                          'capability_unavailable',
                          'The draft-directory read did not prove its fixed typed account',
                        );
                      deps.login = state;
                      deps.bindIdentity(state);
                      ownerObserved = true;
                    },
                  }),
                { signal: ctx.signal },
              );
            } catch (error) {
              if (error instanceof RuntimeError || error instanceof AppError) throw error;
              throw new RuntimeError(
                'capability_unavailable',
                'The service-owned draft-directory read did not complete',
              );
            }
            if ((result.status === 'success' || result.status === 'partial') && !ownerObserved)
              throw new RuntimeError(
                'capability_unavailable',
                'The draft-directory read did not establish a fresh bound identity',
              );
            const ref = ctx.saveEvidence(
              'chapter_drafts',
              jsonValue({ ...result, source: { mode: 'live', origin: 'https://fanqienovel.com' } }),
            );
            if (
              result.status !== 'success' ||
              !result.coverage.complete ||
              !result.coverage.paginationComplete
            )
              throw new RuntimeError(
                'capability_unavailable',
                'Draft-directory coverage was not verified',
                { errors: result.errors },
              );
            return [ref];
          },
        }),
      ),
  );
}
