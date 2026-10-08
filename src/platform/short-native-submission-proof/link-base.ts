import { type State, transport } from './source-fields.js';

import {
  type NativeShortSubmissionStage,
  refLink,
  exact,
  copy,
  same,
  fail,
  time,
  NATIVE_SHORT_SUBMISSION_HASH_BASES,
  type AuditResult,
  order,
  type AuditSnapshot,
  type Data,
  NATIVE_SHORT_SUBMISSION_DATASETS,
  type NativeShortSubmissionWriteResultEvidence,
} from './fail.js';

import {
  NATIVE_SHORT_SUBMISSION_SCOPE,
  compareNativeShortSubmissionReadback,
  type NativeShortSubmissionComparison,
} from '../short-native-submission.js';

import {
  type NativeShortSubmissionAcknowledgement,
  type NativeShortSubmissionReceiptStage,
  type NativeShortSubmissionReceiptFields,
  validateNativeShortSubmissionApiResult,
} from '../short-native-submission-api.js';

export function linkBase(s: State, k: NativeShortSubmissionStage) {
  return {
    schema: `native-short-submission-${k.replace(/[A-Z]/g, (x) => `-${x.toLowerCase()}`)}-evidence/v1`,
    scope: NATIVE_SHORT_SUBMISSION_SCOPE,
    baselineEvidence: refLink(s.context.refs[0]!),
    previousEvidence: refLink(s.context.refs.at(-1)!),
  };
}

export function acknowledgement(input: unknown, s: State): NativeShortSubmissionAcknowledgement {
  const a = exact(copy(input, 16384), [
    'schema',
    'binding',
    'sourceVersionHash',
    'desiredSubmissionHash',
    'useAi',
    'code',
    'message',
    'itemId',
    'accepted',
    'acknowledgedAt',
  ]);
  if (
    !s.plan ||
    a.schema !== 'native-short-submission-acknowledgement-observation/v1' ||
    !same(a.binding, s.plan.expectation.binding) ||
    a.sourceVersionHash !== s.plan.expectation.sourceVersionHash ||
    a.desiredSubmissionHash !== s.plan.desiredContentHash ||
    a.useAi !== s.business!.useAi ||
    !Number.isSafeInteger(a.code) ||
    a.accepted !== (a.code === 0) ||
    (a.message !== null && typeof a.message !== 'string') ||
    (a.itemId !== null && a.itemId !== s.business!.target.workId)
  )
    fail();
  time(a.acknowledgedAt);
  return a as NativeShortSubmissionAcknowledgement;
}

export function receiptFields(
  s: State,
  stage: NativeShortSubmissionReceiptStage,
): NativeShortSubmissionReceiptFields {
  const i = s.kinds.indexOf(stage);
  if (i < 0 || !s.baseline || !s.preSubmit || !s.plan) fail();
  const p = s.payloads[i]!,
    a = stage === 'acknowledgement' ? acknowledgement(p.observation, s) : null;
  return {
    stage,
    accountId: s.context.accountId,
    jobId: s.context.job.id,
    target: { kind: 'short-story', id: s.business!.target.workId },
    binding: s.plan.expectation.binding,
    scope: NATIVE_SHORT_SUBMISSION_SCOPE,
    hashBases: NATIVE_SHORT_SUBMISSION_HASH_BASES,
    baseline: refLink(s.context.refs[0]!),
    evidence: refLink(s.context.refs[i]!),
    sourceVersionHash: s.plan.expectation.sourceVersionHash,
    desiredSubmissionHash: s.plan.desiredContentHash,
    preparationJobId: s.business!.preparationJobId,
    preparationEvidence: s.baseline.servicePrepared.preparationEvidence,
    termsHash: s.plan.expectation.termsHash,
    contractHash: s.plan.expectation.sourceHash,
    useAi: s.business!.useAi,
    ordinal: stage === 'attempt' ? 1 : null,
    transport: stage === 'attempt' ? transport(s.business!.target.workId) : null,
    eventAt:
      stage === 'intent'
        ? s.preSubmit.checkedAt
        : stage === 'attempt'
          ? p.eventAt
          : a!.acknowledgedAt,
  };
}

