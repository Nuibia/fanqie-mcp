import {
  type Job,
  type GenericGraphNode,
  type CapturedGenericShortGraph,
} from '../runtime-error.js';
import {
  genericObject,
  genericJobKeys,
  genericUnavailable,
  genericSame,
  hasGenericShortStatusSignal,
  genericDigest,
} from '../has-generic-short-status-signal.js';
import {
  type GenericAuditPriorOperation,
  type GenericRootAnchorOperation,
  type GenericEffectHistoryOperation,
  type GenericSettlementErrorOperation,
  type GenericPointerOperation,
  type GenericPrefixOperation,
  type GenericValidateAuditOperation,
} from '../contracts/generic-status-generic-refs.js';

import { type NativeReconciliationRow } from '../native-closure-signal.js';

import { validateGenericShortSnapshot } from '../../../platform/writes.js';

interface GenericAuditPriorDependencies {}

export function createGenericAuditPrior(
  deps: GenericAuditPriorDependencies,
): GenericAuditPriorOperation {
  function genericAuditPrior(audit: Record<string, unknown>): Job {
    return genericObject(
      audit.schema === 'generic-short-terminal-publication-bridge/v1'
        ? audit.requestedOriginal
        : audit.priorJob,
      genericJobKeys,
    ) as unknown as Job;
  }
  return genericAuditPrior;
}

interface GenericValidateAuditDependencies {
  genericAuditPrior: GenericAuditPriorOperation;
  genericRootAnchor: GenericRootAnchorOperation;
  genericEffectHistory: GenericEffectHistoryOperation;
  genericSettlementError: GenericSettlementErrorOperation;
  genericPointer: GenericPointerOperation;
  genericPrefix: GenericPrefixOperation;
}

