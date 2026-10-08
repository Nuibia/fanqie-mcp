import {
  type EvidenceRef,
  writeTaskTime,
  type GenericGraphNode,
  type CapturedGenericShortGraph,
} from '../runtime-error.js';
import { genericBindings } from '../native-closure-signal.js';
import {
  genericUnavailable,
  genericObject,
  genericSame,
  hasGenericShortStatusSignal,
} from '../has-generic-short-status-signal.js';
import { type ModernShortSnapshot } from '../../../platform/writes.js';
import {
  type GenericModernObservationsOperation,
  type GenericHistoricalOperation,
  type GenericLedgerOperation,
  type GenericQualifyWriteOperation,
  type GenericRootAnchorOperation,
  type GenericPointerOperation,
  type GenericPrefixOperation,
  type GenericEffectHistoryOperation,
} from '../contracts/generic-status-generic-refs.js';

interface GenericQualifyWriteDependencies {
  genericModernObservations: GenericModernObservationsOperation;
  ownerId: `${string}-${string}-${string}-${string}-${string}`;
  genericHistorical: GenericHistoricalOperation;
  genericLedger: GenericLedgerOperation;
  genericQualifyWrite: GenericQualifyWriteOperation;
  genericRootAnchor: GenericRootAnchorOperation;
}

