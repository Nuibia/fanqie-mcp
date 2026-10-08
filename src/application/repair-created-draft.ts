import { createHash } from 'node:crypto';
import { type Config } from '../config.js';
import { AppError } from '../errors.js';
import { Store, RuntimeError, type GenericShortTrustedContext } from '../runtime/store.js';
import { JobQueue } from '../runtime/jobs.js';
import { BrowserSession } from '../platform/browser.js';
import * as writes from '../platform/writes.js';
import { hash, jsonValue, record } from './shared.js';
import { type RepairCreatedDraftOperation } from './contracts/creation-recovery.js';
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
  type BindGenericShortTargetOperation,
  type AdvanceGenericShortStatusOperation,
  type GenericCanonicalResultOperation,
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
  bindGenericShortTarget: BindGenericShortTargetOperation;
  advanceGenericShortStatus: AdvanceGenericShortStatusOperation;
  genericCanonicalResult: GenericCanonicalResultOperation;
  genericCapture: GenericCaptureOperation;
  modernShortProfile: ModernShortProfileOperation;
  genericShortRun: GenericShortRunOperation;
  wait: WaitOperation;
  retainGenericShortContext: RetainGenericShortContextOperation;
  outputJob: OutputJobOperation;
  completed: CompletedOperation;
}

