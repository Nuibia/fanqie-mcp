import {
  type EvidenceRef,
  type GenericGraphNode,
  type CapturedGenericShortGraph,
  type PrivateGenericShortReadPlan,
  type Job,
  type EvidenceDocument,
  type RuntimeFailure,
  type GenericShortPublicationTuple,
  type Manifest,
} from '../runtime-error.js';

import { type NativeReconciliationRow } from '../native-closure-signal.js';

import { type ModernShortSnapshot } from '../../../platform/writes.js';

export type GenericRefsOperation = (rows: unknown) => EvidenceRef[];

export type GenericRawNodeOperation = (
  id: string,
  accountId: string,
  mode?: 'tracked' | 'native',
) => GenericGraphNode | null;

export type GenericReadGraphOperation = (
  originalId: string,
  accountId: string,
  mode: 'tracked' | 'native',
) => CapturedGenericShortGraph;

export type CaptureGenericShortPublicationGraphOperation = (
  originalId: string,
  accountId: string,
) => PrivateGenericShortReadPlan;

export type RereadGenericShortPublicationGraphOperation = (
  plan: PrivateGenericShortReadPlan,
) => CapturedGenericShortGraph;

export type GenericWitnessOperation = (
  job: Job,
  refs: EvidenceRef[],
  documents: EvidenceDocument[],
  production?: boolean,
) => Record<string, unknown> | null;

export type GenericPointerOperation = (
  row: NativeReconciliationRow,
  graph: CapturedGenericShortGraph,
) => {
  sequence: number;
  id: string;
  originalJobId: string;
  readJobId: string;
  evidenceId: string;
  status: string;
  createdAt: string;
  resultHash: string;
  evidenceHash: string;
};

export type GenericPrefixOperation = (
  rows: NativeReconciliationRow[],
  graph: CapturedGenericShortGraph,
) => {
  rowCount: number;
  first:
    | {
        sequence: number;
        id: string;
        originalJobId: string;
        readJobId: string;
        evidenceId: string;
        status: string;
        createdAt: string;
        resultHash: string;
        evidenceHash: string;
      }
    | undefined;
  last:
    | {
        sequence: number;
        id: string;
        originalJobId: string;
        readJobId: string;
        evidenceId: string;
        status: string;
        createdAt: string;
        resultHash: string;
        evidenceHash: string;
      }
    | undefined;
  rowsHash: string;
};

export type GenericSettlementErrorOperation = (status: string) => RuntimeFailure | null;

export type GenericModernObservationsOperation = (
  node: GenericGraphNode,
  production?: boolean,
) => {
  witness: Record<string, unknown> | null;
  observations: { ref: EvidenceRef; snapshot: ModernShortSnapshot; phase: string }[];
};

export type GenericHistoricalOperation = (node: GenericGraphNode) => void;
export type GenericLegacySnapshotOperation = (input: unknown) => void;

export type GenericReadCompleteOperation = (node: GenericGraphNode, modern: boolean) => void;

export type GenericRootAnchorOperation = (
  graph: CapturedGenericShortGraph,
  rootId: string,
  depth?: number,
) => {
  node: GenericGraphNode;
  rootLink: unknown;
  creationMembers: string[];
  historicalReads: string[];
};

export type GenericAuditPriorOperation = (audit: Record<string, unknown>) => Job;

export type GenericValidateAuditOperation = (
  node: GenericGraphNode,
  graph: CapturedGenericShortGraph,
  settledRow?: NativeReconciliationRow,
) => void;

export type GenericLedgerOperation = (
  node: GenericGraphNode,
  graph: CapturedGenericShortGraph,
) => void;

export type GenericQualifyWriteOperation = (
  node: GenericGraphNode,
  graph: CapturedGenericShortGraph,
  depth?: number,
) => { ref: EvidenceRef; snapshot: ModernShortSnapshot; phase: string } | null;

export type GenericEffectHistoryOperation = (
  node: GenericGraphNode,
  graph: CapturedGenericShortGraph,
) => unknown;

export type GenericAssociationOperation = (
  node: GenericGraphNode,
  graph: CapturedGenericShortGraph,
  roots: Set<string>,
  memberIds: Set<string>,
) => 'associated' | 'disjoint' | 'indeterminate';

export type GenericUnobservedReadOperation = (node: GenericGraphNode) => void;

export type GenericSelectOperation = (
  graph: CapturedGenericShortGraph,
) => GenericShortPublicationTuple;

export type GenericTupleOperation = (source: {
  ref: EvidenceRef;
  snapshot: ModernShortSnapshot;
  phase: string;
}) => GenericShortPublicationTuple;

export type GenericMutationGraphOperation = (
  originalId: string,
  accountId: string,
) => CapturedGenericShortGraph;
export type GetGenericShortOriginalAuditOperation = (
  originalId: string,
  accountId: string,
  readJobId: string,
) => Record<string, unknown>;
export type GenericReadFailureOperation = (error: unknown) => never;

export type GenericShortPublicationOperation = (
  jobId: string,
  accountId: string,
) => GenericShortPublicationTuple;

export type GenericShortEvidenceRowsOperation = (
  node: GenericGraphNode,
  includeDataset?: boolean,
) => Record<string, unknown>[];

export type GenericShortProjectionOperation = (
  jobId: string,
  accountId: string,
  includeDataset?: boolean,
) => {
  job: Job & GenericShortPublicationTuple;
  tuple: GenericShortPublicationTuple;
  manifest: Manifest | null;
  evidence: EvidenceRef[];
  data: Record<string, unknown>[];
};

export type GenericShortCreationEventProjectionOperation = (
  memberId: string,
  accountId: string,
  includeDataset?: boolean,
) => {
  job: Job & GenericShortPublicationTuple;
  tuple: GenericShortPublicationTuple;
  manifest: Manifest | null;
  evidence: EvidenceRef[];
  data: Record<string, unknown>[];
};

export type GenericShortPublicJobOperation = (
  job: Job,
  tuple: GenericShortPublicationTuple,
) => Job & GenericShortPublicationTuple;
