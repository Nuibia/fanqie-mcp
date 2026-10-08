import { type NativeReconciliationRow } from './native-closure-signal.js';

import { Store } from './authority.js';

// Single sources of the existing SELECTs; no new statement is introduced.
export const existingGenericReads = Object.freeze({
  accountJobs: 'SELECT * FROM jobs WHERE account_id=? ORDER BY requested_at DESC,rowid DESC',
  accountIds: 'SELECT id FROM jobs WHERE account_id=? ORDER BY requested_at DESC,rowid DESC',
  rawJob: 'SELECT * FROM jobs WHERE id = ?',
  filteredJob: 'SELECT * FROM jobs WHERE id = ? AND account_id = ?',
  compactFilteredJob: 'SELECT * FROM jobs WHERE id=? AND account_id=?',
  refs: 'SELECT * FROM evidence WHERE job_id = ? ORDER BY rowid',
  durableRef: 'SELECT * FROM evidence WHERE id = ?',
  accountManifests:
    'SELECT manifest_json FROM manifests WHERE account_id = ? ORDER BY committed_at DESC, rowid DESC',
  manifest: 'SELECT * FROM manifests WHERE account_id = ? AND job_id = ? LIMIT 2',
  recoverySummary:
    'SELECT resume_job_id, closed_at FROM creation_recoveries WHERE original_job_id = ?',
  successorSummary:
    'SELECT repair_job_id, closed_at FROM creation_repair_successors WHERE previous_repair_job_id = ?',
  repairSummary: 'SELECT repair_job_id, closed_at FROM creation_repairs WHERE recovery_job_id = ?',
  recovery: 'SELECT * FROM creation_recoveries WHERE original_job_id = ?',
  firstRepair: 'SELECT * FROM creation_repairs WHERE original_job_id = ? AND recovery_job_id = ?',
  successor: 'SELECT * FROM creation_repair_successors WHERE previous_repair_job_id = ?',
  repairById: 'SELECT * FROM creation_repairs WHERE repair_job_id = ?',
  successorByIds:
    'SELECT * FROM creation_repair_successors WHERE repair_job_id = ? AND previous_repair_job_id = ?',
  closedRepair: 'SELECT * FROM creation_repairs WHERE recovery_job_id = ? AND original_job_id = ?',
  closedSuccessor:
    'SELECT * FROM creation_repair_successors WHERE recovery_job_id = ? AND original_job_id = ? AND repair_job_id = ?',
  ledgerJoin:
    'SELECT * FROM write_reconciliations WHERE original_job_id = ? AND read_job_id = ? AND status = ?',
});

export const existingGenericLedgerSql = (position: 'first' | 'last', before?: number) =>
  `SELECT rowid AS sequence, * FROM write_reconciliations WHERE original_job_id = ?${before === undefined ? '' : ' AND rowid < ?'} ORDER BY rowid ${position === 'first' ? 'ASC' : 'DESC'} LIMIT 1`;

export type JobKind = 'read' | 'write';

export type JobStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_login'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'uncertain'
  | 'cancelled';

// HTTP list metadata only: these records do not certify a platform write result.
export const KNOWN_WRITE_TASK_OPERATIONS = Object.freeze([
  'create_draft',
  'update_draft',
  'update_work_metadata',
  'save_chapter_draft',
  'submit_short_story',
  'publish_chapter',
  'resume_create_draft',
  'repair_created_draft',
  'update_short_cover',
  'update_short_body',
] as const);

export type KnownWriteTaskOperation = (typeof KNOWN_WRITE_TASK_OPERATIONS)[number];

export interface SavedWriteTaskRecord {
  id: string;
  kind: 'write';
  operation: KnownWriteTaskOperation;
  recordedTaskStatus: JobStatus;
  requestedAt: string;
  endedAt: string | null;
}

export interface SavedWriteTaskSummaryList {
  schema: 'fanqie-job-summaries/v1';
  sourceMode: 'saved';
  purpose: 'task-state-only';
  authoritative: false;
  bodyIncluded: false;
  scope: 'known_write_tasks/v1';
  tasks: SavedWriteTaskRecord[];
  truncated: boolean;
}

