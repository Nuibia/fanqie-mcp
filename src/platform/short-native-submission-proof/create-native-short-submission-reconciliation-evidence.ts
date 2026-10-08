import { type NativeShortSubmissionApiResult } from '../short-native-submission-api.js';

import {
  type NativeShortSubmissionContext,
  NATIVE_SHORT_SUBMISSION_HASH_BASES,
  fail,
  copy,
  exact,
  same,
  verifyRef,
  UUID,
  hash,
  integer,
  order,
  freeze,
  type NativeShortSubmissionProjection,
} from './fail.js';

import { type NativeShortProvenance } from '../short-native-metadata-proof.js';

import {
  type NativeShortSubmissionOriginalAudit,
  type NativeShortSubmissionReconciliationEvidence,
  type AuditReconciliationEvidence,
  type NativeShortSubmissionReconciliationContext,
  type NativeShortSubmissionClosure,
} from './safe-native-short-submission-job.js';

import {
  reconciliation,
  auditShape,
  createNativeShortSubmissionOriginalAudit,
  closureShape,
  sourceForAudit,
} from './audit-shape.js';

import { type EvidenceRef, type Job, type Manifest } from '../../runtime/store.js';

import { NATIVE_SHORT_SUBMISSION_SCOPE } from '../short-native-submission.js';

import { safeComparison } from './link-base.js';

import { checkedContext } from './source-fields.js';

import {
  scalar,
  nativeObservation,
  statusObservation,
  safeNativeShortSubmissionRef,
} from './create-native-short-submission-stage-evidence.js';

export function createNativeShortSubmissionReconciliationEvidence(
  raw: NativeShortSubmissionApiResult,
  o: NativeShortSubmissionContext,
  p: NativeShortProvenance,
  a?: NativeShortSubmissionOriginalAudit,
): NativeShortSubmissionReconciliationEvidence {
  return reconciliation(raw, o, p, a ? auditShape(a) : createNativeShortSubmissionOriginalAudit(o));
}

function reconciliationBusiness(
  evidence: AuditReconciliationEvidence,
  ref: EvidenceRef,
): Record<string, unknown> {
  const s = evidence.result.snapshot;
  return {
    schema: 'fanqie-short-native-submission-reconciliation-business/v1',
    dataset: 'reconciliation',
    ...evidence.reconciliation,
    accountId: evidence.originalAudit.accountId,
    scope: NATIVE_SHORT_SUBMISSION_SCOPE,
    hashBases: NATIVE_SHORT_SUBMISSION_HASH_BASES,
    originalEndedAt: evidence.originalAudit.originalEndedAt,
    priorEndedAt: evidence.originalAudit.priorEndedAt,
    sourceRef: ref.id,
    evidenceHash: ref.sha256,
    evidenceCapturedAt: ref.capturedAt,
    checkedAt: evidence.result.proof.proofCapturedAt ?? evidence.result.cleanup.checkedAt,
    provenance: evidence.provenance,
    snapshotVersionHash: s?.snapshotVersionHash ?? null,
    comparison: safeComparison(evidence.comparison),
    publication: { status: s?.state ?? 'unknown', statusFacts: s?.statusFacts ?? null },
    useAi: evidence.reconciliation.useAi,
    bodyIncluded: false,
  };
}

