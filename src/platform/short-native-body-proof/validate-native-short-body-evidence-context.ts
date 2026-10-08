import {
  type NativeShortBodyEvidenceContext,
  type NativeShortBodyWriteResultEvidence,
  type ClosurePointer,
  type NativeShortBodyOriginalAudit,
  BODY_WORK,
  type NativeShortBodySettlement,
  type NativeShortBodyClosure,
  type NativeShortBodyRecoveryContextV2,
} from './native-short-body-attempt-row.js';

import { inspectBody } from './inspect-body.js';

import { same, copy, fail, freeze, exact, digest, hash, type Data } from './fail.js';

import { type RuntimeFailure } from '../../runtime/store.js';

import {
  uuid,
  durableTime,
  account,
  ordered,
  BODY_SETTLEMENT_REASONS,
  source,
  link,
  bodyRefLink,
} from './native-short-body-scope.js';

import { NATIVE_SHORT_BODY_COMPARISON_POLICY_V2 } from '../short-native-body.js';

import { recoveryShape, checkedRecovery } from './original-audit.js';

import { type DurableState, contextCopy } from './context-copy.js';

import { clean } from './same-mode.js';

export function validateNativeShortBodyEvidenceContext(
  input: unknown,
  mode: 'prefix' | 'complete',
): NativeShortBodyEvidenceContext {
  return inspectBody(input, mode).context;
}

export function validateNativeShortBodyCompletion(
  input: unknown,
  result: unknown,
): NativeShortBodyWriteResultEvidence {
  const s = inspectBody(input, 'complete'),
    r = s.result!;
  if (
    !['running', 'succeeded'].includes(s.context.job.status) ||
    s.context.job.error !== null ||
    s.context.job.cancellationReason !== null ||
    s.context.job.cancellationRequestedAt !== null ||
    !same(copy(result, 256 * 1024), r) ||
    !(r.outcome === 'matched' || r.reason === 'no_change')
  )
    fail('durability_unverified');
  return freeze(r);
}

export function safeInitialError(input: unknown): RuntimeFailure {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_shape');
  const e = exact(
    input,
    Object.hasOwn(input, 'details') ? ['code', 'message', 'details'] : ['code', 'message'],
  );
  if (
    e.code !== 'outcome_unknown' ||
    ![
      'The platform write may have happened; reconcile before retrying.',
      'A previous service stopped during this write; reconcile before retrying.',
    ].includes(e.message as string)
  )
    fail('source_mismatch');
  if (Object.hasOwn(e, 'details')) {
    const details = exact(e.details, ['cause']),
      cause = exact(details.cause, ['code', 'message']);
    const allowed: Record<string, readonly string[]> = {
      capability_unavailable: ['Native short body is unavailable.'],
      cancelled: ['Cancelled by the caller.', 'Job cancellation was requested.'],
      timeout: ['The platform operation exceeded its execution deadline.'],
      shutdown: ['The service is shutting down.'],
    };
    if (
      typeof cause.code !== 'string' ||
      typeof cause.message !== 'string' ||
      !allowed[cause.code]?.includes(cause.message)
    )
      fail('source_mismatch');
  }
  return e as unknown as RuntimeFailure;
}

function closurePointer(input: unknown): ClosurePointer {
  const p = exact(input, ['readJobId', 'evidenceId', 'evidenceHash', 'resultHash', 'settledAt']);
  uuid(p.readJobId);
  uuid(p.evidenceId);
  digest(p.evidenceHash);
  digest(p.resultHash);
  durableTime(p.settledAt);
  return p as unknown as ClosurePointer;
}

export function auditShape(input: unknown): NativeShortBodyOriginalAudit {
  const a = exact(copy(input, 256 * 1024), [
    'schema',
    'accountId',
    'originalJobId',
    'target',
    'inputHash',
    'originalEndedAt',
    'priorEndedAt',
    'originalResultHash',
    'originalErrorHash',
    'originalError',
    'evidenceHash',
    'attemptsHash',
    'firstClosure',
    'previousClosure',
  ]);
  if (a.schema !== 'native-short-body-original-audit/v1') fail('invalid_shape');
  account(a.accountId);
  uuid(a.originalJobId);
  digest(a.inputHash);
  const t = exact(a.target, ['kind', 'id']);
  if (t.kind !== 'short-story' || typeof t.id !== 'string' || !BODY_WORK.test(t.id))
    fail('source_mismatch');
  for (const key of ['originalResultHash', 'originalErrorHash', 'evidenceHash', 'attemptsHash'])
    digest(a[key]);
  const error = safeInitialError(a.originalError);
  if (hash(error) !== a.originalErrorHash) fail('source_mismatch');
  ordered([a.originalEndedAt, a.priorEndedAt]);
  if ((a.firstClosure === null) !== (a.previousClosure === null)) fail('invalid_trace');
  if (a.firstClosure !== null) {
    const first = closurePointer(a.firstClosure),
      previous = closurePointer(a.previousClosure);
    ordered([a.originalEndedAt, first.settledAt, previous.settledAt]);
    if (previous.settledAt !== a.priorEndedAt) fail('invalid_trace');
  } else if (a.originalEndedAt !== a.priorEndedAt) fail('invalid_trace');
  return a as unknown as NativeShortBodyOriginalAudit;
}

