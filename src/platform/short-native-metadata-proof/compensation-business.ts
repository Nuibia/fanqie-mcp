import {
  type NativeShortCompensationSourceContext,
  type StoredCompensationEvidence,
  type NativeShortCompensationBusiness,
  OPERATOR_BASIS,
  type NativeShortCompensationReadFrame,
  type NativeShortCompensationAttestation,
  type NativeShortCompensationReconciliationEvidence,
  type NativeShortCompensationContext,
  ownData,
  COMPENSATED_ERROR,
} from './project-native-short-closure.js';

import { type EvidenceRef } from '../../runtime/store.js';

import { compensationSourceDetails } from './compensation-source-details.js';

import { compensationRead } from './compensation-read.js';

import { digest } from './validate-native-short-evidence-context.js';

import {
  exact,
  type StoredNativeShortMetadataApiResult,
  equal,
  time,
  reject,
  object,
} from './reject.js';

import {
  buildCompensationEvidence,
  validateCompensationRegistration,
  buildCompensationAttestation,
} from './build-compensation-attestation.js';

import { type NativeShortMetadataApiResult } from '../short-native-metadata-api.js';

import { validateNativeShortApiResult } from './validate-api-result-core.js';

import { statusProjection } from './validate-native-short-write-business-input.js';

import { type NativeShortWriteProjection, safeWriteRef } from './clean-after-business.js';

import { type NativeShortSafeClosure } from './safe-native-short-write-job.js';

function compensationBusiness(
  source: NativeShortCompensationSourceContext,
  evidence: StoredCompensationEvidence,
  ref: EvidenceRef,
): NativeShortCompensationBusiness {
  const snapshot = evidence.result.snapshot!,
    audit = evidence.originalAudit;
  return {
    schema: 'fanqie-short-native-metadata-compensation-business/v1',
    dataset: 'reconciliation',
    terminalState: 'compensated',
    originalOutcome: 'unknown',
    originalAcceptance: 'not_verified',
    compensationOutcome: 'verified_restored',
    accountId: source.accountId,
    originalJobId: source.original.job.id,
    operatorJobId: source.operator.job.id,
    target: { kind: 'short-story', id: snapshot.binding.work.id },
    scope: snapshot.scope,
    hashBases: snapshot.hashBases,
    snapshotVersionHash: snapshot.snapshotVersionHash,
    catalogHash: snapshot.catalogHash,
    documentHash: snapshot.documentHash,
    savedFieldsHash: snapshot.savedFieldsHash,
    categorySelectionHash: snapshot.categorySelectionHash,
    verificationBasis: OPERATOR_BASIS,
    originalEndedAt: audit.originalEndedAt,
    priorEndedAt: audit.priorEndedAt,
    effectsEndedAt: audit.effectsEndedAt,
    registrationEvidence: evidence.registrationEvidence,
    originalBaselineEvidence: evidence.originalBaselineEvidence,
    operatorAfterEvidence: evidence.operatorAfterEvidence,
    source: evidence.source,
    provenance: evidence.provenance,
    proof: evidence.result.proof,
    requests: evidence.result.requests,
    list: evidence.result.list,
    cleanup: evidence.result.cleanup,
    sourceRef: ref.id,
    evidenceHash: ref.sha256,
    evidenceCapturedAt: ref.capturedAt,
  };
}

function verifyCompensationRead(
  source: NativeShortCompensationSourceContext,
  details: ReturnType<typeof compensationSourceDetails>,
  read: NativeShortCompensationReadFrame,
) {
  const payload = compensationRead(
    read,
    'reconcile_write',
    'reconciliation',
    'reconciliation',
    digest({ jobId: source.original.job.id }),
    details.target,
  );
  exact(payload, [
    'schema',
    'scope',
    'result',
    'originalAudit',
    'source',
    'provenance',
    'registrationEvidence',
    'originalBaselineEvidence',
    'operatorAfterEvidence',
    'verification',
  ]);
  const expected = buildCompensationEvidence(
    source,
    details,
    payload.result as StoredNativeShortMetadataApiResult,
  );
  if (
    !equal(payload, expected) ||
    read.job.requestedAt <= time(expected.originalAudit.priorEndedAt) ||
    read.job.platformReadStartedAt! > expected.result.proof.readStartedAt! ||
    read.ref.capturedAt < expected.result.proof.proofCapturedAt!
  )
    reject();
  return {
    evidence: expected,
    status: 'failed' as const,
    observedStatus: 'compensated' as const,
    result: compensationBusiness(source, expected, read.ref),
  };
}

