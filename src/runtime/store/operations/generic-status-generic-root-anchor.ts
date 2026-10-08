import {
  type JobStatus,
  type RuntimeFailure,
  type PlatformTarget,
  writeTaskTime,
  type GenericGraphNode,
  type CapturedGenericShortGraph,
} from '../runtime-error.js';
import { canonicalJson, hash, genericBindings } from '../native-closure-signal.js';
import {
  genericUnavailable,
  genericObject,
  genericSame,
  genericDigest,
} from '../has-generic-short-status-signal.js';
import {
  type GenericModernObservationsOperation,
  type GenericHistoricalOperation,
  type GenericQualifyWriteOperation,
  type GenericRootAnchorOperation,
} from '../contracts/generic-status-generic-refs.js';

interface GenericRootAnchorDependencies {
  genericModernObservations: GenericModernObservationsOperation;
  genericHistorical: GenericHistoricalOperation;
  genericQualifyWrite: GenericQualifyWriteOperation;
}

export function createGenericRootAnchor(
  deps: GenericRootAnchorDependencies,
): GenericRootAnchorOperation {
  function genericRootAnchor(
    graph: CapturedGenericShortGraph,
    rootId: string,
    depth = 0,
  ): {
    node: GenericGraphNode;
    rootLink: unknown;
    creationMembers: string[];
    historicalReads: string[];
  } {
    if (depth >= 128) return genericUnavailable();
    const node = graph.jobs[rootId];
    if (!node) return genericUnavailable();
    const result = genericObject(node.job.result ?? {}),
      key = Object.hasOwn(result, 'creationRepair')
        ? 'creationRepair'
        : Object.hasOwn(result, 'creationRecovery')
          ? 'creationRecovery'
          : null;
    if (!key) return { node, rootLink: null, creationMembers: [], historicalReads: [] };
    if (node.job.kind !== 'write' || !node.job.target || node.job.target.kind !== 'short-story')
      return genericUnavailable();
    genericObject(result, [key, 'prior']);
    const link = genericObject(result[key]),
      isRepair = key === 'creationRepair',
      leafId = String(isRepair ? link.repairJobId : link.resumeJobId);
    const firstRelation = node.relations.closedRepair as Record<string, unknown> | null;
    const relation = (
      isRepair
        ? firstRelation?.repair_job_id === leafId
          ? firstRelation
          : node.relations.closedSuccessor
        : node.relations.recovery
    ) as Record<string, unknown> | null;
    if (
      !relation ||
      relation.original_job_id !== rootId ||
      (!isRepair && relation.resume_job_id !== leafId) ||
      relation.closed_at !== link.closedAt ||
      relation.closure_json !== canonicalJson(result) ||
      node.job.status !== 'succeeded' ||
      node.job.endedAt !== link.closedAt ||
      node.job.updatedAt !== link.closedAt ||
      !genericSame(link.target, node.job.target) ||
      link.originalJobId !== rootId
    )
      return genericUnavailable();
    const leaf = graph.jobs[leafId];
    if (
      !leaf ||
      leaf.job.accountId !== node.job.accountId ||
      !genericSame(leaf.job.target, node.job.target) ||
      leaf.job.status !== 'succeeded' ||
      leaf.job.operation !== (isRepair ? 'repair_created_draft' : 'resume_create_draft')
    )
      return genericUnavailable();
    const prior = genericObject(result.prior, [
      'status',
      'error',
      'result',
      'target',
      'endedAt',
      'intentRefs',
    ]);
    if (
      prior.status !== 'uncertain' ||
      !genericSame(prior.target, node.job.target) ||
      !genericSame(prior.intentRefs, node.refs) ||
      !genericSame(prior.result, { evidence: node.refs }) ||
      !writeTaskTime(prior.endedAt)
    )
      return genericUnavailable();
    const storedPrior = genericObject(JSON.parse(String(relation.prior_json)));
    if (!genericSame(isRepair ? storedPrior.original : storedPrior, prior))
      return genericUnavailable();
    const parentWitness = genericObject(node.job.metadata).genericShortStatus;
    if (parentWitness !== undefined)
      deps.genericModernObservations({
        ...node,
        job: {
          ...node.job,
          status: 'uncertain',
          result: prior.result,
          error: prior.error as RuntimeFailure,
          endedAt: prior.endedAt as string,
          updatedAt: prior.endedAt as string,
        },
      });
    else deps.genericHistorical(node);
    deps.genericQualifyWrite(leaf, graph, depth + 1);
    genericObject(
      link,
      isRepair
        ? [
            'originalJobId',
            'recoveryJobId',
            'repairJobId',
            'target',
            'requestedContentHash',
            'desiredContentHash',
            'expectedContentHash',
            'proof',
            'closedAt',
          ]
        : [
            'originalJobId',
            'resumeJobId',
            'target',
            'requestedContentHash',
            'desiredContentHash',
            'proof',
            'closedAt',
          ],
    );
    const bindings = genericObject(
        JSON.parse(String(relation.bindings_json)),
        genericBindings[isRepair ? 'repair_created_draft' : 'resume_create_draft'],
      ),
      parentEntry =
        node.refs.length === 1 && node.refs[0]!.dataset === 'write-intent'
          ? genericObject(node.documents[0]!.payload)
          : null;
    if (
      node.job.operation !== 'create_draft' ||
      !parentEntry ||
      parentEntry.phase !== 'creation-entry' ||
      parentEntry.capability !== 'create_draft' ||
      parentEntry.clientReferenceHash !== node.job.metadata.clientReferenceHash ||
      parentEntry.requestedContentHash !== link.requestedContentHash ||
      node.documents[0]!.collectionMode !== 'live' ||
      node.documents[0]!.evidenceKind !== 'local-intent' ||
      bindings.accountId !== node.job.accountId ||
      bindings.originalInputHash !== node.job.inputHash ||
      (isRepair ? bindings.repairInputHash : bindings.resumeInputHash) !== leaf.job.inputHash ||
      bindings.clientReferenceHash !== parentEntry.clientReferenceHash ||
      bindings.requestedContentHash !== link.requestedContentHash ||
      (isRepair && bindings.desiredContentHash !== link.desiredContentHash) ||
      !writeTaskTime(link.closedAt) ||
      !leaf.job.endedAt ||
      link.closedAt < leaf.job.endedAt
    )
      return genericUnavailable();
    const intents = leaf.refs.flatMap((ref, i) =>
        ref.dataset === 'write-intent'
          ? [
              {
                ref,
                payload: genericObject(leaf.documents[i]!.payload),
                document: leaf.documents[i]!,
              },
            ]
          : [],
      ),
      baseIndex = leaf.refs.findIndex(
        (ref) =>
          ref.dataset === (isRepair ? 'creation-repair-baseline' : 'creation-resume-baseline'),
      );
    if (
      intents.length !== 1 ||
      baseIndex < 0 ||
      intents[0]!.document.collectionMode !== 'live' ||
      intents[0]!.payload.desiredContentHash !== link.desiredContentHash ||
      !genericSame(intents[0]!.payload.target, node.job.target) ||
      !genericSame(intents[0]!.payload.expectedStates, ['draft_saved']) ||
      !leaf.job.platformWriteStartedAt ||
      intents[0]!.ref.capturedAt > leaf.job.platformWriteStartedAt
    )
      return genericUnavailable();
    const base = genericObject(leaf.documents[baseIndex]!.payload),
      before = genericObject(base.snapshot);
    if (
      leaf.documents[baseIndex]!.collectionMode !== 'live' ||
      base.originalJobId !== rootId ||
      base.requestedContentHash !== link.requestedContentHash ||
      !genericSame(base.target, node.job.target) ||
      before.state !== 'draft' ||
      leaf.refs[baseIndex]!.capturedAt > intents[0]!.ref.capturedAt ||
      (!isRepair && (before.title !== '' || before.body !== ''))
    )
      return genericUnavailable();
    const proof = genericObject(link.proof);
    const proofRef =
      leaf.refs.find((ref) => genericSame(ref, proof.evidence)) ??
      graph.jobs[String(proof.reconciliationJobId)]?.refs.find((ref) =>
        genericSame(ref, proof.evidence),
      );
    if (!proofRef) return genericUnavailable();
    const creationMembers: string[] = [],
      historicalReads: string[] = [];
    if (isRepair) {
      const recoveryId = String(link.recoveryJobId),
        recovery = graph.jobs[recoveryId],
        recoveryRelation = node.relations.recovery;
      if (
        !recovery ||
        !recoveryRelation ||
        genericObject(recoveryRelation).resume_job_id !== recoveryId ||
        recovery.job.operation !== 'resume_create_draft' ||
        recovery.job.status !== 'failed' ||
        recovery.job.error?.code !== 'superseded_by_verified_repair' ||
        !genericSame(recovery.job.target, node.job.target) ||
        relation.recovery_closure_json !== canonicalJson(recovery.job.result) ||
        base.recoveryJobId !== recoveryId ||
        before.contentHash !== link.expectedContentHash ||
        bindings.expectedContentHash !== link.expectedContentHash
      )
        return genericUnavailable();
      const recoveryResult = genericObject(recovery.job.result, [
        'supersededByVerifiedRepair',
        'prior',
      ]);
      if (
        !genericSame(recoveryResult.supersededByVerifiedRepair, link) ||
        !genericSame(genericObject(storedPrior).recovery, recoveryResult.prior)
      )
        return genericUnavailable();
      const recoveryPrior = genericObject(recoveryResult.prior, [
        'status',
        'error',
        'result',
        'target',
        'endedAt',
        'evidence',
        'metadata',
      ]);
      if (
        recoveryPrior.status !== 'uncertain' ||
        recovery.job.endedAt !== recoveryPrior.endedAt ||
        recovery.job.updatedAt !== link.closedAt ||
        !genericSame(recoveryPrior.evidence, recovery.refs) ||
        !genericSame(recoveryPrior.metadata, recovery.job.metadata) ||
        !genericSame(recoveryPrior.target, recovery.job.target)
      )
        return genericUnavailable();
      const historyGraph: CapturedGenericShortGraph = { ...graph, jobs: { ...graph.jobs } },
        asPrior = (member: GenericGraphNode, value: Record<string, unknown>): GenericGraphNode => ({
          ...member,
          job: {
            ...member.job,
            status: value.status as JobStatus,
            result: value.result,
            error: value.error as RuntimeFailure,
            target: value.target as PlatformTarget,
            endedAt: value.endedAt as string,
            updatedAt: value.endedAt as string,
          },
        });
      historyGraph.jobs[rootId] = asPrior(node, prior);
      historyGraph.jobs[recoveryId] = asPrior(recovery, recoveryPrior);
      deps.genericQualifyWrite(historyGraph.jobs[recoveryId]!, historyGraph, depth + 1);
      creationMembers.push(recoveryId);
      historicalReads.push(...recovery.ledger.map((row) => row.readJobId));
      const recoveryBindings = genericObject(
        JSON.parse(String(genericObject(recoveryRelation).bindings_json)),
        [
          'accountId',
          'originalInputHash',
          'resumeInputHash',
          'clientReferenceHash',
          'requestedContentHash',
        ],
      );
      if (
        !genericSame(recoveryBindings, {
          accountId: node.job.accountId,
          originalInputHash: node.job.inputHash,
          resumeInputHash: recovery.job.inputHash,
          clientReferenceHash: bindings.clientReferenceHash,
          requestedContentHash: link.requestedContentHash,
        })
      )
        return genericUnavailable();
      let cursor = node.relations.firstRepair as Record<string, unknown> | null;
      const seen = new Set<string>(),
        priors: unknown[] = [];
      while (cursor) {
        const id = String(cursor.repair_job_id),
          attempt = graph.jobs[id];
        if (
          seen.has(id) ||
          seen.size >= 128 ||
          !attempt ||
          cursor.original_job_id !== rootId ||
          cursor.recovery_job_id !== recoveryId ||
          cursor.closed_at !== link.closedAt ||
          cursor.closure_json !== canonicalJson(result)
        )
          return genericUnavailable();
        seen.add(id);
        const rowPrior = genericObject(JSON.parse(String(cursor.prior_json))),
          rowBindings = genericObject(JSON.parse(String(cursor.bindings_json)), [
            'accountId',
            'originalInputHash',
            'recoveryInputHash',
            'repairInputHash',
            'clientReferenceHash',
            'requestedContentHash',
            'desiredContentHash',
            'expectedContentHash',
            'requestedTitleHash',
            'requestedBodyHash',
          ]);
        if (
          !genericSame(rowPrior.original, prior) ||
          !genericSame(rowPrior.recovery, recoveryPrior) ||
          !genericSame(rowPrior.repairs ?? [], priors) ||
          rowBindings.repairInputHash !== attempt.job.inputHash ||
          Object.keys(rowBindings)
            .filter((key) => !['repairInputHash', 'expectedContentHash'].includes(key))
            .some((key) => !genericSame(rowBindings[key], bindings[key]))
        )
          return genericUnavailable();
        const baselineIndex = attempt.refs.findIndex(
            (ref) => ref.dataset === 'creation-repair-baseline',
          ),
          intentIndex = attempt.refs.findIndex((ref) => ref.dataset === 'write-intent');
        if (baselineIndex < 0 || intentIndex < 0) return genericUnavailable();
        const recordedBase = genericObject(attempt.documents[baselineIndex]!.payload),
          recordedSnapshot = genericObject(recordedBase.snapshot),
          recordedIntent = genericObject(attempt.documents[intentIndex]!.payload);
        if (
          attempt.documents[baselineIndex]!.collectionMode !== 'live' ||
          attempt.documents[intentIndex]!.collectionMode !== 'live' ||
          recordedBase.originalJobId !== rootId ||
          recordedBase.recoveryJobId !== recoveryId ||
          recordedBase.expectedContentHash !== rowBindings.expectedContentHash ||
          recordedBase.requestedContentHash !== rowBindings.requestedContentHash ||
          recordedSnapshot.state !== 'draft' ||
          recordedSnapshot.contentHash !== rowBindings.expectedContentHash ||
          recordedIntent.desiredContentHash !== rowBindings.desiredContentHash ||
          !genericSame(recordedIntent.target, node.job.target) ||
          !genericSame(recordedIntent.expectedStates, ['draft_saved']) ||
          attempt.refs[baselineIndex]!.capturedAt > attempt.refs[intentIndex]!.capturedAt ||
          !attempt.job.platformWriteStartedAt ||
          attempt.refs[intentIndex]!.capturedAt > attempt.job.platformWriteStartedAt
        )
          return genericUnavailable();
        if (id === leafId) break;
        const oldResult = genericObject(attempt.job.result, [
          'supersededByVerifiedRepair',
          'prior',
        ]);
        if (
          attempt.job.status !== 'failed' ||
          attempt.job.error?.code !== 'superseded_by_verified_repair' ||
          !genericSame(oldResult.supersededByVerifiedRepair, link)
        )
          return genericUnavailable();
        const oldPrior = genericObject(oldResult.prior, [
          'id',
          'status',
          'error',
          'result',
          'target',
          'endedAt',
          'evidence',
          'metadata',
        ]);
        if (
          oldPrior.id !== id ||
          oldPrior.status !== 'uncertain' ||
          attempt.job.endedAt !== oldPrior.endedAt ||
          attempt.job.updatedAt !== link.closedAt ||
          !genericSame(oldPrior.evidence, attempt.refs) ||
          !genericSame(oldPrior.metadata, attempt.job.metadata) ||
          !genericSame(oldPrior.target, attempt.job.target)
        )
          return genericUnavailable();
        historyGraph.jobs[id] = asPrior(attempt, oldPrior);
        deps.genericQualifyWrite(historyGraph.jobs[id]!, historyGraph, depth + 1);
        creationMembers.push(id);
        historicalReads.push(...attempt.ledger.map((row) => row.readJobId));
        priors.push(oldPrior);
        cursor = attempt.relations.successor as Record<string, unknown> | null;
      }
      if (!seen.has(leafId) || leaf.relations.successorSummary) return genericUnavailable();
    }
    if (proof.kind === (isRepair ? 'saved-verified-repair' : 'saved-write-result')) {
      genericObject(proof, isRepair ? ['kind', 'evidence', 'fullReadback'] : ['kind', 'evidence']);
      const saved = genericObject(leaf.job.result, [
        'status',
        'capability',
        'target',
        'contentHash',
        'platformState',
        'verifiedAt',
        'sourceUrl',
      ]);
      if (
        proofRef.jobId !== leafId ||
        proofRef.dataset !== 'write-result' ||
        leaf.documents[leaf.refs.indexOf(proofRef)]?.collectionMode !== 'live' ||
        !genericSame(leaf.documents[leaf.refs.indexOf(proofRef)]?.payload, leaf.job.result) ||
        saved.status !== 'succeeded' ||
        saved.capability !== 'update_draft' ||
        !genericSame(saved.target, { kind: 'short', workId: node.job.target!.id }) ||
        saved.contentHash !== link.desiredContentHash ||
        saved.platformState !== 'draft' ||
        !writeTaskTime(saved.verifiedAt) ||
        saved.verifiedAt < intents[0]!.ref.capturedAt ||
        saved.verifiedAt > proofRef.capturedAt
      )
        return genericUnavailable();
      if (isRepair) {
        const index = leaf.refs.findIndex(
          (ref) =>
            ref.dataset === 'creation-repair-verification' && genericSame(ref, proof.fullReadback),
        );
        if (index < 0) return genericUnavailable();
        const full = genericObject(genericObject(leaf.documents[index]!.payload).snapshot);
        if (
          leaf.documents[index]!.collectionMode !== 'live' ||
          full.state !== 'draft' ||
          full.contentHash !== link.desiredContentHash ||
          typeof full.title !== 'string' ||
          hash(full.title) !== bindings.requestedTitleHash ||
          typeof full.body !== 'string' ||
          hash(full.body.replace(/\r\n?/g, '\n')) !== bindings.requestedBodyHash ||
          leaf.refs[index]!.capturedAt > proofRef.capturedAt
        )
          return genericUnavailable();
      }
    } else if (proof.kind === (isRepair ? 'reconciled-verified-repair' : 'reconciled-recovery')) {
      genericObject(proof, ['kind', 'reconciliationJobId', 'evidence']);
      const head = leaf.ledger.at(-1);
      if (
        !head ||
        head.status !== 'succeeded' ||
        head.readJobId !== proof.reconciliationJobId ||
        head.evidenceId !== proofRef.id ||
        !genericSame(JSON.parse(head.resultJson), leaf.job.result)
      )
        return genericUnavailable();
      if (isRepair) {
        const read = graph.jobs[head.readJobId],
          document = read?.documents[read.refs.findIndex((ref) => ref.id === proofRef.id)];
        if (!read || !document || document.collectionMode !== 'live') return genericUnavailable();
        const full = genericObject(genericObject(document.payload).repairVerification);
        if (
          full.state !== 'draft' ||
          full.contentHash !== link.desiredContentHash ||
          !genericSame(full.target, { kind: 'short', workId: node.job.target!.id }) ||
          typeof full.title !== 'string' ||
          hash(full.title) !== bindings.requestedTitleHash ||
          typeof full.body !== 'string' ||
          hash(full.body.replace(/\r\n?/g, '\n')) !== bindings.requestedBodyHash
        )
          return genericUnavailable();
      }
    } else return genericUnavailable();
    return {
      node: leaf,
      rootLink: {
        kind: isRepair ? 'creation_repair' : 'creation_recovery',
        originalJobId: rootId,
        resolutionJobId: leafId,
        closedAt: link.closedAt,
        closureHash: genericDigest(result),
      },
      creationMembers,
      historicalReads,
    };
  }
  return genericRootAnchor;
}