export function validateNativeShortSubmissionReconciliationContext(
  input: NativeShortSubmissionReconciliationContext,
): {
  evidence: AuditReconciliationEvidence;
  status: 'succeeded' | 'failed' | 'uncertain';
  result: Record<string, unknown>;
} {
  try {
    if (!input || typeof input !== 'object') fail();
    const descriptors = Object.getOwnPropertyDescriptors(input),
      keys = ['original', 'readJob', 'manifest', 'ref', 'document'];
    if (
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
      Object.getOwnPropertySymbols(input).length ||
      Object.keys(descriptors).length !== keys.length ||
      keys.some((k) => !descriptors[k]?.enumerable || !Object.hasOwn(descriptors[k]!, 'value'))
    )
      fail();
    const original = checkedContext(descriptors.original!.value),
      copied = copy(
        {
          readJob: descriptors.readJob!.value,
          manifest: descriptors.manifest!.value,
          ref: descriptors.ref!.value,
        },
        512 * 1024,
      ),
      document = copy(descriptors.document!.value, 192 * 1024 * 1024),
      payload = exact(document.payload, [
        'schema',
        'scope',
        'hashBases',
        'originalAudit',
        'baselineEvidence',
        'result',
        'comparison',
        'source',
        'provenance',
        'reconciliation',
      ]);
    const audit = auditShape(payload.originalAudit),
      expected = reconciliation(payload.result, original, payload.provenance, audit);
    if (!same(payload, expected)) fail();
    const read = copied.readJob as Job,
      manifest = copied.manifest as Manifest,
      ref = copied.ref as EvidenceRef;
    verifyRef(ref, document, original.accountId, read.id);
    if (
      read.id === original.job.id ||
      !UUID.test(read.id) ||
      !UUID.test(read.ownerId) ||
      read.kind !== 'read' ||
      read.status !== 'succeeded' ||
      read.accountId !== original.accountId ||
      read.operation !== 'reconcile_write' ||
      read.scope !== 'reconciliation' ||
      !same(read.datasets, ['reconciliation']) ||
      read.inputHash !== hash({ jobId: original.job.id }) ||
      read.error !== null ||
      read.cancellationRequestedAt !== null ||
      read.cancellationReason !== null ||
      read.idempotencyKey !== null ||
      read.platformWriteStartedAt !== null ||
      !same(read.target, audit.target) ||
      !same(read.metadata, {})
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
      manifest.accountId !== read.accountId ||
      manifest.jobId !== read.id ||
      manifest.operation !== read.operation ||
      manifest.scope !== read.scope ||
      !same(manifest.datasets, read.datasets) ||
      manifest.requestedAt !== read.requestedAt ||
      manifest.platformReadStartedAt !== read.platformReadStartedAt ||
      manifest.committedAt !== read.endedAt ||
      read.updatedAt !== read.endedAt ||
      !same(manifest.evidence, [ref]) ||
      !same(read.result, { manifest }) ||
      ref.dataset !== 'reconciliation' ||
      (expected.provenance.mode === 'live' && document.collectionMode !== 'live') ||
      document.evidenceKind !== 'observation' ||
      integer(read.timeoutMs, 2_147_483_647) < 1
    )
      fail();
    if (
      manifest.committedAt > new Date().toISOString() ||
      read.requestedAt <= audit.priorEndedAt ||
      read.platformReadStartedAt === null ||
      read.platformReadStartedAt <= audit.priorEndedAt
    )
      fail();
    const rp = expected.result.proof;
    order([
      read.requestedAt,
      read.startedAt,
      read.platformReadStartedAt,
      expected.result.phases.after.proof.readStartedAt,
      ...[expected.result.phases.after.proof.readFinishedAt].filter((t) => t !== null),
      ...[rp.proofCapturedAt].filter((t) => t !== null),
      expected.result.cleanup.checkedAt,
      ref.capturedAt,
      manifest.committedAt,
    ]);
    if (read.deadlineAt !== null) order([read.startedAt, read.deadlineAt]);
    // Historical source reconstruction uses its immutable audit, never mutable endedAt as original proof.
    if (
      original.job.endedAt === null ||
      original.job.endedAt < audit.originalEndedAt ||
      !['uncertain', 'failed', 'succeeded'].includes(original.job.status)
    )
      fail();
    return freeze({
      evidence: expected,
      status: expected.reconciliation.status,
      result: reconciliationBusiness(expected, ref),
    });
  } catch {
    fail();
  }
}

export function createNativeShortSubmissionClosure(
  context: NativeShortSubmissionReconciliationContext,
  settledAt: string,
): NativeShortSubmissionClosure {
  const verified = validateNativeShortSubmissionReconciliationContext(context),
    audit = verified.evidence.originalAudit;
  order([context.manifest.committedAt, settledAt]);
  if (settledAt > new Date().toISOString()) fail();
  return freeze<NativeShortSubmissionClosure>({
    schema: 'native-short-submission-closure/v1',
    target: audit.target,
    reconciliationJobId: context.readJob.id,
    evidence: copy(context.ref, 16_384),
    status: verified.status,
    result: verified.result,
    originalAudit: audit,
    originalAttemptEvidence: audit.originalAttemptEvidence ?? {
      readJobId: context.readJob.id,
      evidenceId: context.ref.id,
      evidenceHash: context.ref.sha256,
    },
    settledAt,
  });
}

export function validateNativeShortSubmissionClosureContext(
  context: NativeShortSubmissionReconciliationContext,
  closure: unknown,
  settledAt: string,
): ReturnType<typeof validateNativeShortSubmissionReconciliationContext> {
  try {
    const c = closureShape(closure),
      expected = createNativeShortSubmissionClosure(context, settledAt);
    if (!same(c, expected)) fail();
    return validateNativeShortSubmissionReconciliationContext(context);
  } catch {
    fail();
  }
}

export function projectNativeShortSubmissionReconciliationContext(
  context: NativeShortSubmissionReconciliationContext,
): NativeShortSubmissionProjection {
  try {
    const verified = validateNativeShortSubmissionReconciliationContext(context),
      current = scalar(context.original.job, 'result');
    let result: Record<string, unknown> | null = null;
    const status = verified.evidence.result.snapshot
        ? nativeObservation(verified.evidence.result.snapshot, 'later_read', context.ref)
        : statusObservation(sourceForAudit(context.original, verified.evidence.originalAudit)),
      publicBusiness = { ...verified.result, ...status };
    if (
      scalar(current, 'schema') === 'native-short-submission-closure/v1' &&
      scalar(current, 'reconciliationJobId') === context.readJob.id
    ) {
      const c = closureShape(current);
      validateNativeShortSubmissionClosureContext(context, c, c.settledAt);
      result = {
        schema: c.schema,
        target: c.target,
        reconciliationJobId: c.reconciliationJobId,
        evidence: safeNativeShortSubmissionRef(c.evidence),
        status: c.status,
        result: publicBusiness,
        originalAttemptEvidence: c.originalAttemptEvidence,
        settledAt: c.settledAt,
        originalEndedAt: c.originalAudit.originalEndedAt,
        priorEndedAt: c.originalAudit.priorEndedAt,
      };
    }
    return freeze({
      validated: true,
      result,
      evidence: [safeNativeShortSubmissionRef(context.ref)],
      data: [publicBusiness],
      collectionMode: verified.evidence.provenance.mode,
    });
  } catch {
    return { validated: false, result: null, evidence: [], data: [], collectionMode: null };
  }
}
