import {
  type NativeShortTrialPlan,
  type NativeShortTrialComparison,
  nativeShortTrialDesiredContentHash,
  NATIVE_SHORT_TRIAL_SCOPE,
  NATIVE_SHORT_TRIAL_HASH_BASES,
} from '../short-native-trial.js';

import {
  type AuditSnapshot,
  type NativeShortTrialEvidenceContext,
  provenance,
  copy,
  fail,
  freeze,
  refLink,
  ORIGIN,
  exact,
  same,
  UUID,
  hash,
  integer,
  order,
} from './fail.js';

import {
  type NativeShortProvenance,
  validateStoredNativeShortApiResult,
  validateNativeShortApiResult,
} from '../short-native-metadata-proof.js';

import {
  type NativeShortTrialOriginalAudit,
  type AuditReconciliationEvidence,
  sourceForAudit,
  type NativeShortTrialReconciliationEvidence,
  auditShape,
  createNativeShortTrialOriginalAudit,
  type NativeShortTrialReconciliationContext,
} from './pointer.js';

import { storedMetadataMath, storedTrialMath } from '../short-native-legacy-codec.js';

import { storedNativeSnapshot } from './stored-native-snapshot.js';

import { type NativeShortMetadataApiResult } from '../short-native-metadata-api.js';

import { type EvidenceRef, type Job, type Manifest } from '../../runtime/store.js';

import { checkedContext, verifyRef } from './read-phase.js';

export function observedHash(
  plan: NativeShortTrialPlan,
  s: AuditSnapshot,
  comparison: NativeShortTrialComparison,
): string {
  return nativeShortTrialDesiredContentHash({
    ...plan.expectation,
    binding: s.binding,
    expectedDocumentHash: s.documentHash,
    expectedSavedFieldsHash: s.savedFieldsHash,
    catalogHash: s.catalogHash,
    categorySelectionHash: s.categorySelectionHash,
    preservationHash: comparison.actual.preservationHash,
    coversHash: s.coversHash,
    bodyHash: s.bodyHash,
    paragraphsHash: s.paragraphsHash,
    trialDocumentHash: s.trialDocumentHash,
    desiredHtml: s.document.rawHtml,
  });
}

function reconciliation(
  raw: unknown,
  original: NativeShortTrialEvidenceContext,
  provenanceInput: NativeShortProvenance,
  audit: NativeShortTrialOriginalAudit,
): AuditReconciliationEvidence {
  const state = sourceForAudit(original, audit),
    p = provenance(copy(provenanceInput)),
    plan = state.plan!;
  const read = validateStoredNativeShortApiResult(raw, {
    accountId: plan.expectation.binding.account.id,
    workId: plan.expectation.binding.work.id,
  });
  if (
    !read.proof.platformStarted ||
    read.proof.readStartedAt === null ||
    read.proof.readStartedAt <= audit.priorEndedAt ||
    read.cleanup.checkedAt > new Date().toISOString() ||
    (read.proof.proofCapturedAt !== null &&
      read.proof.proofCapturedAt > new Date().toISOString()) ||
    (state.provenance!.mode === 'live' && p.mode !== 'live')
  )
    fail();
  let comparison: NativeShortTrialComparison | null = null,
    observed: string | null = null;
  if (
    read.snapshot !== null &&
    state.mode === 'modern' &&
    storedMetadataMath.decodeSnapshot(read.snapshot).mode !== 'modern'
  )
    fail();
  if (read.status === 'success') {
    try {
      const after = storedNativeSnapshot(read.snapshot!);
      comparison = storedTrialMath.compareReadback(plan.expectation, after);
      observed = observedHash(plan, after.snapshot, comparison);
    } catch {
      /* Full C1 with unsupported body grammar is still an uncertain private observation. */
    }
  }
  const live = p.mode === 'live' && state.provenance!.mode === 'live',
    attempted = state.kinds.includes('attempt'),
    acknowledged = state.kinds.includes('acknowledgement');
  const status =
    live &&
    attempted &&
    (state.after === null || state.after.save.post.attempts === 1) &&
    comparison?.matches &&
    observed === plan.desiredContentHash
      ? 'succeeded'
      : 'uncertain';
  return freeze<AuditReconciliationEvidence>({
    schema: 'native-short-trial-reconciliation-evidence/v1',
    scope: NATIVE_SHORT_TRIAL_SCOPE,
    hashBases: NATIVE_SHORT_TRIAL_HASH_BASES,
    originalAudit: audit,
    baselineEvidence: refLink(original.refs[0]!),
    result: read,
    comparison,
    source: { origin: ORIGIN, mode: p.mode },
    provenance: p,
    reconciliation: {
      originalJobId: audit.originalJobId,
      target: audit.target,
      inputHash: audit.inputHash,
      status,
      reason: !live
        ? 'fixture_only'
        : status === 'succeeded'
          ? 'saved_by_later_read'
          : 'outcome_unknown',
      observedContentHash: observed,
      originalSaveAcknowledged: state.after?.save.post.acknowledged ?? acknowledged,
      originalSaveDurableAcknowledged: acknowledged,
      originalOutcome: acknowledged ? (state.after?.save.outcome ?? 'acknowledged') : 'unknown',
    },
  });
}

