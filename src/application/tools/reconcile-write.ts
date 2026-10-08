import { reconcileGenericWrite } from './reconcile-generic-write.js';
import * as submissionRuntime from '../../platform/short-native-submission-runtime.js';
import * as bodyRuntime from '../../platform/short-native-body-runtime.js';
import * as trialRuntime from '../../platform/short-native-trial-runtime.js';
import * as coverRuntime from '../../platform/short-native-cover-runtime.js';
import {
  hasReservedNativeShortSignal,
  type NativeShortProvenance,
} from '../../platform/short-native-metadata-proof.js';
import * as z from 'zod/v4';
import { type Config } from '../../config.js';
import { AppError } from '../../errors.js';
import { Store, type GenericShortTrustedContext } from '../../runtime/store.js';
import { JobQueue } from '../../runtime/jobs.js';
import { BrowserSession, type LoginState } from '../../platform/browser.js';
import * as writes from '../../platform/writes.js';
import { AccountBinding, record } from '../shared.js';
import {
  type ToolOperation,
  type RequireEditorWritesEnabledOperation,
} from '../contracts/tool-input.js';

import { type RefsForOperation } from '../contracts/evidence-context.js';
import {
  type NativeBoundAccountOperation,
  type PlatformAccountOperation,
} from '../contracts/capabilities.js';
import { type CompletedOperation } from '../contracts/query.js';
import {
  type SubmissionOptionsOperation,
  type RuntimeTargetOperation,
} from '../contracts/maintenance.js';
import {
  type BindIdentityOperation,
  type RequireLoginOperation,
  type ReadAccountPageOperation,
} from '../contracts/identity.js';
import {
  type ReconcileNativeCompensationOperation,
  type ReconcileNativeShortMetadataOperation,
  type ReconcileBookMetadataOperation,
} from '../contracts/reconciliation.js';

import {
  type ModernShortProfileOperation,
  type PersistGenericShortObservationOperation,
  type AdvanceGenericShortStatusOperation,
  type GenericShortRunOperation,
  type RetainGenericShortContextOperation,
} from '../contracts/generic-write.js';

export interface ReconcileWriteDependencies {
  tool: ToolOperation;
  store: Store;
  config: Config;
  requireEditorWritesEnabled: RequireEditorWritesEnabledOperation;
  refsFor: RefsForOperation;
  queue: JobQueue;
  browser: BrowserSession;
  nativeProvenance: NativeShortProvenance;
  nativeBoundAccount: NativeBoundAccountOperation;
  completed: CompletedOperation;
  submissionOptions: SubmissionOptionsOperation;
  bodyExecutorEligible: boolean;
  bindIdentity: BindIdentityOperation;
  login: LoginState | null;
  reconcileNativeCompensation: ReconcileNativeCompensationOperation;
  reconcileNativeShortMetadata: ReconcileNativeShortMetadataOperation;
  reconcileBookMetadata: ReconcileBookMetadataOperation;
  requireLogin: RequireLoginOperation;
  modernShortProfile: ModernShortProfileOperation;
  readAccountPage: ReadAccountPageOperation;
  platformAccount: PlatformAccountOperation;
  writeProfiles:
    | (Partial<Record<'short' | 'chapter', writes.UiWriteProfile>> & {
        'long-book'?: writes.UiLongBookMetadataProfile;
      })
    | undefined;
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
  genericShortRun: GenericShortRunOperation;
  runtimeTarget: RuntimeTargetOperation;
  retainGenericShortContext: RetainGenericShortContextOperation;
}

