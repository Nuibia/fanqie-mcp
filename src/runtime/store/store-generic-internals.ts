import {
  type Job,
  type EvidenceRef,
  type PlatformTarget,
  type GenericGraphNode,
  type CapturedGenericShortGraph,
  type PrivateGenericShortReadPlan,
  type EvidenceDocument,
} from './runtime-error.js';
import { type NativeReconciliationRow } from './native-closure-signal.js';

import { type ModernShortSnapshot } from '../../platform/writes.js';

import { type StoreOperations } from './operations.js';
import { StoreNativeInternals } from './store-native-internals.js';
export class StoreGenericInternals extends StoreNativeInternals {
  private genericRefs(rows: unknown): ReturnType<StoreOperations['genericRefs']> {
    return this.operation('genericRefs')(rows);
  }
  private genericRawNode(
    id: string,
    accountId: string,
    mode: 'tracked' | 'native' = 'tracked',
  ): ReturnType<StoreOperations['genericRawNode']> {
    return this.operation('genericRawNode')(id, accountId, mode);
  }
  private genericReadGraph(
    originalId: string,
    accountId: string,
    mode: 'tracked' | 'native',
  ): ReturnType<StoreOperations['genericReadGraph']> {
    return this.operation('genericReadGraph')(originalId, accountId, mode);
  }
  private captureGenericShortPublicationGraph(
    originalId: string,
    accountId: string,
  ): ReturnType<StoreOperations['captureGenericShortPublicationGraph']> {
    return this.operation('captureGenericShortPublicationGraph')(originalId, accountId);
  }
  private rereadGenericShortPublicationGraph(
    plan: PrivateGenericShortReadPlan,
  ): ReturnType<StoreOperations['rereadGenericShortPublicationGraph']> {
    return this.operation('rereadGenericShortPublicationGraph')(plan);
  }
  private genericWitness(
    job: Job,
    refs: EvidenceRef[],
    documents: EvidenceDocument[],
    production = false,
  ): ReturnType<StoreOperations['genericWitness']> {
    return this.operation('genericWitness')(job, refs, documents, production);
  }
  private genericPointer(
    row: NativeReconciliationRow,
    graph: CapturedGenericShortGraph,
  ): ReturnType<StoreOperations['genericPointer']> {
    return this.operation('genericPointer')(row, graph);
  }
  private genericPrefix(
    rows: NativeReconciliationRow[],
    graph: CapturedGenericShortGraph,
  ): ReturnType<StoreOperations['genericPrefix']> {
    return this.operation('genericPrefix')(rows, graph);
  }
  private genericSettlementError(
    status: string,
  ): ReturnType<StoreOperations['genericSettlementError']> {
    return this.operation('genericSettlementError')(status);
  }
  private genericModernObservations(
    node: GenericGraphNode,
    production = false,
  ): ReturnType<StoreOperations['genericModernObservations']> {
    return this.operation('genericModernObservations')(node, production);
  }
  private genericHistorical(
    node: GenericGraphNode,
  ): ReturnType<StoreOperations['genericHistorical']> {
    return this.operation('genericHistorical')(node);
  }
  private genericLegacySnapshot(
    input: unknown,
  ): ReturnType<StoreOperations['genericLegacySnapshot']> {
    return this.operation('genericLegacySnapshot')(input);
  }
  private genericReadComplete(
    node: GenericGraphNode,
    modern: boolean,
  ): ReturnType<StoreOperations['genericReadComplete']> {
    return this.operation('genericReadComplete')(node, modern);
  }
  private genericRootAnchor(
    graph: CapturedGenericShortGraph,
    rootId: string,
    depth = 0,
  ): ReturnType<StoreOperations['genericRootAnchor']> {
    return this.operation('genericRootAnchor')(graph, rootId, depth);
  }
  private genericAuditPrior(
    audit: Record<string, unknown>,
  ): ReturnType<StoreOperations['genericAuditPrior']> {
    return this.operation('genericAuditPrior')(audit);
  }
  private genericValidateAudit(
    node: GenericGraphNode,
    graph: CapturedGenericShortGraph,
    settledRow?: NativeReconciliationRow,
  ): ReturnType<StoreOperations['genericValidateAudit']> {
    return this.operation('genericValidateAudit')(node, graph, settledRow);
  }
  private genericLedger(
    node: GenericGraphNode,
    graph: CapturedGenericShortGraph,
  ): ReturnType<StoreOperations['genericLedger']> {
    return this.operation('genericLedger')(node, graph);
  }
  private genericQualifyWrite(
    node: GenericGraphNode,
    graph: CapturedGenericShortGraph,
    depth = 0,
  ): ReturnType<StoreOperations['genericQualifyWrite']> {
    return this.operation('genericQualifyWrite')(node, graph, depth);
  }
  private genericEffectHistory(
    node: GenericGraphNode,
    graph: CapturedGenericShortGraph,
  ): ReturnType<StoreOperations['genericEffectHistory']> {
    return this.operation('genericEffectHistory')(node, graph);
  }
  private genericAssociation(
    node: GenericGraphNode,
    graph: CapturedGenericShortGraph,
    roots: Set<string>,
    memberIds: Set<string>,
  ): ReturnType<StoreOperations['genericAssociation']> {
    return this.operation('genericAssociation')(node, graph, roots, memberIds);
  }
  private genericUnobservedRead(
    node: GenericGraphNode,
  ): ReturnType<StoreOperations['genericUnobservedRead']> {
    return this.operation('genericUnobservedRead')(node);
  }
  private genericSelect(
    graph: CapturedGenericShortGraph,
  ): ReturnType<StoreOperations['genericSelect']> {
    return this.operation('genericSelect')(graph);
  }
  private genericCreationPrior(
    node: GenericGraphNode,
    kind: 'original' | 'recovery' | 'repair',
  ): ReturnType<StoreOperations['genericCreationPrior']> {
    return this.operation('genericCreationPrior')(node, kind);
  }
  private genericCreationPriorView(
    node: GenericGraphNode,
    input: unknown,
    kind: 'original' | 'recovery' | 'repair',
  ): ReturnType<StoreOperations['genericCreationPriorView']> {
    return this.operation('genericCreationPriorView')(node, input, kind);
  }
  private genericCreationEnvelopeInGraph(
    node: GenericGraphNode,
    input: unknown,
    keys: string[],
  ): ReturnType<StoreOperations['genericCreationEnvelopeInGraph']> {
    return this.operation('genericCreationEnvelopeInGraph')(node, input, keys);
  }
  private genericCreationUnknown(
    node: GenericGraphNode,
    target: PlatformTarget,
    previousEndedAt?: string,
  ): ReturnType<StoreOperations['genericCreationUnknown']> {
    return this.operation('genericCreationUnknown')(node, target, previousEndedAt);
  }
  private genericCreationResumeClaim(
    root: GenericGraphNode,
    recovery: GenericGraphNode,
    graph: CapturedGenericShortGraph,
  ): ReturnType<StoreOperations['genericCreationResumeClaim']> {
    return this.operation('genericCreationResumeClaim')(root, recovery, graph);
  }
  private genericCreationAncestor(
    node: GenericGraphNode,
    root: GenericGraphNode,
    recovery: GenericGraphNode,
    bindings: Record<string, unknown>,
    graph: CapturedGenericShortGraph,
  ): ReturnType<StoreOperations['genericCreationAncestor']> {
    return this.operation('genericCreationAncestor')(node, root, recovery, bindings, graph);
  }
  private genericCreationOpenFamily(
    graph: CapturedGenericShortGraph,
    root: GenericGraphNode,
  ): ReturnType<StoreOperations['genericCreationOpenFamily']> {
    return this.operation('genericCreationOpenFamily')(graph, root);
  }
  private genericCreationEventAssociations(
    graph: CapturedGenericShortGraph,
    members: string[],
    historicalReads: string[],
  ): ReturnType<StoreOperations['genericCreationEventAssociations']> {
    return this.operation('genericCreationEventAssociations')(graph, members, historicalReads);
  }
  private genericCreationEvent(
    graph: CapturedGenericShortGraph,
  ): ReturnType<StoreOperations['genericCreationEvent']> {
    return this.operation('genericCreationEvent')(graph);
  }
  private genericTuple(source: {
    ref: EvidenceRef;
    snapshot: ModernShortSnapshot;
    phase: string;
  }): ReturnType<StoreOperations['genericTuple']> {
    return this.operation('genericTuple')(source);
  }
  private genericMutationGraph(
    originalId: string,
    accountId: string,
  ): ReturnType<StoreOperations['genericMutationGraph']> {
    return this.operation('genericMutationGraph')(originalId, accountId);
  }
  private genericReadFailure(error: unknown): ReturnType<StoreOperations['genericReadFailure']> {
    return this.operation('genericReadFailure')(error);
  }
  private genericShortEvidenceRows(
    node: GenericGraphNode,
    includeDataset = true,
  ): ReturnType<StoreOperations['genericShortEvidenceRows']> {
    return this.operation('genericShortEvidenceRows')(node, includeDataset);
  }
  private genericCreationEnvelope(
    job: Job,
    input: unknown,
    keys: string[],
  ): ReturnType<StoreOperations['genericCreationEnvelope']> {
    return this.operation('genericCreationEnvelope')(job, input, keys);
  }
  private genericRepairEntry(
    job: Job,
    bindings: { expectedContentHash: string; desiredContentHash: string },
    target: PlatformTarget,
  ): ReturnType<StoreOperations['genericRepairEntry']> {
    return this.operation('genericRepairEntry')(job, bindings, target);
  }
}