export function createNativeShortTrialReconciliationEvidence(
  rawRead: NativeShortMetadataApiResult,
  original: NativeShortTrialEvidenceContext,
  p: NativeShortProvenance,
  auditInput?: NativeShortTrialOriginalAudit,
): NativeShortTrialReconciliationEvidence {
  try {
    const modern = validateNativeShortApiResult(rawRead),
      evidence = reconciliation(
        modern,
        original,
        p,
        auditInput ? auditShape(auditInput) : createNativeShortTrialOriginalAudit(original),
      );
    return freeze({ ...evidence, result: modern });
  } catch {
    fail();
  }
}

function safeComparison(c: NativeShortTrialComparison | null): Record<string, unknown> | null {
  if (c === null) return null;
  const a = c.actual;
  return {
    matches: c.matches,
    reason: c.reason,
    scope: NATIVE_SHORT_TRIAL_SCOPE,
    hashBases: NATIVE_SHORT_TRIAL_HASH_BASES,
    actual: {
      snapshotVersionHash: a.snapshotVersionHash,
      catalogHash: a.catalogHash,
      documentHash: a.documentHash,
      savedFieldsHash: a.savedFieldsHash,
      categorySelectionHash: a.categorySelectionHash,
      preservationHash: a.preservationHash,
      coversHash: a.coversHash,
      bodyHash: a.bodyHash,
      paragraphsHash: a.paragraphsHash,
      trialDocumentHash: a.trialDocumentHash,
      serverRevisionPolicy: a.serverRevisionPolicy,
    },
  };
}

function reconciliationBusiness(
  evidence: AuditReconciliationEvidence,
  ref: EvidenceRef,
): Record<string, unknown> {
  const s = evidence.result.snapshot;
  return {
    schema: 'fanqie-short-native-trial-reconciliation-business/v1',
    dataset: 'reconciliation',
    ...evidence.reconciliation,
    accountId: evidence.originalAudit.accountId,
    scope: NATIVE_SHORT_TRIAL_SCOPE,
    hashBases: NATIVE_SHORT_TRIAL_HASH_BASES,
    originalEndedAt: evidence.originalAudit.originalEndedAt,
    priorEndedAt: evidence.originalAudit.priorEndedAt,
    sourceRef: ref.id,
    evidenceHash: ref.sha256,
    evidenceCapturedAt: ref.capturedAt,
    checkedAt: evidence.result.proof.proofCapturedAt ?? evidence.result.cleanup.checkedAt,
    provenance: evidence.provenance,
    snapshotVersionHash: s?.snapshotVersionHash ?? null,
    comparison: safeComparison(evidence.comparison),
    bodyIncluded: false,
  };
}

export function validateNativeShortTrialReconciliationContext(
  input: NativeShortTrialReconciliationContext,
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
      document = copy(descriptors.document!.value, 32 * 1024 * 1024),
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
      rp.readStartedAt,
      ...[rp.readFinishedAt].filter((t) => t !== null),
      expected.result.cleanup.checkedAt,
      ...[rp.proofCapturedAt].filter((t) => t !== null),
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
