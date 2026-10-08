import {
  writeTaskUuid,
  writeTaskTime,
  type GenericGraphNode,
  type CapturedGenericShortGraph,
} from '../runtime-error.js';
import { canonicalJson, type NativeReconciliationRow } from '../native-closure-signal.js';
import {
  genericUnavailable,
  genericObject,
  genericSame,
  hasGenericShortStatusSignal,
  genericDigest,
} from '../has-generic-short-status-signal.js';
import {
  type GenericReadCompleteOperation,
  type GenericValidateAuditOperation,
  type GenericSettlementErrorOperation,
  type GenericLedgerOperation,
} from '../contracts/generic-status-generic-refs.js';

interface GenericLedgerDependencies {
  genericReadComplete: GenericReadCompleteOperation;
  genericValidateAudit: GenericValidateAuditOperation;
  genericSettlementError: GenericSettlementErrorOperation;
}

export function createGenericLedger(deps: GenericLedgerDependencies): GenericLedgerOperation {
  function genericLedger(node: GenericGraphNode, graph: CapturedGenericShortGraph): void {
    let previous: NativeReconciliationRow | null = null,
      modernSeen = false;
    for (const row of node.ledger) {
      if (
        row.originalJobId !== node.job.id ||
        !writeTaskUuid(row.id) ||
        !writeTaskTime(row.createdAt) ||
        (previous && (row.sequence <= previous.sequence || previous.status !== 'uncertain'))
      )
        return genericUnavailable();
      const read = graph.jobs[row.readJobId];
      if (!read) return genericUnavailable();
      const modern = hasGenericShortStatusSignal([read.job, read.documents]);
      deps.genericReadComplete(read, modern);
      const ref = read.refs[0]!,
        payload = genericObject(read.documents[0]!.payload),
        observed = genericObject(payload.reconciliation, [
          'originalJobId',
          'target',
          'inputHash',
          'observedContentHash',
          'observedStatus',
        ]),
        closure = genericObject(JSON.parse(row.resultJson), [
          'target',
          'reconciliationJobId',
          'evidence',
          'observedStatus',
          'result',
        ]);
      if (
        row.evidenceId !== ref.id ||
        row.readJobId !== read.job.id ||
        ref.dataset !== 'reconciliation' ||
        read.job.inputHash !== genericDigest({ jobId: node.job.id }) ||
        observed.originalJobId !== node.job.id ||
        observed.inputHash !== node.job.inputHash ||
        !genericSame(observed.target, node.job.target) ||
        !genericSame(closure, {
          target: node.job.target,
          reconciliationJobId: read.job.id,
          evidence: ref,
          observedStatus: observed.observedStatus,
          result: {
            contentHash: observed.observedContentHash,
            platformState: observed.observedStatus,
          },
        }) ||
        canonicalJson(closure) !== row.resultJson ||
        read.job.endedAt! > row.createdAt ||
        (previous && read.job.platformReadStartedAt! <= previous.createdAt)
      )
        return genericUnavailable();
      const status =
        observed.observedStatus === 'unknown'
          ? 'uncertain'
          : observed.observedStatus === 'not_applied'
            ? 'failed'
            : 'succeeded';
      if (row.status !== status) return genericUnavailable();
      if (modern) {
        modernSeen = true;
        deps.genericValidateAudit(read, graph, row);
      } else {
        if (modernSeen) return genericUnavailable();
        const intent = node.documents
          .filter((_, i) => node.refs[i]?.dataset === 'write-intent')
          .map((doc) => genericObject(doc.payload))
          .at(-1);
        if (
          status === 'succeeded' &&
          (!intent ||
            observed.observedContentHash !== intent.desiredContentHash ||
            !Array.isArray(intent.expectedStates) ||
            !(intent.expectedStates as unknown[]).includes(observed.observedStatus))
        )
          return genericUnavailable();
      }
      previous = row;
    }
    if (
      previous &&
      (node.job.status !== previous.status ||
        !genericSame(node.job.result, JSON.parse(previous.resultJson)) ||
        !genericSame(node.job.error, deps.genericSettlementError(previous.status)) ||
        node.job.endedAt !== previous.createdAt ||
        node.job.updatedAt !== previous.createdAt)
    )
      return genericUnavailable();
  }
  return genericLedger;
}