export function validateNativeShortCompensationSourceContext(
  context: NativeShortCompensationSourceContext,
): NativeShortCompensationSourceContext {
  const details = compensationSourceDetails(context);
  validateCompensationRegistration(context, details);
  if (details.history.terminal) {
    const current = context.history.current!;
    const checked = verifyCompensationRead(context, details, current.read),
      closure = object(context.original.job.result);
    if (
      !equal(closure, {
        schema: 'native-short-metadata-compensated-closure/v1',
        target: details.target,
        reconciliationJobId: current.read.job.id,
        evidence: current.read.ref,
        observedStatus: checked.observedStatus,
        result: checked.result,
        originalAudit: checked.evidence.originalAudit,
        originalAttemptEvidence: checked.evidence.originalAudit.originalAttemptEvidence,
      })
    )
      reject();
  }
  return context;
}

export function createNativeShortCompensationAttestation(
  source: NativeShortCompensationSourceContext,
  approvedAt: string,
  effectsEndedAt: string,
): NativeShortCompensationAttestation {
  const details = compensationSourceDetails(source);
  if (source.registration !== null || details.history.terminal) reject();
  return buildCompensationAttestation(source, details, approvedAt, effectsEndedAt);
}

export function createNativeShortCompensationReconciliationEvidence(
  source: NativeShortCompensationSourceContext,
  result: NativeShortMetadataApiResult,
): NativeShortCompensationReconciliationEvidence {
  const validated = validateNativeShortCompensationSourceContext(source),
    details = compensationSourceDetails(validated);
  if (details.history.terminal) reject();
  validateNativeShortApiResult(result);
  return buildCompensationEvidence(
    validated,
    details,
    result,
  ) as NativeShortCompensationReconciliationEvidence;
}

export function validateNativeShortCompensationContext(context: NativeShortCompensationContext): {
  evidence: StoredCompensationEvidence;
  status: 'failed';
  observedStatus: 'compensated';
  result: NativeShortCompensationBusiness;
} {
  ownData(context, ['source', 'readJob', 'manifest', 'ref', 'document']);
  const source = validateNativeShortCompensationSourceContext(context.source),
    details = compensationSourceDetails(source);
  const verified = verifyCompensationRead(source, details, {
    job: context.readJob,
    manifest: context.manifest,
    ref: context.ref,
    document: context.document,
  });
  if (details.history.terminal && context.readJob.id !== source.history.current!.read.job.id)
    reject();
  return verified;
}

export function projectNativeShortCompensationReadContext(
  context: NativeShortCompensationContext,
): Record<string, unknown> {
  const verified = validateNativeShortCompensationContext(context);
  return {
    ...verified.result,
    ...statusProjection(verified.evidence.result.snapshot!, context.ref, 'compensation_read'),
  };
}

export function projectNativeShortCompensationEvidenceContext(
  source: NativeShortCompensationSourceContext,
  read: NativeShortCompensationReadFrame,
): NativeShortWriteProjection {
  const verified = validateNativeShortCompensationContext({
    source,
    readJob: read.job,
    manifest: read.manifest,
    ref: read.ref,
    document: read.document,
  });
  const original = source.original.job;
  if (
    original.status !== 'failed' ||
    !equal(original.error, COMPENSATED_ERROR) ||
    object(original.result).reconciliationJobId !== read.job.id
  )
    reject();
  const closure = object(original.result);
  const safe = {
    schema: closure.schema,
    target: original.target,
    reconciliationJobId: read.job.id,
    evidence: safeWriteRef(read.ref),
    observedStatus: 'compensated',
    result: {
      ...verified.result,
      ...statusProjection(verified.evidence.result.snapshot!, read.ref, 'compensation_read'),
    },
    originalAttemptEvidence: verified.evidence.originalAudit.originalAttemptEvidence,
    originalEndedAt: verified.evidence.originalAudit.originalEndedAt,
    priorEndedAt: verified.evidence.originalAudit.priorEndedAt,
  };
  return {
    validated: true,
    result: safe as unknown as NativeShortSafeClosure,
    evidence: [
      ...source.original.refs.filter((ref) => ref.dataset !== 'write-intent').map(safeWriteRef),
      safeWriteRef(read.ref),
    ],
    data: [
      {
        ...verified.result,
        ...statusProjection(verified.evidence.result.snapshot!, read.ref, 'compensation_read'),
      },
    ],
    collectionMode: 'live',
  };
}
