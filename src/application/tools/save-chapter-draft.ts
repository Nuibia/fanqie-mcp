import * as z from 'zod/v4';
import * as writes from '../../platform/writes.js';
import { contentSchema, stateSchema, hashSchema, writeBase } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type ExecuteWriteOperation } from '../contracts/maintenance.js';
interface Dependencies {
  tool: ToolOperation;
  executeWrite: ExecuteWriteOperation;
}

export function registerSaveChapterDraftTool(deps: Dependencies): void {
  deps.tool(
    'save_chapter_draft',
    '新建或保存长篇章节草稿，持久去重并重新打开核对正文。',
    z
      .object({
        ...writeBase,
        workId: z.string().regex(/^\d{10,22}$/),
        chapterId: z
          .string()
          .regex(/^\d{10,22}$/)
          .optional(),
        clientReference: z.string().optional(),
        expectedContentHash: hashSchema.optional(),
        expectedState: stateSchema.optional(),
        content: contentSchema,
      })
      .strict(),
    false,
    async (args) =>
      deps.executeWrite('save_chapter_draft', args, 'chapter', (page, _ctx, options, accountId) =>
        writes.saveChapterDraft(
          page,
          { ...args, accountId } as unknown as writes.SaveChapterInput,
          options,
        ),
      ),
  );
}