export function intentPayload(s: State) {
  if (!s.preSubmit || !s.plan) fail();
  return {
    ...linkBase(s, 'intent'),
    binding: s.plan.expectation.binding,
    sourceVersionHash: s.plan.expectation.sourceVersionHash,
    desiredSubmissionHash: s.plan.desiredContentHash,
    preparationJobId: s.business!.preparationJobId,
    preparationEvidence: s.baseline!.servicePrepared.preparationEvidence,
    termsHash: s.plan.expectation.termsHash,
    contractHash: s.plan.expectation.sourceHash,
    useAi: s.business!.useAi,
    checkedAt: s.preSubmit.checkedAt,
  };
}

export function apiResult(raw: unknown, s: State): AuditResult {
  if (!s.baseline || !s.plan) fail();
  const r = validateNativeShortSubmissionApiResult(copy(raw, 192 * 1024 * 1024), {
    accountId: s.plan.expectation.binding.account.id,
    workId: s.business!.target.workId,
  });
  if (
    r.provenance.mode !== s.provenance!.mode ||
    (s.provenance!.mode === 'live' &&
      (!r.proof.fixedSourcesVerified || !s.plan.request.liveAllowed)) ||
    r.mode !== 'submit' ||
    !same(r.plan, s.plan) ||
    !same(r.expectation, s.plan.expectation) ||
    !same(r.prepared, s.baseline.servicePrepared.prepared) ||
    !same(r.contract, s.baseline.contract) ||
    !same(r.snapshots.before, s.baseline.beforeSnapshot) ||
    !same(r.phases.before, s.baseline.read)
  )
    fail();
  if (
    s.preSubmit &&
    (!same(r.snapshots.preSubmit, s.preSubmit.snapshot) ||
      !same(r.phases.preSubmit, s.preSubmit.read) ||
      !same(r.publish.held, s.preSubmit))
  )
    fail();
  for (const [stage, field] of [
    ['intent', 'intentReceipt'],
    ['attempt', 'attemptReceipt'],
    ['acknowledgement', 'acknowledgementReceipt'],
  ] as const) {
    const v = r.publish[field];
    if (v !== null) {
      if (
        !s.kinds.includes(stage) ||
        !same(v, {
          schema: `native-short-submission-${stage}-receipt/v1`,
          ...receiptFields(s, stage),
        })
      )
        fail();
    } else if (r.status === 'success') fail();
  }
  const ai = s.kinds.indexOf('attempt'),
    ki = s.kinds.indexOf('acknowledgement'),
    post = r.publish.post;
  if (
    (ai < 0 && (post.attempts !== 0 || post.markedAt !== null)) ||
    (post.markedAt !== null && post.markedAt !== s.payloads[ai]?.eventAt)
  )
    fail();
  if (post.startedAt !== null) {
    if (ai < 0) fail();
    order([s.context.refs[ai]!.capturedAt, post.startedAt]);
  }
  if (r.publish.observation) {
    const a = acknowledgement(r.publish.observation, s);
    if (ki < 0 || !same(a, s.payloads[ki]!.observation)) fail();
    order([post.startedAt, a.acknowledgedAt, s.context.refs[ki]!.capturedAt]);
  }
  if (r.snapshot) {
    const c = compareNativeShortSubmissionReadback(s.plan.expectation, r.snapshot);
    if (!same(c, r.comparison)) fail();
  }
  if (
    r.status === 'success' &&
    (!s.preSubmit ||
      ai < 0 ||
      ki < 0 ||
      post.attempts !== 1 ||
      post.disposed !== 1 ||
      !post.acknowledged ||
      !r.publish.observation ||
      !['rejected', 'verified', 'acknowledged'].includes(r.publish.outcome))
  )
    fail();
  return r;
}

