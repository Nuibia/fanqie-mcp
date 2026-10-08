import {
  type NativeShortCompensationSourceContext,
  type NativeShortCompensationAttestation,
  ownData,
  compensationDocument,
  type StoredCompensationEvidence,
  OPERATOR_BASIS,
} from './project-native-short-closure.js';

import { compensationSourceDetails } from './compensation-source-details.js';

import {
  ordered,
  object,
  copyBoundedNativeJson,
  exact,
  time,
  equal,
  reject,
  UUID,
  type Data,
  type StoredNativeShortMetadataApiResult,
  NATIVE_SHORT_ORIGIN,
} from './reject.js';

import { safeWriteRef } from './clean-after-business.js';

import { digest } from './validate-native-short-evidence-context.js';

import { type Job } from '../../runtime/store.js';

import { digestBytes } from './validate-native-short-reconciliation-context.js';

import {
  rejectAdditionalNativeSignals,
  validateStoredNativeShortApiResult,
} from './validate-api-result-core.js';

import { evidenceLink } from './validate-native-short-write-business-input.js';

import { nonServerSnapshot } from './compensation-read.js';

import { NATIVE_SHORT_METADATA_SCOPE } from '../short-native-metadata.js';

export function buildCompensationAttestation(
  source: NativeShortCompensationSourceContext,
  details: ReturnType<typeof compensationSourceDetails>,
  approvedAt: string,
  effectsEndedAt: string,
): NativeShortCompensationAttestation {
  ordered([
    details.authority.controller.completedAt,
    effectsEndedAt,
    approvedAt,
    new Date().toISOString(),
  ]);
  return {
    schema: 'native-short-metadata-compensation-attestation/v1',
    accountId: source.accountId,
    originalJobId: source.original.job.id,
    operatorJobId: source.operator.job.id,
    operatorBeforeReadJobId: source.operatorBefore.job.id,
    target: details.target,
    originalInputHash: source.original.job.inputHash,
    originalEvidence: source.original.refs.map(safeWriteRef),
    originalAuditHash: digest(details.history.prior),
    operatorBeforeEvidence: safeWriteRef(source.operatorBefore.ref),
    operatorEvidence: source.operator.refs.map(safeWriteRef),
    authority: details.authority.authority,
    authorityHash: digest(details.authority.authority),
    policyHash: digest(details.authority.authority.policy),
    approvedAt,
    effectsEndedAt,
  };
}

export function validateCompensationRegistration(
  source: NativeShortCompensationSourceContext,
  details: ReturnType<typeof compensationSourceDetails>,
) {
  if (source.registration === null) return;
  const registration = ownData(source.registration, ['job', 'manifest', 'ref', 'document']);
  const job = object(
    copyBoundedNativeJson(registration.job, 128 * 1024, 8192, 24),
  ) as unknown as Job;
  const manifest = exact(copyBoundedNativeJson(registration.manifest, 64 * 1024, 8192, 24), [
    'schema',
    'id',
    'accountId',
    'jobId',
    'operation',
    'scope',
    'datasets',
    'inputHash',
    'requestedAt',
    'startedAt',
    'platformReadStartedAt',
    'platformWriteStartedAt',
    'committedAt',
    'evidence',
    'authorityHash',
    'policyHash',
  ]);
  const payload = compensationDocument(
    source.registration.ref,
    source.registration.document,
    job,
    'native_compensation_attestation',
    true,
  );
  exact(payload, [
    'schema',
    'accountId',
    'originalJobId',
    'operatorJobId',
    'operatorBeforeReadJobId',
    'target',
    'originalInputHash',
    'originalEvidence',
    'originalAuditHash',
    'operatorBeforeEvidence',
    'operatorEvidence',
    'authority',
    'authorityHash',
    'policyHash',
    'approvedAt',
    'effectsEndedAt',
  ]);
  const expected = buildCompensationAttestation(
    source,
    details,
    time(payload.approvedAt),
    time(payload.effectsEndedAt),
  );
  if (!equal(payload, expected)) reject();
  const input = {
    schema: 'native-short-metadata-compensation-registration-input/v1',
    accountId: source.accountId,
    originalJobId: source.original.job.id,
    operatorJobId: source.operator.job.id,
    authority: expected.authority,
    approvedAt: expected.approvedAt,
    effectsEndedAt: expected.effectsEndedAt,
  };
  const scope = `native_compensation_attestation.${digestBytes(source.original.job.id).slice(0, 32)}`;
  if (
    job.kind !== 'read' ||
    job.status !== 'succeeded' ||
    job.operation !== 'register_native_compensation_attestation' ||
    job.accountId !== source.accountId ||
    job.scope !== scope ||
    !equal(job.datasets, ['native_compensation_attestation']) ||
    job.platformReadStartedAt !== null ||
    job.platformWriteStartedAt !== null ||
    job.error !== null ||
    job.cancellationRequestedAt !== null ||
    job.cancellationReason !== null ||
    job.idempotencyKey !== source.original.job.id ||
    job.inputHash !== digest(input) ||
    !equal(job.target, details.target) ||
    job.updatedAt !== job.endedAt ||
    !equal(job.metadata, {
      schema: 'native-short-metadata-compensation-registration-job/v1',
      originalJobId: source.original.job.id,
      operatorJobId: source.operator.job.id,
      authorityHash: expected.authorityHash,
      policyHash: expected.policyHash,
    })
  )
    reject();
  if (
    !equal(manifest, {
      schema: 'native-short-metadata-compensation-registration-manifest/v1',
      id: manifest.id,
      accountId: source.accountId,
      jobId: job.id,
      operation: job.operation,
      scope,
      datasets: job.datasets,
      inputHash: job.inputHash,
      requestedAt: job.requestedAt,
      startedAt: job.startedAt,
      platformReadStartedAt: null,
      platformWriteStartedAt: null,
      committedAt: job.endedAt,
      evidence: [source.registration.ref],
      authorityHash: expected.authorityHash,
      policyHash: expected.policyHash,
    }) ||
    !UUID.test(String(manifest.id)) ||
    !equal(job.result, { manifest })
  )
    reject();
  ordered([
    expected.approvedAt,
    job.requestedAt,
    job.startedAt,
    source.registration.ref.capturedAt,
    job.endedAt,
  ]);
  rejectAdditionalNativeSignals(
    { job },
    new Map([
      [
        JSON.stringify(['job', 'metadata', 'schema']),
        'native-short-metadata-compensation-registration-job/v1',
      ],
      [JSON.stringify(['job', 'result', 'manifest', 'schema']), manifest.schema],
    ]),
  );
}

