import {
  type NativeShortSubmissionOriginalAudit,
  pointer,
  type NativeShortSubmissionClosure,
  AUDIT_STABLE,
  type AuditReconciliationEvidence,
} from './safe-native-short-submission-job.js';

import {
  exact,
  copy,
  UUID,
  NATIVE_SHORT_SUBMISSION_OPERATION,
  HASH,
  same,
  fail,
  WORK,
  nativeShortSubmissionScope,
  order,
  object,
  time,
  type NativeShortSubmissionEvidenceContext,
  hash,
  freeze,
  type NativeShortSubmissionContext,
  provenance,
  NATIVE_SHORT_SUBMISSION_HASH_BASES,
  refLink,
  ORIGIN,
} from './fail.js';

import { type State, checkedContext } from './source-fields.js';

import { stateFor } from './ordinary-job.js';

import { type NativeShortProvenance } from '../short-native-metadata-proof.js';

import { validateNativeShortSubmissionApiResult } from '../short-native-submission-api.js';

import {
  compareNativeShortSubmissionReadback,
  NATIVE_SHORT_SUBMISSION_SCOPE,
} from '../short-native-submission.js';

export function auditShape(input: unknown): NativeShortSubmissionOriginalAudit {
  const a = exact(copy(input, 128 * 1024), [
    'schema',
    'phase',
    'originalJobId',
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
    'originalEndedAt',
    'priorEndedAt',
    'priorError',
    'priorEvidence',
    'attempts',
    'previousClosure',
    'originalAttemptEvidence',
  ]);
  if (
    a.schema !== 'native-short-submission-original-audit/v1' ||
    !['initial', 'continuation'].includes(a.phase) ||
    !UUID.test(a.originalJobId) ||
    a.operation !== NATIVE_SHORT_SUBMISSION_OPERATION ||
    !HASH.test(a.inputHash) ||
    !same(a.datasets, [])
  )
    fail();
  const target = exact(a.target, ['kind', 'id']);
  if (
    target.kind !== 'short-story' ||
    !WORK.test(target.id) ||
    a.scope !== nativeShortSubmissionScope(target.id)
  )
    fail();
  order([a.requestedAt, a.startedAt, a.platformReadStartedAt, a.originalEndedAt, a.priorEndedAt]);
  if (a.priorEndedAt > new Date().toISOString()) fail();
  if (a.platformWriteStartedAt !== null)
    order([a.platformReadStartedAt, a.platformWriteStartedAt, a.originalEndedAt]);
  if (
    !Array.isArray(a.priorEvidence) ||
    !Array.isArray(a.attempts) ||
    a.priorEvidence.length > 7 ||
    a.attempts.length > 1 ||
    a.priorError === null ||
    object(a.priorError).code !== 'outcome_unknown'
  )
    fail();
  if (a.phase === 'initial') {
    if (
      a.previousClosure !== null ||
      a.originalAttemptEvidence !== null ||
      a.priorEndedAt !== a.originalEndedAt
    )
      fail();
  } else {
    const p = exact(a.previousClosure, [
      'reconciliationJobId',
      'evidenceId',
      'evidenceHash',
      'resultHash',
      'settledAt',
    ]);
    if (
      !UUID.test(p.reconciliationJobId) ||
      !UUID.test(p.evidenceId) ||
      !HASH.test(p.evidenceHash) ||
      !HASH.test(p.resultHash) ||
      p.settledAt !== a.priorEndedAt
    )
      fail();
    pointer(a.originalAttemptEvidence);
  }
  return a as NativeShortSubmissionOriginalAudit;
}