export function createGenericQualifyWrite(
  deps: GenericQualifyWriteDependencies,
): GenericQualifyWriteOperation {
  function genericQualifyWrite(
    node: GenericGraphNode,
    graph: CapturedGenericShortGraph,
    depth = 0,
  ): { ref: EvidenceRef; snapshot: ModernShortSnapshot; phase: string } | null {
    if (depth >= 128 || node.job.kind !== 'write') return genericUnavailable();
    const storedWitness = genericObject(node.job.metadata).genericShortStatus,
      effectiveTarget =
        node.job.target ??
        (storedWitness === undefined ? null : genericObject(storedWitness).target);
    const modern = hasGenericShortStatusSignal([node.job, node.documents]),
      data = modern ? deps.genericModernObservations(node) : null;
    if (effectiveTarget === null) {
      if (
        !data?.witness ||
        node.job.operation !== 'create_draft' ||
        data.observations.length ||
        node.ledger.length ||
        node.refs.some(
          (ref, i) =>
            ref.dataset !== 'write-intent' ||
            genericObject(node.documents[i]!.payload).phase !== 'creation-entry',
        )
      )
        return genericUnavailable();
      const w = data.witness;
      if (
        ['queued', 'running', 'waiting_for_login'].includes(node.job.status) &&
        node.job.endedAt === null &&
        node.job.ownerId === deps.ownerId &&
        w.failure === null &&
        ['before_first_read', 'allocation_marked'].includes(String(w.stage))
      )
        return null;
      if (
        w.stage !== 'source_unavailable' ||
        genericObject(w.failure, ['kind', 'at']).kind !== 'source_unavailable' ||
        !['failed', 'uncertain', 'waiting_for_login'].includes(node.job.status) ||
        !node.job.endedAt ||
        node.job.updatedAt !== node.job.endedAt ||
        !node.job.error ||
        !genericSame(node.job.result, { evidence: node.refs })
      )
        return genericUnavailable();
      return null;
    }
    const target = genericObject(effectiveTarget, ['kind', 'id']);
    if (target.kind !== 'short-story') return genericUnavailable();
    if (!modern) deps.genericHistorical(node);
    if (!modern && ['update_work_metadata', 'submit_short_story'].includes(node.job.operation)) {
      if (
        node.job.scope !== 'account' ||
        node.job.datasets.length ||
        !writeTaskTime(node.job.requestedAt) ||
        !/^[a-f0-9]{64}$/.test(node.job.inputHash) ||
        typeof target.id !== 'string' ||
        !/^\d{10,22}$/.test(target.id)
      )
        return genericUnavailable();
      const intents = node.refs.filter((ref) => ref.dataset === 'write-intent');
      if (node.job.platformWriteStartedAt !== null && intents.length !== 1)
        return genericUnavailable();
      for (const ref of intents) {
        const intent = genericObject(node.documents[node.refs.indexOf(ref)]!.payload, [
          'desiredContentHash',
          'expectedStates',
          'target',
        ]);
        if (
          !genericSame(intent.target, node.job.target) ||
          typeof intent.desiredContentHash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(intent.desiredContentHash) ||
          !Array.isArray(intent.expectedStates) ||
          !intent.expectedStates.length ||
          intent.expectedStates.some(
            (state) =>
              !['draft_saved', 'reviewing', 'submitted', 'published', 'rejected'].includes(
                String(state),
              ),
          )
        )
          return genericUnavailable();
      }
      for (const ref of node.refs.filter((value) => value.dataset === 'write-result')) {
        const saved = genericObject(node.documents[node.refs.indexOf(ref)]!.payload);
        if (
          saved.capability !== node.job.operation ||
          !genericSame(saved.target, { kind: 'short', workId: target.id }) ||
          typeof saved.contentHash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(saved.contentHash)
        )
          return genericUnavailable();
      }
    }
    if (
      data?.witness &&
      ['resume_create_draft', 'repair_created_draft'].includes(node.job.operation)
    ) {
      const w = data.witness,
        context = genericObject(w.creationContext, [
          'originalJobId',
          'recoveryJobId',
          'previousRepairJobId',
        ]),
        bindings = genericObject(w.requestBindings),
        parent = graph.jobs[String(context.originalJobId)],
        relation = parent?.relations.recovery;
      if (
        !parent ||
        parent.job.operation !== 'create_draft' ||
        parent.job.accountId !== node.job.accountId ||
        parent.job.inputHash !== bindings.originalInputHash ||
        !genericSame(parent.job.target, w.target) ||
        !relation
      )
        return genericUnavailable();
      const allocation = genericObject(relation),
        allocationBindings = genericObject(
          JSON.parse(String(allocation.bindings_json)),
          genericBindings.resume_create_draft,
        );
      if (node.job.operation === 'resume_create_draft') {
        if (allocation.resume_job_id !== node.job.id || !genericSame(allocationBindings, bindings))
          return genericUnavailable();
      } else {
        const recovery = graph.jobs[String(context.recoveryJobId)];
        if (
          !recovery ||
          recovery.job.operation !== 'resume_create_draft' ||
          recovery.job.accountId !== node.job.accountId ||
          recovery.job.inputHash !== bindings.recoveryInputHash ||
          allocation.resume_job_id !== recovery.job.id ||
          !genericSame(recovery.job.target, w.target) ||
          !genericSame(allocationBindings, {
            accountId: node.job.accountId,
            originalInputHash: bindings.originalInputHash,
            resumeInputHash: bindings.recoveryInputHash,
            clientReferenceHash: bindings.clientReferenceHash,
            requestedContentHash: bindings.requestedContentHash,
          })
        )
          return genericUnavailable();
        const claimed =
          context.previousRepairJobId === null
            ? parent.relations.firstRepair
            : node.relations.successorByIds;
        if (node.job.target === null) {
          if (
            (claimed && genericObject(claimed).repair_job_id === node.job.id) ||
            node.job.platformWriteStartedAt !== null ||
            node.refs.some((ref) =>
              ['write-intent', 'write-result', 'creation-repair-verification'].includes(
                ref.dataset,
              ),
            )
          )
            return genericUnavailable();
        } else if (
          !claimed ||
          genericObject(claimed).repair_job_id !== node.job.id ||
          !genericSame(JSON.parse(String(genericObject(claimed).bindings_json)), bindings)
        )
          return genericUnavailable();
      }
    }
    if (node.ledger.length) deps.genericLedger(node, graph);
    const result = genericObject(node.job.result ?? {});
    if (Object.hasOwn(result, 'creationRecovery') || Object.hasOwn(result, 'creationRepair'))
      return deps.genericQualifyWrite(
        deps.genericRootAnchor(graph, node.job.id, depth + 1).node,
        graph,
        depth + 1,
      );
    if (data) {
      const w = data.witness!;
      if (
        w.stage === 'capture_failed' ||
        w.stage === 'persist_failed' ||
        (w.failure !== null &&
          ['capture_failed', 'persist_failed'].includes(String(genericObject(w.failure).kind)))
      )
        return genericUnavailable();
      if (node.job.status === 'succeeded' && !node.ledger.length) {
        if (
          w.stage !== 'completed' ||
          w.failure !== null ||
          data.observations.length !==
            (node.job.operation === 'repair_created_draft'
              ? 4
              : node.job.operation === 'resume_create_draft'
                ? 3
                : 2) ||
          node.refs.filter(
            (ref, i) =>
              ref.dataset === 'write-intent' &&
              genericObject(node.documents[i]!.payload).phase !== 'creation-entry',
          ).length !== 1
        )
          return genericUnavailable();
      } else if (!data.observations.length) {
        if (
          ['queued', 'running', 'waiting_for_login'].includes(node.job.status) &&
          node.job.endedAt === null &&
          node.job.ownerId === deps.ownerId &&
          ['before_first_read', 'allocation_marked'].includes(String(w.stage)) &&
          w.failure === null
        )
          return null;
        if (
          w.stage !== 'source_unavailable' ||
          genericObject(w.failure, ['kind', 'at']).kind !== 'source_unavailable' ||
          !['failed', 'uncertain', 'waiting_for_login'].includes(node.job.status)
        )
          return genericUnavailable();
        return null;
      } else if (
        (w.stage === 'completed' && !node.ledger.length && node.job.status !== 'succeeded') ||
        (['failed', 'partial', 'cancelled'].includes(node.job.status) && w.failure === null)
      )
        return genericUnavailable();
    }
    if (node.job.status === 'succeeded' && !node.ledger.length) {
      const results = node.refs.filter((ref) => ref.dataset === 'write-result');
      if (
        results.length !== 1 ||
        !genericSame(node.documents[node.refs.indexOf(results[0]!)]!.payload, node.job.result)
      )
        return genericUnavailable();
      genericObject(result, [
        'status',
        'capability',
        'target',
        'contentHash',
        'platformState',
        'verifiedAt',
        'sourceUrl',
      ]);
      if (
        result.status !== 'succeeded' ||
        !genericSame(result.target, { kind: 'short', workId: target.id }) ||
        (data || !['update_work_metadata', 'submit_short_story'].includes(node.job.operation)
          ? result.platformState !== 'draft'
          : result.capability !== node.job.operation ||
            !['draft', 'reviewing', 'submitted', 'published', 'rejected'].includes(
              String(result.platformState),
            ))
      )
        return genericUnavailable();
      if (data) {
        const after = data.observations.find(
          (v) => v.ref.dataset === 'editable_snapshot' && v.phase === 'after',
        );
        if (
          !after ||
          result.contentHash !== after.snapshot.contentHash ||
          result.verifiedAt !== after.snapshot.platformReadAt ||
          result.sourceUrl !== after.snapshot.sourceUrl
        )
          return genericUnavailable();
      }
    }
    return data?.observations.at(-1) ?? null;
  }
  return genericQualifyWrite;
}

