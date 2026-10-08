import {
  type GenericGraphNode,
  RuntimeError,
  type EvidenceRef,
  type Manifest,
  type CapturedGenericShortGraph,
  type GenericShortPublicationTuple,
} from '../runtime-error.js';
import {
  genericUnavailable,
  genericObject,
  genericSame,
  hasGenericShortStatusSignal,
  genericUnknown,
} from '../has-generic-short-status-signal.js';
import {
  type GenericModernObservationsOperation,
  type GenericUnobservedReadOperation,
  type GenericReadCompleteOperation,
  type GenericAuditPriorOperation,
  type GenericValidateAuditOperation,
  type GenericTupleOperation,
  type GenericQualifyWriteOperation,
  type GenericRootAnchorOperation,
  type GenericAssociationOperation,
  type GenericSelectOperation,
  type GenericReadGraphOperation,
  type GenericMutationGraphOperation,
} from '../contracts/generic-status-generic-refs.js';

import { type ModernShortSnapshot } from '../../../platform/writes.js';

import { type GenericCreationEventOperation } from '../contracts/creation-recovery-generic-creation-prior.js';

import { captureShortStatusJson } from '../../../platform/short-status.js';

interface GenericUnobservedReadDependencies {
  genericModernObservations: GenericModernObservationsOperation;
  ownerId: `${string}-${string}-${string}-${string}-${string}`;
}

export function createGenericUnobservedRead(
  deps: GenericUnobservedReadDependencies,
): GenericUnobservedReadOperation {
  function genericUnobservedRead(node: GenericGraphNode): void {
    const { witness, observations } = deps.genericModernObservations(node),
      job = node.job;
    if (
      !witness ||
      job.kind !== 'read' ||
      observations.length ||
      node.manifest ||
      node.refs.length ||
      !genericSame(witness.observations, [])
    )
      return genericUnavailable();
    if (
      ['queued', 'running', 'waiting_for_login'].includes(job.status) &&
      job.endedAt === null &&
      job.ownerId === deps.ownerId &&
      witness.failure === null &&
      witness.stage === 'before_first_read'
    )
      return;
    if (
      !['failed', 'waiting_for_login'].includes(job.status) ||
      !job.endedAt ||
      job.updatedAt !== job.endedAt ||
      witness.stage !== 'source_unavailable' ||
      genericObject(witness.failure, ['kind', 'at']).kind !== 'source_unavailable' ||
      !genericSame(job.result, { evidence: [] }) ||
      !job.error ||
      [
        'evidence_binding_invalid',
        'evidence_hash_invalid',
        'evidence_path_invalid',
        'invalid_json',
      ].includes(job.error.code)
    )
      return genericUnavailable();
  }
  return genericUnobservedRead;
}

interface GenericSelectDependencies {
  genericUnobservedRead: GenericUnobservedReadOperation;
  genericReadComplete: GenericReadCompleteOperation;
  genericModernObservations: GenericModernObservationsOperation;
  genericAuditPrior: GenericAuditPriorOperation;
  genericValidateAudit: GenericValidateAuditOperation;
  genericCreationEvent: GenericCreationEventOperation;
  genericTuple: GenericTupleOperation;
  genericQualifyWrite: GenericQualifyWriteOperation;
  genericRootAnchor: GenericRootAnchorOperation;
  genericAssociation: GenericAssociationOperation;
}

