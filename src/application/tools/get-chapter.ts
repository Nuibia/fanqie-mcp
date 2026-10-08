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

export function registerGetChapterTool(deps: Dependencies): void {
  deps.tool(
    'get_chapter',
    '只读本轮管理目录中唯一既有章节的当前作者编辑版本原文；不打开编辑页、不保存，不声称已发布版本正文。',
    z
      .object({
        workId: z.string().regex(/^[1-9]\d{9,29}$/),
        chapterId: z.string().regex(/^[1-9]\d{9,29}$/),
      })
      .strict(),
    true,
    async (args) =>
      deps.wait(
        deps.queue.enqueueRead({
          accountId: deps.config.accountId,
          operation: 'get_chapter',
          scope: `chapter_body.${args.workId}.${args.chapterId}`,
          datasets: ['chapter_body'],
          inputHash: hash(args),
          run: async (ctx) => {
            await deps.requireLogin(ctx);
            if (!deps.bound)
              throw new RuntimeError(
                'capability_unavailable',
                'A fixed own-account binding is required for chapter body reads',
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
                  deps.browser.collectCurrentChapterBody(
                    page,
                    String(args.workId),
                    String(args.chapterId),
                    {
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
                            'The chapter body read did not prove its fixed typed account',
                          );
                        deps.login = state;
                        deps.bindIdentity(state);
                        ownerObserved = true;
                      },
                    },
                  ),
                { signal: ctx.signal },
              );
            } catch (error) {
              if (error instanceof RuntimeError || error instanceof AppError) throw error;
              throw new RuntimeError(
                'capability_unavailable',
                'The service-owned chapter body read did not complete',
              );
            }
            if ((result.status === 'success' || result.status === 'partial') && !ownerObserved)
              throw new RuntimeError(
                'capability_unavailable',
                'The chapter body read did not establish a fresh bound identity',
              );
            const ref = ctx.saveEvidence(
              'chapter_body',
              jsonValue({ ...result, source: { mode: 'live', origin: 'https://fanqienovel.com' } }),
            );
            if (
              result.status !== 'success' ||
              !result.coverage.complete ||
              !result.coverage.paginationComplete
            )
              throw new RuntimeError(
                'capability_unavailable',
                'The single author-edit response was not verified',
                { errors: result.errors },
              );
            return [ref];
          },
        }),
      ),
  );
}
