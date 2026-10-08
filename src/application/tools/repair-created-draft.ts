import * as z from 'zod/v4';
import { contentSchema, hashSchema, writeBase } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type RepairCreatedDraftOperation } from '../contracts/creation-recovery.js';
interface Dependencies {
  tool: ToolOperation;
  repairCreatedDraft: RepairCreatedDraftOperation;
}

export function registerRepairCreatedDraftTool(deps: Dependencies): void {
  deps.tool(
    'repair_created_draft',
    '按实时完整版本修复已分配草稿的未知保存；只更新同一目标，旧键不回放，成功证据保留早期失败。',
    z
      .object({
        ...writeBase,
        originalJobId: z.string().uuid(),
        recoveryJobId: z.string().uuid(),
        clientReference: z.string().min(1).max(128),
        content: contentSchema,
        expectedContentHash: hashSchema,
        expectedState: z.literal('draft'),
        previousRepairJobId: z.string().uuid().optional(),
      })
      .strict(),
    false,
    deps.repairCreatedDraft,
  );
}