export function registerReconcileWriteTool(deps: ReconcileWriteDependencies): void {
  deps.tool(
    'reconcile_write',
    '按原目标与持久版本回查未知写结果；原生短故事仅独立API读取、0 POST且默认关闭写开关时仍可对账，legacy编辑器可能自动保存并仍需写开关。不重放新建、保存或提交。',
    z.object({ jobId: z.string().uuid() }).strict(),
    false,
    async (args) => {
      const original = deps.store.getJob(String(args.jobId), deps.config.accountId);
      if (!original) {
        deps.requireEditorWritesEnabled();
        throw new AppError(
          'invalid_reconciliation',
          'An uncertain write belonging to this service account is required',
          409,
        );
      }
      const originalRefs = deps.refsFor(original);
      let submission = [original, ...originalRefs].some(
        submissionRuntime.hasReservedNativeShortSubmissionSignal,
      );
      let body = [original, ...originalRefs].some(bodyRuntime.hasReservedNativeShortBodySignal);
      let trial = [original, ...originalRefs].some(trialRuntime.hasReservedNativeShortTrialSignal);
      let cover = [original, ...originalRefs].some(coverRuntime.hasReservedNativeShortCoverSignal);
      let native = [original, ...originalRefs].some(hasReservedNativeShortSignal);
      let evidenceFailure: unknown;
      for (const ref of originalRefs) {
        try {
          const document = deps.store.readEvidence(ref);
          submission ||= submissionRuntime.hasReservedNativeShortSubmissionSignal(document);
          body ||= bodyRuntime.hasReservedNativeShortBodySignal(document);
          trial ||= trialRuntime.hasReservedNativeShortTrialSignal(document);
          cover ||= coverRuntime.hasReservedNativeShortCoverSignal(document);
          native ||= hasReservedNativeShortSignal(document);
        } catch (error) {
          evidenceFailure = error;
        }
      }
      if (submission) {
        if (original.accountId !== deps.config.accountId || original.kind !== 'write')
          throw new AppError(
            'invalid_reconciliation',
            'A submission write belonging to this service account is required',
            409,
          );
        if (evidenceFailure)
          throw new AppError(
            'capability_unavailable',
            'Native short submission reconciliation is unavailable',
            409,
          );
        return submissionRuntime.reconcileNativeShortSubmissionWrite(
          deps.store,
          deps.queue,
          deps.browser,
          deps.config.accountId,
          original,
          {
            timeoutMs: deps.config.timeoutMs,
            provenance: deps.nativeProvenance,
            currentPlatformAccount: deps.nativeBoundAccount,
            completed: deps.completed,
            onVerifiedAccount: deps.submissionOptions('').onVerifiedAccount,
          },
        );
      }
      if (body) {
        if (original.accountId !== deps.config.accountId || original.kind !== 'write')
          throw new AppError(
            'invalid_reconciliation',
            'An uncertain write belonging to this service account is required',
            409,
          );
        if (evidenceFailure)
          throw new AppError(
            'capability_unavailable',
            'Native short body reconciliation is unavailable',
            409,
          );
        if (original.status === 'uncertain' && !deps.bodyExecutorEligible)
          throw new AppError('capability_unavailable', 'Native short body is unavailable.', 409);
        const response = await bodyRuntime.reconcileNativeShortBodyWrite(
          deps.store,
          deps.queue,
          deps.browser,
          deps.config.accountId,
          original,
          {
            timeoutMs: deps.config.timeoutMs,
            currentPlatformAccount: deps.nativeBoundAccount,
            onVerifiedAccount: (accountId, checkedAt) => {
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
            },
          },
        );
        const current = deps.store.getJob(response.originalJobId, deps.config.accountId),
          read =
            response.reconciliationJobId === null
              ? null
              : deps.store.getJob(response.reconciliationJobId, deps.config.accountId);
        if (!current || (response.reconciliationJobId !== null && !read))
          throw new AppError(
            'capability_unavailable',
            'Native short body reconciliation is unavailable',
            409,
          );
        return {
          original: deps.completed(current),
          reconciliation: read === null ? null : deps.completed(read, response.retrievalMode),
          settlement:
            response.settlement === null
              ? null
              : {
                  ...response.settlement,
                  result: {
                    ...response.settlement.result,
                    source: { mode: response.settlement.result.source.mode },
                  },
                },
        };
      }
      if (trial) {
        if (original.accountId !== deps.config.accountId || original.kind !== 'write')
          throw new AppError(
            'invalid_reconciliation',
            'An uncertain write belonging to this service account is required',
            409,
          );
        if (evidenceFailure)
          throw new AppError(
            'capability_unavailable',
            'Native short trial reconciliation is unavailable',
            409,
          );
        return trialRuntime.reconcileNativeShortTrialWrite(
          deps.store,
          deps.queue,
          deps.browser,
          deps.config.accountId,
          original,
          {
            timeoutMs: deps.config.timeoutMs,
            provenance: deps.nativeProvenance,
            currentPlatformAccount: deps.nativeBoundAccount,
            completed: deps.completed,
            onVerifiedAccount: (accountId, checkedAt) => {
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
            },
          },
        );
      }
      if (cover) {
        if (original.accountId !== deps.config.accountId || original.kind !== 'write')
          throw new AppError(
            'invalid_reconciliation',
            'An uncertain write belonging to this service account is required',
            409,
          );
        if (evidenceFailure)
          throw new AppError(
            'capability_unavailable',
            'Native short cover reconciliation is unavailable',
            409,
          );
        return coverRuntime.reconcileNativeShortCoverWrite(
          deps.store,
          deps.queue,
          deps.browser,
          deps.config.accountId,
          original,
          {
            timeoutMs: deps.config.timeoutMs,
            provenance: deps.nativeProvenance,
            currentPlatformAccount: deps.nativeBoundAccount,
            completed: deps.completed,
            onVerifiedAccount: (accountId, checkedAt) => {
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
            },
          },
        );
      }
      if (native) {
        if (original.accountId !== deps.config.accountId || original.kind !== 'write')
          throw new AppError(
            'invalid_reconciliation',
            'An uncertain write belonging to this service account is required',
            409,
          );
        const compensation = deps.store.getNativeCompensationContext(original.id);
        if (compensation) {
          if (record(original.result).schema === 'native-short-metadata-compensated-closure/v1')
            return {
              original: deps.completed(deps.store.getJob(original.id, deps.config.accountId)!),
              settlement: { status: 'saved', terminalState: 'compensated' },
            };
          if (original.status !== 'uncertain')
            throw new AppError('capability_unavailable', 'Native compensation is unavailable', 409);
          return deps.reconcileNativeCompensation(compensation);
        }
        if (original.status !== 'uncertain')
          throw new AppError(
            'invalid_reconciliation',
            'An uncertain write belonging to this service account is required',
            409,
          );
        if (evidenceFailure)
          throw new AppError(
            'capability_unavailable',
            'Native short metadata reconciliation is unavailable',
            409,
          );
        return deps.reconcileNativeShortMetadata(original);
      }
      return reconcileGenericWrite(deps, original, evidenceFailure);
    },
  );
}
