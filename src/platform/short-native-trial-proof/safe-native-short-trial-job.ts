import {
  type Job,
  type Manifest,
  type EvidenceRef,
  type EvidenceDocument,
} from '../../runtime/store.js';

import {
  type NativeShortTrialProjection,
  UUID,
  NATIVE_SHORT_TRIAL_OPERATION,
  NATIVE_SHORT_TRIAL_READ_OPERATION,
  NATIVE_SHORT_TRIAL_READ_DATASET,
  HASH,
  WORK,
  ORIGIN,
  copy,
  provenance,
  fail,
  freeze,
  exact,
  same,
  integer,
  order,
  type AuditSnapshot,
  type NativeShortTrialContext,
  nativeShortTrialScope,
  nativeShortTrialReadInputHash,
} from './fail.js';

import {
  scalar,
  safeString,
  publicSnapshot,
  observation,
  safeNativeShortTrialRef,
} from './validate-native-short-trial-evidence-context.js';

import {
  isCanonicalNativeTime,
  type NativeShortProvenance,
  validateNativeShortApiResult,
  type StoredNativeShortMetadataApiResult,
  validateStoredNativeShortApiResult,
} from '../short-native-metadata-proof.js';

import { NATIVE_SHORT_TRIAL_SCOPE, createNativeShortTrialSnapshot } from '../short-native-trial.js';

import { type NativeShortMetadataApiResult } from '../short-native-metadata-api.js';

import { safeSnapshot } from './api-result.js';

import { verifyRef, checkedContext } from './read-phase.js';

import { storedNativeSnapshot } from './stored-native-snapshot.js';

