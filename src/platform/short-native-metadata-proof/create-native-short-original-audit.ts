import { type Job, type EvidenceRef } from '../../runtime/store.js';

import {
  type NativeShortOriginalAudit,
  type NativeShortClosure,
  AUDIT_STABLE,
  validateNativeShortOriginalAudit,
  attemptPointer,
  auditSignalPaths,
} from './safe-native-short-write-job.js';

import {
  object,
  copyBoundedNativeJson,
  reject,
  equal,
  exact,
  UUID,
  HASH,
  time,
  type StoredBaseline,
  type StoredReconciliation,
} from './reject.js';

import {
  NATIVE_SHORT_RESOURCE_LIMITS,
  NATIVE_SHORT_METADATA_SCOPE,
  NATIVE_SHORT_HASH_BASES,
  NATIVE_SHORT_WRITE_HASH_BASES_V2,
} from '../short-native-metadata.js';

import {
  carrier,
  carrierVersion,
  type NativeShortWriteIntent,
  expectationVersion,
  comparisonBasis,
  provenanceFields,
  evidenceLink,
  compareStored,
  nativeShortDesiredContentHash,
  observedExpectation,
} from './validate-native-short-write-business-input.js';

import { digest } from './validate-native-short-evidence-context.js';

import {
  rejectAdditionalNativeSignals,
  validateStoredNativeShortApiResult,
} from './validate-api-result-core.js';

import { type NativeShortWriteEvidenceContext } from './clean-after-business.js';

import { projectNativeShortWriteEvidence } from './project-native-short-write-evidence.js';

import { validateStoredBaseline, validateIntentCore, link } from './link.js';

import { storedMetadataMath } from '../short-native-legacy-codec.js';

export function createNativeShortOriginalAudit(
  originalJob: Job,
  originalRefs: EvidenceRef[],
  continuation?: { firstAudit: NativeShortOriginalAudit; previousClosure: NativeShortClosure },
  version: 1 | 2 = 1,
): NativeShortOriginalAudit {
  const job = object(
    copyBoundedNativeJson(
      originalJob,
      4 * NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes + 192 * 1024,
      5 * NATIVE_SHORT_RESOURCE_LIMITS.nodes,
      NATIVE_SHORT_RESOURCE_LIMITS.depth + 12,
    ),
  ) as unknown as Job;
  if (job.status !== 'uncertain' || job.endedAt === null || job.error?.code !== 'outcome_unknown')
    reject();
  const common = {
    schema: carrier('native-short-metadata-original-audit', version),
    originalJobId: job.id,
    ...Object.fromEntries(AUDIT_STABLE.map((name) => [name, job[name]])),
    priorEndedAt: job.endedAt,
    status: 'uncertain',
    priorError: job.error,
    priorEvidence: originalRefs,
  };
  if (!continuation)
    return validateNativeShortOriginalAudit({
      ...common,
      phase: 'initial',
      originalEndedAt: job.endedAt,
      originalResult: job.result,
      originalAttemptEvidence: null,
      previousClosure: null,
    });
  const first = validateNativeShortOriginalAudit(continuation.firstAudit),
    previous = validateNativeShortClosureShape(continuation.previousClosure);
  if (carrierVersion(first.schema, 'native-short-metadata-original-audit') !== version) reject();
  if (
    first.phase !== 'initial' ||
    first.originalJobId !== job.id ||
    !equal(job.result, previous) ||
    !equal(first.priorEvidence, originalRefs) ||
    first.originalEndedAt !== previous.originalAudit.originalEndedAt ||
    AUDIT_STABLE.some((name) => !equal(first[name], job[name]))
  )
    reject();
  return validateNativeShortOriginalAudit({
    ...common,
    phase: 'continuation',
    originalEndedAt: first.originalEndedAt,
    priorResultHash: digest(job.result),
    originalAttemptEvidence: previous.originalAttemptEvidence,
    previousClosure: {
      reconciliationJobId: previous.reconciliationJobId,
      evidenceId: previous.evidence.id,
      evidenceHash: previous.evidence.sha256,
      resultHash: digest(job.result),
      settledAt: job.endedAt,
    },
  });
}

