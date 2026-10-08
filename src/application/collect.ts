import { Store, RuntimeError, type EvidenceRef } from '../runtime/store.js';
import { type JobContext } from '../runtime/jobs.js';
import {
  collectShortWorks,
  collectShortMetrics,
  collectLongWorks,
  collectLongMetrics,
  isMetricsDataset,
  projectMetricTimeContext,
  type DatasetResult,
  type CollectionEvidenceProfile,
} from '../platform/reads.js';
import { collectPublicActivities, collectWriterClasses } from '../platform/public.js';
import { Dataset, jsonValue } from './shared.js';
import { type CollectOperation } from './contracts/query.js';
import {
  type RequireLoginOperation,
  type ReadAccountPageOperation,
  type CollectedAccountDatasetOperation,
} from './contracts/identity.js';

interface Dependencies {
  store: Store;
  requireLogin: RequireLoginOperation;
  readAccountPage: ReadAccountPageOperation;
  readProfiles:
    | Partial<Record<'long_works' | 'long_metrics' | 'chapters', CollectionEvidenceProfile>>
    | undefined;
  collectedAccountDataset: CollectedAccountDatasetOperation;
}

export function createCollect(deps: Dependencies): CollectOperation {
  async function collect(
    dataset: Dataset,
    ctx: JobContext,
    options: { workId?: string; category?: string } = {},
  ): Promise<EvidenceRef> {
    deps.store.assertPublicReadMutationAllowed();
    ctx.beforePlatformRead();
    let result: DatasetResult<unknown>;
    if (dataset === 'activities')
      result = await collectPublicActivities(undefined, { signal: ctx.signal });
    else if (dataset === 'writer_classes')
      result = await collectWriterClasses(undefined, {
        tab: options.category ? Number(options.category) : undefined,
        signal: ctx.signal,
      });
    else {
      await deps.requireLogin(ctx);
      result = await deps.readAccountPage(
        ctx,
        async (page) => {
          if (dataset === 'short_works') return collectShortWorks(page);
          if (dataset === 'short_metrics') return collectShortMetrics(page, options);
          if (dataset === 'long_works')
            return collectLongWorks(page, { profile: deps.readProfiles?.long_works });
          return collectLongMetrics(page, {
            profile: deps.readProfiles?.long_metrics,
            workId: options.workId,
          });
        },
        deps.collectedAccountDataset,
      );
    }
    if (isMetricsDataset(dataset)) {
      try {
        result = projectMetricTimeContext(result, false);
      } catch {
        throw new RuntimeError('capability_unavailable', 'Statistics time context is unavailable.');
      }
    }
    const ref = ctx.saveEvidence(
      dataset,
      jsonValue({ ...result, source: { mode: 'live', origin: 'https://fanqienovel.com' } }),
    );
    if (
      result.status !== 'success' ||
      !result.coverage.complete ||
      !result.coverage.paginationComplete
    ) {
      const code =
        result.status === 'login_required'
          ? 'requires_login'
          : result.status === 'capability_unavailable'
            ? 'capability_unavailable'
            : 'invalid_evidence';
      throw new RuntimeError(code, 'The requested platform dataset is not complete', {
        dataset,
        coverage: result.coverage,
        errors: result.errors,
        limitations: result.limitations,
      });
    }
    return ref;
  }
  return collect;
}
