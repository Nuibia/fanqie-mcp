import * as z from 'zod/v4';
import { type Config } from '../../config.js';
import { Store, type GenericShortTrustedContext } from '../../runtime/store.js';
import { JobQueue } from '../../runtime/jobs.js';
import { BrowserSession } from '../../platform/browser.js';
import * as writes from '../../platform/writes.js';
import { datasets, AccountBinding, metadataTargetSchema, hash, jsonValue } from '../shared.js';
import {
  type ToolOperation,
  type RequireEditorWritesEnabledOperation,
} from '../contracts/tool-input.js';

import { type WaitOperation } from '../contracts/query.js';
import {
  type RequireLoginOperation,
  type ReadAccountPageOperation,
} from '../contracts/identity.js';

import { type PlatformAccountOperation } from '../contracts/capabilities.js';
import {
  type BookWriteOptionsOperation,
  type RuntimeTargetOperation,
} from '../contracts/maintenance.js';
import {
  type RetainGenericShortContextOperation,
  type PersistGenericShortObservationOperation,
  type AdvanceGenericShortStatusOperation,
  type ModernShortProfileOperation,
  type GenericShortRunOperation,
} from '../contracts/generic-write.js';

interface Dependencies {
  tool: ToolOperation;
  requireEditorWritesEnabled: RequireEditorWritesEnabledOperation;
  wait: WaitOperation;
  queue: JobQueue;
  config: Config;
  requireLogin: RequireLoginOperation;
  readAccountPage: ReadAccountPageOperation;
  platformAccount: PlatformAccountOperation;
  bookWriteOptions: BookWriteOptionsOperation;
  retainGenericShortContext: RetainGenericShortContextOperation;
  writeProfiles:
    | (Partial<Record<'short' | 'chapter', writes.UiWriteProfile>> & {
        'long-book'?: writes.UiLongBookMetadataProfile;
      })
    | undefined;
  browser: BrowserSession;
  bound: AccountBinding | undefined;
  genericShortContexts: Map<
    string,
    {
      context: GenericShortTrustedContext;
      witness: Record<string, unknown>;
      sticky: 'capture_failed' | 'persist_failed' | null;
    }
  >;
  persistGenericShortObservation: PersistGenericShortObservationOperation;
  advanceGenericShortStatus: AdvanceGenericShortStatusOperation;
  modernShortProfile: ModernShortProfileOperation;
  genericShortRun: GenericShortRunOperation;
  runtimeTarget: RuntimeTargetOperation;
  store: Store;
}

export function registerGetEditableSnapshotTool(deps: Dependencies): void {
  deps.tool(
    'get_editable_snapshot',
    '回读既有短篇/章节编辑器，或已核验长篇作品信息页的独立metadataHash；页面可能自动保存，仅启用写开关时可用，长篇快照不含正文。',
    z.object({ target: metadataTargetSchema }).strict(),
    false,
    async (args) => {
      deps.requireEditorWritesEnabled();
      if ((args.target as writes.LongBookMetadataTarget).kind === 'long-book')
        return deps.wait(
          deps.queue.enqueueRead({
            accountId: deps.config.accountId,
            operation: 'long_book_metadata_snapshot',
            scope: `long_book_metadata.${(args.target as writes.LongBookMetadataTarget).workId}`,
            datasets: ['long_book_metadata'],
            inputHash: hash(args),
            run: async (ctx) => {
              await deps.requireLogin(ctx);
              const result = await deps.readAccountPage(ctx, (page) =>
                writes.readLongBookMetadataSnapshot(
                  page,
                  deps.platformAccount(),
                  args.target as writes.LongBookMetadataTarget,
                  deps.bookWriteOptions(ctx),
                ),
              );
              return [
                ctx.saveEvidence(
                  'long_book_metadata',
                  jsonValue({
                    ...result,
                    source: { mode: 'live', origin: 'https://fanqienovel.com' },
                  }),
                ),
              ];
            },
          }),
        );
      return deps.wait(
        deps.retainGenericShortContext(
          deps.queue.enqueueRead({
            accountId: deps.config.accountId,
            operation: 'editable_snapshot',
            scope: 'editable_snapshot',
            datasets: ['editable_snapshot'],
            inputHash: hash(args),
            run: async (ctx) => {
              await deps.requireLogin(ctx);
              const target = args.target as writes.WriteTarget;
              const execute = async () => {
                const result = await deps.readAccountPage(ctx, (page) =>
                  writes.readWriteSnapshot(page, deps.platformAccount(), target, {
                    profile: deps.writeProfiles?.[target.kind],
                    uploadRoot: deps.config.uploadDir,
                    verifyAccount: (page) => deps.browser.verifyCurrentAccount(page),
                    identityType: deps.bound?.platformIdType ?? 'account',
                  }),
                );
                if (deps.genericShortContexts.has(ctx.jobId)) {
                  const ref = deps.persistGenericShortObservation(
                    ctx,
                    { dataset: 'editable_snapshot', phase: 'snapshot_read' },
                    result,
                  );
                  deps.advanceGenericShortStatus(ctx, 'completed');
                  return [ref];
                }
                return [
                  ctx.saveEvidence(
                    'editable_snapshot',
                    jsonValue({
                      ...result,
                      source: { mode: 'live', origin: 'https://fanqienovel.com' },
                    }),
                  ),
                ];
              };
              return target.kind === 'short' && deps.modernShortProfile()
                ? deps.genericShortRun(
                    ctx,
                    {
                      target: deps.runtimeTarget(target),
                      creationContext: null,
                      requestBindings: { inputHash: deps.store.getJob(ctx.jobId)!.inputHash },
                    },
                    execute,
                  )
                : execute();
            },
          }),
        ),
      );
    },
  );
}
