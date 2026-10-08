import {
  type NativeShortCoverEvidenceContext,
  provenance,
  fail,
  freeze,
  refLink,
  ORIGIN,
  copy,
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
  type NativeShortCoverOriginalAudit,
  type AuditReconciliationEvidence,
  type NativeShortCoverReconciliationEvidence,
  type NativeShortCoverReconciliationContext,
} from './project-native-short-cover-evidence-context.js';

import {
  sourceForAudit,
  auditShape,
  createNativeShortCoverOriginalAudit,
  type NativeShortCoverClosure,
  closureShape,
} from './pointer.js';

import { storedSnapshot } from './has-reserved-native-short-cover-signal.js';

import { storedCoverMath } from '../short-native-legacy-codec.js';

import {
  nativeShortCoverDesiredContentHash,
  NATIVE_SHORT_COVER_SCOPE,
  NATIVE_SHORT_COVER_HASH_BASES,
} from '../short-native-cover.js';

import { type NativeShortMetadataApiResult } from '../short-native-metadata-api.js';

import { type EvidenceRef, type Job, type Manifest } from '../../runtime/store.js';

import { checkedContext, verifyRef } from './ordinary-job.js';

function reconciliation(
  raw: unknown,
  original: NativeShortCoverEvidenceContext,
  provenanceInput: NativeShortProvenance,
  audit: NativeShortCoverOriginalAudit,
): AuditReconciliationEvidence {
  const state = sourceForAudit(original, audit),
    p = provenance(provenanceInput),
    intent = state.baseline!.uploadIntent;
  const read = validateStoredNativeShortApiResult(raw, {
    accountId: intent.binding.account.id,
    workId: intent.binding.work.id,
  });
  if (
    read.status !== 'success' ||
    read.proof.readStartedAt! <= audit.priorEndedAt ||
    read.proof.proofCapturedAt! > new Date().toISOString() ||
    (state.provenance!.mode === 'live' && p.mode !== 'live')
  )
    fail();
  const later = storedSnapshot(read.snapshot!);
  if (state.mode === 'modern' && later.mode !== 'modern') fail();
  // The later graph is authenticated independently. Modern comparison keeps the current facts gate when its expectation came from a legacy original.
  const comparison = state.plan
    ? storedCoverMath.compareReadback(state.plan.expectation, later)
    : null;
  let observed: string | null = null;
  if (comparison && state.plan) {
    const a = comparison.actual;
    observed = nativeShortCoverDesiredContentHash({
      ...state.plan.expectation,
      binding: read.snapshot!.binding,
      catalogHash: a.catalogHash,
      documentHash: a.documentHash,
      savedFieldsHash: a.savedFieldsHash,
      categorySelectionHash: a.categorySelectionHash,
      preservationHash: a.preservationHash,
      coverUriHash: a.coverUriHash,
    });
  }
  const saveAttempted = state.kinds.includes('saveAttempt'),
    live = p.mode === 'live' && state.provenance!.mode === 'live';
  const status = !live
    ? 'uncertain'
    : !state.uploadAck
      ? 'uncertain'
      : !saveAttempted
        ? 'failed'
        : comparison?.matches && observed === state.plan?.desiredContentHash
          ? 'succeeded'
          : 'uncertain';
  const reason = !live
    ? 'fixture_only'
    : status === 'succeeded'
      ? 'saved_by_later_read'
      : status === 'failed'
        ? 'save_not_attempted'
        : 'outcome_unknown';
  const ackIndex = state.kinds.indexOf('uploadAck');
  return freeze<AuditReconciliationEvidence>({
    schema: 'native-short-cover-reconciliation-evidence/v1',
    scope: NATIVE_SHORT_COVER_SCOPE,
    hashBases: NATIVE_SHORT_COVER_HASH_BASES,
    originalAudit: audit,
    baselineEvidence: refLink(original.refs[0]!),
    uploadAckEvidence: ackIndex < 0 ? null : refLink(original.refs[ackIndex]!),
    result: read,
    comparison,
    source: { origin: ORIGIN, mode: p.mode },
    provenance: p,
    reconciliation: {
      originalJobId: audit.originalJobId,
      target: audit.target,
      inputHash: audit.inputHash,
      status,
      reason,
      assetOutcome:
        status === 'succeeded' ? 'bound_verified' : state.uploadAck ? 'orphan_possible' : 'unknown',
      observedContentHash: observed,
      originalSaveAcknowledged:
        state.after?.save.post.acknowledged ?? state.kinds.includes('saveAck'),
      originalSaveDurableAcknowledged: state.kinds.includes('saveAck'),
    },
  });
}