export function validateNativeShortClosureShape(input: unknown): NativeShortClosure {
  const closure = exact(
    copyBoundedNativeJson(
      input,
      4 * NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes + 128 * 1024,
      5 * NATIVE_SHORT_RESOURCE_LIMITS.nodes,
      NATIVE_SHORT_RESOURCE_LIMITS.depth + 12,
    ),
    [
      'schema',
      'target',
      'reconciliationJobId',
      'evidence',
      'observedStatus',
      'result',
      'originalAudit',
      'originalAttemptEvidence',
    ],
  );
  if (
    !['native-short-metadata-closure/v1', 'native-short-metadata-closure/v2'].includes(
      String(closure.schema),
    ) ||
    !UUID.test(String(closure.reconciliationJobId)) ||
    !['draft_saved', 'unknown'].includes(String(closure.observedStatus))
  )
    reject();
  const audit = validateNativeShortOriginalAudit(closure.originalAudit),
    pointer = attemptPointer(closure.originalAttemptEvidence),
    ref = exact(closure.evidence, [
      'id',
      'accountId',
      'jobId',
      'dataset',
      'capturedAt',
      'path',
      'sha256',
    ]);
  if (
    carrierVersion(closure.schema, 'native-short-metadata-closure') !==
      carrierVersion(audit.schema, 'native-short-metadata-original-audit') ||
    !equal(closure.target, audit.target) ||
    ref.accountId !== audit.accountId ||
    ref.jobId !== closure.reconciliationJobId ||
    ref.dataset !== 'reconciliation' ||
    !UUID.test(String(ref.id)) ||
    !HASH.test(String(ref.sha256)) ||
    typeof ref.path !== 'string'
  )
    reject();
  time(ref.capturedAt);
  if (
    audit.phase === 'initial'
      ? !equal(pointer, { readJobId: ref.jobId, evidenceId: ref.id, evidenceHash: ref.sha256 })
      : !equal(pointer, audit.originalAttemptEvidence)
  )
    reject();
  // The full DTO is rebuilt against the external read context below. This shape
  // gate also protects the previous result carried by a continuation audit.
  const result = object(closure.result);
  if (
    result.schema !==
      carrier(
        'fanqie-short-native-metadata-reconciliation-business',
        carrierVersion(audit.schema, 'native-short-metadata-original-audit'),
      ) ||
    result.dataset !== 'reconciliation' ||
    result.status !== (closure.observedStatus === 'draft_saved' ? 'succeeded' : 'uncertain') ||
    result.platformState !== closure.observedStatus ||
    result.originalJobId !== audit.originalJobId ||
    !equal(result.target, audit.target) ||
    result.inputHash !== audit.inputHash ||
    result.sourceRef !== ref.id ||
    result.evidenceHash !== ref.sha256 ||
    result.evidenceCapturedAt !== ref.capturedAt
  )
    reject();
  const allowed = auditSignalPaths(audit, ['originalAudit']);
  allowed.set(JSON.stringify(['schema']), closure.schema);
  allowed.set(JSON.stringify(['result', 'schema']), result.schema);
  rejectAdditionalNativeSignals(closure, allowed);
  return closure as unknown as NativeShortClosure;
}

