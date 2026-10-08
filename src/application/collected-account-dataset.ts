import { type DatasetResult } from '../platform/reads.js';
import { type CollectedAccountDatasetOperation } from './contracts/identity.js';

interface Dependencies {}

export function createCollectedAccountDataset(
  deps: Dependencies,
): CollectedAccountDatasetOperation {
  const collectedAccountDataset = (result: DatasetResult<unknown>) =>
    result.status === 'success' || result.status === 'partial';
  return collectedAccountDataset;
}
