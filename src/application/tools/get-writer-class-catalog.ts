import * as z from 'zod/v4';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type WaitOperation, type RefreshOperation } from '../contracts/query.js';

interface Dependencies {
  tool: ToolOperation;
  wait: WaitOperation;
  refresh: RefreshOperation;
}

export function registerGetWriterClassCatalogTool(deps: Dependencies): void {
  deps.tool(
    'get_writer_class_catalog',
    '实时读取番茄作家课堂目录并持久化本次证据；分类1新手、2专访、3技巧、4品类、5宝典。',
    z.object({ category: z.enum(['1', '2', '3', '4', '5']).optional() }).strict(),
    true,
    async (args) =>
      deps.wait(
        deps.refresh(['writer_classes'], 'writer_classes', {
          category: args.category as string | undefined,
        }),
      ),
  );
}