export const WRITE_TASK_SUMMARY_CAP = 256;

export const writeTaskUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.exec(value)?.[0] ===
    value;

export const writeTaskTime = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.exec(value)?.[0] === value &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

export type RuntimeFailure = { code: string; message: string; details?: unknown };

export type PlatformTarget = {
  kind: 'short-story' | 'long-book' | 'chapter';
  id: string;
  parentId?: string;
};

export class RuntimeError extends Error {
  readonly code: string;
  readonly details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'RuntimeError';
    this.code = code;
    this.details = details;
  }
  toJSON(): RuntimeFailure {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export interface Job {
  id: string;
  accountId: string;
  ownerId: string;
  kind: JobKind;
  operation: string;
  scope: string;
  datasets: string[];
  idempotencyKey: string | null;
  inputHash: string;
  status: JobStatus;
  requestedAt: string;
  startedAt: string | null;
  platformReadStartedAt: string | null;
  platformWriteStartedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
  result: unknown;
  error: RuntimeFailure | null;
  target: PlatformTarget | null;
  metadata: Record<string, unknown>;
  timeoutMs: number;
  deadlineAt: string | null;
  cancellationRequestedAt: string | null;
  cancellationReason: RuntimeFailure | null;
}

export interface EvidenceRef {
  id: string;
  accountId: string;
  jobId: string;
  dataset: string;
  capturedAt: string;
  path: string;
  sha256: string;
}

export interface EvidenceDocument {
  schemaVersion: 1;
  evidenceId: string;
  accountId: string;
  jobId: string;
  dataset: string;
  capturedAt: string;
  collectionMode: 'live' | 'fixture';
  evidenceKind: 'observation' | 'local-intent';
  payload: unknown;
}

export interface Manifest {
  schemaVersion: 1;
  id: string;
  accountId: string;
  jobId: string;
  operation: string;
  scope: string;
  datasets: string[];
  requestedAt: string;
  platformReadStartedAt: string;
  committedAt: string;
  evidence: EvidenceRef[];
}

export const GENERIC_SHORT_STATUS_PROTOCOL = 'fanqie-generic-short-status/v1' as const;

export interface GenericShortTrustedContext {
  jobId: string;
  accountId: string;
  kind: JobKind;
  operation: string;
  scope: string;
  datasets: string[];
  inputHash: string;
  target: PlatformTarget | null;
  creationContext: {
    originalJobId: string;
    recoveryJobId: string | null;
    previousRepairJobId: string | null;
  } | null;
  requestBindings: Record<string, string>;
  identityType: 'account' | 'author';
  platformOwnerId: string;
  profileId: string;
  profileVerifiedAt: string;
  provenance: { executor: string; mode: 'live' | 'fixture' };
}

export interface StoreReadPort<T> {
  readonly tracked: () => T;
  readonly native: () => T;
}

export interface EvidenceObservation {
  document: EvidenceDocument;
  marks: unknown[];
}

export interface GenericGraphNode {
  job: Job;
  refs: EvidenceRef[];
  documents: EvidenceDocument[];
  manifest: Manifest | null;
  ledger: NativeReconciliationRow[];
  relations: Record<string, unknown>;
}

export interface CapturedGenericShortGraph {
  originalId: string;
  accountId: string;
  jobs: Record<string, GenericGraphNode>;
  rawJobs: unknown[];
  rawManifests: unknown[];
}

export interface PrivateGenericShortReadPlan {
  readonly store: Store;
  readonly scope: object;
  readonly originalId: string;
  readonly accountId: string;
  readonly first: CapturedGenericShortGraph;
  readonly sql: Array<{ port: StoreReadPort<unknown>; value: unknown }>;
  readonly files: Array<{ port: StoreReadPort<EvidenceObservation>; value: EvidenceObservation }>;
}

export interface GenericShortPublicationTuple {
  state: string;
  statusFacts: unknown;
  statusSource: {
    phase: string;
    sourceRef: string;
    evidenceHash: string;
    evidenceCapturedAt: string;
  } | null;
  statusEvidence: {
    id: string;
    jobId: string;
    dataset: string;
    sha256: string;
    capturedAt: string;
  } | null;
}
