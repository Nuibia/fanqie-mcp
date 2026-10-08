import { type GenericGraphNode } from '../runtime-error.js';
import {
  genericUnavailable,
  genericObject,
  genericSame,
} from '../has-generic-short-status-signal.js';
import {
  type GenericModernObservationsOperation,
  type GenericHistoricalOperation,
  type GenericReadCompleteOperation,
} from '../contracts/generic-status-generic-refs.js';

interface GenericReadCompleteDependencies {
  genericModernObservations: GenericModernObservationsOperation;
  genericHistorical: GenericHistoricalOperation;
}

export function createGenericReadComplete(
  deps: GenericReadCompleteDependencies,
): GenericReadCompleteOperation {
  function genericReadComplete(node: GenericGraphNode, modern: boolean): void {
    const { job, manifest, refs } = node;
    if (
      !manifest ||
      job.kind !== 'read' ||
      job.status !== 'succeeded' ||
      job.error !== null ||
      job.platformWriteStartedAt !== null ||
      !job.platformReadStartedAt ||
      !job.endedAt ||
      !genericSame(job.result, { manifest }) ||
      refs.length !== 1
    )
      return genericUnavailable();
    genericObject(manifest, [
      'schemaVersion',
      'id',
      'accountId',
      'jobId',
      'operation',
      'scope',
      'datasets',
      'requestedAt',
      'platformReadStartedAt',
      'committedAt',
      'evidence',
    ]);
    if (
      manifest.schemaVersion !== 1 ||
      manifest.accountId !== job.accountId ||
      manifest.jobId !== job.id ||
      manifest.operation !== job.operation ||
      manifest.scope !== job.scope ||
      !genericSame(manifest.datasets, job.datasets) ||
      manifest.requestedAt !== job.requestedAt ||
      manifest.platformReadStartedAt !== job.platformReadStartedAt ||
      manifest.committedAt !== job.endedAt ||
      job.updatedAt !== job.endedAt ||
      !genericSame(manifest.evidence, refs) ||
      refs[0]!.capturedAt > manifest.committedAt
    )
      return genericUnavailable();
    if (modern) {
      const { witness } = deps.genericModernObservations(node);
      if (!witness || witness.stage !== 'completed' || witness.failure !== null)
        return genericUnavailable();
    } else deps.genericHistorical(node);
  }
  return genericReadComplete;
}