export function originalForAudit(
  original: NativeShortWriteEvidenceContext,
  audit: NativeShortOriginalAudit,
): { baseline: StoredBaseline; intent: NativeShortWriteIntent } {
  if (
    original.manifest !== null ||
    original.job.id !== audit.originalJobId ||
    original.accountId !== audit.accountId ||
    AUDIT_STABLE.some((name) => !equal(original.job[name], audit[name])) ||
    !equal(original.refs, audit.priorEvidence)
  )
    reject();
  const effective: Job = {
    ...original.job,
    status: 'uncertain',
    result: { evidence: original.refs },
    error: audit.priorError,
    endedAt: audit.originalEndedAt,
    updatedAt: audit.originalEndedAt,
  };
  const projection = projectNativeShortWriteEvidence({ ...original, job: effective });
  if (!projection.validated || projection.result !== null || original.refs.length < 2) reject();
  const baseline = validateStoredBaseline(original.documents[0]!.payload),
    intent = validateIntentCore(original.documents[1]!.payload, baseline, original.refs[0]!);
  if (
    expectationVersion(intent.expectation) !==
    carrierVersion(audit.schema, 'native-short-metadata-original-audit')
  )
    reject();
  return { baseline, intent };
}

export function recomputeReconciliation(
  input: unknown,
  original: NativeShortWriteEvidenceContext,
): StoredReconciliation {
  const data = exact(
    copyBoundedNativeJson(
      input,
      4 * NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes + 128 * 1024,
      5 * NATIVE_SHORT_RESOURCE_LIMITS.nodes,
      NATIVE_SHORT_RESOURCE_LIMITS.depth + 12,
    ),
    [
      'schema',
      'scope',
      'hashBases',
      'comparisonBasis',
      'baselineEvidence',
      'intentEvidence',
      'originalAudit',
      'result',
      'comparison',
      'source',
      'provenance',
      'reconciliation',
    ],
  );
  const version = carrierVersion(data.schema, 'native-short-metadata-reconciliation');
  if (
    data.scope !== NATIVE_SHORT_METADATA_SCOPE ||
    !equal(
      data.hashBases,
      version === 1 ? NATIVE_SHORT_HASH_BASES : NATIVE_SHORT_WRITE_HASH_BASES_V2,
    ) ||
    data.comparisonBasis !== comparisonBasis(version)
  )
    reject();
  const audit = validateNativeShortOriginalAudit(data.originalAudit),
    { baseline, intent } = originalForAudit(original, audit);
  if (version !== expectationVersion(intent.expectation)) reject();
  const provenance = provenanceFields(data);
  if (
    !equal(link(data.baselineEvidence), evidenceLink(original.refs[0]!)) ||
    !equal(link(data.intentEvidence), evidenceLink(original.refs[1]!))
  )
    reject();
  const result = validateStoredNativeShortApiResult(data.result, {
    accountId: baseline.held.snapshot.binding.account.id,
    workId: audit.target.id,
  });
  if (
    result.status !== 'success' ||
    result.proof.readStartedAt! <= audit.priorEndedAt ||
    result.proof.proofCapturedAt! > new Date().toISOString()
  )
    reject();
  if (
    storedMetadataMath.decodeSnapshot(baseline.held.snapshot).mode === 'modern' &&
    storedMetadataMath.decodeSnapshot(result.snapshot!).mode !== 'modern'
  )
    reject();
  const comparison = compareStored(intent.expectation, result.snapshot!);
  const observedContentHash = nativeShortDesiredContentHash(
    observedExpectation(intent.expectation, result.snapshot!, comparison),
  );
  const expectedObservation = {
    originalJobId: audit.originalJobId,
    target: audit.target,
    inputHash: audit.inputHash,
    observedContentHash,
    observedStatus: comparison.matches ? 'draft_saved' : 'unknown',
  };
  if (!equal(data.comparison, comparison) || !equal(data.reconciliation, expectedObservation))
    reject();
  const allowed = auditSignalPaths(audit, ['originalAudit']);
  allowed.set(JSON.stringify(['schema']), data.schema);
  allowed.set(JSON.stringify(['result', 'schema']), result.schema);
  rejectAdditionalNativeSignals(data, allowed, [
    JSON.stringify(['result', 'snapshot', 'editData']),
    JSON.stringify(['result', 'snapshot', 'categoryData']),
  ]);
  return {
    ...data,
    result,
    originalAudit: audit,
    source: provenance.source,
    provenance: provenance.provenance,
  } as unknown as StoredReconciliation;
}