export function settlementShape(input: unknown): NativeShortBodySettlement {
  const s = exact(input, ['status', 'reason', 'result']);
  if (
    !['succeeded', 'failed', 'uncertain'].includes(s.status as string) ||
    !BODY_SETTLEMENT_REASONS.includes(s.reason as NativeShortBodySettlement['reason'])
  )
    fail('invalid_trace');
  const r = exact(s.result, [
    'schema',
    'source',
    'originalJobId',
    'readJobId',
    'desiredMatched',
    'bodyIncluded',
    'verifiedLive',
  ]);
  const p = source(r.source);
  uuid(r.originalJobId);
  uuid(r.readJobId);
  if (
    r.schema !== 'native-short-body-settlement-result/v1' ||
    typeof r.desiredMatched !== 'boolean' ||
    r.bodyIncluded !== false ||
    typeof r.verifiedLive !== 'boolean' ||
    (r.verifiedLive && (p.mode !== 'live' || s.status !== 'succeeded' || !r.desiredMatched)) ||
    (s.status === 'succeeded') !== (s.reason === 'match') ||
    (s.status === 'failed') !== (s.reason === 'not_applied') ||
    (s.status === 'succeeded') !== r.desiredMatched
  )
    fail('invalid_trace');
  return s as unknown as NativeShortBodySettlement;
}

export function isBodyClosure(input: unknown): boolean {
  return (
    !!input &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    ['native-short-body-closure/v1', 'native-short-body-closure/v2'].includes(
      String((input as Data).schema),
    )
  );
}

export function closureShape(input: unknown): NativeShortBodyClosure {
  const captured = copy(input, 256 * 1024) as Data,
    v2 = captured?.schema === 'native-short-body-closure/v2';
  const c = exact(captured, [
    'schema',
    'accountId',
    'originalJobId',
    'reconciliationJobId',
    'evidence',
    'status',
    'reason',
    'result',
    'originalAudit',
    'settledAt',
    ...(v2 ? ['comparisonPolicy', 'recovery'] : []),
  ]);
  if (!v2 && c.schema !== 'native-short-body-closure/v1') fail('invalid_shape');
  if (v2) {
    if (c.comparisonPolicy !== NATIVE_SHORT_BODY_COMPARISON_POLICY_V2) fail('source_mismatch');
    if (c.recovery !== null) recoveryShape(c.recovery);
  }
  account(c.accountId);
  uuid(c.originalJobId);
  uuid(c.reconciliationJobId);
  const a = auditShape(c.originalAudit),
    e = link(c.evidence),
    settlement = settlementShape({ status: c.status, reason: c.reason, result: c.result });
  if (
    c.accountId !== a.accountId ||
    c.originalJobId !== a.originalJobId ||
    settlement.result.originalJobId !== a.originalJobId ||
    settlement.result.readJobId !== c.reconciliationJobId ||
    c.originalJobId === c.reconciliationJobId
  )
    fail('source_mismatch');
  ordered([a.priorEndedAt, e.capturedAt, c.settledAt]);
  return c as unknown as NativeShortBodyClosure;
}

export function pointerForClosure(c: NativeShortBodyClosure): ClosurePointer {
  return {
    readJobId: c.reconciliationJobId,
    evidenceId: c.evidence.id,
    evidenceHash: c.evidence.sha256,
    resultHash: hash(c),
    settledAt: c.settledAt,
  };
}

export function originalForAudit(
  input: unknown,
  a: NativeShortBodyOriginalAudit,
  recoveryContext?: NativeShortBodyRecoveryContextV2,
  allowUncleanForIssue = false,
): DurableState {
  const c = contextCopy(input),
    j = c.job;
  if (
    j.accountId !== a.accountId ||
    j.id !== a.originalJobId ||
    j.inputHash !== a.inputHash ||
    !same(j.target, a.target) ||
    j.endedAt === null ||
    j.endedAt < a.originalEndedAt ||
    !['uncertain', 'succeeded', 'failed'].includes(j.status)
  )
    fail('source_mismatch');
  const isClosure =
    j.result !== null &&
    typeof j.result === 'object' &&
    !Array.isArray(j.result) &&
    isBodyClosure(j.result);
  if (
    !isClosure &&
    (a.previousClosure !== null ||
      j.status !== 'uncertain' ||
      j.endedAt !== a.originalEndedAt ||
      !same(j.result, { evidence: c.refs }) ||
      !same(j.error, a.originalError))
  )
    fail('source_mismatch');
  if (isClosure) {
    const current = closureShape(j.result);
    if (
      current.accountId !== j.accountId ||
      current.originalJobId !== j.id ||
      current.status !== j.status ||
      current.settledAt !== j.endedAt ||
      current.originalAudit.originalEndedAt !== a.originalEndedAt ||
      current.originalAudit.originalResultHash !== a.originalResultHash ||
      current.originalAudit.originalErrorHash !== a.originalErrorHash ||
      current.originalAudit.evidenceHash !== a.evidenceHash ||
      current.originalAudit.attemptsHash !== a.attemptsHash
    )
      fail('source_mismatch');
  }
  const frozen: NativeShortBodyEvidenceContext = {
    ...c,
    job: {
      ...j,
      status: 'uncertain',
      result: { evidence: c.refs },
      error: a.originalError,
      endedAt: a.originalEndedAt,
      updatedAt: a.originalEndedAt,
    },
  };
  const state = inspectBody(frozen, 'prefix');
  if (
    state.context.attempts.length !== 1 ||
    !state.plan ||
    !state.baseline ||
    hash({ evidence: c.refs }) !== a.originalResultHash ||
    hash({ basis: 'native-short-body-original-evidence/v1', links: c.refs.map(bodyRefLink) }) !==
      a.evidenceHash ||
    hash({ basis: 'native-short-body-original-attempts/v1', attempts: c.attempts }) !==
      a.attemptsHash
  )
    fail('source_mismatch');
  if (state.result && !clean(state.result.cleanup) && !allowUncleanForIssue) {
    if (!recoveryContext) fail('durability_unverified');
    checkedRecovery(state, a, recoveryContext);
  }
  return state;
}
