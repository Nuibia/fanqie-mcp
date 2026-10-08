import * as z from 'zod/v4';
import { type Config } from '../../config.js';
import { Store, RuntimeError } from '../../runtime/store.js';
import { JobQueue } from '../../runtime/jobs.js';
import {
  safeShortMetadataResult,
  type ShortMetadataReason,
  type ShortMetadataResult,
} from '../../platform/short-metadata-schema.js';
import { BrowserSession, type LoginState } from '../../platform/browser.js';
import { datasets, AccountBinding, hash, jsonValue } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type BindIdentityOperation } from '../contracts/identity.js';
interface Dependencies {
  tool: ToolOperation;
  queue: JobQueue;
  config: Config;
  store: Store;
  bound: AccountBinding | undefined;
  browser: BrowserSession;
  bindIdentity: BindIdentityOperation;
  login: LoginState | null;
}

export function registerDiagnoseShortMetadataSchemaTool(deps: Dependencies): void {
  deps.tool(
    'diagnose_short_metadata_schema',
    '在同一服务浏览器的cookie-only隔离上下文中，只读观察既有短故事的固定元数据字段类型；阻止非GET、未知资源与重定向，输出不含账号、目标ID或字段值，不证明元数据写能力。',
    z
      .object({
        target: z
          .object({ kind: z.literal('short'), workId: z.string().regex(/^[1-9]\d{9,21}$/) })
          .strict(),
      })
      .strict(),
    true,
    async (args) => {
      let localReason: ShortMetadataReason | null = null;
      const target = args.target as { kind: 'short'; workId: string };
      const handle = deps.queue.enqueueRead({
        accountId: deps.config.accountId,
        operation: 'diagnose_short_metadata_schema',
        scope: `short_metadata_schema.${target.workId}`,
        datasets: ['short_metadata_schema'],
        inputHash: hash(args),
        run: async (ctx) => {
          deps.store.assertLeaseOwnership();
          if (
            !deps.bound ||
            deps.bound.accountId !== deps.config.accountId ||
            deps.bound.platformIdType !== 'account' ||
            !/^\d{1,30}$/.test(deps.bound.platformId)
          ) {
            localReason = 'identity_unverified';
            throw new RuntimeError(
              'capability_unavailable',
              'A typed service-account binding is required for isolated metadata observation',
            );
          }
          const expected = deps.bound.platformId;
          let platformStarted = false,
            ownerCallbackChecked = false;
          const raw = await deps.browser
            .diagnoseShortMetadataSchema(target.workId, {
              signal: ctx.signal,
              expectedAccountId: expected,
              assertLease: () => deps.store.assertLeaseOwnership(),
              onBeforePlatformRead: () => {
                if (platformStarted)
                  throw new RuntimeError(
                    'capability_unavailable',
                    'The isolated platform-start callback was repeated',
                  );
                ctx.beforePlatformRead();
                platformStarted = true;
              },
              onVerifiedAccount: (accountId, checkedAt) => {
                deps.store.assertLeaseOwnership();
                if (ownerCallbackChecked || ctx.signal.aborted || accountId !== expected)
                  throw new RuntimeError(
                    'capability_unavailable',
                    'The isolated metadata identity changed',
                  );
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
                ownerCallbackChecked = true;
              },
            })
            .catch(() => {
              localReason = 'response_unavailable';
              throw new RuntimeError(
                'capability_unavailable',
                'The isolated metadata collector did not settle with its fixed result',
              );
            });
          let result: ShortMetadataResult;
          try {
            result = safeShortMetadataResult(raw);
          } catch {
            localReason = 'response_unverified';
            throw new RuntimeError(
              'capability_unavailable',
              'The isolated metadata result did not meet its safe contract',
            );
          }
          if (result.status === 'success' && !ownerCallbackChecked) {
            localReason = 'callback_failed';
            throw new RuntimeError(
              'capability_unavailable',
              'The isolated metadata owner callback was not verified',
            );
          }
          localReason = result.reason;
          if (!platformStarted || !result.proof.platformStarted)
            throw new RuntimeError(
              'capability_unavailable',
              'The isolated metadata observation did not access the platform',
            );
          deps.store.assertLeaseOwnership();
          ctx.recordTarget({ kind: 'short-story', id: target.workId });
          const ref = ctx.saveEvidence('short_metadata_schema', jsonValue(result));
          if (result.status !== 'success')
            throw new RuntimeError(
              'capability_unavailable',
              'The isolated metadata schema observation is unavailable',
            );
          return [ref];
        },
      });
      const job = await handle.completion;
      const evidence = deps.store
        .listEvidence(job.id)
        .filter((ref) => ref.dataset === 'short_metadata_schema');
      const data: ShortMetadataResult[] = evidence.map((ref) =>
        safeShortMetadataResult(deps.store.readEvidence(ref).payload),
      );
      return {
        job: {
          id: job.id,
          status: job.status,
          operation: 'diagnose_short_metadata_schema',
          requestedAt: job.requestedAt,
          endedAt: job.endedAt,
        },
        retrievalMode: 'live',
        sourceMode: job.status === 'succeeded' ? 'live' : 'incomplete',
        reason:
          job.status === 'succeeded'
            ? null
            : (data[0]?.reason ??
              localReason ??
              (job.status === 'cancelled' ? 'cancelled' : 'response_unavailable')),
        evidence: evidence.map((ref) => ({
          id: ref.id,
          dataset: 'short_metadata_schema',
          sha256: ref.sha256,
          capturedAt: ref.capturedAt,
        })),
        data,
      };
    },
  );
}
