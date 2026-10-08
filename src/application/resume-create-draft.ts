import { type Config } from '../config.js';
import { AppError } from '../errors.js';
import { Store, RuntimeError, type GenericShortTrustedContext } from '../runtime/store.js';
import { JobQueue } from '../runtime/jobs.js';
import { BrowserSession } from '../platform/browser.js';
import * as writes from '../platform/writes.js';
import { hash, jsonValue, record } from './shared.js';
import { type ResumeCreateDraftOperation } from './contracts/creation-recovery.js';
import { type RequireEditorWritesEnabledOperation } from './contracts/tool-input.js';
import { type RefsForOperation } from './contracts/evidence-context.js';
import { type RequireLoginOperation } from './contracts/identity.js';
import {
  type WriteOptionsOperation,
  type RuntimeTargetOperation,
} from './contracts/maintenance.js';
import { type PlatformAccountOperation } from './contracts/capabilities.js';
import {
  type PersistGenericShortObservationOperation,
  type GenericCanonicalResultOperation,
  type AdvanceGenericShortStatusOperation,
  type GenericCaptureOperation,
  type ModernShortProfileOperation,
  type GenericShortRunOperation,
  type RetainGenericShortContextOperation,
} from './contracts/generic-write.js';

import { type WaitOperation, type CompletedOperation } from './contracts/query.js';

import { type OutputJobOperation } from './contracts/evidence-projection.js';

interface Dependencies {
  store: Store;
  requireEditorWritesEnabled: RequireEditorWritesEnabledOperation;
  config: Config;
  refsFor: RefsForOperation;
  queue: JobQueue;
  requireLogin: RequireLoginOperation;
  writeOptions: WriteOptionsOperation;
  browser: BrowserSession;
  platformAccount: PlatformAccountOperation;
  genericShortContexts: Map<
    string,
    {
      context: GenericShortTrustedContext;
      witness: Record<string, unknown>;
      sticky: 'capture_failed' | 'persist_failed' | null;
    }
  >;
  persistGenericShortObservation: PersistGenericShortObservationOperation;
  runtimeTarget: RuntimeTargetOperation;
  genericCanonicalResult: GenericCanonicalResultOperation;
  advanceGenericShortStatus: AdvanceGenericShortStatusOperation;
  genericCapture: GenericCaptureOperation;
  modernShortProfile: ModernShortProfileOperation;
  genericShortRun: GenericShortRunOperation;
  wait: WaitOperation;
  retainGenericShortContext: RetainGenericShortContextOperation;
  outputJob: OutputJobOperation;
  completed: CompletedOperation;
}