export function createGenericValidateAudit(
  deps: GenericValidateAuditDependencies,
): GenericValidateAuditOperation {
  function genericValidateAudit(
    node: GenericGraphNode,
    graph: CapturedGenericShortGraph,
    settledRow?: NativeReconciliationRow,
  ): void {
    const doc = node.documents[0],
      ref = node.refs[0];
    if (!doc || !ref) return genericUnavailable();
    const payload = genericObject(doc.payload),
      audit = genericObject(payload.originalAudit),
      prior = deps.genericAuditPrior(audit),
      actual = graph.jobs[prior.id];
    if (
      !actual ||
      prior.accountId !== graph.accountId ||
      node.job.accountId !== graph.accountId ||
      node.job.operation !== 'reconcile_write' ||
      node.job.scope !== 'reconciliation' ||
      !genericSame(node.job.datasets, ['reconciliation']) ||
      node.job.inputHash !== genericDigest({ jobId: prior.id }) ||
      !genericSame(
        audit.schema === 'generic-short-terminal-publication-bridge/v1'
          ? audit.requestedEvidence
          : audit.priorEvidence,
        actual.refs,
      )
    )
      return genericUnavailable();
    const observation = genericObject(payload.reconciliation, [
      'originalJobId',
      'target',
      'inputHash',
      'observedContentHash',
      'observedStatus',
    ]);
    if (observation.originalJobId !== prior.id || observation.inputHash !== prior.inputHash)
      return genericUnavailable();
    const originalAudit = audit.schema === 'generic-short-write-original-audit/v1',
      bridge = audit.schema === 'generic-short-write-publication-bridge-audit/v1',
      terminalBridge = audit.schema === 'generic-short-terminal-publication-bridge/v1';
    if (originalAudit)
      genericObject(audit, [
        'schema',
        'phase',
        'priorJob',
        'priorEvidence',
        'firstSettlement',
        'previousSettlement',
      ]);
    else if (bridge)
      genericObject(audit, [
        'schema',
        'phase',
        'effectLevel',
        'priorJob',
        'priorEvidence',
        'legacyPrefix',
        'sourceRead',
        'firstBridgeSettlement',
        'previousSettlement',
      ]);
    else if (terminalBridge)
      genericObject(audit, [
        'schema',
        'mode',
        'requestedOriginal',
        'requestedEvidence',
        'anchorOriginal',
        'anchorEvidence',
        'effectHistory',
        'rootLink',
        'sourceRead',
      ]);
    else return genericUnavailable();
    const anchor = terminalBridge
      ? (genericObject(audit.anchorOriginal, genericJobKeys) as unknown as Job)
      : prior;
    if (!genericSame(observation.target, anchor.target)) return genericUnavailable();
    if (
      (payload.repairVerification !== undefined &&
        !genericSame(payload.repairVerification, payload.statusSnapshot)) ||
      (prior.operation === 'repair_created_draft' &&
        observation.observedStatus === 'draft_saved' &&
        payload.repairVerification === undefined)
    )
      return genericUnavailable();
    const snapshot = validateGenericShortSnapshot(payload.statusSnapshot);
    if (
      snapshot.contentHash !== observation.observedContentHash ||
      !genericSame({ kind: 'short-story', id: snapshot.target.workId }, anchor.target) ||
      payload.sourceUrl !== snapshot.sourceUrl ||
      payload.platformReadAt !== snapshot.platformReadAt
    )
      return genericUnavailable();
    if (terminalBridge || bridge) {
      const sr = genericObject(audit.sourceRead, [
        'jobId',
        'accountId',
        'operation',
        'scope',
        'datasets',
        'inputHash',
        'target',
      ]);
      if (
        !genericSame(sr, {
          jobId: node.job.id,
          accountId: node.job.accountId,
          operation: node.job.operation,
          scope: node.job.scope,
          datasets: node.job.datasets,
          inputHash: node.job.inputHash,
          target: anchor.target,
        })
      )
        return genericUnavailable();
    }
    const head = actual.ledger.at(-1),
      index = settledRow
        ? actual.ledger.findIndex((row) => row.sequence === settledRow.sequence)
        : -1;
    if (terminalBridge) {
      if (
        audit.mode !== 'observation-only' ||
        settledRow ||
        payload.repairVerification !== undefined ||
        observation.observedStatus !== 'unknown' ||
        !genericSame(prior, actual.job)
      )
        return genericUnavailable();
      const authenticated = deps.genericRootAnchor(graph, prior.id);
      if (
        !genericSame(audit.rootLink, authenticated.rootLink) ||
        !genericSame(anchor, authenticated.node.job) ||
        !genericSame(audit.anchorEvidence, authenticated.node.refs)
      )
        return genericUnavailable();
      const history = deps.genericEffectHistory(authenticated.node, graph);
      if (!genericSame(history, audit.effectHistory)) return genericUnavailable();
      const latest = [
        prior.endedAt,
        prior.updatedAt,
        anchor.endedAt,
        anchor.updatedAt,
        head?.createdAt,
      ]
        .filter((v): v is string => typeof v === 'string')
        .sort()
        .at(-1)!;
      if (!node.job.platformReadStartedAt || node.job.platformReadStartedAt <= latest)
        return genericUnavailable();
    } else {
      if (
        prior.status !== 'uncertain' ||
        !prior.endedAt ||
        !node.job.platformReadStartedAt ||
        node.job.platformReadStartedAt <= prior.endedAt
      )
        return genericUnavailable();
      if (!settledRow) {
        if (!genericSame(prior, actual.job)) return genericUnavailable();
      } else {
        const prev = index > 0 ? actual.ledger[index - 1] : null;
        if (prev) {
          const priorHead = {
            ...prior,
            status: prev.status,
            result: JSON.parse(prev.resultJson),
            error: deps.genericSettlementError(prev.status),
            endedAt: prev.createdAt,
            updatedAt: prev.createdAt,
          };
          if (!genericSame(prior, priorHead) || prev.status !== 'uncertain')
            return genericUnavailable();
        }
        const immutable = genericJobKeys.filter(
          (key) => !['status', 'result', 'error', 'endedAt', 'updatedAt'].includes(key),
        );
        for (const key of immutable)
          if (
            !genericSame(
              (prior as unknown as Record<string, unknown>)[key],
              (actual.job as unknown as Record<string, unknown>)[key],
            )
          )
            return genericUnavailable();
      }
      if (originalAudit) {
        const first = actual.ledger[0],
          previous = settledRow ? (index > 0 ? actual.ledger[index - 1] : null) : head;
        if (audit.phase === 'initial') {
          if (
            previous ||
            audit.firstSettlement !== null ||
            audit.previousSettlement !== null ||
            !genericSame(prior.result, { evidence: actual.refs }) ||
            prior.error?.code !== 'outcome_unknown'
          )
            return genericUnavailable();
          const failure = genericObject(prior.error, ['code', 'message'], ['details']);
          if (
            failure.message === 'The platform write may have happened; reconcile before retrying.'
          ) {
            const details = genericObject(failure.details, ['cause']);
            genericObject(details.cause, ['code', 'message'], ['details']);
          } else if (
            failure.message !==
              'A previous service stopped during this write; reconcile before retrying.' ||
            Object.hasOwn(failure, 'details')
          )
            return genericUnavailable();
        } else if (audit.phase === 'continuation') {
          if (
            !first ||
            !previous ||
            !genericSame(audit.firstSettlement, deps.genericPointer(first, graph)) ||
            !genericSame(audit.previousSettlement, deps.genericPointer(previous, graph))
          )
            return genericUnavailable();
        } else return genericUnavailable();
      } else {
        if (audit.effectLevel !== 'legacy-reconciliation') return genericUnavailable();
        const prefixCount = Number(
            genericObject(audit.legacyPrefix, ['rowCount', 'first', 'last', 'rowsHash']).rowCount,
          ),
          prefix = actual.ledger.slice(0, prefixCount);
        if (
          !Number.isSafeInteger(prefixCount) ||
          prefixCount < 1 ||
          prefix.length !== prefixCount ||
          !genericSame(audit.legacyPrefix, deps.genericPrefix(prefix, graph))
        )
          return genericUnavailable();
        for (const row of prefix) {
          const read = graph.jobs[row.readJobId];
          if (!read || hasGenericShortStatusSignal(read.documents)) return genericUnavailable();
        }
        const previous = settledRow ? actual.ledger[index - 1] : head;
        if (
          !previous ||
          !genericSame(audit.previousSettlement, deps.genericPointer(previous, graph))
        )
          return genericUnavailable();
        if (audit.phase === 'boundary') {
          if (previous.sequence !== prefix.at(-1)!.sequence || audit.firstBridgeSettlement !== null)
            return genericUnavailable();
        } else if (audit.phase === 'continuation') {
          const first = actual.ledger[prefixCount];
          if (
            !first ||
            !genericSame(audit.firstBridgeSettlement, deps.genericPointer(first, graph))
          )
            return genericUnavailable();
        } else return genericUnavailable();
      }
      const desired = actual.documents
          .filter((_, i) => actual.refs[i]?.dataset === 'write-intent')
          .map((doc) => genericObject(doc.payload))
          .at(-1),
        state = snapshot.state === 'draft' ? 'draft_saved' : snapshot.state;
      const expected =
        desired &&
        desired.desiredContentHash === snapshot.contentHash &&
        Array.isArray(desired.expectedStates) &&
        (desired.expectedStates as unknown[]).includes(state)
          ? state
          : 'unknown';
      if (
        observation.observedStatus !== expected ||
        (payload.repairVerification !== undefined &&
          (prior.operation !== 'repair_created_draft' ||
            expected === 'unknown' ||
            !genericSame(payload.repairVerification, snapshot))) ||
        (prior.operation === 'repair_created_draft' &&
          expected !== 'unknown' &&
          payload.repairVerification === undefined)
      )
        return genericUnavailable();
    }
  }
  return genericValidateAudit;
}