export function closureShape(input: unknown): NativeShortSubmissionClosure {
  const c = exact(copy(input, 256 * 1024), [
    'schema',
    'target',
    'reconciliationJobId',
    'evidence',
    'status',
    'result',
    'originalAudit',
    'originalAttemptEvidence',
    'settledAt',
  ]);
  if (
    c.schema !== 'native-short-submission-closure/v1' ||
    !UUID.test(c.reconciliationJobId) ||
    !['succeeded', 'failed', 'uncertain'].includes(c.status)
  )
    fail();
  const audit = auditShape(c.originalAudit);
  if (!same(c.target, audit.target)) fail();
  pointer(c.originalAttemptEvidence);
  time(c.settledAt);
  order([audit.priorEndedAt, c.evidence.capturedAt, c.settledAt]);
  exact(c.evidence, ['id', 'accountId', 'jobId', 'dataset', 'capturedAt', 'path', 'sha256']);
  if (
    !UUID.test(c.evidence.id) ||
    !HASH.test(c.evidence.sha256) ||
    c.evidence.accountId !== audit.accountId ||
    c.evidence.jobId !== c.reconciliationJobId ||
    c.evidence.dataset !== 'reconciliation' ||
    typeof c.evidence.path !== 'string'
  )
    fail();
  if (
    audit.phase === 'initial'
      ? !same(c.originalAttemptEvidence, {
          readJobId: c.reconciliationJobId,
          evidenceId: c.evidence.id,
          evidenceHash: c.evidence.sha256,
        })
      : !same(c.originalAttemptEvidence, audit.originalAttemptEvidence)
  )
    fail();
  return c as NativeShortSubmissionClosure;
}

export function sourceForAudit(
  context: NativeShortSubmissionEvidenceContext,
  audit: NativeShortSubmissionOriginalAudit,
): State {
  const original = checkedContext(context),
    job = original.job;
  if (
    job.id !== audit.originalJobId ||
    original.accountId !== audit.accountId ||
    AUDIT_STABLE.some((k) => !same(job[k], audit[k])) ||
    !same(original.refs, audit.priorEvidence) ||
    !same(original.attempts, audit.attempts)
  )
    fail();
  const frozenJob = {
    ...job,
    status: 'uncertain' as const,
    result: { evidence: original.refs },
    error: audit.priorError,
    endedAt: audit.originalEndedAt,
    updatedAt: audit.originalEndedAt,
  };
  const state = stateFor({ ...original, job: frozenJob });
  if (!state.baseline || !same(job.target, audit.target)) fail();
  return state;
}

export function createNativeShortSubmissionOriginalAudit(
  context: NativeShortSubmissionEvidenceContext,
  continuation?: {
    firstAudit: NativeShortSubmissionOriginalAudit;
    previousClosure: NativeShortSubmissionClosure;
  },
): NativeShortSubmissionOriginalAudit {
  try {
    const original = checkedContext(context),
      job = original.job;
    if (job.status !== 'uncertain' || job.endedAt === null || job.error?.code !== 'outcome_unknown')
      fail();
    const common = {
      schema: 'native-short-submission-original-audit/v1',
      originalJobId: job.id,
      ...Object.fromEntries(AUDIT_STABLE.map((k) => [k, job[k]])),
      priorEndedAt: job.endedAt,
      priorError: job.error,
      priorEvidence: original.refs,
      attempts: original.attempts,
    };
    let audit: NativeShortSubmissionOriginalAudit;
    if (!continuation) {
      stateFor(original);
      if (!same(job.result, { evidence: original.refs })) fail();
      audit = auditShape({
        ...common,
        phase: 'initial',
        originalEndedAt: job.endedAt,
        previousClosure: null,
        originalAttemptEvidence: null,
      });
    } else {
      const first = auditShape(continuation.firstAudit),
        previous = closureShape(continuation.previousClosure);
      if (
        first.phase !== 'initial' ||
        previous.status !== 'uncertain' ||
        previous.settledAt !== job.endedAt ||
        !same(job.result, previous) ||
        first.originalJobId !== job.id ||
        AUDIT_STABLE.some((k) => !same(first[k], job[k])) ||
        !same(first.priorEvidence, original.refs) ||
        !same(first.attempts, original.attempts) ||
        first.originalEndedAt !== previous.originalAudit.originalEndedAt
      )
        fail();
      audit = auditShape({
        ...common,
        phase: 'continuation',
        originalEndedAt: first.originalEndedAt,
        previousClosure: {
          reconciliationJobId: previous.reconciliationJobId,
          evidenceId: previous.evidence.id,
          evidenceHash: previous.evidence.sha256,
          resultHash: hash(previous),
          settledAt: previous.settledAt,
        },
        originalAttemptEvidence: previous.originalAttemptEvidence,
      });
    }
    sourceForAudit(original, audit);
    return freeze(audit);
  } catch {
    fail();
  }
}

