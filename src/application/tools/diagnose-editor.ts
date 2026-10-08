import * as z from 'zod/v4';
import { type Config } from '../../config.js';
import { JobQueue } from '../../runtime/jobs.js';
import { BrowserSession } from '../../platform/browser.js';
import * as writes from '../../platform/writes.js';
import { datasets, AccountBinding, targetSchema, hash, jsonValue } from '../shared.js';
import {
  type ToolOperation,
  type RequireEditorWritesEnabledOperation,
} from '../contracts/tool-input.js';

import { type WaitOperation } from '../contracts/query.js';
import {
  type RequireLoginOperation,
  type ReadAccountPageOperation,
} from '../contracts/identity.js';

interface Dependencies {
  tool: ToolOperation;
  requireEditorWritesEnabled: RequireEditorWritesEnabledOperation;
  wait: WaitOperation;
  queue: JobQueue;
  config: Config;
  requireLogin: RequireLoginOperation;
  readAccountPage: ReadAccountPageOperation;
  bound: AccountBinding | undefined;
  writeProfiles:
    | (Partial<Record<'short' | 'chapter', writes.UiWriteProfile>> & {
        'long-book'?: writes.UiLongBookMetadataProfile;
      })
    | undefined;
  browser: BrowserSession;
}

export function registerDiagnoseEditorTool(deps: Dependencies): void {
  deps.tool(
    'diagnose_editor',
    '检查既有草稿/章节编辑器的字段结构、正文长度与hash；加载编辑器可能通过HTTP/WebSocket自动保存，仅启用写开关时可用。',
    z
      .object({
        target: targetSchema,
        editorUrl: z.string().url().optional(),
        routeEvidenceRef: z.string().optional(),
      })
      .strict(),
    false,
    async (args) => {
      deps.requireEditorWritesEnabled();
      return deps.wait(
        deps.queue.enqueueRead({
          accountId: deps.config.accountId,
          operation: 'diagnose_editor',
          scope: 'editor_diagnostic',
          datasets: ['editor_diagnostic'],
          inputHash: hash(args),
          run: async (ctx) => {
            await deps.requireLogin(ctx);
            const target = args.target as writes.WriteTarget;
            const result = await deps.readAccountPage(ctx, (page) =>
              writes.diagnoseEditor(
                page,
                {
                  target,
                  accountId: deps.bound?.platformId,
                  editorUrl: args.editorUrl as string | undefined,
                  routeEvidenceRef: args.routeEvidenceRef as string | undefined,
                },
                {
                  profile: deps.writeProfiles?.[target.kind],
                  verifyAccount: (page) => deps.browser.verifyCurrentAccount(page),
                  identityType: deps.bound?.platformIdType ?? 'account',
                },
              ),
            );
            return [ctx.saveEvidence('editor_diagnostic', jsonValue(result))];
          },
        }),
      );
    },
  );
}
