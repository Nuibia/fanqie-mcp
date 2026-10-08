import { AppError } from '../../errors.js';

import * as writes from '../../platform/writes.js';
import { datasets, hash, jsonValue, record } from '../shared.js';

import { type Job } from '../../runtime/store.js';
import { type ReconcileWriteDependencies } from './reconcile-write.js';
type Dependencies = Pick<
  ReconcileWriteDependencies,
  | 'requireEditorWritesEnabled'
  | 'config'
  | 'store'
  | 'reconcileBookMetadata'
  | 'refsFor'
  | 'queue'
  | 'requireLogin'
  | 'modernShortProfile'
  | 'readAccountPage'
  | 'platformAccount'
  | 'writeProfiles'
  | 'browser'
  | 'bound'
  | 'genericShortContexts'
  | 'persistGenericShortObservation'
  | 'advanceGenericShortStatus'
  | 'genericShortRun'
  | 'runtimeTarget'
  | 'retainGenericShortContext'
  | 'completed'
>;
export async function reconcileGenericWrite(
  deps: Dependencies,
  original: Job,
  evidenceFailure: unknown,
) {
  deps.requireEditorWritesEnabled();
  const publicationOnly =
    original.target?.kind === 'short-story' && ['succeeded', 'failed'].includes(original.status);
  if (
    original.accountId !== deps.config.accountId ||
    original.kind !== 'write' ||
    (original.status !== 'uncertain' && !publicationOnly)
  )
    throw new AppError(
      'invalid_reconciliation',
      'An uncertain write belonging to this service account is required',
      409,
    );
  if (evidenceFailure) throw evidenceFailure;
  const assertLatestRepair = () => {
    if (
      (original.operation === 'resume_create_draft' && deps.store.getCreationRepair(original.id)) ||
      (original.operation === 'repair_created_draft' &&
        deps.store.getCreationRepairSuccessor(original.id))
    )
      throw new AppError(
        'creation_repair_conflict',
        'Only the latest repair may be reconciled; older attempts retain their prior audit',
        409,
      );
  };
  assertLatestRepair();
  if (original.target?.kind === 'long-book') return deps.reconcileBookMetadata(original);
  if (!original.target)
    throw new AppError(
      'reconciliation_target_missing',
      'A known stable draft or chapter target is required; investigate the platform before another creation',
      409,
    );
  const intentRef = deps
    .refsFor(original)
    .filter((ref) => ref.dataset === 'write-intent')
    .at(-1);
  const intent = intentRef ? record(deps.store.readEvidence(intentRef).payload) : {};
  if (
    !publicationOnly &&
    (typeof intent.desiredContentHash !== 'string' || !Array.isArray(intent.expectedStates))
  )
    throw new AppError(
      'reconciliation_intent_missing',
      'The original desired version is not known; outcome remains uncertain',
      409,
    );
  const expectedStates = Array.isArray(intent.expectedStates)
    ? (intent.expectedStates as string[])
    : [];
  const target: writes.WriteTarget =
    original.target.kind === 'short-story'
      ? { kind: 'short', workId: original.target.id }
      : { kind: 'chapter', workId: original.target.parentId!, chapterId: original.target.id };
  const handle = deps.queue.enqueueRead({
    accountId: deps.config.accountId,
    operation: 'reconcile_write',
    scope: 'reconciliation',
    datasets: ['reconciliation'],
    inputHash: hash({ jobId: original.id }),
    run: async (ctx) => {
      assertLatestRepair();
      await deps.requireLogin(ctx);
      const execute = async () => {
        const audit =
          target.kind === 'short' && deps.modernShortProfile()
            ? deps.store.getGenericShortOriginalAudit(original.id, deps.config.accountId, ctx.jobId)
            : null;
        const result = await deps.readAccountPage(ctx, (page) =>
          writes.readWriteSnapshot(page, deps.platformAccount(), target, {
            profile: deps.writeProfiles?.[target.kind],
            uploadRoot: deps.config.uploadDir,
            verifyAccount: (page) => deps.browser.verifyCurrentAccount(page),
            identityType: deps.bound?.platformIdType ?? 'account',
          }),
        );
        const state = result.state === 'draft' ? 'draft_saved' : result.state;
        const verified =
          !publicationOnly &&
          result.contentHash === intent.desiredContentHash &&
          expectedStates.includes(state);
        if (deps.genericShortContexts.has(ctx.jobId)) {
          const anchor = publicationOnly ? record(audit!.anchorOriginal) : original,
            closed = record(anchor.result),
            effectStatus = publicationOnly ? 'unknown' : verified ? state : 'unknown';
          const ref = deps.persistGenericShortObservation(
            ctx,
            {
              dataset: 'reconciliation',
              phase: 'later_read',
              payload: {
                sourceUrl: result.sourceUrl,
                platformReadAt: result.platformReadAt,
                reconciliation: {
                  originalJobId: original.id,
                  target: original.target,
                  inputHash: original.inputHash,
                  observedContentHash: result.contentHash,
                  observedStatus: effectStatus,
                },
                originalAudit: audit,
                ...(!publicationOnly && original.operation === 'repair_created_draft' && verified
                  ? { repairVerification: result }
                  : {}),
              },
            },
            result,
          );
          deps.advanceGenericShortStatus(ctx, 'completed');
          return [ref];
        }
        return [
          ctx.saveEvidence(
            'reconciliation',
            jsonValue({
              source: { mode: 'live', origin: 'https://fanqienovel.com' },
              reconciliation: {
                originalJobId: original.id,
                target: original.target,
                inputHash: original.inputHash,
                observedContentHash: result.contentHash,
                observedStatus: verified ? state : 'unknown',
              },
              ...(original.operation === 'repair_created_draft' && verified
                ? { repairVerification: result }
                : {}),
              sourceUrl: result.sourceUrl,
              platformReadAt: result.platformReadAt,
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
              requestBindings: {
                inputHash: deps.store.getJob(ctx.jobId)!.inputHash,
                originalInputHash: original.inputHash,
              },
            },
            execute,
          )
        : execute();
    },
  });
  const readJob = await deps.retainGenericShortContext(handle).completion;
  const latest = deps.store.getJob(original.id, deps.config.accountId)!;
  if (publicationOnly || readJob.status !== 'succeeded' || latest.status !== 'uncertain')
    return {
      reconciliation: deps.completed(readJob, 'live'),
      original: deps.completed(latest),
    };
  const ref = deps.refsFor(readJob).find((item) => item.dataset === 'reconciliation')!;
  const observation = record(record(deps.store.readEvidence(ref).payload).reconciliation);
  const resolved = observation.observedStatus === 'unknown' ? 'uncertain' : 'succeeded';
  return {
    reconciliation: deps.completed(readJob, 'live'),
    original: deps.completed(
      deps.store.reconcileWriteJob(original.id, readJob.id, {
        status: resolved,
        result: {
          contentHash: observation.observedContentHash,
          platformState: observation.observedStatus,
        },
      }),
    ),
  };
}
