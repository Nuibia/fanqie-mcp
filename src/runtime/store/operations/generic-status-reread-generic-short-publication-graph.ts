import {
  type StoreReadPort,
  type EvidenceObservation,
  type CapturedGenericShortGraph,
  type PrivateGenericShortReadPlan,
} from '../runtime-error.js';
import {
  genericUnavailable,
  genericSqlCapture,
  genericSame,
} from '../has-generic-short-status-signal.js';
import { type Store } from '../authority.js';
import {
  type GenericReadGraphOperation,
  type RereadGenericShortPublicationGraphOperation,
} from '../contracts/generic-status-generic-refs.js';

interface RereadGenericShortPublicationGraphDependencies {
  genericReadScope: {
    token: object;
    accountId: string;
    open: boolean;
    ports: Map<string, StoreReadPort<unknown>>;
    files: Map<string, StoreReadPort<EvidenceObservation>>;
  } | null;
  owner: Store;
  genericReadGraph: GenericReadGraphOperation;
}

export function createRereadGenericShortPublicationGraph(
  deps: RereadGenericShortPublicationGraphDependencies,
): RereadGenericShortPublicationGraphOperation {
  function rereadGenericShortPublicationGraph(
    plan: PrivateGenericShortReadPlan,
  ): CapturedGenericShortGraph {
    const scope = deps.genericReadScope;
    if (
      plan.store !== deps.owner ||
      !scope ||
      !scope.open ||
      plan.scope !== scope.token ||
      plan.accountId !== scope.accountId
    )
      return genericUnavailable();
    // Whole native captures, including absence/order/marks, are compared before classification.
    for (const { port, value } of plan.sql)
      if (!genericSame(genericSqlCapture(port.native()), value)) return genericUnavailable();
    for (const { port, value } of plan.files)
      if (!genericSame(port.native(), value)) return genericUnavailable();
    // The exact native rows were just authenticated against every first capture;
    // reconstruct a separate complete JSON graph, never reuse a qualification flag.
    const final = deps.genericReadGraph(plan.originalId, plan.accountId, 'native');
    if (!genericSame(final, plan.first)) return genericUnavailable();
    return final;
  }
  return rereadGenericShortPublicationGraph;
}
