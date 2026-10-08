import { createAssociationPrefixChecker } from '../generic-association/check-prefix.js';
import { createAssociationPointerChecker } from '../generic-association/check-pointer.js';
import {
  writeTaskUuid,
  type GenericGraphNode,
  type CapturedGenericShortGraph,
} from '../runtime-error.js';
import { canonicalJson, genericBindings } from '../native-closure-signal.js';
import * as bodyProof from '../../../platform/short-native-body-proof.js';
import {
  genericObject,
  genericSame,
  genericJobKeys,
  hasGenericShortStatusSignal,
  genericWitnessKeys,
  genericRefKeys,
  genericDigest,
  hasGenericShortExecutionSignal,
} from '../has-generic-short-status-signal.js';
import * as draftDirectory from '../../../platform/short-draft-directory.js';
import { hasReservedNativeShortTrialSignal } from '../../../platform/short-native-trial-proof.js';
import { hasReservedNativeShortSubmissionSignal } from '../../../platform/short-native-submission-proof.js';
import { hasReservedNativeShortCoverSignal } from '../../../platform/short-native-cover-proof.js';
import { hasReservedNativeShortSignal } from '../../../platform/short-native-metadata-proof.js';
import {
  type GenericAuditPriorOperation,
  type GenericPointerOperation,
  type GenericPrefixOperation,
  type GenericAssociationOperation,
} from '../contracts/generic-status-generic-refs.js';

export interface GenericAssociationDependencies {
  genericAuditPrior: GenericAuditPriorOperation;
  genericPointer: GenericPointerOperation;
  genericPrefix: GenericPrefixOperation;
}

