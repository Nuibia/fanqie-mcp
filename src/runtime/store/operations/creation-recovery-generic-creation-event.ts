import {
  writeTaskUuid,
  writeTaskTime,
  type GenericGraphNode,
  type CapturedGenericShortGraph,
  type GenericShortPublicationTuple,
  type Job,
  GENERIC_SHORT_STATUS_PROTOCOL,
  type PlatformTarget,
  existingGenericReads,
} from '../runtime-error.js';
import { canonicalJson, genericBindings } from '../native-closure-signal.js';
import {
  genericUnavailable,
  genericObject,
  genericSame,
  genericUnknown,
} from '../has-generic-short-status-signal.js';
import {
  type GenericSelectOperation,
  type GenericRootAnchorOperation,
  type GenericQualifyWriteOperation,
  type GenericWitnessOperation,
} from '../contracts/generic-status-generic-refs.js';

import {
  type GenericCreationPriorViewOperation,
  type GenericCreationResumeClaimOperation,
  type GenericCreationAncestorOperation,
  type GenericCreationPriorOperation,
  type GenericCreationOpenFamilyOperation,
  type GenericCreationEventAssociationsOperation,
  type GenericCreationEventOperation,
  type GenericCreationEnvelopeOperation,
  type GenericRepairEntryOperation,
  type GetCreationRepairSuccessorOperation,
} from '../contracts/creation-recovery-generic-creation-prior.js';

