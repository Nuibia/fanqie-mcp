import {
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
import {
  type GenericCreationResumeClaimOperation,
  type GenericCreationAncestorOperation,
  type GenericCreationPriorOperation,
  type GenericCreationOpenFamilyOperation,
  type GenericCreationEventAssociationsOperation,
} from '../contracts/creation-recovery-generic-creation-prior.js';

import {
  type GenericQualifyWriteOperation,
  type GenericAssociationOperation,
  type GenericUnobservedReadOperation,
  type GenericReadCompleteOperation,
  type GenericAuditPriorOperation,
  type GenericValidateAuditOperation,
} from '../contracts/generic-status-generic-refs.js';

interface GenericCreationOpenFamilyDependencies {
  genericCreationResumeClaim: GenericCreationResumeClaimOperation;
  genericCreationAncestor: GenericCreationAncestorOperation;
  genericCreationPrior: GenericCreationPriorOperation;
  genericQualifyWrite: GenericQualifyWriteOperation;
}

export function createGenericCreationOpenFamily(
  deps: GenericCreationOpenFamilyDependencies,
): GenericCreationOpenFamilyOperation {
  function genericCreationOpenFamily(
    graph: CapturedGenericShortGraph,
    root: GenericGraphNode,
  ): { members: string[]; historicalReads: string[] } {
    const relation = genericObject(root.relations.recovery),
      recovery = graph.jobs[String(relation.resume_job_id)];
    if (!recovery || relation.closed_at !== null || relation.closure_json !== null)
      return genericUnavailable();
    const resumeBindings = deps.genericCreationResumeClaim(root, recovery, graph);
    deps.genericCreationAncestor(recovery, root, recovery, resumeBindings, graph);
    const members = [root.job.id, recovery.job.id],
      historicalReads = recovery.ledger.map((row) => row.readJobId),
      priors: unknown[] = [];
    let row = root.relations.firstRepair as Record<string, unknown> | null,
      previous = recovery,
      common: Record<string, unknown> | null = null;
    if (!row) return genericUnavailable();
    while (row) {
      const attempt = graph.jobs[String(row.repair_job_id)];
      if (
        !attempt ||
        members.includes(attempt.job.id) ||
        members.length >= 130 ||
        row.original_job_id !== root.job.id ||
        row.recovery_job_id !== recovery.job.id ||
        row.closed_at !== null ||
        row.closure_json !== null ||
        row.recovery_closure_json !== null ||
        attempt.job.operation !== 'repair_created_draft' ||
        attempt.job.kind !== 'write' ||
        attempt.job.accountId !== root.job.accountId ||
        attempt.job.scope !== 'account' ||
        attempt.job.datasets.length ||
        !genericSame(attempt.job.target, root.job.target) ||
        !previous.job.endedAt ||
        previous.job.endedAt > attempt.job.requestedAt ||
        !writeTaskTime(row.created_at) ||
        row.created_at < attempt.job.requestedAt ||
        (attempt.job.endedAt !== null && row.created_at > attempt.job.endedAt) ||
        (previous.job.id !== recovery.job.id && row.previous_repair_job_id !== previous.job.id)
      )
        return genericUnavailable();
      const bindings = genericObject(
          JSON.parse(String(row.bindings_json)),
          genericBindings.repair_created_draft,
        ),
        prior = genericObject(
          JSON.parse(String(row.prior_json)),
          ['original', 'recovery'],
          ['repairs'],
        ),
        shared = Object.fromEntries(
          Object.entries(bindings).filter(
            ([key]) => !['repairInputHash', 'expectedContentHash'].includes(key),
          ),
        );
      if (
        bindings.accountId !== root.job.accountId ||
        bindings.originalInputHash !== root.job.inputHash ||
        bindings.recoveryInputHash !== recovery.job.inputHash ||
        bindings.repairInputHash !== attempt.job.inputHash ||
        bindings.clientReferenceHash !== resumeBindings.clientReferenceHash ||
        bindings.requestedContentHash !== resumeBindings.requestedContentHash ||
        Object.entries(bindings).some(
          ([key, value]) =>
            typeof value !== 'string' || (key !== 'accountId' && !/^[a-f0-9]{64}$/.test(value)),
        ) ||
        (common !== null && !genericSame(shared, common)) ||
        !genericSame(prior.original, deps.genericCreationPrior(root, 'original')) ||
        !genericSame(prior.recovery, deps.genericCreationPrior(recovery, 'recovery')) ||
        !genericSame(prior.repairs ?? [], priors) ||
        attempt.job.metadata.creationOriginalJobId !== root.job.id ||
        attempt.job.metadata.creationRecoveryJobId !== recovery.job.id ||
        attempt.job.metadata.clientReferenceHash !== bindings.clientReferenceHash ||
        attempt.job.metadata.requestedContentHash !== bindings.requestedContentHash
      )
        return genericUnavailable();
      common = shared;
      deps.genericQualifyWrite(attempt, graph);
      members.push(attempt.job.id);
      const next = attempt.relations.successor as Record<string, unknown> | null;
      if (next) {
        deps.genericCreationAncestor(attempt, root, recovery, bindings, graph);
        historicalReads.push(...attempt.ledger.map((value) => value.readJobId));
        priors.push(deps.genericCreationPrior(attempt, 'repair'));
      }
      row = next;
      previous = attempt;
    }
    return { members, historicalReads };
  }
  return genericCreationOpenFamily;
}

interface GenericCreationEventAssociationsDependencies {
  genericAssociation: GenericAssociationOperation;
  genericQualifyWrite: GenericQualifyWriteOperation;
  genericUnobservedRead: GenericUnobservedReadOperation;
  genericReadComplete: GenericReadCompleteOperation;
  genericAuditPrior: GenericAuditPriorOperation;
  genericValidateAudit: GenericValidateAuditOperation;
}

export function createGenericCreationEventAssociations(
  deps: GenericCreationEventAssociationsDependencies,
): GenericCreationEventAssociationsOperation {
  function genericCreationEventAssociations(
    graph: CapturedGenericShortGraph,
    members: string[],
    historicalReads: string[],
  ): void {
    const roots = new Set(members),
      authenticatedReads = new Set(historicalReads),
      refs = new Set<string>();
    for (const id of members) {
      const node = graph.jobs[id];
      if (!node) return genericUnavailable();
      for (const ref of node.refs) refs.add(ref.id);
      for (const row of node.ledger) {
        refs.add(row.readJobId);
        refs.add(row.evidenceId);
      }
    }
    for (const node of Object.values(graph.jobs)) {
      if (roots.has(node.job.id) || authenticatedReads.has(node.job.id)) continue;
      const association = deps.genericAssociation(node, graph, roots, refs);
      if (association === 'disjoint') continue;
      if (association === 'indeterminate') return genericUnavailable();
      if (node.job.kind === 'write') {
        deps.genericQualifyWrite(node, graph);
        continue;
      }
      if (node.job.kind !== 'read' || node.job.operation !== 'reconcile_write')
        return genericUnavailable();
      const modern = hasGenericShortStatusSignal([node.job, node.documents, node.manifest]);
      if (modern && !node.manifest) {
        deps.genericUnobservedRead(node);
        continue;
      }
      deps.genericReadComplete(node, modern);
      if (modern) {
        const audit = genericObject(genericObject(node.documents[0]!.payload).originalAudit),
          prior = deps.genericAuditPrior(audit);
        deps.genericValidateAudit(
          node,
          graph,
          graph.jobs[prior.id]?.ledger.find((row) => row.readJobId === node.job.id),
        );
      }
    }
  }
  return genericCreationEventAssociations;
}
