import * as z from 'zod/v4';
import { type Config } from '../../config.js';
import { RuntimeError } from '../../runtime/store.js';
import { JobQueue } from '../../runtime/jobs.js';
import { collectWriterArticle } from '../../platform/public.js';
import { datasets, hash, jsonValue } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type WaitOperation } from '../contracts/query.js';
interface Dependencies {
  tool: ToolOperation;
  wait: WaitOperation;
  queue: JobQueue;
  config: Config;
}

export function registerGetWriterArticleTool(deps: Dependencies): void {
  deps.tool(
    'get_writer_article',
    '实时读取官方课堂文章，返回原文与发布日期；不会修改创作护栏。',
    z.object({ articleId: z.string().regex(/^\d{15,30}$/) }).strict(),
    true,
    async (args) =>
      deps.wait(
        deps.queue.enqueueRead({
          accountId: deps.config.accountId,
          operation: 'writer_article',
          scope: `writer_article.${args.articleId}`,
          datasets: ['writer_article'],
          inputHash: hash(args),
          run: async (ctx) => {
            ctx.beforePlatformRead();
            const result = await collectWriterArticle(String(args.articleId), {
              signal: ctx.signal,
            });
            const ref = ctx.saveEvidence(
              'writer_article',
              jsonValue({ ...result, source: { mode: 'live', origin: 'https://fanqienovel.com' } }),
            );
            if (result.status !== 'success')
              throw new RuntimeError('invalid_evidence', 'Article could not be read completely');
            return [ref];
          },
        }),
      ),
  );
}
