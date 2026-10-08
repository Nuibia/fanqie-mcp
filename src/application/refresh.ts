import { type Config } from '../config.js';
import { Store, type EvidenceRef } from '../runtime/store.js';
import { JobQueue } from '../runtime/jobs.js';
import { datasets, accountDatasets, Dataset, hash } from './shared.js';
import { type RefreshOperation, type CollectOperation } from './contracts/query.js';

interface Dependencies {
  store: Store;
  queue: JobQueue;
  config: Config;
  collect: CollectOperation;
}

export function createRefresh(deps: Dependencies): RefreshOperation {
  function refresh(
    selected: Dataset[],
    scope = 'account',
    options: { workId?: string; category?: string } = {},
  ) {
    deps.store.assertPublicReadMutationAllowed();
    if (scope === 'account' && !accountDatasets.every((dataset) => selected.includes(dataset)))
      scope = `selection.${[...new Set(selected)].sort().join('.')}`;
    if (options.workId) scope += `.${options.workId}`;
    if (options.category) scope += `.tab${options.category}`;
    return deps.queue.enqueueRead({
      accountId: deps.config.accountId,
      operation: 'refresh',
      scope,
      datasets: selected,
      inputHash: hash(options),
      run: async (ctx) => {
        const refs: EvidenceRef[] = [];
        for (const dataset of selected) refs.push(await deps.collect(dataset, ctx, options));
        return refs;
      },
    });
  }
  return refresh;
}
