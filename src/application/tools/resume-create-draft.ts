import * as z from 'zod/v4';
import { contentSchema, writeBase } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type ResumeCreateDraftOperation } from '../contracts/creation-recovery.js';
interface Dependencies {
  tool: ToolOperation;
  resumeCreateDraft: ResumeCreateDraftOperation;
}

export function registerResumeCreateDraftTool(deps: Dependencies): void {
  deps.tool(
    'resume_create_draft',
    '恢复已分配稳定ID但尚未填入内容的短故事创建；只继续同一空白原生草稿，原请求/恢复幂等键严格绑定，不再次新建，未知保存先对账。',
    z
      .object({
        ...writeBase,
        originalJobId: z.string().uuid(),
        clientReference: z.string().min(1).max(128),
        content: contentSchema,
      })
      .strict(),
    false,
    deps.resumeCreateDraft,
  );
}
