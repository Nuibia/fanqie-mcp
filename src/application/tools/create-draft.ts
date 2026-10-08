import * as z from 'zod/v4';
import * as writes from '../../platform/writes.js';
import { contentSchema, writeBase } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type ExecuteWriteOperation } from '../contracts/maintenance.js';
interface Dependencies {
  tool: ToolOperation;
  executeWrite: ExecuteWriteOperation;
}

export function registerCreateDraftTool(deps: Dependencies): void {
  deps.tool(
    'create_draft',
    '创建短故事草稿并回读核对；同幂等键不重复新建，0字自动草稿也记账。',
    z
      .object({ ...writeBase, clientReference: z.string().min(1).max(128), content: contentSchema })
      .strict(),
    false,
    async (args) =>
      deps.executeWrite('create_draft', args, 'short', (page, _ctx, options, accountId) =>
        writes.createDraft(
          page,
          {
            accountId,
            clientReference: String(args.clientReference),
            content: args.content as writes.DraftContent,
          },
          options,
        ),
      ),
  );
}