function compensationAudit(
  source: NativeShortCompensationSourceContext,
  details: ReturnType<typeof compensationSourceDetails>,
): Data {
  if (!source.registration) reject();
  const prior = details.history.prior,
    job = details.history.priorJob;
  const first = source.history.first?.row.status === 'uncertain' ? source.history.first : null,
    previous = details.history.terminal ? source.history.previous : source.history.current;
  const registration = object(source.registration.document.payload);
  return {
    schema: 'native-short-metadata-compensation-original-audit/v1',
    originalJobId: job.id,
    accountId: source.accountId,
    inputHash: job.inputHash,
    target: details.target,
    originalEndedAt: prior.originalEndedAt,
    priorEndedAt: prior.priorEndedAt,
    priorStatus: 'uncertain',
    priorResultHash: digest(job.result),
    priorErrorHash: digest(job.error),
    priorError: job.error,
    originalEvidenceHash: digest(source.original.refs),
    originalAttemptEvidence: first
      ? {
          readJobId: first.read.job.id,
          evidenceId: first.read.ref.id,
          evidenceHash: first.read.ref.sha256,
        }
      : null,
    previousClosure: previous
      ? {
          reconciliationJobId: previous.read.job.id,
          evidenceId: previous.read.ref.id,
          evidenceHash: previous.read.ref.sha256,
          resultHash: digest(JSON.parse(previous.row.resultJson)),
          settledAt: previous.row.createdAt,
        }
      : null,
    registrationJobId: source.registration.job.id,
    attestationEvidence: evidenceLink(source.registration.ref),
    authorityHash: registration.authorityHash,
    policyHash: registration.policyHash,
    operatorJobId: source.operator.job.id,
    operatorBeforeReadJobId: source.operatorBefore.job.id,
    operatorEvidenceHash: digest(source.operator.refs),
    effectsEndedAt: registration.effectsEndedAt,
  };
}

export function buildCompensationEvidence(
  source: NativeShortCompensationSourceContext,
  details: ReturnType<typeof compensationSourceDetails>,
  raw: StoredNativeShortMetadataApiResult,
): StoredCompensationEvidence {
  if (!source.registration) reject();
  const result = validateStoredNativeShortApiResult(raw, {
    accountId: details.original.binding.account.id,
    workId: details.target.id,
  });
  if (
    result.status !== 'success' ||
    !equal(
      {
        binding: result.snapshot!.binding,
        editData: result.snapshot!.editData,
        categoryData: result.snapshot!.categoryData,
      },
      {
        binding: details.after.snapshot!.binding,
        editData: details.after.snapshot!.editData,
        categoryData: details.after.snapshot!.categoryData,
      },
    )
  )
    reject();
  // All raw including the immutable operator-after server pair must still match.
  if (
    !equal(nonServerSnapshot(details.original, false), nonServerSnapshot(result.snapshot!, false))
  )
    reject();
  const audit = compensationAudit(source, details),
    cutoff = [
      audit.priorEndedAt,
      audit.effectsEndedAt,
      source.registration.job.endedAt,
      source.operator.job.endedAt,
      details.after.proof.proofCapturedAt,
    ]
      .map(time)
      .sort()
      .at(-1)!;
  if (
    result.proof.readStartedAt! <= cutoff ||
    result.proof.proofCapturedAt! > new Date().toISOString()
  )
    reject();
  return {
    schema: 'native-short-metadata-compensation-reconciliation/v1',
    scope: NATIVE_SHORT_METADATA_SCOPE,
    result,
    originalAudit: audit,
    source: { origin: NATIVE_SHORT_ORIGIN, mode: 'live' },
    provenance: { executor: 'application-default-browser/v1', mode: 'live' },
    registrationEvidence: evidenceLink(source.registration.ref),
    originalBaselineEvidence: evidenceLink(source.original.refs[0]!),
    operatorAfterEvidence: evidenceLink(source.operator.refs[3]!),
    verification: {
      basis: OPERATOR_BASIS,
      originalOutcome: 'unknown',
      originalAcceptance: 'not_verified',
      compensationOutcome: 'verified_restored',
      originalRawExceptServerFieldsRestored: true,
      operatorAfterSnapshotUnchanged: true,
    },
  };
}
