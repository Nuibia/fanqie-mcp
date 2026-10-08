import {
  type Job,
  type Manifest,
  type EvidenceRef,
  type EvidenceDocument,
} from '../../runtime/store.js';

import {
  type NativeShortSubmissionProjection,
  UUID,
  NATIVE_SHORT_SUBMISSION_OPERATION,
  NATIVE_SHORT_SUBMISSION_READ_OPERATION,
  NATIVE_SHORT_SUBMISSION_READ_DATASET,
  HASH,
  WORK,
  exact,
  same,
  integer,
  fail,
  verifyRef,
  order,
  type NativeShortSubmissionAttemptRow,
  NATIVE_SHORT_SUBMISSION_HASH_BASES,
  ORIGIN,
  type NativeShortSubmissionEvidenceContext,
} from './fail.js';

import { scalar, safeString } from './create-native-short-submission-stage-evidence.js';

import {
  isCanonicalNativeTime,
  type NativeShortProvenance,
} from '../short-native-metadata-proof.js';

import { type NativeShortSubmissionApiResult } from '../short-native-submission-api.js';

import {
  NATIVE_SHORT_SUBMISSION_SCOPE,
  type NativeShortSubmissionComparison,
} from '../short-native-submission.js';

export function safeNativeShortSubmissionJob(
  job: Job,
  projection: NativeShortSubmissionProjection | null,
): Record<string, unknown> {
  const operation = scalar(job, 'operation'),
    scope = scalar(job, 'scope');
  const out: Record<string, unknown> = {
    schema: 'fanqie-short-native-submission-job/v1',
    id: safeString(scalar(job, 'id'), UUID),
    accountId: safeString(scalar(job, 'accountId'), /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
    kind:
      scalar(job, 'kind') === 'read' ? 'read' : scalar(job, 'kind') === 'write' ? 'write' : null,
    operation: [
      NATIVE_SHORT_SUBMISSION_OPERATION,
      NATIVE_SHORT_SUBMISSION_READ_OPERATION,
      'reconcile_write',
    ].includes(operation as any)
      ? operation
      : null,
    scope:
      typeof scope === 'string' &&
      (/^short_native_submission\.[1-9][0-9]{9,21}$/.test(scope) || scope === 'reconciliation')
        ? scope
        : null,
    datasets:
      operation === 'reconcile_write'
        ? ['reconciliation']
        : operation === NATIVE_SHORT_SUBMISSION_READ_OPERATION
          ? [NATIVE_SHORT_SUBMISSION_READ_DATASET]
          : operation === NATIVE_SHORT_SUBMISSION_OPERATION
            ? []
            : null,
    status: safeString(
      scalar(job, 'status'),
      /^(queued|running|succeeded|failed|uncertain|cancelled|waiting_for_login)$/,
    ),
    projectionStatus: projection?.validated ? 'validated' : 'capability_unavailable',
    inputHash: safeString(scalar(job, 'inputHash'), HASH),
    result: projection?.validated ? projection.result : null,
    target: null,
    error:
      scalar(job, 'error') === null
        ? null
        : {
            code: 'native_submission_outcome_unavailable',
            message: 'Native short submission outcome is unavailable.',
          },
  };
  for (const k of [
    'requestedAt',
    'startedAt',
    'platformReadStartedAt',
    'platformWriteStartedAt',
    'endedAt',
    'updatedAt',
    'deadlineAt',
    'cancellationRequestedAt',
  ])
    out[k] = isCanonicalNativeTime(scalar(job, k)) ? scalar(job, k) : null;
  // Restoring a target from an unvalidated scope would turn corrupt input into authority.
  if (projection?.validated) {
    const target = scalar(job, 'target');
    if (scalar(target, 'kind') === 'short-story' && safeString(scalar(target, 'id'), WORK))
      out.target = { kind: 'short-story', id: scalar(target, 'id') };
  }
  return out;
}

export function validateReadJob(
  job: Job,
  manifest: Manifest,
  ref: EvidenceRef,
  document: EvidenceDocument,
  accountId: string,
  workId: string,
  operation: string,
  scope: string,
  inputHash: string,
  read: NativeShortSubmissionApiResult,
  mode: 'live' | 'fixture',
): void {
  exact(job, [
    'id',
    'accountId',
    'ownerId',
    'kind',
    'operation',
    'scope',
    'datasets',
    'idempotencyKey',
    'inputHash',
    'status',
    'requestedAt',
    'startedAt',
    'platformReadStartedAt',
    'platformWriteStartedAt',
    'endedAt',
    'updatedAt',
    'result',
    'error',
    'target',
    'metadata',
    'timeoutMs',
    'deadlineAt',
    'cancellationRequestedAt',
    'cancellationReason',
  ]);
  if (
    !UUID.test(job.id) ||
    !UUID.test(job.ownerId) ||
    job.kind !== 'read' ||
    job.status !== 'succeeded' ||
    job.accountId !== accountId ||
    job.operation !== operation ||
    job.scope !== scope ||
    !same(job.datasets, [ref.dataset]) ||
    job.inputHash !== inputHash ||
    job.error !== null ||
    job.cancellationRequestedAt !== null ||
    job.cancellationReason !== null ||
    job.idempotencyKey !== null ||
    job.platformWriteStartedAt !== null ||
    !same(job.target, { kind: 'short-story', id: workId }) ||
    !same(job.metadata, {}) ||
    integer(job.timeoutMs, 2_147_483_647) < 1
  )
    fail();
  exact(manifest, [
    'schemaVersion',
    'id',
    'accountId',
    'jobId',
    'operation',
    'scope',
    'datasets',
    'requestedAt',
    'platformReadStartedAt',
    'committedAt',
    'evidence',
  ]);
  if (
    manifest.schemaVersion !== 1 ||
    !UUID.test(manifest.id) ||
    manifest.accountId !== accountId ||
    manifest.jobId !== job.id ||
    manifest.operation !== operation ||
    manifest.scope !== scope ||
    !same(manifest.datasets, job.datasets) ||
    manifest.requestedAt !== job.requestedAt ||
    manifest.platformReadStartedAt !== job.platformReadStartedAt ||
    manifest.committedAt !== job.endedAt ||
    job.updatedAt !== job.endedAt ||
    !same(manifest.evidence, [ref]) ||
    !same(job.result, { manifest }) ||
    (mode === 'live' && document.collectionMode !== 'live')
  )
    fail();
  verifyRef(ref, document, accountId, job.id);
  if (manifest.committedAt > new Date().toISOString()) fail();
  order([
    job.requestedAt,
    job.startedAt,
    job.platformReadStartedAt,
    read.phases.before.proof.readStartedAt,
    read.phases.before.proof.readFinishedAt,
    read.proof.proofCapturedAt,
    read.cleanup.checkedAt,
    ref.capturedAt,
    manifest.committedAt,
  ]);
  if (job.deadlineAt !== null) order([job.startedAt, job.deadlineAt]);
}

export interface NativeShortSubmissionAttemptPointer {
  readJobId: string;
  evidenceId: string;
  evidenceHash: string;
}

export interface NativeShortSubmissionPreviousPointer {
  reconciliationJobId: string;
  evidenceId: string;
  evidenceHash: string;
  resultHash: string;
  settledAt: string;
}

export interface NativeShortSubmissionOriginalAudit {
  schema: 'native-short-submission-original-audit/v1';
  phase: 'initial' | 'continuation';
  originalJobId: string;
  accountId: string;
  operation: typeof NATIVE_SHORT_SUBMISSION_OPERATION;
  scope: string;
  inputHash: string;
  target: { kind: 'short-story'; id: string };
  datasets: [];
  requestedAt: string;
  startedAt: string;
  platformReadStartedAt: string;
  platformWriteStartedAt: string | null;
  originalEndedAt: string;
  priorEndedAt: string;
  priorError: Job['error'];
  priorEvidence: EvidenceRef[];
  attempts: NativeShortSubmissionAttemptRow[];
  previousClosure: NativeShortSubmissionPreviousPointer | null;
  originalAttemptEvidence: NativeShortSubmissionAttemptPointer | null;
}

export interface NativeShortSubmissionReconciliationEvidence {
  schema: 'native-short-submission-reconciliation-evidence/v1';
  scope: typeof NATIVE_SHORT_SUBMISSION_SCOPE;
  hashBases: typeof NATIVE_SHORT_SUBMISSION_HASH_BASES;
  originalAudit: NativeShortSubmissionOriginalAudit;
  baselineEvidence: NativeShortSubmissionAttemptRow['evidence'];
  result: NativeShortSubmissionApiResult;
  comparison: NativeShortSubmissionComparison | null;
  source: { origin: typeof ORIGIN; mode: 'live' | 'fixture' };
  provenance: NativeShortProvenance;
  reconciliation: {
    originalJobId: string;
    target: { kind: 'short-story'; id: string };
    inputHash: string;
    status: 'succeeded' | 'failed' | 'uncertain';
    reason: 'saved_by_later_read' | 'outcome_unknown' | 'fixture_only' | 'platform_rejected';
    originalOutcome: string;
    observedContentHash: string | null;
    originalSaveAcknowledged: boolean;
    originalSaveDurableAcknowledged: boolean;
    useAi: {
      requested: 1 | 2;
      acknowledged: 1 | 2 | null;
      observed: 1 | 2 | null;
      evidence: string;
    };
    termsHash: string;
    contractHash: string;
    attemptOrdinal: 1 | null;
    acknowledgement: { code: number; accepted: boolean; itemId: string | null } | null;
  };
}

export type AuditReconciliationEvidence = Omit<
  NativeShortSubmissionReconciliationEvidence,
  'result'
> & {
  result: NativeShortSubmissionApiResult;
};

export interface NativeShortSubmissionReconciliationContext {
  original: NativeShortSubmissionEvidenceContext;
  readJob: Job;
  manifest: Manifest;
  ref: EvidenceRef;
  document: EvidenceDocument;
}

export interface NativeShortSubmissionClosure {
  schema: 'native-short-submission-closure/v1';
  target: { kind: 'short-story'; id: string };
  reconciliationJobId: string;
  evidence: EvidenceRef;
  status: 'succeeded' | 'failed' | 'uncertain';
  result: Record<string, unknown>;
  originalAudit: NativeShortSubmissionOriginalAudit;
  originalAttemptEvidence: NativeShortSubmissionAttemptPointer;
  settledAt: string;
}

export const AUDIT_STABLE = [
  'accountId',
  'operation',
  'scope',
  'inputHash',
  'target',
  'datasets',
  'requestedAt',
  'startedAt',
  'platformReadStartedAt',
  'platformWriteStartedAt',
] as const;

export function pointer(input: unknown): NativeShortSubmissionAttemptPointer {
  const p = exact(input, ['readJobId', 'evidenceId', 'evidenceHash']);
  if (!UUID.test(p.readJobId) || !UUID.test(p.evidenceId) || !HASH.test(p.evidenceHash)) fail();
  return p as NativeShortSubmissionAttemptPointer;
}