export function reconciliation(
  raw: unknown,
  original: NativeShortSubmissionContext,
  pInput: NativeShortProvenance,
  audit: NativeShortSubmissionOriginalAudit,
): AuditReconciliationEvidence {
  const s = sourceForAudit(original, audit),
    p = provenance(copy(pInput)),
    plan = s.plan!,
    r = validateNativeShortSubmissionApiResult(copy(raw, 192 * 1024 * 1024), {
      accountId: plan.expectation.binding.account.id,
      workId: plan.expectation.binding.work.id,
    });
  const start = r.phases.after.proof.readStartedAt;
  if (
    r.mode !== 'read' ||
    !r.proof.platformStarted ||
    start === null ||
    start <= audit.priorEndedAt ||
    r.cleanup.checkedAt > new Date().toISOString() ||
    (s.provenance!.mode === 'live' && p.mode !== 'live')
  )
    fail();
  const comparison =
      r.status === 'success' && r.snapshot
        ? compareNativeShortSubmissionReadback(plan.expectation, r.snapshot)
        : null,
    live = p.mode === 'live' && s.provenance!.mode === 'live',
    attempted = s.kinds.includes('attempt'),
    ack = s.kinds.includes('acknowledgement');
  const ao = ack ? s.payloads[s.kinds.indexOf('acknowledgement')]!.observation : null;
  const rejected =
    ack && s.payloads[s.kinds.indexOf('acknowledgement')]!.observation.accepted === false;
  const mayHavePosted = s.after === null || s.after.publish.post.attempts === 1;
  // A later matching state cannot replace the acknowledgement of this attempt.
  // Only its immutable accepted ACK supplies the publication causality gate.
  const status =
    live && attempted && rejected
      ? 'failed'
      : live &&
          attempted &&
          ack &&
          ao.accepted === true &&
          mayHavePosted &&
          comparison?.matches &&
          ['reviewing', 'published'].includes(comparison.observedStatus)
        ? 'succeeded'
        : 'uncertain';
  return freeze({
    schema: 'native-short-submission-reconciliation-evidence/v1',
    scope: NATIVE_SHORT_SUBMISSION_SCOPE,
    hashBases: NATIVE_SHORT_SUBMISSION_HASH_BASES,
    originalAudit: audit,
    baselineEvidence: refLink(original.refs[0]!),
    result: r,
    comparison,
    source: { origin: ORIGIN, mode: p.mode },
    provenance: p,
    reconciliation: {
      useAi: {
        requested: s.business!.useAi,
        acknowledged: ao?.useAi ?? null,
        observed: comparison?.ai.observed ?? null,
        evidence: comparison?.ai.evidence ?? 'missing',
      },
      termsHash: plan.expectation.termsHash,
      contractHash: plan.expectation.sourceHash,
      attemptOrdinal: attempted ? 1 : null,
      acknowledgement: ao ? { code: ao.code, accepted: ao.accepted, itemId: ao.itemId } : null,
      originalJobId: audit.originalJobId,
      target: audit.target,
      inputHash: audit.inputHash,
      status,
      reason: !live
        ? 'fixture_only'
        : status === 'succeeded'
          ? 'saved_by_later_read'
          : status === 'failed'
            ? 'platform_rejected'
            : 'outcome_unknown',
      observedContentHash: comparison?.actual.contentHash ?? null,
      originalSaveAcknowledged: s.after?.publish.post.acknowledged ?? ack,
      originalSaveDurableAcknowledged: ack,
      originalOutcome: ack ? (s.after?.publish.outcome ?? 'acknowledged') : 'unknown',
    },
  }) as AuditReconciliationEvidence;
}