export function createNativeShortCoverReconciliationEvidence(
  rawRead: NativeShortMetadataApiResult,
  original: NativeShortCoverEvidenceContext,
  p: NativeShortProvenance,
  auditInput?: NativeShortCoverOriginalAudit,
): NativeShortCoverReconciliationEvidence {
  try {
    const modern = validateNativeShortApiResult(rawRead),
      evidence = reconciliation(
        modern,
        original,
        p,
        auditInput ? auditShape(auditInput) : createNativeShortCoverOriginalAudit(original),
      );
    return freeze({ ...evidence, result: modern });
  } catch {
    fail();
  }
}

function reconciliationBusiness(
  evidence: AuditReconciliationEvidence,
  ref: EvidenceRef,
): Record<string, unknown> {
  const r = evidence.reconciliation;
  return {
    schema: 'fanqie-short-native-cover-reconciliation-business/v1',
    dataset: 'reconciliation',
    ...r,
    accountId: evidence.originalAudit.accountId,
    scope: NATIVE_SHORT_COVER_SCOPE,
    hashBases: NATIVE_SHORT_COVER_HASH_BASES,
    originalEndedAt: evidence.originalAudit.originalEndedAt,
    priorEndedAt: evidence.originalAudit.priorEndedAt,
    sourceRef: ref.id,
    evidenceHash: ref.sha256,
    evidenceCapturedAt: ref.capturedAt,
    provenance: evidence.provenance,
    snapshotVersionHash: evidence.result.snapshot!.snapshotVersionHash,
    comparison: evidence.comparison,
  };
}

export function validateNativeShortCoverReconciliationContext(
  input: NativeShortCoverReconciliationContext,
): {
  evidence: AuditReconciliationEvidence;
  status: 'succeeded' | 'failed' | 'uncertain';
  result: Record<string, unknown>;
} {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(input),
      keys = ['original', 'readJob', 'manifest', 'ref', 'document'];
    if (
      !input ||
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
      document = copy(descriptors.document!.value),
      payload = exact(document.payload, [
        'schema',
        'scope',
        'hashBases',
        'originalAudit',
        'baselineEvidence',
        'uploadAckEvidence',
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
    if (read.requestedAt <= audit.priorEndedAt || read.platformReadStartedAt! <= audit.priorEndedAt)
      fail();
    order([
      read.requestedAt,
      read.startedAt,
      read.platformReadStartedAt,
      expected.result.proof.readStartedAt,
      expected.result.proof.readFinishedAt,
      expected.result.cleanup.checkedAt,
      expected.result.proof.proofCapturedAt,
      ref.capturedAt,
      manifest.committedAt,
    ]);
    if (read.deadlineAt !== null) order([read.startedAt, read.deadlineAt]);
    // A historical read remains valid after a later settlement; only stable source fields and frozen original end bind it.
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

export function createNativeShortCoverClosure(
  context: NativeShortCoverReconciliationContext,
  settledAt: string,
): NativeShortCoverClosure {
  const verified = validateNativeShortCoverReconciliationContext(context),
    audit = verified.evidence.originalAudit;
  order([context.manifest.committedAt, settledAt]);
  return freeze<NativeShortCoverClosure>({
    schema: 'native-short-cover-closure/v1',
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

export function validateNativeShortCoverClosureContext(
  context: NativeShortCoverReconciliationContext,
  closure: unknown,
  settledAt: string,
): ReturnType<typeof validateNativeShortCoverReconciliationContext> {
  try {
    const c = closureShape(closure),
      expected = createNativeShortCoverClosure(context, settledAt);
    if (!same(c, expected)) fail();
    return validateNativeShortCoverReconciliationContext(context);
  } catch {
    fail();
  }
}