import {
  type ListEvidenceOperation,
  type ReadEvidenceOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

import { validateGenericShortSnapshot } from '../../../platform/writes.js';

import { PublicReadCoordinator } from '../../public-read.js';
import {
  type EnsureOpenOperation,
  type PrepareOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';

interface GenericCreationEventDependencies {
  genericSelect: GenericSelectOperation;
  genericRootAnchor: GenericRootAnchorOperation;
  genericCreationPriorView: GenericCreationPriorViewOperation;
  genericCreationResumeClaim: GenericCreationResumeClaimOperation;
  genericCreationAncestor: GenericCreationAncestorOperation;
  genericCreationPrior: GenericCreationPriorOperation;
  genericQualifyWrite: GenericQualifyWriteOperation;
  genericCreationOpenFamily: GenericCreationOpenFamilyOperation;
  genericCreationEventAssociations: GenericCreationEventAssociationsOperation;
}

export function createGenericCreationEvent(
  deps: GenericCreationEventDependencies,
): GenericCreationEventOperation {
  function genericCreationEvent(graph: CapturedGenericShortGraph): {
    tuple: GenericShortPublicationTuple;
    rows: GenericGraphNode;
  } {
    const member = graph.jobs[graph.originalId];
    if (!member) return genericUnavailable();
    const historical =
      (member.job.operation === 'resume_create_draft' && member.relations.repairSummary !== null) ||
      (member.job.operation === 'repair_created_draft' &&
        member.relations.successorSummary !== null) ||
      member.job.error?.code === 'superseded_by_verified_repair';
    if (!historical) return { tuple: deps.genericSelect(graph), rows: member };
    if (
      member.job.kind !== 'write' ||
      !member.job.endedAt ||
      !['uncertain', 'failed'].includes(member.job.status)
    )
      return genericUnavailable();
    const rootIds = new Set<string>();
    for (const node of Object.values(graph.jobs)) {
      const recovery = node.relations.recovery as Record<string, unknown> | null;
      if (
        member.job.operation === 'resume_create_draft' &&
        recovery?.resume_job_id === member.job.id
      )
        rootIds.add(node.job.id);
      for (const value of [node.relations.firstRepair, node.relations.successor]) {
        if (value !== null && value !== undefined) {
          const relation = genericObject(value);
          if (
            member.job.operation === 'repair_created_draft' &&
            relation.repair_job_id === member.job.id
          ) {
            if (!writeTaskUuid(relation.original_job_id)) return genericUnavailable();
            rootIds.add(relation.original_job_id);
          }
        }
      }
    }
    if (rootIds.size !== 1) return genericUnavailable();
    const rootId = [...rootIds][0]!,
      root = graph.jobs[rootId];
    if (
      !root ||
      root.job.operation !== 'create_draft' ||
      root.job.accountId !== member.job.accountId
    )
      return genericUnavailable();
    const rootGraph = { ...graph, originalId: rootId },
      result = genericObject(root.job.result ?? {});
    let rows = member,
      members: string[],
      historicalReads: string[];
    if (Object.hasOwn(result, 'creationRepair') || Object.hasOwn(result, 'creationRecovery')) {
      const anchored = deps.genericRootAnchor(rootGraph, rootId);
      if (!anchored.creationMembers.includes(member.job.id)) return genericUnavailable();
      members = [rootId, anchored.node.job.id, ...anchored.creationMembers];
      historicalReads = anchored.historicalReads;
      const priorGraph = { ...rootGraph, jobs: { ...rootGraph.jobs } };
      priorGraph.jobs[rootId] = deps.genericCreationPriorView(root, result.prior, 'original');
      for (const id of anchored.creationMembers) {
        const node = graph.jobs[id]!;
        priorGraph.jobs[id] = deps.genericCreationPriorView(
          node,
          genericObject(node.job.result, ['supersededByVerifiedRepair', 'prior']).prior,
          node.job.operation === 'resume_create_draft' ? 'recovery' : 'repair',
        );
      }
      const recoveryRow = genericObject(root.relations.recovery),
        recoveryId = String(recoveryRow.resume_job_id),
        recovery = priorGraph.jobs[recoveryId],
        priorRoot = priorGraph.jobs[rootId]!,
        link = genericObject(result.creationRepair);
      if (
        !recovery ||
        recoveryRow.closed_at !== link.closedAt ||
        recoveryRow.closure_json !== canonicalJson(result) ||
        !genericSame(root.relations.recoverySummary, {
          resume_job_id: recoveryId,
          closed_at: link.closedAt,
        })
      )
        return genericUnavailable();
      const resumeBindings = deps.genericCreationResumeClaim(priorRoot, recovery, priorGraph);
      deps.genericCreationAncestor(recovery, priorRoot, recovery, resumeBindings, priorGraph);
      let relation = root.relations.firstRepair as Record<string, unknown> | null,
        previous = recovery;
      const visited = new Set<string>(),
        priors: unknown[] = [];
      let common: Record<string, unknown> | null = null;
      while (relation) {
        const attempt = priorGraph.jobs[String(relation.repair_job_id)];
        if (
          !attempt ||
          attempt.job.kind !== 'write' ||
          attempt.job.operation !== 'repair_created_draft' ||
          attempt.job.accountId !== graph.accountId ||
          attempt.job.scope !== 'account' ||
          attempt.job.datasets.length ||
          !genericSame(attempt.job.target, root.job.target) ||
          visited.has(attempt.job.id) ||
          visited.size >= 128 ||
          relation.original_job_id !== rootId ||
          relation.recovery_job_id !== recoveryId ||
          relation.closed_at !== link.closedAt ||
          relation.closure_json !== canonicalJson(result) ||
          relation.recovery_closure_json !== canonicalJson(graph.jobs[recoveryId]!.job.result) ||
          !previous.job.endedAt ||
          previous.job.endedAt > attempt.job.requestedAt ||
          !writeTaskTime(relation.created_at) ||
          relation.created_at < attempt.job.requestedAt ||
          (attempt.job.endedAt !== null && relation.created_at > attempt.job.endedAt) ||
          (previous.job.id !== recoveryId && relation.previous_repair_job_id !== previous.job.id)
        )
          return genericUnavailable();
        const bindings = genericObject(
            JSON.parse(String(relation.bindings_json)),
            genericBindings.repair_created_draft,
          ),
          prior = genericObject(
            JSON.parse(String(relation.prior_json)),
            ['original', 'recovery'],
            ['repairs'],
          ),
          shared = Object.fromEntries(
            Object.entries(bindings).filter(
              ([key]) => !['repairInputHash', 'expectedContentHash'].includes(key),
            ),
          );
        if (
          bindings.accountId !== graph.accountId ||
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
          !genericSame(prior.original, deps.genericCreationPrior(priorRoot, 'original')) ||
          !genericSame(prior.recovery, deps.genericCreationPrior(recovery, 'recovery')) ||
          !genericSame(prior.repairs ?? [], priors) ||
          attempt.job.metadata.creationOriginalJobId !== rootId ||
          attempt.job.metadata.creationRecoveryJobId !== recoveryId ||
          attempt.job.metadata.clientReferenceHash !== bindings.clientReferenceHash ||
          attempt.job.metadata.requestedContentHash !== bindings.requestedContentHash
        )
          return genericUnavailable();
        visited.add(attempt.job.id);
        common = shared;
        if (attempt.job.id === anchored.node.job.id) {
          if (attempt.relations.successor !== null) return genericUnavailable();
          break;
        }
        deps.genericCreationAncestor(attempt, priorRoot, recovery, bindings, priorGraph);
        priors.push(deps.genericCreationPrior(attempt, 'repair'));
        previous = attempt;
        relation = attempt.relations.successor as Record<string, unknown> | null;
      }
      if (!visited.has(anchored.node.job.id)) return genericUnavailable();
      rows = priorGraph.jobs[member.job.id]!;
      deps.genericQualifyWrite(rows, priorGraph);
    } else {
      const family = deps.genericCreationOpenFamily(rootGraph, root);
      members = family.members;
      historicalReads = family.historicalReads;
      if (!members.includes(member.job.id) || members.at(-1) === member.job.id)
        return genericUnavailable();
    }
    // The current root selector and the full family association pass remain
    // independent guards. A historical event cannot become their fresh source.
    deps.genericSelect(rootGraph);
    deps.genericCreationEventAssociations(rootGraph, members, historicalReads);
    return { tuple: genericUnknown(), rows };
  }
  return genericCreationEvent;
}

interface GenericCreationEnvelopeDependencies {
  listEvidence: ListEvidenceOperation;
  genericWitness: GenericWitnessOperation;
  readEvidence: ReadEvidenceOperation;
}

export function createGenericCreationEnvelope(
  deps: GenericCreationEnvelopeDependencies,
): GenericCreationEnvelopeOperation {
  function genericCreationEnvelope(job: Job, input: unknown, keys: string[]): boolean {
    const modern = Object.hasOwn(genericObject(job.metadata), 'genericShortStatus'),
      value = genericObject(input);
    if (
      !genericSame(
        Object.keys(value).sort(),
        [...keys, ...(modern ? ['statusProtocol'] : [])].sort(),
      ) ||
      (modern && value.statusProtocol !== GENERIC_SHORT_STATUS_PROTOCOL)
    )
      return false;
    if (modern) {
      const refs = deps.listEvidence(job.id);
      deps.genericWitness(
        job,
        refs,
        refs.map((ref) => deps.readEvidence(ref)),
      );
    }
    return true;
  }
  return genericCreationEnvelope;
}

interface GenericRepairEntryDependencies {
  listEvidence: ListEvidenceOperation;
  readEvidence: ReadEvidenceOperation;
  genericWitness: GenericWitnessOperation;
}

export function createGenericRepairEntry(
  deps: GenericRepairEntryDependencies,
): GenericRepairEntryOperation {
  function genericRepairEntry(
    job: Job,
    bindings: { expectedContentHash: string; desiredContentHash: string },
    target: PlatformTarget,
  ): boolean {
    const refs = deps.listEvidence(job.id);
    if (!Object.hasOwn(genericObject(job.metadata), 'genericShortStatus')) return refs.length === 0;
    const docs = refs.map((ref) => deps.readEvidence(ref)),
      w = deps.genericWitness(job, refs, docs, true);
    if (
      !w ||
      refs.length !== 2 ||
      refs[0]!.dataset !== 'creation-repair-baseline' ||
      refs[1]!.dataset !== 'editable_snapshot' ||
      w.stage !== 'baseline_saved' ||
      job.target !== null ||
      job.platformWriteStartedAt !== null ||
      (w.observations as unknown[]).length !== 2
    )
      return false;
    const a = validateGenericShortSnapshot(genericObject(docs[0]!.payload).snapshot),
      b = validateGenericShortSnapshot(genericObject(docs[1]!.payload).snapshot);
    return (
      a.statusFacts.draftEditable &&
      b.statusFacts.draftEditable &&
      a.contentHash === bindings.expectedContentHash &&
      b.contentHash === bindings.expectedContentHash &&
      genericSame({ kind: 'short-story', id: a.target.workId }, target) &&
      genericSame({ kind: 'short-story', id: b.target.workId }, target)
    );
  }
  return genericRepairEntry;
}

interface GetCreationRepairSuccessorDependencies {
  publicReads: PublicReadCoordinator;
  ensureOpen: EnsureOpenOperation;
  prepare: PrepareOperation;
}

export function createGetCreationRepairSuccessor(
  deps: GetCreationRepairSuccessorDependencies,
): GetCreationRepairSuccessorOperation {
  function getCreationRepairSuccessor(
    previousId: string,
  ): { repairJobId: string; closedAt: string | null } | null {
    return deps.publicReads.memo('store.getCreationRepairSuccessor', [previousId], () => {
      deps.ensureOpen();
      const row = deps.prepare(existingGenericReads.successorSummary).get(previousId);
      return row
        ? { repairJobId: String(row.repair_job_id), closedAt: row.closed_at as string | null }
        : null;
    });
  }
  return getCreationRepairSuccessor;
}