export function createResumeCreateDraft(deps: Dependencies): ResumeCreateDraftOperation {
  async function resumeCreateDraft(args: Record<string, unknown>) {
    deps.store.assertPublicReadMutationAllowed();
    deps.requireEditorWritesEnabled();
    const originalId = String(args.originalJobId),
      original = deps.store.getJob(originalId, deps.config.accountId);
    if (
      !original ||
      original.accountId !== deps.config.accountId ||
      original.kind !== 'write' ||
      original.operation !== 'create_draft'
    )
      throw new AppError(
        'invalid_creation_recovery',
        'An allocated creation belonging to this account is required',
        409,
      );
    const clientReference = String(args.clientReference),
      content = args.content as writes.DraftContent;
    const originalInputHash = hash({ clientReference, content }),
      clientReferenceHash = hash({ kind: 'short', clientReference }),
      requestedContentHash = writes.hashDraftContent(content);
    const entryRefs = deps.refsFor(original),
      entry =
        entryRefs.length === 1 && entryRefs[0]!.dataset === 'write-intent'
          ? record(deps.store.readEvidence(entryRefs[0]!).payload)
          : {};
    if (
      original.inputHash !== originalInputHash ||
      entry.phase !== 'creation-entry' ||
      entry.capability !== 'create_draft' ||
      entry.clientReferenceHash !== clientReferenceHash ||
      entry.requestedContentHash !== requestedContentHash ||
      'desiredContentHash' in entry ||
      original.metadata.clientReferenceHash !== clientReferenceHash ||
      original.target?.kind !== 'short-story' ||
      !/^\d{10,22}$/.test(original.target.id)
    )
      throw new AppError(
        'invalid_creation_recovery',
        'The recovery must bind the unchanged original request and allocated short target',
        409,
      );
    const { idempotencyKey, ...businessInput } = args;
    const resumeInputHash = hash(businessInput),
      previous = deps.store.getCreationRecovery(originalId);
    if (previous) {
      const job = deps.store.getJob(previous.resumeJobId, deps.config.accountId);
      if (
        !job ||
        job.accountId !== deps.config.accountId ||
        job.operation !== 'resume_create_draft' ||
        job.idempotencyKey !== idempotencyKey ||
        job.inputHash !== resumeInputHash
      )
        throw new AppError(
          'creation_recovery_conflict',
          'This creation already has one recovery; use its original key without replaying the save',
          409,
        );
    } else if (original.status !== 'uncertain')
      throw new AppError(
        'invalid_creation_recovery',
        'Only an unknown initial creation can start a recovery',
        409,
      );
    const handle = deps.queue.enqueueWrite({
      accountId: deps.config.accountId,
      operation: 'resume_create_draft',
      idempotencyKey: String(idempotencyKey),
      inputHash: resumeInputHash,
      run: async (ctx) => {
        const claimed = deps.store.claimCreationRecovery(originalId, ctx.jobId, {
          accountId: deps.config.accountId,
          originalInputHash,
          resumeInputHash,
          clientReferenceHash,
          requestedContentHash,
        });
        await deps.requireLogin(ctx);
        const execute = async () => {
          const target: writes.WriteTarget = { kind: 'short', workId: claimed.target!.id },
            options = deps.writeOptions(ctx, 'short');
          if (
            options.profile?.serverState !== 'short_article_edit_v1' ||
            options.profile.bodyRead !== 'short_editor_document' ||
            options.profile.saveAcknowledgement !== 'short_article_cover_v0'
          )
            throw new RuntimeError(
              'capability_unavailable',
              'Creation recovery requires the verified native draft state, bound document body and save acknowledgement profile',
            );
          const raw = await deps.browser.withPage(
            async (page) => {
              const before = await writes.readWriteSnapshot(
                page,
                deps.platformAccount(),
                target,
                options,
              );
              if (deps.genericShortContexts.has(ctx.jobId))
                deps.persistGenericShortObservation(
                  ctx,
                  {
                    dataset: 'creation-resume-baseline',
                    phase: 'baseline',
                    payload: {
                      originalJobId: originalId,
                      requestedContentHash,
                      target: claimed.target,
                    },
                  },
                  before,
                );
              if (
                before.state !== 'draft' ||
                before.title !== '' ||
                before.body !== '' ||
                hash(deps.runtimeTarget(before.target)) !== hash(claimed.target)
              )
                throw new RuntimeError(
                  'creation_recovery_not_blank',
                  'Only the same currently empty native draft may resume the original creation request',
                );
              if (!deps.genericShortContexts.has(ctx.jobId))
                ctx.saveEvidence(
                  'creation-resume-baseline',
                  jsonValue({
                    originalJobId: originalId,
                    requestedContentHash,
                    target: claimed.target,
                    snapshot: before,
                    source: { mode: 'live', origin: 'https://fanqienovel.com' },
                  }),
                );
              return writes.updateDraft(
                page,
                {
                  accountId: deps.platformAccount(),
                  target,
                  expectedContentHash: before.contentHash,
                  expectedState: 'draft',
                  content,
                },
                options,
              );
            },
            { signal: ctx.signal },
          );
          const result = deps.genericCanonicalResult(ctx, raw);
          if (result.status === 'uncertain')
            throw new RuntimeError(
              'outcome_unknown',
              result.reason ??
                'The recovered save remains unknown; reconcile this recovery job without replaying it',
              jsonValue(result),
            );
          if (deps.genericShortContexts.has(ctx.jobId))
            deps.advanceGenericShortStatus(ctx, 'completed');
          ctx.saveEvidence(
            'write-result',
            deps.genericShortContexts.has(ctx.jobId)
              ? deps.genericCapture(result)
              : jsonValue(result),
          );
          return result;
        };
        return deps.modernShortProfile()
          ? deps.genericShortRun(
              ctx,
              {
                target: claimed.target,
                creationContext: {
                  originalJobId: originalId,
                  recoveryJobId: null,
                  previousRepairJobId: null,
                },
                requestBindings: {
                  accountId: deps.config.accountId,
                  originalInputHash,
                  resumeInputHash,
                  clientReferenceHash,
                  requestedContentHash,
                },
              },
              execute,
            )
          : execute();
      },
    });
    const response = await deps.wait(deps.retainGenericShortContext(handle), 'creation-event');
    const latest = deps.store.getJob(handle.jobId, deps.config.accountId)!;
    const parent =
      latest.status === 'succeeded'
        ? deps.store.completeCreationRecovery(originalId, latest.id)
        : deps.store.getJob(originalId, deps.config.accountId)!;
    return {
      ...response,
      job: deps.outputJob(latest, 'creation-event'),
      original: deps.completed(parent, 'saved', 'creation-event'),
    };
  }
  return resumeCreateDraft;
}