function safeSnapshot(s: AuditSnapshot): Data {
  return {
    target: { kind: 'short-story', id: s.binding.work.id },
    state: s.state,
    statusFacts: s.statusFacts,
    snapshotVersionHash: s.snapshotVersionHash,
    catalogHash: s.catalogHash,
    documentHash: s.documentHash,
    savedFieldsHash: s.savedFieldsHash,
    categorySelectionHash: s.categorySelectionHash,
    bodyIncluded: false,
  };
}

export function safeComparison(c: NativeShortSubmissionComparison | null): Data | null {
  return c
    ? {
        matches: c.matches,
        reason: c.reason,
        observedStatus: c.observedStatus,
        statusFacts: c.statusFacts,
        ai: c.ai,
        actual: c.actual,
        fields: c.fields,
      }
    : null;
}

export function businessResult(s: State, status = 'succeeded', reason: string | null = null): Data {
  const r = s.after,
    a =
      r?.publish.observation ??
      (s.kinds.includes('acknowledgement')
        ? s.payloads[s.kinds.indexOf('acknowledgement')]!.observation
        : null),
    p = s.plan!;
  return {
    schema: 'fanqie-short-native-submission-write-business/v1',
    dataset: NATIVE_SHORT_SUBMISSION_DATASETS.after,
    status,
    reason,
    accountId: s.context.accountId,
    target: { kind: 'short-story', id: s.business!.target.workId },
    inputHash: s.context.job.inputHash,
    scope: NATIVE_SHORT_SUBMISSION_SCOPE,
    hashBases: NATIVE_SHORT_SUBMISSION_HASH_BASES,
    sourceVersionHash: p.expectation.sourceVersionHash,
    desiredSubmissionHash: p.desiredContentHash,
    preparationJobId: s.business!.preparationJobId,
    termsHash: p.expectation.termsHash,
    contractHash: p.expectation.sourceHash,
    useAi: {
      requested: s.business!.useAi,
      acknowledged: a?.useAi ?? null,
      observed: r?.comparison?.ai.observed ?? null,
      evidence: r?.comparison?.ai.evidence ?? 'missing',
    },
    attempted: s.kinds.includes('attempt'),
    attemptOrdinal: s.kinds.includes('attempt') ? 1 : null,
    durableAcknowledged: s.kinds.includes('acknowledgement'),
    acknowledgement: a ? { code: a.code, accepted: a.accepted, itemId: a.itemId } : null,
    publication: {
      status: r?.snapshot?.state ?? 'unknown',
      statusFacts: r?.snapshot?.statusFacts ?? null,
    },
    originalOutcome: r?.publish.outcome ?? 'unknown',
    comparison: safeComparison(r?.comparison ?? null),
    validation: s.baseline!.servicePrepared.prepared.validation,
    before: safeSnapshot(s.baseline!.snapshot),
    after: r?.snapshot ? safeSnapshot(r.snapshot) : null,
    provenance: s.provenance,
    bodyIncluded: false,
  };
}

export function resultPayload(s: State): NativeShortSubmissionWriteResultEvidence {
  if (
    s.kinds.at(-1) !== 'after' ||
    s.after?.status !== 'success' ||
    (s.after.publish.outcome !== 'rejected' &&
      (!s.after.comparison?.matches ||
        !['reviewing', 'published'].includes(s.after.comparison.observedStatus)))
  )
    fail();
  return {
    schema: 'native-short-submission-write-result/v1',
    scope: NATIVE_SHORT_SUBMISSION_SCOPE,
    baselineEvidence: refLink(s.context.refs[0]!),
    afterEvidence: refLink(s.context.refs.at(-1)!),
    business: businessResult(
      s,
      s.after.publish.outcome === 'rejected' ? 'failed' : 'succeeded',
      s.after.publish.outcome === 'rejected' ? 'platform_rejected' : null,
    ),
  };
}
