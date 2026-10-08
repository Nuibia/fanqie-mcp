import * as z from 'zod/v4';
import { record } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type WaitOperation, type RefreshOperation } from '../contracts/query.js';

interface Dependencies {
  tool: ToolOperation;
  wait: WaitOperation;
  refresh: RefreshOperation;
}

export function registerGetWorkDetailTool(deps: Dependencies): void {
  deps.tool(
    'get_work_detail',
    '从本次真实作品清单查询稳定ID；不按同名作品合并。',
    z
      .object({
        kind: z.enum(['short', 'long']).default('short'),
        workId: z.string().regex(/^\d{10,30}$/),
      })
      .strict(),
    true,
    async (args) => {
      const dataset = args.kind === 'long' ? 'long_works' : 'short_works';
      const result = await deps.wait(deps.refresh([dataset], dataset));
      return {
        ...result,
        works: result.data
          .flatMap((data) => {
            const records = record(data).records;
            return Array.isArray(records) ? records : [];
          })
          .filter((item) => String(record(item).workId ?? record(item).id) === args.workId),
      };
    },
  );
}
