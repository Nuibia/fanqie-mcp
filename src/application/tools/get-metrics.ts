import * as z from 'zod/v4';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type WaitOperation, type RefreshOperation } from '../contracts/query.js';

interface Dependencies {
  tool: ToolOperation;
  wait: WaitOperation;
  refresh: RefreshOperation;
}

export function registerGetMetricsTool(deps: Dependencies): void {
  deps.tool(
    'get_metrics',
    '本次真实读取经营数据；保留页面截止日期、窗口与未知字段，不推算昨天。',
    z
      .object({
        kind: z.enum(['short', 'long']).default('short'),
        workId: z
          .string()
          .regex(/^\d{1,30}$/)
          .optional(),
      })
      .strict(),
    true,
    async (args) => {
      const dataset = args.kind === 'long' ? 'long_metrics' : 'short_metrics';
      return deps.wait(
        deps.refresh([dataset], dataset, { workId: args.workId as string | undefined }),
      );
    },
  );
}