export function createRepairCreatedDraft(deps: Dependencies): RepairCreatedDraftOperation {
  async function repairCreatedDraft(args: Record<string, unknown>) {
    deps.store.assertPublicReadMutationAllowed();
    deps.requireEditorWritesEnabled();
    const originalId = String(args.originalJobId),
      recoveryId = String(args.recoveryJobId);
    const original = deps.store.getJob(originalId, deps.config.accountId),
      recovery = deps.store.getJob(recoveryId, deps.config.accountId),
      relation = deps.store.getCreationRecovery(originalId);
    if (
      !original ||
      !recovery ||
      original.accountId !== deps.config.accountId ||
      recovery.accountId !== deps.config.accountId ||
      original.operation !== 'create_draft' ||
      recovery.operation !== 'resume_create_draft' ||
      relation?.resumeJobId !== recoveryId
    )
      throw new AppError(
        'invalid_creation_repair',
        "Repair requires this account's original allocation and its unique saved recovery",
        409,
      );
    const clientReference = String(args.clientReference),
      content = args.content as writes.DraftContent;
    const originalInputHash = hash({ clientReference, content }),
      recoveryInputHash = hash({ originalJobId: originalId, clientReference, content });
    const clientReferenceHash = hash({ kind: 'short', clientReference }),
      requestedContentHash = writes.hashDraftContent(content);
    const entryRefs = deps.refsFor(original),
      entry =
        entryRefs.length === 1 && entryRefs[0]!.dataset === 'write-intent'
          ? record(deps.store.readEvidence(entryRefs[0]!).payload)
          : {};
    const intentRefs = deps.refsFor(recovery).filter((ref) => ref.dataset === 'write-intent'),
      desired =
        intentRefs.length === 1 ? record(deps.store.readEvidence(intentRefs[0]!).payload) : {};
    if (
      original.inputHash !== originalInputHash ||
      recovery.inputHash !== recoveryInputHash ||
      entry.phase !== 'creation-entry' ||
      entry.capability !== 'create_draft' ||
      entry.clientReferenceHash !== clientReferenceHash ||
      entry.requestedContentHash !== requestedContentHash ||
      'desiredContentHash' in entry ||
      original.metadata.clientReferenceHash !== clientReferenceHash ||
      original.target?.kind !== 'short-story' ||
      !/^\d{10,22}$/.test(original.target.id) ||
      hash(recovery.target) !== hash(original.target) ||
      typeof desired.desiredContentHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(desired.desiredContentHash) ||
      hash(desired.target) !== hash(original.target) ||
      hash(desired.expectedStates) !== hash(['draft_saved'])
    )
      throw new AppError(
        'invalid_creation_repair',
        'Repair must bind the unchanged original request, recovery desired intent and allocated target',
        409,
      );
    const previousRepairId =
      typeof args.previousRepairJobId === 'string' ? args.previousRepairJobId : undefined;
    const { idempotencyKey, ...businessInput } = args,
      repairInputHash = hash(businessInput),
      previous = previousRepairId
        ? deps.store.getCreationRepairSuccessor(previousRepairId)
        : deps.store.getCreationRepair(recoveryId);
    if (previous) {
      const job = deps.store.getJob(previous.repairJobId, deps.config.accountId);
      if (
        !job ||
        job.accountId !== deps.config.accountId ||
        job.operation !== 'repair_created_draft' ||
        job.idempotencyKey !== idempotencyKey ||
        job.inputHash !== repairInputHash
      )
        throw new AppError(
          'creation_repair_conflict',
          'This recovery already has one repair; its key must return the saved result without replaying',
          409,
        );
    } else if (original.status !== 'uncertain' || recovery.status !== 'uncertain')
      throw new AppError(
        'invalid_creation_repair',
        'Only the original allocation and its current unknown recovery may start repair',
        409,
      );
    const bindings = {
      accountId: deps.config.accountId,
      originalInputHash,
      recoveryInputHash,
      repairInputHash,
      clientReferenceHash,
      requestedContentHash,
      desiredContentHash: desired.desiredContentHash,
      expectedContentHash: String(args.expectedContentHash),
      requestedTitleHash: createHash('sha256').update(content.title).digest('hex'),
      requestedBodyHash: createHash('sha256')
        .update(writes.normalizeBody(content.body))
        .digest('hex'),
    };
    const handle = deps.queue.enqueueWrite({
      accountId: deps.config.accountId,
      operation: 'repair_created_draft',
      idempotencyKey: String(idempotencyKey),
      inputHash: repairInputHash,
      run: async (ctx) => {
        const ancestors = previousRepairId
          ? deps.store.getCreationRepairAncestorIds(originalId, recoveryId, previousRepairId)
          : [];
        if (
          deps.store
            .listJobs(deps.config.accountId)
            .some(
              (job) =>
                job.kind === 'write' &&
                job.status === 'uncertain' &&
                ![originalId, recoveryId, ...ancestors].includes(job.id),
            )
        )
          throw new RuntimeError(
            'unresolved_write',
            'Another unknown write must be reconciled before this same-target repair',
          );
        await deps.requireLogin(ctx);
        const execute = async () => {
          const target: writes.WriteTarget = { kind: 'short', workId: original.target!.id },
            options = deps.writeOptions(ctx, 'short');
          if (
            options.profile?.serverState !== 'short_article_edit_v1' ||
            options.profile.bodyRead !== 'short_editor_document' ||
            options.profile.saveAcknowledgement !== 'short_article_cover_v0'
          )
            throw new RuntimeError(
              'capability_unavailable',
              'Repair requires the verified native complete draft snapshot and save acknowledgement profile',
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
                    dataset: 'creation-repair-baseline',
                    phase: 'baseline',
                    payload: {
                      originalJobId: originalId,
                      recoveryJobId: recoveryId,
                      requestedContentHash,
                      expectedContentHash: bindings.expectedContentHash,
                      target: original.target,
                    },
                  },
                  before,
                );
              if (
                before.state !== 'draft' ||
                before.contentHash !== bindings.expectedContentHash ||
                hash(deps.runtimeTarget(before.target)) !== hash(original.target)
              )
                throw new RuntimeError(
                  'version_conflict',
                  'The complete current native draft differs from the explicitly expected repair baseline',
                );
              if (
                writes.hashDraftContent({
                  ...content,
                  metadata: { ...before.metadata, ...content.metadata },
                }) !== bindings.desiredContentHash
              )
                throw new RuntimeError(
                  'creation_repair_desired_conflict',
                  "Repair must preserve the recovery's exact originally intended complete version",
                );
              const recordDesiredIntent = options.beforeSideEffect!;
              let claimed = false;
              const repairOptions: writes.WriteOptions = {
                ...options,
                beforeSideEffect: async (intent) => {
                  if (
                    claimed ||
                    intent.capability !== 'update_draft' ||
                    !intent.target ||
                    hash(deps.runtimeTarget(intent.target)) !== hash(original.target) ||
                    intent.expectedContentHash !== bindings.expectedContentHash ||
                    intent.desiredContentHash !== bindings.desiredContentHash
                  )
                    throw new RuntimeError(
                      'creation_repair_desired_conflict',
                      'The repair write intent must match the exact current and desired versions',
                    );
                  const allocation = deps.store.claimCreationRepair(
                    originalId,
                    recoveryId,
                    ctx.jobId,
                    bindings,
                    previousRepairId,
                  );
                  claimed = true;
                  deps.bindGenericShortTarget(ctx, allocation.target!);
                  if (!deps.genericShortContexts.has(ctx.jobId))
                    ctx.saveEvidence(
                      'creation-repair-baseline',
                      jsonValue({
                        originalJobId: originalId,
                        recoveryJobId: recoveryId,
                        requestedContentHash,
                        expectedContentHash: bindings.expectedContentHash,
                        target: allocation.target,
                        snapshot: before,
                        source: { mode: 'live', origin: 'https://fanqienovel.com' },
                      }),
                    );
                  await recordDesiredIntent(intent);
                },
              };
              const saved = await writes.updateDraft(
                page,
                {
                  accountId: deps.platformAccount(),
                  target,
                  expectedContentHash: bindings.expectedContentHash,
                  expectedState: 'draft',
                  content,
                },
                repairOptions,
              );
              if (!claimed)
                throw new RuntimeError(
                  'outcome_unknown',
                  'The repair did not establish its durable desired intent',
                );
              if (saved.status !== 'succeeded') return saved;
              const after = await writes.readWriteSnapshot(
                page,
                deps.platformAccount(),
                target,
                options,
              );
              if (deps.genericShortContexts.has(ctx.jobId))
                deps.persistGenericShortObservation(
                  ctx,
                  {
                    dataset: 'creation-repair-verification',
                    phase: 'after',
                    payload: {
                      originalJobId: originalId,
                      recoveryJobId: recoveryId,
                      target: original.target,
                    },
                  },
                  after,
                );
              if (
                after.state !== 'draft' ||
                after.contentHash !== bindings.desiredContentHash ||
                after.title !== content.title ||
                writes.normalizeBody(after.body) !== writes.normalizeBody(content.body) ||
                hash(deps.runtimeTarget(after.target)) !== hash(original.target)
              )
                throw new RuntimeError(
                  'outcome_unknown',
                  'The repaired draft still lacks the requested complete native readback',
                );
              if (deps.genericShortContexts.has(ctx.jobId))
                deps.advanceGenericShortStatus(ctx, 'final_verified');
              else
                ctx.saveEvidence(
                  'creation-repair-verification',
                  jsonValue({
                    originalJobId: originalId,
                    recoveryJobId: recoveryId,
                    target: original.target,
                    snapshot: after,
                    source: { mode: 'live', origin: 'https://fanqienovel.com' },
                  }),
                );
              return saved;
            },
            { signal: ctx.signal },
          );
          const result = deps.genericCanonicalResult(ctx, raw);
          if (result.status === 'uncertain')
            throw new RuntimeError(
              'outcome_unknown',
              result.reason ??
                'Repair remains unknown; reconcile this repair job without replaying it',
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
                target: original.target,
                creationContext: {
                  originalJobId: originalId,
                  recoveryJobId: recoveryId,
                  previousRepairJobId: previousRepairId ?? null,
                },
                requestBindings: bindings,
              },
              execute,
            )
          : execute();
      },
    });
    const response = await deps.wait(deps.retainGenericShortContext(handle), 'creation-event'),
      latest = deps.store.getJob(handle.jobId, deps.config.accountId)!;
    if (latest.status === 'succeeded')
      deps.store.completeCreationRepair(originalId, recoveryId, latest.id);
    return {
      ...response,
      job: deps.outputJob(latest, 'creation-event'),
      original: deps.completed(
        deps.store.getJob(originalId, deps.config.accountId)!,
        'saved',
        'creation-event',
      ),
      recovered: deps.completed(
        deps.store.getJob(recoveryId, deps.config.accountId)!,
        'saved',
        'creation-event',
      ),
    };
  }
  return repairCreatedDraft;
}
