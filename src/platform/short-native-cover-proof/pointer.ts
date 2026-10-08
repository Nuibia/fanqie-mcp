import { type EvidenceRef } from '../../runtime/store.js';

import {
  type NativeShortCoverOriginalAudit,
  type NativeShortCoverAttemptPointer,
} from './project-native-short-cover-evidence-context.js';

import {
  exact,
  UUID,
  HASH,
  fail,
  copy,
  NATIVE_SHORT_COVER_OPERATION,
  same,
  WORK,
  nativeShortCoverScope,
  order,
  object,
  time,
  type NativeShortCoverEvidenceContext,
  hash,
  freeze,
} from './fail.js';

import { type State } from './has-reserved-native-short-cover-signal.js';

import { checkedContext } from './ordinary-job.js';

import { stateFor } from './state-for.js';

export interface NativeShortCoverClosure {
  schema: 'native-short-cover-closure/v1';
  target: { kind: 'short-story'; id: string };
  reconciliationJobId: string;
  evidence: EvidenceRef;
  status: 'succeeded' | 'failed' | 'uncertain';
  result: Record<string, unknown>;
  originalAudit: NativeShortCoverOriginalAudit;
  originalAttemptEvidence: NativeShortCoverAttemptPointer;
  settledAt: string;
}

const AUDIT_STABLE = [
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

function pointer(input: unknown): NativeShortCoverAttemptPointer {
  const p = exact(input, ['readJobId', 'evidenceId', 'evidenceHash']);
  if (!UUID.test(p.readJobId) || !UUID.test(p.evidenceId) || !HASH.test(p.evidenceHash)) fail();
  return p as NativeShortCoverAttemptPointer;
}

export function auditShape(input: unknown): NativeShortCoverOriginalAudit {
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
    a.schema !== 'native-short-cover-original-audit/v1' ||
    !['initial', 'continuation'].includes(a.phase) ||
    !UUID.test(a.originalJobId) ||
    a.operation !== NATIVE_SHORT_COVER_OPERATION ||
    !HASH.test(a.inputHash) ||
    !same(a.datasets, [])
  )
    fail();
  const target = exact(a.target, ['kind', 'id']);
  if (
    target.kind !== 'short-story' ||
    !WORK.test(target.id) ||
    a.scope !== nativeShortCoverScope(target.id)
  )
    fail();
  order([a.requestedAt, a.startedAt, a.platformReadStartedAt, a.originalEndedAt, a.priorEndedAt]);
  if (a.platformWriteStartedAt !== null)
    order([a.platformReadStartedAt, a.platformWriteStartedAt, a.originalEndedAt]);
  if (
    !Array.isArray(a.priorEvidence) ||
    !Array.isArray(a.attempts) ||
    a.priorEvidence.length > 10 ||
    a.attempts.length > 2 ||
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
  return a as NativeShortCoverOriginalAudit;
}

export function closureShape(input: unknown): NativeShortCoverClosure {
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
    c.schema !== 'native-short-cover-closure/v1' ||
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
  return c as NativeShortCoverClosure;
}

export function sourceForAudit(
  context: NativeShortCoverEvidenceContext,
  audit: NativeShortCoverOriginalAudit,
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

export function createNativeShortCoverOriginalAudit(
  context: NativeShortCoverEvidenceContext,
  continuation?: {
    firstAudit: NativeShortCoverOriginalAudit;
    previousClosure: NativeShortCoverClosure;
  },
): NativeShortCoverOriginalAudit {
  try {
    const original = checkedContext(context),
      job = original.job;
    if (job.status !== 'uncertain' || job.endedAt === null || job.error?.code !== 'outcome_unknown')
      fail();
    const common = {
      schema: 'native-short-cover-original-audit/v1',
      originalJobId: job.id,
      ...Object.fromEntries(AUDIT_STABLE.map((k) => [k, job[k]])),
      priorEndedAt: job.endedAt,
      priorError: job.error,
      priorEvidence: original.refs,
      attempts: original.attempts,
    };
    let audit: NativeShortCoverOriginalAudit;
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
