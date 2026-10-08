import * as z from 'zod/v4';
import { type Config } from '../../config.js';
import { AppError } from '../../errors.js';
import { RuntimeError } from '../../runtime/store.js';
import { JobQueue } from '../../runtime/jobs.js';
import { BrowserSession, type LoginState } from '../../platform/browser.js';
import {
  aggregateChapterDirectory,
  isCompleteManagementDirectory,
  type GenericChapterDirectoryResult,
} from '../../platform/chapter-directory.js';
import { datasets, AccountBinding, hash, jsonValue } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type WaitOperation } from '../contracts/query.js';
import { type RequireLoginOperation, type BindIdentityOperation } from '../contracts/identity.js';

interface Dependencies {
  tool: ToolOperation;
  wait: WaitOperation;
  queue: JobQueue;
  config: Config;
  requireLogin: RequireLoginOperation;
  bound: AccountBinding | undefined;
  login: LoginState | null;
  bindIdentity: BindIdentityOperation;
  browser: BrowserSession;
}

export function registerListChaptersTool(deps: Dependencies): void {
  deps.tool(
    'list_chapters',
    '本次按固定顺序读取全部管理卷页与草稿箱页，两个命名空间完整才推进目录快照；分别保留采集截止，不声称平台原子版本。',
    z.object({ workId: z.string().regex(/^\d{10,30}$/) }).strict(),
    true,
    async (args) =>
      deps.wait(
        deps.queue.enqueueRead({
          accountId: deps.config.accountId,
          operation: 'list_chapters',
          scope: `chapters.${args.workId}`,
          datasets: ['chapters'],
          inputHash: hash(args),
          run: async (ctx) => {
            await deps.requireLogin(ctx);
            if (!deps.bound)
              throw new RuntimeError(
                'capability_unavailable',
                'A fixed own-account binding is required for chapter reads',
              );
            const expectedOwner = {
              kind: deps.bound.platformIdType ?? 'account',
              id: deps.bound.platformId,
            };
            const assertCurrentJob = () => {
              if (ctx.signal.aborted)
                throw new RuntimeError('cancelled', 'The chapter-directory job was cancelled');
            };
            let managementOwnerObserved = false,
              draftOwnerObserved = false;
            const observeOwner = (phase: 'management' | 'draft_list') => (state: LoginState) => {
              assertCurrentJob();
              if (
                state.status !== 'authenticated' ||
                expectedOwner.kind !== 'account' ||
                state.identity?.accountId !== expectedOwner.id
              )
                throw new RuntimeError(
                  'capability_unavailable',
                  'The chapter-directory phase did not prove its fixed typed account',
                );
              deps.login = state;
              deps.bindIdentity(state);
              if (phase === 'management') managementOwnerObserved = true;
              else draftOwnerObserved = true;
            };
            let result: GenericChapterDirectoryResult;
            try {
              // Select the builtin two-namespace contract before reading. A profile or
              // a previous saved phase cannot independently authorize generic coverage.
              result = await deps.browser.withPage(
                async (page) => {
                  assertCurrentJob();
                  const management = await deps.browser.collectCurrentChapterDirectory(
                    page,
                    String(args.workId),
                    {
                      jobId: ctx.jobId,
                      signal: ctx.signal,
                      expectedOwner,
                      onVerifiedOwner: observeOwner('management'),
                    },
                  );
                  assertCurrentJob();
                  if (
                    (management.status === 'success' || management.status === 'partial') &&
                    !managementOwnerObserved
                  )
                    throw new RuntimeError(
                      'capability_unavailable',
                      'The management phase did not establish a fresh bound identity',
                    );
                  if (!isCompleteManagementDirectory(String(args.workId), management))
                    return aggregateChapterDirectory(String(args.workId), management, null);
                  assertCurrentJob();
                  const drafts = await deps.browser.collectCurrentChapterDraftDirectory(
                    page,
                    String(args.workId),
                    {
                      jobId: ctx.jobId,
                      signal: ctx.signal,
                      expectedOwner,
                      onVerifiedOwner: observeOwner('draft_list'),
                    },
                  );
                  assertCurrentJob();
                  if (
                    (drafts.status === 'success' || drafts.status === 'partial') &&
                    !draftOwnerObserved
                  )
                    throw new RuntimeError(
                      'capability_unavailable',
                      'The draft phase did not establish a fresh bound identity',
                    );
                  return aggregateChapterDirectory(String(args.workId), management, drafts);
                },
                { signal: ctx.signal },
              );
            } catch (error) {
              if (error instanceof RuntimeError || error instanceof AppError) throw error;
              throw new RuntimeError(
                'capability_unavailable',
                'The service-owned chapter-directory traversal did not complete',
              );
            }
            assertCurrentJob();
            const ref = ctx.saveEvidence(
              'chapters',
              jsonValue({ ...result, source: { mode: 'live', origin: 'https://fanqienovel.com' } }),
            );
            assertCurrentJob();
            if (
              result.status !== 'success' ||
              !result.coverage.complete ||
              !result.coverage.paginationComplete ||
              !managementOwnerObserved ||
              !draftOwnerObserved
            )
              throw new RuntimeError(
                'capability_unavailable',
                'Both chapter-directory namespaces were not verified',
                { errors: result.errors },
              );
            return [ref];
          },
        }),
      ),
  );
}