interface GenericEffectHistoryDependencies {
  genericQualifyWrite: GenericQualifyWriteOperation;
  genericPointer: GenericPointerOperation;
  genericPrefix: GenericPrefixOperation;
}

export function createGenericEffectHistory(
  deps: GenericEffectHistoryDependencies,
): GenericEffectHistoryOperation {
  function genericEffectHistory(node: GenericGraphNode, graph: CapturedGenericShortGraph): unknown {
    deps.genericQualifyWrite(node, graph);
    if (!['succeeded', 'failed'].includes(node.job.status)) return genericUnavailable();
    if (node.ledger.length) {
      const modern = hasGenericShortStatusSignal(graph.jobs[node.ledger[0]!.readJobId]?.documents);
      return modern
        ? { kind: 'modern-ledger', head: deps.genericPointer(node.ledger.at(-1)!, graph) }
        : {
            kind: 'legacy-ledger',
            prefix: deps.genericPrefix(
              node.ledger.filter(
                (row) => !hasGenericShortStatusSignal(graph.jobs[row.readJobId]?.documents),
              ),
              graph,
            ),
            head: deps.genericPointer(node.ledger.at(-1)!, graph),
          };
    }
    if (node.job.status !== 'succeeded') return genericUnavailable();
    const ref = node.refs.find((ref) => ref.dataset === 'write-result');
    if (!ref) return genericUnavailable();
    return {
      kind: hasGenericShortStatusSignal([node.job, node.documents])
        ? 'modern-direct-success'
        : 'legacy-direct-success',
      resultEvidence: ref,
    };
  }
  return genericEffectHistory;
}
