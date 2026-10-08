import {
  genericUnavailable,
  hasGenericShortStatusSignal,
  genericDigest,
  genericObject,
  genericUnknown,
  genericSnapshotKeys,
} from '../has-generic-short-status-signal.js';
import {
  type EnsureOpenOperation,
  type LostLeaseErrorOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';
import {
  type GenericMutationGraphOperation,
  type GenericRootAnchorOperation,
  type GenericQualifyWriteOperation,
  type GenericEffectHistoryOperation,
  type GenericPrefixOperation,
  type GenericPointerOperation,
  type GetGenericShortOriginalAuditOperation,
  type GenericReadFailureOperation,
  type CaptureGenericShortPublicationGraphOperation,
  type GenericSelectOperation,
  type RereadGenericShortPublicationGraphOperation,
  type GenericShortPublicationOperation,
  type GenericModernObservationsOperation,
  type GenericHistoricalOperation,
  type GenericTupleOperation,
  type GenericShortEvidenceRowsOperation,
  type GenericShortPublicJobOperation,
  type GenericShortProjectionOperation,
} from '../contracts/generic-status-generic-refs.js';

import {
  RuntimeError,
  type StoreReadPort,
  type EvidenceObservation,
  type GenericShortPublicationTuple,
  type GenericGraphNode,
  type Job,
  type EvidenceRef,
  type Manifest,
} from '../runtime-error.js';

import { captureShortStatusJson } from '../../../platform/short-status.js';

import { type WithPublicProjectionReadOperation } from '../contracts/jobs-api-with-public-projection-read.js';

import {
  type ModernShortSnapshot,
  validateGenericShortSnapshot,
} from '../../../platform/writes.js';

interface GetGenericShortOriginalAuditDependencies {
  ensureOpen: EnsureOpenOperation;
  genericMutationGraph: GenericMutationGraphOperation;
  genericRootAnchor: GenericRootAnchorOperation;
  genericQualifyWrite: GenericQualifyWriteOperation;
  genericEffectHistory: GenericEffectHistoryOperation;
  genericPrefix: GenericPrefixOperation;
  genericPointer: GenericPointerOperation;
}

export function createGetGenericShortOriginalAudit(
  deps: GetGenericShortOriginalAuditDependencies,
): GetGenericShortOriginalAuditOperation {
  function getGenericShortOriginalAudit(
    originalId: string,
    accountId: string,
    readJobId: string,
  ): Record<string, unknown> {
    deps.ensureOpen();
    const graph = deps.genericMutationGraph(originalId, accountId),
      root = graph.jobs[originalId],
      read = graph.jobs[readJobId];
    if (
      !root ||
      !read ||
      read.job.kind !== 'read' ||
      read.job.operation !== 'reconcile_write' ||
      read.job.inputHash !== genericDigest({ jobId: originalId })
    )
      return genericUnavailable();
    const { node: anchor, rootLink } = deps.genericRootAnchor(graph, originalId);
    deps.genericQualifyWrite(anchor, graph);
    const sourceRead = {
      jobId: readJobId,
      accountId,
      operation: 'reconcile_write',
      scope: 'reconciliation',
      datasets: ['reconciliation'],
      inputHash: read.job.inputHash,
      target: anchor.job.target,
    };
    if (root.job.status !== 'uncertain')
      return {
        schema: 'generic-short-terminal-publication-bridge/v1',
        mode: 'observation-only',
        requestedOriginal: root.job,
        requestedEvidence: root.refs,
        anchorOriginal: anchor.job,
        anchorEvidence: anchor.refs,
        effectHistory: deps.genericEffectHistory(anchor, graph),
        rootLink,
        sourceRead,
      };
    if (anchor.job.id !== root.job.id) return genericUnavailable();
    const rows = root.ledger,
      head = rows.at(-1);
    const legacy = rows.filter(
      (row) => !hasGenericShortStatusSignal(graph.jobs[row.readJobId]?.documents),
    );
    if (legacy.length) {
      const firstBridge = rows[legacy.length],
        previous = head!;
      return {
        schema: 'generic-short-write-publication-bridge-audit/v1',
        phase: firstBridge ? 'continuation' : 'boundary',
        effectLevel: 'legacy-reconciliation',
        priorJob: root.job,
        priorEvidence: root.refs,
        legacyPrefix: deps.genericPrefix(legacy, graph),
        sourceRead,
        firstBridgeSettlement: firstBridge ? deps.genericPointer(firstBridge, graph) : null,
        previousSettlement: deps.genericPointer(previous, graph),
      };
    }
    return {
      schema: 'generic-short-write-original-audit/v1',
      phase: head ? 'continuation' : 'initial',
      priorJob: root.job,
      priorEvidence: root.refs,
      firstSettlement: head ? deps.genericPointer(rows[0]!, graph) : null,
      previousSettlement: head ? deps.genericPointer(head, graph) : null,
    };
  }
  return getGenericShortOriginalAudit;
}

interface GenericReadFailureDependencies {
  ownershipLost: boolean;
  lostLeaseError: LostLeaseErrorOperation;
}

export function createGenericReadFailure(
  deps: GenericReadFailureDependencies,
): GenericReadFailureOperation {
  function genericReadFailure(error: unknown): never {
    if (deps.ownershipLost) throw deps.lostLeaseError();
    if (
      error instanceof RuntimeError &&
      ['service_lease_lost', 'creation_repair_conflict'].includes(error.code)
    )
      throw error;
    return genericUnavailable();
  }
  return genericReadFailure;
}

interface GenericShortPublicationDependencies {
  captureGenericShortPublicationGraph: CaptureGenericShortPublicationGraphOperation;
  genericSelect: GenericSelectOperation;
  rereadGenericShortPublicationGraph: RereadGenericShortPublicationGraphOperation;
  genericReadScope: {
    token: object;
    accountId: string;
    open: boolean;
    ports: Map<string, StoreReadPort<unknown>>;
    files: Map<string, StoreReadPort<EvidenceObservation>>;
  } | null;
  withPublicProjectionRead: WithPublicProjectionReadOperation;
  genericReadFailure: GenericReadFailureOperation;
}

export function createGenericShortPublication(
  deps: GenericShortPublicationDependencies,
): GenericShortPublicationOperation {
  function genericShortPublication(jobId: string, accountId: string): GenericShortPublicationTuple {
    const run = () => {
      const plan = deps.captureGenericShortPublicationGraph(jobId, accountId);
      deps.genericSelect(plan.first);
      const final = deps.rereadGenericShortPublicationGraph(plan);
      return captureShortStatusJson(deps.genericSelect(final)) as GenericShortPublicationTuple;
    };
    try {
      return deps.genericReadScope ? run() : deps.withPublicProjectionRead(accountId, 'jobs', run);
    } catch (error) {
      return deps.genericReadFailure(error);
    }
  }
  return genericShortPublication;
}

interface GenericShortEvidenceRowsDependencies {
  genericModernObservations: GenericModernObservationsOperation;
  genericHistorical: GenericHistoricalOperation;
  genericTuple: GenericTupleOperation;
}

export function createGenericShortEvidenceRows(
  deps: GenericShortEvidenceRowsDependencies,
): GenericShortEvidenceRowsOperation {
  function genericShortEvidenceRows(
    node: GenericGraphNode,
    includeDataset = true,
  ): Record<string, unknown>[] {
    const modern = hasGenericShortStatusSignal([node.job, node.documents]),
      data = modern ? deps.genericModernObservations(node) : null;
    if (!modern) deps.genericHistorical(node);
    return node.refs.flatMap((ref, i) => {
      if (ref.dataset === 'write-intent') return [];
      const payload = genericObject(node.documents[i]!.payload),
        tail = {
          sourceRef: ref.id,
          evidenceHash: ref.sha256,
          evidenceCapturedAt: ref.capturedAt,
          ...(includeDataset ? { dataset: ref.dataset } : {}),
        };
      if (ref.dataset === 'write-result') return [{ ...payload, ...tail }];
      const source = data?.observations.find((value) => value.ref.id === ref.id),
        tuple = source ? deps.genericTuple(source) : genericUnknown(),
        q3 = {
          state: tuple.state,
          statusFacts: tuple.statusFacts,
          statusSource: tuple.statusSource,
        };
      const safeSnapshot = (s: ModernShortSnapshot) => {
        const value = genericObject(s, genericSnapshotKeys);
        return Object.fromEntries(
          Object.entries(value).filter(([key]) => !['statusInput', 'statusProof'].includes(key)),
        );
      };
      if (ref.dataset === 'editable_snapshot') {
        if (modern && node.job.kind === 'write') {
          const s = source!.snapshot;
          return [
            {
              ...tail,
              phase: source!.phase,
              contentHash: s.contentHash,
              platformReadAt: s.platformReadAt,
              ...q3,
            },
          ];
        }
        if (modern)
          return [{ ...safeSnapshot(source!.snapshot), source: payload.source, ...tail, ...q3 }];
        return [{ ...payload, ...tail, ...q3 }];
      }
      const out = Object.fromEntries(
        Object.entries(payload).filter(
          ([key]) => !['statusProtocol', 'statusSnapshot', 'originalAudit'].includes(key),
        ),
      );
      if (modern && out.snapshot !== undefined)
        out.snapshot = safeSnapshot(validateGenericShortSnapshot(out.snapshot));
      if (modern && out.repairVerification !== undefined)
        out.repairVerification = safeSnapshot(validateGenericShortSnapshot(out.repairVerification));
      return [{ ...out, ...tail, ...q3 }];
    });
  }
  return genericShortEvidenceRows;
}

interface GenericShortProjectionDependencies {
  captureGenericShortPublicationGraph: CaptureGenericShortPublicationGraphOperation;
  genericSelect: GenericSelectOperation;
  rereadGenericShortPublicationGraph: RereadGenericShortPublicationGraphOperation;
  genericShortPublicJob: GenericShortPublicJobOperation;
  genericShortEvidenceRows: GenericShortEvidenceRowsOperation;
  genericReadScope: {
    token: object;
    accountId: string;
    open: boolean;
    ports: Map<string, StoreReadPort<unknown>>;
    files: Map<string, StoreReadPort<EvidenceObservation>>;
  } | null;
  withPublicProjectionRead: WithPublicProjectionReadOperation;
  genericReadFailure: GenericReadFailureOperation;
}

export function createGenericShortProjection(
  deps: GenericShortProjectionDependencies,
): GenericShortProjectionOperation {
  function genericShortProjection(
    jobId: string,
    accountId: string,
    includeDataset = true,
  ): {
    job: Job & GenericShortPublicationTuple;
    tuple: GenericShortPublicationTuple;
    manifest: Manifest | null;
    evidence: EvidenceRef[];
    data: Record<string, unknown>[];
  } {
    const run = () => {
      const plan = deps.captureGenericShortPublicationGraph(jobId, accountId);
      deps.genericSelect(plan.first);
      const final = deps.rereadGenericShortPublicationGraph(plan),
        tuple = deps.genericSelect(final),
        node = final.jobs[jobId];
      if (!node) return genericUnavailable();
      return {
        job: deps.genericShortPublicJob(node.job, tuple),
        tuple,
        manifest: node.manifest,
        evidence: node.refs,
        data: deps.genericShortEvidenceRows(node, includeDataset),
      };
    };
    try {
      return deps.genericReadScope ? run() : deps.withPublicProjectionRead(accountId, 'jobs', run);
    } catch (error) {
      return deps.genericReadFailure(error);
    }
  }
  return genericShortProjection;
}