export function safeNativeShortTrialJob(
  job: Job,
  projection: NativeShortTrialProjection | null,
): Record<string, unknown> {
  const operation = scalar(job, 'operation'),
    scope = scalar(job, 'scope');
  const out: Record<string, unknown> = {
    id: safeString(scalar(job, 'id'), UUID),
    accountId: safeString(scalar(job, 'accountId'), /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
    kind:
      scalar(job, 'kind') === 'read' ? 'read' : scalar(job, 'kind') === 'write' ? 'write' : null,
    operation: [
      NATIVE_SHORT_TRIAL_OPERATION,
      NATIVE_SHORT_TRIAL_READ_OPERATION,
      'reconcile_write',
    ].includes(operation as any)
      ? operation
      : null,
    scope:
      typeof scope === 'string' &&
      (/^short_native_trial\.[1-9][0-9]{9,21}$/.test(scope) || scope === 'reconciliation')
        ? scope
        : null,
    datasets:
      operation === 'reconcile_write'
        ? ['reconciliation']
        : operation === NATIVE_SHORT_TRIAL_READ_OPERATION
          ? [NATIVE_SHORT_TRIAL_READ_DATASET]
          : operation === NATIVE_SHORT_TRIAL_OPERATION
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
            code: 'native_trial_outcome_unavailable',
            message: 'Native short trial outcome is unavailable.',
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

export interface NativeShortTrialReadEvidence {
  schema: 'native-short-trial-read-evidence/v1';
  scope: typeof NATIVE_SHORT_TRIAL_SCOPE;
  result: NativeShortMetadataApiResult;
  snapshot: Record<string, unknown>;
  source: { origin: typeof ORIGIN; mode: 'live' | 'fixture' };
  provenance: NativeShortProvenance;
}

export function createNativeShortTrialReadEvidence(
  raw: NativeShortMetadataApiResult,
  pInput: NativeShortProvenance,
): NativeShortTrialReadEvidence {
  try {
    const result = validateNativeShortApiResult(copy(raw)),
      p = provenance(copy(pInput));
    if (result.status !== 'success') fail();
    return freeze({
      schema: 'native-short-trial-read-evidence/v1',
      scope: NATIVE_SHORT_TRIAL_SCOPE,
      result,
      snapshot: safeSnapshot(createNativeShortTrialSnapshot(result.snapshot!)),
      source: { origin: ORIGIN, mode: p.mode },
      provenance: p,
    });
  } catch {
    fail();
  }
}

function validateReadJob(
  job: Job,
  manifest: Manifest,
  ref: EvidenceRef,
  document: EvidenceDocument,
  accountId: string,
  workId: string,
  operation: string,
  scope: string,
  inputHash: string,
  read: StoredNativeShortMetadataApiResult,
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
    read.proof.readStartedAt,
    read.proof.readFinishedAt,
    read.cleanup.checkedAt,
    read.proof.proofCapturedAt,
    ref.capturedAt,
    manifest.committedAt,
  ]);
  if (job.deadlineAt !== null) order([job.startedAt, job.deadlineAt]);
}

export type NativeShortTrialValidatedReadEvidence = Omit<
  NativeShortTrialReadEvidence,
  'snapshot' | 'result'
> & { snapshot: AuditSnapshot; result: StoredNativeShortMetadataApiResult };

export function validateNativeShortTrialReadContext(
  input: NativeShortTrialContext,
): NativeShortTrialValidatedReadEvidence {
  try {
    const c = checkedContext(input);
    if (!c.manifest || c.refs.length !== 1 || c.documents.length !== 1 || c.attempts.length !== 0)
      fail();
    const document = c.documents[0]!,
      ref = c.refs[0]!,
      payload = exact(document.payload, [
        'schema',
        'scope',
        'result',
        'snapshot',
        'source',
        'provenance',
      ]);
    const result = validateStoredNativeShortApiResult(payload.result),
      p = provenance(payload.provenance);
    if (result.status !== 'success') fail();
    const snapshot = storedNativeSnapshot(result.snapshot!).snapshot,
      rebuilt = {
        schema: 'native-short-trial-read-evidence/v1' as const,
        scope: NATIVE_SHORT_TRIAL_SCOPE,
        result,
        snapshot: safeSnapshot(snapshot),
        source: { origin: ORIGIN as typeof ORIGIN, mode: p.mode },
        provenance: p,
      };
    if (!same(payload, rebuilt) || ref.dataset !== NATIVE_SHORT_TRIAL_READ_DATASET) fail();
    const workId = snapshot.binding.work.id;
    validateReadJob(
      c.job,
      c.manifest,
      ref,
      document,
      c.accountId,
      workId,
      NATIVE_SHORT_TRIAL_READ_OPERATION,
      nativeShortTrialScope(workId),
      nativeShortTrialReadInputHash(workId),
      rebuilt.result,
      rebuilt.provenance.mode,
    );
    return freeze({ ...rebuilt, snapshot });
  } catch {
    fail();
  }
}

export function projectNativeShortTrialReadContext(
  context: NativeShortTrialContext,
): NativeShortTrialProjection {
  try {
    const verified = validateNativeShortTrialReadContext(context),
      ref = context.refs[0]!;
    const data = {
      schema: 'fanqie-short-native-trial-read-business/v1',
      dataset: NATIVE_SHORT_TRIAL_READ_DATASET,
      status: 'succeeded',
      reason: null,
      accountId: context.accountId,
      ...publicSnapshot(verified.snapshot),
      ...observation(verified.snapshot, 'read', ref),
      sourceRef: ref.id,
      evidenceHash: ref.sha256,
      evidenceCapturedAt: ref.capturedAt,
      checkedAt: verified.result.proof.proofCapturedAt,
      provenance: verified.provenance,
    };
    return freeze({
      validated: true,
      result: null,
      evidence: [safeNativeShortTrialRef(ref)],
      data: [data],
      collectionMode: verified.provenance.mode,
    });
  } catch {
    return { validated: false, result: null, evidence: [], data: [], collectionMode: null };
  }
}

export interface NativeShortTrialAttemptPointer {
  readJobId: string;
  evidenceId: string;
  evidenceHash: string;
}

export interface NativeShortTrialPreviousPointer {
  reconciliationJobId: string;
  evidenceId: string;
  evidenceHash: string;
  resultHash: string;
  settledAt: string;
}
