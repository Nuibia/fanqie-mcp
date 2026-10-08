import * as z from 'zod/v4';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type WaitOperation, type RefreshOperation } from '../contracts/query.js';

interface Dependencies {
  tool: ToolOperation;
  wait: WaitOperation;
  refresh: RefreshOperation;
}

export function registerListWorksTool(deps: Dependencies): void {
  deps.tool(
    'list_works',
    '本次真实读取短故事或长篇全分页作品清单并保存；不重读旧文件冒充最新。',
    z.object({ kind: z.enum(['short', 'long']).default('short') }).strict(),
    true,
    async (args) => {
      const dataset = args.kind === 'long' ? 'long_works' : 'short_works';
      return deps.wait(deps.refresh([dataset], dataset));
    },
  );
}