export function createGenericSelect(deps: GenericSelectDependencies): GenericSelectOperation {
  function genericSelect(graph: CapturedGenericShortGraph): GenericShortPublicationTuple {
    const root = graph.jobs[graph.originalId];
    if (!root) return genericUnavailable();
    if (root.job.kind === 'read') {
      const modern = hasGenericShortStatusSignal([root.job, root.documents]);
      if (modern && !root.manifest) {
        deps.genericUnobservedRead(root);
        return genericUnknown();
      }
      deps.genericReadComplete(root, modern);
      if (!modern) return genericUnknown();
      const data = deps.genericModernObservations(root);
      if (root.job.operation === 'reconcile_write') {
        const audit = genericObject(genericObject(root.documents[0]!.payload).originalAudit),
          prior = deps.genericAuditPrior(audit),
          actual = graph.jobs[prior.id];
        deps.genericValidateAudit(
          root,
          graph,
          actual?.ledger.find((row) => row.readJobId === root.job.id),
        );
        if (
          !actual ||
          actual.job.kind !== 'write' ||
          actual.job.id !== prior.id ||
          actual.job.accountId !== graph.accountId
        )
          return genericUnavailable();
        // Qualify the existing complete family as a refusal gate. Historical
        // reads keep their own immutable M11 tuple even when a newer read exists.
        deps.genericCreationEvent({ ...graph, originalId: actual.job.id });
      }
      const source = data.observations[0];
      if (!source) return genericUnavailable();
      return deps.genericTuple(source);
    }
    if (
      root.job.target === null &&
      root.refs.every((ref) => ref.dataset === 'write-intent') &&
      hasGenericShortStatusSignal(root.job)
    ) {
      deps.genericQualifyWrite(root, graph);
      return genericUnknown();
    }
    if (
      (root.job.operation === 'resume_create_draft' && root.relations.repairSummary) ||
      (root.job.operation === 'repair_created_draft' && root.relations.successorSummary)
    )
      throw new RuntimeError(
        'creation_repair_conflict',
        'Only the latest repair may be projected as the current publication source.',
      );
    const anchored = deps.genericRootAnchor(graph, graph.originalId),
      leaf = anchored.node,
      own = deps.genericQualifyWrite(leaf, graph);
    const roots = new Set([root.job.id, leaf.job.id]),
      members = new Set<string>(),
      creationMembers = new Set(anchored.creationMembers),
      historicalReads = new Set(anchored.historicalReads);
    for (const id of [...roots, ...creationMembers]) {
      const n = graph.jobs[id]!;
      for (const ref of n.refs) members.add(ref.id);
      for (const row of n.ledger) {
        members.add(row.readJobId);
        members.add(row.evidenceId);
      }
    }
    const candidates: Array<{
      source: { ref: EvidenceRef; snapshot: ModernShortSnapshot; phase: string };
      manifest: Manifest;
      order: number;
    }> = [];
    const manifestOrder = new Map<string, number>();
    graph.rawManifests.forEach((raw, i) => {
      const row = genericObject(raw);
      const m = genericObject(JSON.parse(String(row.manifest_json)));
      manifestOrder.set(String(m.jobId), i);
    });
    for (const node of Object.values(graph.jobs)) {
      if (roots.has(node.job.id)) continue;
      const association = deps.genericAssociation(node, graph, roots, members);
      if (association === 'disjoint') continue;
      if (association === 'indeterminate') return genericUnavailable();
      if (creationMembers.has(node.job.id) || historicalReads.has(node.job.id)) continue; // Already authenticated through the actual closed claim/prior/ancestor graph; never a new root/source.
      if (node.job.kind === 'write') {
        deps.genericQualifyWrite(node, graph);
        continue;
      } // Related write/control prefixes are certified under T3/T4, never admitted as cross-job fresh reads.
      if (node.job.kind !== 'read' || node.job.operation !== 'reconcile_write')
        return genericUnavailable();
      const modern = hasGenericShortStatusSignal([node.job, node.documents, node.manifest]);
      if (modern && !node.manifest) {
        deps.genericUnobservedRead(node);
        continue;
      }
      deps.genericReadComplete(node, modern);
      if (!modern) continue;
      const audit = genericObject(genericObject(node.documents[0]!.payload).originalAudit),
        prior = deps.genericAuditPrior(audit);
      deps.genericValidateAudit(
        node,
        graph,
        graph.jobs[prior.id]?.ledger.find((row) => row.readJobId === node.job.id),
      );
      const source = deps.genericModernObservations(node).observations[0];
      if (!source || source.phase !== 'later_read') return genericUnavailable();
      candidates.push({
        source,
        manifest: node.manifest!,
        order: manifestOrder.get(node.job.id) ?? Number.MAX_SAFE_INTEGER,
      });
    }
    candidates.sort(
      (a, b) =>
        b.manifest.committedAt.localeCompare(a.manifest.committedAt) ||
        b.source.ref.capturedAt.localeCompare(a.source.ref.capturedAt) ||
        a.order - b.order,
    );
    return candidates[0]
      ? deps.genericTuple(candidates[0].source)
      : own && 'ref' in own
        ? deps.genericTuple(own)
        : genericUnknown();
  }
  return genericSelect;
}

interface GenericTupleDependencies {}

export function createGenericTuple(deps: GenericTupleDependencies): GenericTupleOperation {
  function genericTuple(source: {
    ref: EvidenceRef;
    snapshot: ModernShortSnapshot;
    phase: string;
  }): GenericShortPublicationTuple {
    const { ref, snapshot, phase } = source;
    return {
      state: snapshot.state,
      statusFacts: captureShortStatusJson(snapshot.statusFacts),
      statusSource: {
        phase,
        sourceRef: ref.id,
        evidenceHash: ref.sha256,
        evidenceCapturedAt: ref.capturedAt,
      },
      statusEvidence: {
        id: ref.id,
        jobId: ref.jobId,
        dataset: ref.dataset,
        sha256: ref.sha256,
        capturedAt: ref.capturedAt,
      },
    };
  }
  return genericTuple;
}

interface GenericMutationGraphDependencies {
  genericReadGraph: GenericReadGraphOperation;
}

export function createGenericMutationGraph(
  deps: GenericMutationGraphDependencies,
): GenericMutationGraphOperation {
  function genericMutationGraph(originalId: string, accountId: string): CapturedGenericShortGraph {
    return deps.genericReadGraph(originalId, accountId, 'native');
  }
  return genericMutationGraph;
}
