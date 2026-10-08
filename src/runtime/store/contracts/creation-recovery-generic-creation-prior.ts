import {
  type GenericGraphNode,
  type PlatformTarget,
  type CapturedGenericShortGraph,
  type GenericShortPublicationTuple,
  type Job,
} from '../runtime-error.js';

export type GenericCreationPriorOperation = (
  node: GenericGraphNode,
  kind: 'original' | 'recovery' | 'repair',
) => Record<string, unknown>;

export type GenericCreationPriorViewOperation = (
  node: GenericGraphNode,
  input: unknown,
  kind: 'original' | 'recovery' | 'repair',
) => GenericGraphNode;

export type GenericCreationEnvelopeInGraphOperation = (
  node: GenericGraphNode,
  input: unknown,
  keys: string[],
) => Record<string, unknown>;

export type GenericCreationUnknownOperation = (
  node: GenericGraphNode,
  target: PlatformTarget,
  previousEndedAt?: string,
) => void;

export type GenericCreationResumeClaimOperation = (
  root: GenericGraphNode,
  recovery: GenericGraphNode,
  graph: CapturedGenericShortGraph,
) => Record<string, unknown>;

export type GenericCreationAncestorOperation = (
  node: GenericGraphNode,
  root: GenericGraphNode,
  recovery: GenericGraphNode,
  bindings: Record<string, unknown>,
  graph: CapturedGenericShortGraph,
) => void;

export type GenericCreationOpenFamilyOperation = (
  graph: CapturedGenericShortGraph,
  root: GenericGraphNode,
) => { members: string[]; historicalReads: string[] };

export type GenericCreationEventAssociationsOperation = (
  graph: CapturedGenericShortGraph,
  members: string[],
  historicalReads: string[],
) => void;

export type GenericCreationEventOperation = (graph: CapturedGenericShortGraph) => {
  tuple: GenericShortPublicationTuple;
  rows: GenericGraphNode;
};

export type GenericCreationEnvelopeOperation = (
  job: Job,
  input: unknown,
  keys: string[],
) => boolean;

export type GenericRepairEntryOperation = (
  job: Job,
  bindings: { expectedContentHash: string; desiredContentHash: string },
  target: PlatformTarget,
) => boolean;
export type GetCreationRepairSuccessorOperation = (
  previousId: string,
) => { repairJobId: string; closedAt: string | null } | null;

export type CreationRepairJobsOperation = (originalId: string, recoveryId: string) => Job[];

export type CreationRepairPriorOperation = (job: Job) => Record<string, unknown>;
export type GetCreationRepairAncestorIdsOperation = (
  originalId: string,
  recoveryId: string,
  previousId: string,
) => string[];

export type VerifyUnknownRepairChainOperation = (
  jobs: Job[],
  original: Job,
  recovery: Job,
  bindings: Record<string, string>,
) => void;
export type GetCreationRepairOperation = (
  recoveryId: string,
) => { repairJobId: string; closedAt: string | null } | null;

export type ClaimCreationRepairOperation = (
  originalId: string,
  recoveryId: string,
  repairId: string,
  bindings: {
    accountId: string;
    originalInputHash: string;
    recoveryInputHash: string;
    repairInputHash: string;
    clientReferenceHash: string;
    requestedContentHash: string;
    desiredContentHash: string;
    expectedContentHash: string;
    requestedTitleHash: string;
    requestedBodyHash: string;
  },
  previousRepairId?: string,
) => Job;

export type CompleteCreationRepairOperation = (
  originalId: string,
  recoveryId: string,
  repairId: string,
) => Job;
