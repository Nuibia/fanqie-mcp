import * as z from 'zod/v4';
import { type Config } from '../../config.js';
import { AppError } from '../../errors.js';
import { JobQueue } from '../../runtime/jobs.js';
import { BrowserSession } from '../../platform/browser.js';
import { datasets, hash, jsonValue } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type WaitOperation } from '../contracts/query.js';
import { type RequireLoginOperation } from '../contracts/identity.js';
interface Dependencies {
  tool: ToolOperation;
  wait: WaitOperation;
  queue: JobQueue;
  config: Config;
  requireLogin: RequireLoginOperation;
  browser: BrowserSession;
}

export function registerDiagnoseReadPageTool(deps: Dependencies): void {
  deps.tool(
    'diagnose_read_page',
    '只读检查实际管理/数据页结构与已加载GET路径；可从已核验可见作品的章节管理按钮进入目录，不访问新建/编辑/提交路由；chapterVolumeOptions仅展开已核验管理页的唯一既有卷选择控件，不选择卷或翻页；chapterVolumeContext是已登记目录上的独立context GET字段类型实验，不证明目录覆盖。',
    z
      .object({
        sourceUrl: z.string().min(1).max(2000),
        openChaptersForWorkId: z
          .string()
          .regex(/^[1-9]\d{9,29}$/)
          .optional(),
        chapterTab: z.enum(['drafts']).optional(),
        chapterVolumeContext: z.literal(true).optional(),
        chapterVolumeOptions: z.literal(true).optional(),
      })
      .strict(),
    true,
    async (args) => {
      if (
        args.chapterVolumeOptions === true &&
        (typeof args.openChaptersForWorkId !== 'string' ||
          args.chapterTab !== undefined ||
          args.chapterVolumeContext !== undefined)
      )
        throw new AppError(
          'invalid_input',
          'Volume options require only the verified current-work management entry',
        );
      return deps.wait(
        deps.queue.enqueueRead({
          accountId: deps.config.accountId,
          operation: 'diagnose_read_page',
          scope: 'page_diagnostic',
          datasets: ['page_diagnostic'],
          inputHash: hash(args),
          run: async (ctx) => {
            await deps.requireLogin(ctx);
            const result = await deps.browser.diagnoseReadPage(String(args.sourceUrl), {
              signal: ctx.signal,
              maxElements: 300,
              maxResponses: 100,
              ...(typeof args.openChaptersForWorkId === 'string'
                ? { openChaptersForWorkId: args.openChaptersForWorkId }
                : {}),
              ...(args.chapterTab === 'drafts' ? { chapterTab: args.chapterTab } : {}),
              ...(args.chapterVolumeContext === true ? { chapterVolumeContext: true } : {}),
              ...(args.chapterVolumeOptions === true ? { chapterVolumeOptions: true } : {}),
            });
            return [ctx.saveEvidence('page_diagnostic', jsonValue(result))];
          },
        }),
      );
    },
  );
}
