import { type Config } from '../config.js';
import { AppError } from '../errors.js';
import { Store, type Job } from '../runtime/store.js';
import { JobQueue } from '../runtime/jobs.js';
import * as writes from '../platform/writes.js';
import { datasets, hash, jsonValue, record } from './shared.js';
import { type ReconcileBookMetadataOperation } from './contracts/reconciliation.js';
import { type RefsForOperation } from './contracts/evidence-context.js';
import { type RequireLoginOperation, type ReadAccountPageOperation } from './contracts/identity.js';

import { type PlatformAccountOperation } from './contracts/capabilities.js';
import { type BookWriteOptionsOperation } from './contracts/maintenance.js';
import { type CompletedOperation } from './contracts/query.js';
interface Dependencies {
  refsFor: RefsForOperation;
  store: Store;
  queue: JobQueue;
  config: Config;
  requireLogin: RequireLoginOperation;
  readAccountPage: ReadAccountPageOperation;
  platformAccount: PlatformAccountOperation;
  bookWriteOptions: BookWriteOptionsOperation;
  completed: CompletedOperation;
}

export function createReconcileBookMetadata(deps: Dependencies): ReconcileBookMetadataOperation {
  async function reconcileBookMetadata(original: Job) {
    if (original.operation !== 'update_work_metadata' || original.target?.kind !== 'long-book')
      throw new AppError(
        'invalid_reconciliation',
        'Only an existing-work metadata maintenance operation can use this reconciliation scope',
        409,
      );
    const intentRef = deps
      .refsFor(original)
      .filter((ref) => ref.dataset === 'write-intent')
      .at(-1);
    const intent = intentRef ? record(deps.store.readEvidence(intentRef).payload) : {};
    if (
      intent.snapshotScope !== 'long_book_metadata' ||
      intent.hashBasis !== 'long-book-metadata/v1' ||
      typeof intent.desiredContentHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(intent.desiredContentHash) ||
      !Array.isArray(intent.expectedStates) ||
      hash(intent.target) !== hash(original.target)
    )
      throw new AppError(
        'reconciliation_intent_missing',
        'The original metadata version and target are not known; outcome remains uncertain',
        409,
      );
    const target: writes.LongBookMetadataTarget = { kind: 'long-book', workId: original.target.id };
    const handle = deps.queue.enqueueRead({
      accountId: deps.config.accountId,
      operation: 'reconcile_write',
      scope: 'reconciliation',
      datasets: ['reconciliation'],
      inputHash: hash({ jobId: original.id }),
      run: async (ctx) => {
        await deps.requireLogin(ctx);
        const result = await deps.readAccountPage(ctx, (page) =>
          writes.readLongBookMetadataSnapshot(
            page,
            deps.platformAccount(),
            target,
            deps.bookWriteOptions(ctx),
          ),
        );
        const state = result.state === 'draft' ? 'draft_saved' : result.state;
        const verified =
          result.metadataHash === intent.desiredContentHash &&
          (intent.expectedStates as string[]).includes(state);
        return [
          ctx.saveEvidence(
            'reconciliation',
            jsonValue({
              snapshotScope: result.snapshotScope,
              hashBasis: result.hashBasis,
              source: { mode: 'live', origin: 'https://fanqienovel.com' },
              reconciliation: {
                originalJobId: original.id,
                target: original.target,
                inputHash: original.inputHash,
                observedContentHash: result.metadataHash,
                observedStatus: verified ? state : 'unknown',
              },
              sourceUrl: result.sourceUrl,
              platformReadAt: result.platformReadAt,
            }),
          ),
        ];
      },
    });
    const readJob = await handle.completion;
    const latest = deps.store.getJob(original.id, deps.config.accountId)!;
    if (readJob.status !== 'succeeded' || latest.status !== 'uncertain')
      return { reconciliation: deps.completed(readJob, 'live'), original: deps.completed(latest) };
    const ref = deps.refsFor(readJob).find((item) => item.dataset === 'reconciliation')!;
    const observation = record(record(deps.store.readEvidence(ref).payload).reconciliation);
    const resolved = observation.observedStatus === 'unknown' ? 'uncertain' : 'succeeded';
    return {
      reconciliation: deps.completed(readJob, 'live'),
      original: deps.completed(
        deps.store.reconcileWriteJob(original.id, readJob.id, {
          status: resolved,
          result: {
            snapshotScope: 'long_book_metadata',
            hashBasis: 'long-book-metadata/v1',
            metadataHash: observation.observedContentHash,
            platformState: observation.observedStatus,
          },
        }),
      ),
    };
  }
  return reconcileBookMetadata;
}