export function createGenericAssociation(
  deps: GenericAssociationDependencies,
): GenericAssociationOperation {
  function genericAssociation(
    node: GenericGraphNode,
    graph: CapturedGenericShortGraph,
    roots: Set<string>,
    memberIds: Set<string>,
  ): 'associated' | 'disjoint' | 'indeterminate' {
    const hashes = new Set([...roots].map((jobId) => genericDigest({ jobId }))),
      related = new Set<string>(),
      inputs = new Set<string>();
    inputs.add(node.job.inputHash);
    const w = genericObject(node.job.metadata).genericShortStatus;
    if (w !== undefined) {
      const witness = genericObject(w),
        bindings = genericObject(witness.requestBindings);
      if (typeof bindings.inputHash === 'string') inputs.add(bindings.inputHash);
    }
    const nativeSignals = [node.job, node.manifest, ...node.refs, ...node.documents];
    const nativeNamespace =
      nativeSignals.some(hasReservedNativeShortSubmissionSignal) ||
      nativeSignals.some(bodyProof.hasReservedNativeShortBodySignal) ||
      nativeSignals.some(draftDirectory.hasReservedShortDraftDirectorySignal) ||
      nativeSignals.some(hasReservedNativeShortTrialSignal) ||
      nativeSignals.some(hasReservedNativeShortCoverSignal) ||
      nativeSignals.some(hasReservedNativeShortSignal);
    if (nativeNamespace) {
      if (
        [...inputs].some((input) => hashes.has(input)) ||
        memberIds.has(node.job.id) ||
        node.refs.some((ref) => memberIds.has(ref.id))
      )
        return 'associated';
      for (const doc of node.documents) {
        const p = genericObject(doc.payload),
          audit = p.originalAudit === undefined ? null : genericObject(p.originalAudit);
        if (audit && typeof audit.originalJobId === 'string' && roots.has(audit.originalJobId))
          return 'associated';
      }
      return 'disjoint';
    }
    let unknown = false,
      relationCarrier = false;
    const audits: Array<{
      audit: Record<string, unknown>;
      reconciliation: Record<string, unknown> | null;
    }> = [];
    for (const doc of node.documents) {
      const p = genericObject(doc.payload);
      if (p.reconciliation !== undefined) {
        relationCarrier = true;
        const r = genericObject(p.reconciliation);
        if (typeof r.originalJobId === 'string' && writeTaskUuid(r.originalJobId))
          related.add(r.originalJobId);
        else unknown = true;
      }
      if (p.originalAudit !== undefined) {
        relationCarrier = true;
        const audit = genericObject(p.originalAudit),
          schema = String(audit.schema);
        if (
          ![
            'generic-short-write-original-audit/v1',
            'generic-short-write-publication-bridge-audit/v1',
            'generic-short-terminal-publication-bridge/v1',
          ].includes(schema)
        ) {
          unknown = true;
          continue;
        }
        const keys =
          schema === 'generic-short-write-original-audit/v1'
            ? [
                'schema',
                'phase',
                'priorJob',
                'priorEvidence',
                'firstSettlement',
                'previousSettlement',
              ]
            : schema === 'generic-short-write-publication-bridge-audit/v1'
              ? [
                  'schema',
                  'phase',
                  'effectLevel',
                  'priorJob',
                  'priorEvidence',
                  'legacyPrefix',
                  'sourceRead',
                  'firstBridgeSettlement',
                  'previousSettlement',
                ]
              : [
                  'schema',
                  'mode',
                  'requestedOriginal',
                  'requestedEvidence',
                  'anchorOriginal',
                  'anchorEvidence',
                  'effectHistory',
                  'rootLink',
                  'sourceRead',
                ];
        if (
          keys.some((key) => !Object.hasOwn(audit, key)) ||
          Object.keys(audit).some((key) => !keys.includes(key))
        )
          unknown = true;
        audits.push({
          audit,
          reconciliation: p.reconciliation === undefined ? null : genericObject(p.reconciliation),
        });
        for (const key of ['priorJob', 'requestedOriginal', 'anchorOriginal'])
          if (audit[key] !== undefined) {
            const job = genericObject(audit[key], genericJobKeys);
            if (writeTaskUuid(job.id)) related.add(job.id);
            else unknown = true;
          }
        if (audit.sourceRead !== undefined) {
          const source = genericObject(audit.sourceRead);
          if (typeof source.inputHash === 'string') inputs.add(source.inputHash);
          else unknown = true;
        }
        if (audit.rootLink !== undefined && audit.rootLink !== null) {
          const link = genericObject(audit.rootLink);
          for (const key of ['originalJobId', 'resolutionJobId'])
            if (writeTaskUuid(link[key])) related.add(link[key] as string);
            else unknown = true;
        }
        const collect = (input: unknown): void => {
          if (input === null) return;
          if (Array.isArray(input)) {
            for (const item of input) collect(item);
            return;
          }
          if (!input || typeof input !== 'object') return;
          const value = genericObject(input);
          for (const key of ['jobId', 'originalJobId', 'readJobId', 'evidenceId', 'id'])
            if (typeof value[key] === 'string' && memberIds.has(value[key] as string))
              related.add([...roots][0]!);
          for (const [key, item] of Object.entries(value))
            if (key !== 'priorJob' && key !== 'requestedOriginal' && key !== 'anchorOriginal')
              collect(item);
        };
        for (const key of [
          'priorEvidence',
          'requestedEvidence',
          'anchorEvidence',
          'firstSettlement',
          'previousSettlement',
          'firstBridgeSettlement',
          'effectHistory',
          'legacyPrefix',
        ])
          if (audit[key] !== undefined) collect(audit[key]);
      }
    }
    if (
      [...inputs].some((input) => hashes.has(input)) ||
      [...related].some((id) => roots.has(id)) ||
      memberIds.has(node.job.id) ||
      node.refs.some((ref) => memberIds.has(ref.id))
    )
      return 'associated';
    if (unknown) return 'indeterminate';
    const modern = hasGenericShortExecutionSignal(
      node.job,
      node.refs,
      node.documents,
      node.manifest,
    );
    if (!modern)
      return relationCarrier && [...related].some((id) => !graph.jobs[id])
        ? 'indeterminate'
        : 'disjoint';
    if (node.job.operation === 'reconcile_write' || relationCarrier) {
      // Without an audit, the only safe other-root read is an exact unobserved witness prefix.
      if (!relationCarrier) {
        if (!w) return 'indeterminate';
        const witness = genericObject(w),
          bindings = genericObject(witness.requestBindings);
        const candidates = Object.values(graph.jobs).filter(
          (n) =>
            n.job.kind === 'write' && genericDigest({ jobId: n.job.id }) === bindings.inputHash,
        );
        if (candidates.length !== 1 || bindings.originalInputHash !== candidates[0]!.job.inputHash)
          return 'indeterminate';
        related.add(candidates[0]!.job.id);
      }
      if (!related.size || [...related].some((id) => !graph.jobs[id] || roots.has(id)))
        return 'indeterminate';
      for (const id of related) {
        const root = graph.jobs[id]!;
        if (root.job.kind !== 'write' || root.job.accountId !== graph.accountId)
          return 'indeterminate';
      }
      const witness = w === undefined ? null : genericObject(w, genericWitnessKeys),
        bindings = witness
          ? genericObject(witness.requestBindings, genericBindings.reconcile_write)
          : null;
      if (
        !witness ||
        node.job.kind !== 'read' ||
        node.job.operation !== 'reconcile_write' ||
        node.job.scope !== 'reconciliation' ||
        !genericSame(node.job.datasets, ['reconciliation']) ||
        witness.operation !== node.job.operation ||
        witness.creationContext !== null ||
        !bindings
      )
        return 'indeterminate';
      if (
        !relationCarrier &&
        (node.refs.length ||
          node.manifest ||
          !genericSame(witness.observations, []) ||
          !['before_first_read', 'source_unavailable', 'capture_failed', 'persist_failed'].includes(
            String(witness.stage),
          ))
      )
        return 'indeterminate';
      const requested = audits.map(({ audit }) => deps.genericAuditPrior(audit));
      const boundRoot = requested[0] ?? [...related].map((id) => graph.jobs[id]!.job)[0];
      if (
        !boundRoot ||
        requested.some((job) => job.id !== boundRoot.id) ||
        node.job.inputHash !== genericDigest({ jobId: boundRoot.id }) ||
        bindings.inputHash !== node.job.inputHash ||
        bindings.originalInputHash !== boundRoot.inputHash
      )
        return 'indeterminate';
      for (const { audit, reconciliation } of audits) {
        const prior = deps.genericAuditPrior(audit),
          actual = graph.jobs[prior.id];
        if (
          !actual ||
          prior.accountId !== graph.accountId ||
          prior.kind !== 'write' ||
          prior.inputHash !== actual.job.inputHash ||
          !genericSame(prior.target, actual.job.target) ||
          !reconciliation
        )
          return 'indeterminate';
        genericObject(reconciliation, [
          'originalJobId',
          'target',
          'inputHash',
          'observedContentHash',
          'observedStatus',
        ]);
        if (
          reconciliation.originalJobId !== prior.id ||
          reconciliation.inputHash !== prior.inputHash
        )
          return 'indeterminate';
        const terminal = audit.schema === 'generic-short-terminal-publication-bridge/v1',
          anchor = terminal ? genericObject(audit.anchorOriginal, genericJobKeys) : prior;
        if (!genericSame(reconciliation.target, anchor.target)) return 'indeterminate';
        const checkRefs = (value: unknown, ownerId: string) => {
          if (!Array.isArray(value) || !graph.jobs[ownerId]) return false;
          for (const ref of value) genericObject(ref, genericRefKeys);
          return genericSame(value, graph.jobs[ownerId]!.refs);
        };
        if (
          !checkRefs(terminal ? audit.requestedEvidence : audit.priorEvidence, prior.id) ||
          (terminal && !checkRefs(audit.anchorEvidence, String(anchor.id)))
        )
          return 'indeterminate';
        if (audit.sourceRead !== undefined) {
          const source = genericObject(audit.sourceRead, [
            'jobId',
            'accountId',
            'operation',
            'scope',
            'datasets',
            'inputHash',
            'target',
          ]);
          if (
            !genericSame(source, {
              jobId: node.job.id,
              accountId: node.job.accountId,
              operation: node.job.operation,
              scope: node.job.scope,
              datasets: node.job.datasets,
              inputHash: node.job.inputHash,
              target: anchor.target,
            })
          )
            return 'indeterminate';
        }
        if (terminal) {
          if (audit.rootLink === null) {
            if (anchor.id !== prior.id) return 'indeterminate';
          } else {
            const link = genericObject(audit.rootLink, [
                'kind',
                'originalJobId',
                'resolutionJobId',
                'closedAt',
                'closureHash',
              ]),
              closure = genericObject(actual.job.result),
              canonical = genericObject(
                closure[link.kind === 'creation_recovery' ? 'creationRecovery' : 'creationRepair'],
              );
            if (
              !['creation_recovery', 'creation_repair'].includes(String(link.kind)) ||
              link.originalJobId !== prior.id ||
              link.resolutionJobId !== anchor.id ||
              canonical.originalJobId !== prior.id ||
              (link.kind === 'creation_recovery'
                ? canonical.resumeJobId
                : canonical.repairJobId) !== anchor.id ||
              canonical.closedAt !== link.closedAt ||
              link.closureHash !== genericDigest(closure)
            )
              return 'indeterminate';
            const relation =
              link.kind === 'creation_recovery'
                ? actual.relations.recovery
                : [actual.relations.closedRepair, actual.relations.closedSuccessor].find(
                    (value) => value && genericObject(value).repair_job_id === anchor.id,
                  );
            if (
              !relation ||
              genericObject(relation).closed_at !== link.closedAt ||
              genericObject(relation).closure_json !== canonicalJson(closure)
            )
              return 'indeterminate';
          }
        }
        const checkPointer = createAssociationPointerChecker({ graph, deps });
        const checkPrefix = createAssociationPrefixChecker({ graph, checkPointer, deps });
        const settledIndex = actual.ledger.findIndex((row) => row.readJobId === node.job.id),
          previous =
            settledIndex >= 0
              ? settledIndex > 0
                ? actual.ledger[settledIndex - 1]
                : null
              : actual.ledger.at(-1);
        if (terminal) {
          if (audit.mode !== 'observation-only' || reconciliation.observedStatus !== 'unknown')
            return 'indeterminate';
          const effect = genericObject(audit.effectHistory),
            owner = graph.jobs[String(anchor.id)];
          if (!owner) return 'indeterminate';
          if (effect.kind === 'modern-ledger' || effect.kind === 'legacy-ledger') {
            genericObject(
              effect,
              effect.kind === 'modern-ledger' ? ['kind', 'head'] : ['kind', 'prefix', 'head'],
            );
            const head = owner.ledger.at(-1),
              legacyCount = owner.ledger.filter(
                (row) => !hasGenericShortStatusSignal(graph.jobs[row.readJobId]?.documents),
              ).length;
            if (
              !head ||
              !checkPointer(effect.head, owner.job.id, head) ||
              (effect.kind === 'modern-ledger' && legacyCount !== 0) ||
              (effect.kind === 'legacy-ledger' &&
                checkPrefix(effect.prefix, owner.job.id) !== legacyCount)
            )
              return 'indeterminate';
          } else if (
            effect.kind === 'modern-direct-success' ||
            effect.kind === 'legacy-direct-success'
          ) {
            genericObject(effect, ['kind', 'resultEvidence']);
            const ref = genericObject(effect.resultEvidence, genericRefKeys),
              resultRefs = owner.refs.filter((value) => value.dataset === 'write-result'),
              modernOwner = hasGenericShortStatusSignal([owner.job, owner.documents]);
            if (
              owner.ledger.length ||
              owner.job.status !== 'succeeded' ||
              resultRefs.length !== 1 ||
              ref.jobId !== owner.job.id ||
              ref.accountId !== graph.accountId ||
              ref.dataset !== 'write-result' ||
              !genericSame(ref, resultRefs[0]) ||
              (effect.kind === 'modern-direct-success') !== modernOwner
            )
              return 'indeterminate';
          } else return 'indeterminate';
        } else if (audit.schema === 'generic-short-write-original-audit/v1') {
          if (audit.phase === 'initial') {
            if (audit.firstSettlement !== null || audit.previousSettlement !== null || previous)
              return 'indeterminate';
          } else if (
            audit.phase !== 'continuation' ||
            !previous ||
            previous.status !== 'uncertain' ||
            !checkPointer(audit.firstSettlement, prior.id, actual.ledger[0]) ||
            !checkPointer(audit.previousSettlement, prior.id, previous)
          )
            return 'indeterminate';
        } else {
          const count = checkPrefix(audit.legacyPrefix, prior.id);
          if (
            audit.effectLevel !== 'legacy-reconciliation' ||
            count === null ||
            !previous ||
            previous.status !== 'uncertain' ||
            !checkPointer(audit.previousSettlement, prior.id, previous)
          )
            return 'indeterminate';
          if (audit.phase === 'boundary') {
            if (
              audit.firstBridgeSettlement !== null ||
              previous.sequence !== actual.ledger[count - 1]!.sequence
            )
              return 'indeterminate';
          } else if (
            audit.phase !== 'continuation' ||
            !actual.ledger[count] ||
            !checkPointer(audit.firstBridgeSettlement, prior.id, actual.ledger[count])
          )
            return 'indeterminate';
        }
      }
      return 'disjoint';
    }
    // Exact standalone/write witnesses have no original relation slots; body/raw
    // qualification of a disjoint root does not become a blanket account gate.
    if (!w) return 'indeterminate';
    const witness = genericObject(w, genericWitnessKeys);
    if (witness.operation !== node.job.operation || !genericBindings[node.job.operation])
      return 'indeterminate';
    if (witness.creationContext !== null) {
      const c = genericObject(witness.creationContext, [
        'originalJobId',
        'recoveryJobId',
        'previousRepairJobId',
      ]);
      for (const id of Object.values(c))
        if (id !== null && (typeof id !== 'string' || !graph.jobs[id])) return 'indeterminate';
      if (Object.values(c).some((id) => typeof id === 'string' && roots.has(id)))
        return 'associated';
    }
    return 'disjoint';
  }
  return genericAssociation;
}
