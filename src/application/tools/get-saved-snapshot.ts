import * as z from 'zod/v4';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type SnapshotOperation } from '../contracts/query.js';
interface Dependencies {
  tool: ToolOperation;
  snapshot: SnapshotOperation;
}

export function registerGetSavedSnapshotTool(deps: Dependencies): void {
  deps.tool(
    'get_saved_snapshot',
    '只读取历史保存的数据，明确sourceMode=saved，不联网也不刷新采集时间。',
    z
      .object({
        scope: z
          .string()
          .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/)
          .default('account'),
      })
      .strict(),
    true,
    async (args) => deps.snapshot(String(args.scope)),
  );
}
