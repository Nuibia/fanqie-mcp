import * as draftDirectory from '../../platform/short-draft-directory.js';
import { randomUUID } from 'node:crypto';
import { type Config } from '../../config.js';
import { Store, RuntimeError, canonicalJson } from '../../runtime/store.js';
import { JobQueue } from '../../runtime/jobs.js';
import { BrowserSession, type LoginState } from '../../platform/browser.js';
import { datasets, empty } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type NativeBoundAccountOperation } from '../contracts/capabilities.js';
import { type BindIdentityOperation } from '../contracts/identity.js';
import { type CompletedOperation } from '../contracts/query.js';
interface Dependencies {
  tool: ToolOperation;
  queue: JobQueue;
  config: Config;
  nativeBoundAccount: NativeBoundAccountOperation;
  store: Store;
  browser: BrowserSession;
  bindIdentity: BindIdentityOperation;
  login: LoginState | null;
  directoryApplicationOrigin: 'default' | 'injected';
  completed: CompletedOperation;
}

export function registerListShortDraftsTool(deps: Dependencies): void {
  deps.tool(
    'list_short_drafts',
    '本次只读本人短故事私人草稿目录，最多100个ID；title不可用、发布和签约状态unknown，不读取正文。',
    empty,
    true,
    async () => {
      const internalKey = randomUUID();
      const handle = deps.queue.enqueueRead({
        accountId: deps.config.accountId,
        operation: draftDirectory.SHORT_DRAFT_DIRECTORY_OPERATION,
        scope: draftDirectory.SHORT_DRAFT_DIRECTORY_SCOPE,
        datasets: [draftDirectory.SHORT_DRAFT_DIRECTORY_DATASET],
        inputHash: draftDirectory.SHORT_DRAFT_DIRECTORY_INPUT_HASH,
        idempotencyKey: internalKey,
        run: async (ctx) => {
          try {
            const expectedAccount = deps.nativeBoundAccount();
            if (expectedAccount === null) throw Error('No typed directory binding');
            const observation = {
              beforeCount: 0,
              ownerCount: 0,
              readAt: null as string | null,
              ownerAt: null as string | null,
            };
            const assertCurrent = () => {
              deps.store.assertLeaseOwnership();
              const job = deps.store.getJob(ctx.jobId, deps.config.accountId),
                now = new Date().toISOString();
              if (
                !job ||
                job.kind !== 'read' ||
                job.status !== 'running' ||
                job.accountId !== deps.config.accountId ||
                ctx.accountId !== deps.config.accountId ||
                job.scope !== draftDirectory.SHORT_DRAFT_DIRECTORY_SCOPE ||
                job.operation !== draftDirectory.SHORT_DRAFT_DIRECTORY_OPERATION ||
                canonicalJson(job.datasets) !== '["short_drafts"]' ||
                job.inputHash !== draftDirectory.SHORT_DRAFT_DIRECTORY_INPUT_HASH ||
                job.idempotencyKey !== internalKey ||
                job.target !== null ||
                job.platformWriteStartedAt !== null ||
                job.cancellationRequestedAt !== null ||
                job.cancellationReason !== null ||
                !job.deadlineAt ||
                now > job.deadlineAt ||
                ctx.signal.aborted ||
                deps.browser.hasUnsafeApiCleanup === true ||
                deps.nativeBoundAccount() !== expectedAccount
              )
                throw Error('Directory read stopped');
            };
            assertCurrent();
            const raw = await deps.browser.runShortDraftDirectory({
              mode: 'read',
              expectedOwner: { kind: 'account', id: expectedAccount },
              timeoutMs: deps.config.timeoutMs,
              signal: ctx.signal,
              assertLease: assertCurrent,
              onBeforePlatformRead: () => {
                assertCurrent();
                if (++observation.beforeCount !== 1)
                  throw Error('Repeated directory read boundary');
                observation.readAt = ctx.beforePlatformRead();
                assertCurrent();
              },
              onVerifiedAccount: (accountId, checkedAt) => {
                assertCurrent();
                if (
                  ++observation.ownerCount !== 1 ||
                  observation.beforeCount !== 1 ||
                  accountId !== expectedAccount ||
                  !draftDirectory.isShortDraftDirectoryTime(checkedAt) ||
                  checkedAt > new Date().toISOString()
                )
                  throw Error('Invalid directory owner callback');
                const state: LoginState = {
                  status: 'authenticated',
                  identity: {
                    accountId,
                    authorId: null,
                    displayName: null,
                    evidenceSource: 'https://fanqienovel.com/api/user/info/v2',
                  },
                  sourceUrl: 'https://fanqienovel.com/api/user/info/v2',
                  checkedAt,
                };
                deps.bindIdentity(state);
                deps.login = state;
                observation.ownerAt = checkedAt;
                assertCurrent();
              },
            });
            assertCurrent();
            const result = draftDirectory.validateShortDraftDirectoryApiResult(raw),
              evidence = draftDirectory.createShortDraftDirectoryEvidence(
                raw,
                deps.directoryApplicationOrigin,
              );
            if (
              result.owner?.id !== expectedAccount ||
              observation.beforeCount !== 1 ||
              !observation.readAt ||
              !result.coverage.readStartedAt ||
              observation.readAt > result.coverage.readStartedAt ||
              result.cleanup.checkedAt > new Date().toISOString()
            )
              throw Error('Invalid directory read boundary');
            if (
              result.status === 'success' &&
              (observation.ownerCount !== 1 ||
                observation.ownerAt !== result.proof.ownerCheckedAt ||
                observation.ownerAt !== result.coverage.proofCapturedAt)
            )
              throw Error('Incomplete directory owner proof');
            if (result.status !== 'success' && observation.ownerCount !== 0)
              throw Error('Invalid negative directory proof');
            ctx.addMetadata({
              shortDraftDirectorySchema: 'short-draft-directory-job/v1',
              shortDraftDirectoryOwnerKind: 'account',
              shortDraftDirectoryOwnerId: expectedAccount,
              shortDraftDirectorySource: evidence.source.mode,
            });
            assertCurrent();
            const ref = ctx.saveEvidence(draftDirectory.SHORT_DRAFT_DIRECTORY_DATASET, evidence);
            const job = deps.store.getJob(ctx.jobId, deps.config.accountId)!,
              refs = deps.store.listEvidence(ctx.jobId);
            draftDirectory.validateShortDraftDirectoryContext(
              {
                accountId: deps.config.accountId,
                job,
                manifest: null,
                refs,
                documents: refs.map((item) => deps.store.readEvidence(item)),
                evaluationAt: new Date().toISOString(),
              },
              'prefix',
            );
            assertCurrent();
            if (result.status !== 'success') throw Error('Directory unavailable');
            return [ref];
          } catch {
            throw new RuntimeError(
              'capability_unavailable',
              'Short draft directory is unavailable.',
            );
          }
        },
      });
      return deps.completed(await handle.completion, 'live');
    },
  );
}
