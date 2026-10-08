import * as z from 'zod/v4';
import * as writes from '../../platform/writes.js';
import { contentSchema, writeBase, versionBase } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type ExecuteWriteOperation } from '../contracts/maintenance.js';
interface Dependencies {
  tool: ToolOperation;
  executeWrite: ExecuteWriteOperation;
}

export function registerUpdateDraftTool(deps: Dependencies): void {
  deps.tool(
    'update_draft',
    '按稳定草稿ID和前置内容hash保存并回读，冲突拒绝覆盖。',
    z.object({ ...writeBase, ...versionBase, content: contentSchema }).strict(),
    false,
    async (args) =>
      deps.executeWrite(
        'update_draft',
        args,
        (args.target as writes.WriteTarget).kind,
        (page, _ctx, options, accountId) =>
          writes.updateDraft(
            page,
            {
              accountId,
              target: args.target as writes.WriteTarget,
              expectedContentHash: String(args.expectedContentHash),
              expectedState: args.expectedState as writes.PlatformState,
              content: args.content as writes.DraftContent,
            },
            options,
          ),
      ),
  );
}
