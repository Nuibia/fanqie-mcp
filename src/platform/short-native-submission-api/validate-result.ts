import { createResultShape } from './validate-result-shape.js';

import { request } from 'playwright';

import { type NativeShortMetadataWriteReadPhase } from '../short-native-metadata-api.js';
import {
  NATIVE_SHORT_SUBMISSION_SCOPE,
  validateNativeShortSubmissionWriteRequest,
  validateNativeShortSubmissionContract,
  planNativeShortSubmission,
  compareNativeShortSubmissionReadback,
  type NativeShortSubmissionPlan,
  type NativeShortSubmissionComparison,
} from '../short-native-submission.js';
import {
  type OwnedStopSignal,
  type NativeShortSubmissionServicePrepared,
  type NativeShortSubmissionEvidenceRef,
  type NativeShortSubmissionTransport,
  type NativeShortSubmissionReceipt,
  type NativeShortSubmissionHeldIntent,
  type NativeShortSubmissionAcknowledgement,
  type NativeShortSubmissionSourceRead,
  type NativeShortSubmissionApiResult,
} from '../short-native-submission-api.js';

export interface Ports {
  copy: <T>(input: T) => T;
  fields: (
    input: unknown,
    allowed: readonly string[],
    required?: readonly string[],
  ) => Record<string, unknown>;
  NATIVE_SHORT_SUBMISSION_API_REASONS: readonly [
    'context_unavailable',
    'identity_unverified',
    'owner_changed',
    'source_changed',
    'redirect_blocked',
    'response_unverified',
    'response_unavailable',
    'bounded_unavailable',
    'pagination_inconsistent',
    'target_unverified',
    'unsupported_schema',
    'cancelled',
    'timeout',
    'cleanup_failed',
    'lease_unavailable',
    'callback_failed',
    'invalid_input',
    'version_conflict',
    'durability_unverified',
    'acknowledgement_unverified',
    'readback_mismatch',
    'submission_rejected',
  ];
  STOPPED: OwnedStopSignal;
  OWNER: RegExp;
  WORK: RegExp;
  same: (a: unknown, b: unknown) => boolean;
  time: (value: unknown) => value is string;
  SOURCE_KEYS: readonly ['writer', 'main', 'publishShort', 'asyncMain'];
  HASH: RegExp;
  servicePrepared: (input: unknown) => NativeShortSubmissionServicePrepared;
  ref: (input: unknown) => NativeShortSubmissionEvidenceRef;
  UUID: RegExp;
  NATIVE_SHORT_SUBMISSION_RECEIPT_HASH_BASES: Readonly<{
    readonly snapshot: 'full-edit-catalog-and-typed-binding/v1';
    readonly submission: 'native-short-submission-wire-form/v1';
  }>;
}
export function createResultValidator(ports: Ports) {
  return function validateNativeShortSubmissionApiResult(
    input: unknown,
    expectedBinding?: { accountId: string; workId: string },
  ): NativeShortSubmissionApiResult {
    const parseResultShape = createResultShape({ ports, input, expectedBinding });
    const {
      current,
      value,
      r,
      binding,
      provenance,
      snapshot,
      phases,
      sources,
      publish,
      post,
      proof,
      cleanup,
      before,
      preSubmit,
      after,
      prepared,
      contract,
    } = parseResultShape();

    const ordered = (...values: unknown[]) => {
      let last = '';
      for (const value of values) {
        if (!ports.time(value) || value < last) throw ports.STOPPED;
        last = value;
      }
    };
    for (const [name, s] of [
      ['before', before],
      ['preSubmit', preSubmit],
      ['after', after],
    ] as const) {
      const p = phases[name] as NativeShortMetadataWriteReadPhase,
        q = p.proof;
      if (q.readStartedAt !== null && q.readFinishedAt !== null)
        ordered(q.readStartedAt, q.readFinishedAt, q.proofCapturedAt);
      if (
        s &&
        (!q.platformStarted ||
          !q.ownerBefore ||
          !q.ownerAfter ||
          !q.fixedSourceVerified ||
          !q.targetUnique ||
          q.atomicRevision !== false ||
          p.requests.edit.attempts !== 1 ||
          p.requests.catalog.attempts !== 1 ||
          p.requests.own.attempts !==
            (name === 'before' ? (r.status === 'success' ? 3 : p.requests.own.attempts) : 2) ||
          (name === 'before' && ![2, 3].includes(p.requests.own.attempts)) ||
          (name !== 'after' &&
            (!q.paginationComplete ||
              p.list.pagesRead !== p.requests.list.attempts ||
              p.list.totalCount !== p.list.rowsRead)) ||
          (name === 'after' &&
            (p.requests.list.attempts !== 0 ||
              p.list.pagesRead !== 0 ||
              p.list.rowsRead !== 0 ||
              p.list.totalCount !== null ||
              s.responseBinding !== 'exact')))
      )
        throw ports.STOPPED;
      if (
        s &&
        r.status === 'success' &&
        Object.values(p.requests).some((c) => c.disposed !== c.attempts)
      )
        throw ports.STOPPED;
    }
    for (const key of ['sourceReadStartedAt', 'sourceReadFinishedAt'])
      if (r[key] !== null && !ports.time(r[key])) throw ports.STOPPED;
    let priorSource = r.sourceReadStartedAt;
    for (const key of ports.SOURCE_KEYS) {
      const s = sources[key] as NativeShortSubmissionSourceRead;
      if (
        (s.attempts === 0 &&
          !ports.same(s, {
            attempts: 0,
            disposed: 0,
            url: null,
            sha256: null,
            requestedAt: null,
            completedAt: null,
          })) ||
        (s.completedAt !== null &&
          (s.attempts !== 1 || s.url === null || s.sha256 === null || s.requestedAt === null))
      )
        throw ports.STOPPED;
      if (s.requestedAt !== null && priorSource !== null) ordered(priorSource, s.requestedAt);
      if (s.completedAt !== null) {
        ordered(s.requestedAt, s.completedAt);
        priorSource = s.completedAt;
      }
      if (
        contract &&
        (s.attempts !== 1 ||
          s.disposed !== 1 ||
          s.completedAt !== contract.sources[key].observedAt ||
          s.url !== contract.sources[key].url ||
          (provenance.mode === 'live' && s.sha256 !== contract.sources[key].sha256))
      )
        throw ports.STOPPED;
    }
    if (contract) {
      ordered(
        (phases.before as NativeShortMetadataWriteReadPhase).proof.readFinishedAt,
        r.sourceReadStartedAt,
        priorSource,
        r.sourceReadFinishedAt,
      );
      if (proof.fixedSourcesVerified !== (provenance.mode === 'live')) throw ports.STOPPED;
    }
    let held: NativeShortSubmissionHeldIntent | null = null,
      plan: NativeShortSubmissionPlan | null = null;
    if (publish.held !== null) {
      const h = ports.fields(publish.held, [
          'schema',
          'beforeSnapshot',
          'snapshot',
          'contract',
          'businessRequest',
          'servicePrepared',
          'plan',
          'expectation',
          'desiredSubmissionHash',
          'read',
          'checkedAt',
        ]),
        sp = ports.servicePrepared(h.servicePrepared),
        request = validateNativeShortSubmissionWriteRequest(h.businessRequest),
        hs = snapshot(h.snapshot),
        hb = snapshot(h.beforeSnapshot),
        hc = validateNativeShortSubmissionContract(h.contract);
      if (
        h.schema !== 'native-short-submission-held-intent/v1' ||
        !ports.time(h.checkedAt) ||
        !hs ||
        !hb ||
        !ports.same(hs, hb) ||
        !ports.same(hs, preSubmit) ||
        !ports.same(hb, before) ||
        !ports.same(hc, contract) ||
        !ports.same(sp.prepared, prepared) ||
        !ports.same(h.read, phases.preSubmit)
      )
        throw ports.STOPPED;
      plan = planNativeShortSubmission(
        hs,
        hc,
        {
          ...request,
          target: { kind: 'short', workId: binding.workId },
          snapshotScope: NATIVE_SHORT_SUBMISSION_SCOPE,
        },
        sp.prepared,
        h.checkedAt,
      );
      if (
        !ports.same(h.plan, plan) ||
        !ports.same(h.expectation, plan.expectation) ||
        h.desiredSubmissionHash !== plan.desiredContentHash
      )
        throw ports.STOPPED;
      ordered(
        r.sourceReadFinishedAt,
        (phases.preSubmit as NativeShortMetadataWriteReadPhase).proof.readStartedAt,
        (h.read as NativeShortMetadataWriteReadPhase).proof.readFinishedAt,
        h.checkedAt,
      );
      held = h as unknown as NativeShortSubmissionHeldIntent;
    }
    if (r.plan !== null) {
      if (!before || !contract || !prepared || !ports.time(r.sourceReadFinishedAt))
        throw ports.STOPPED;
      plan ??= planNativeShortSubmission(
        before,
        contract,
        prepared.business,
        prepared,
        r.sourceReadFinishedAt,
      );
      if (
        !ports.same(r.plan, plan) ||
        !ports.same(r.expectation, plan.expectation) ||
        plan.request.liveAllowed !== (provenance.mode === 'live')
      )
        throw ports.STOPPED;
    } else if (r.expectation !== null || held !== null) throw ports.STOPPED;
    if (r.comparison !== null) {
      if (
        !plan ||
        !after ||
        !ports.same(current, after) ||
        !ports.same(r.comparison, compareNativeShortSubmissionReadback(plan.expectation, after))
      )
        throw ports.STOPPED;
    }
    const receiptRefs = new Set<string>();
    let priorReceipt: NativeShortSubmissionReceipt | null = null;
    for (const [stage, key] of [
      ['intent', 'intentReceipt'],
      ['attempt', 'attemptReceipt'],
      ['acknowledgement', 'acknowledgementReceipt'],
    ] as const) {
      if (publish[key] === null) {
        if (
          stage !== 'acknowledgement' &&
          (stage === 'intent'
            ? publish.attemptReceipt !== null
            : publish.acknowledgementReceipt !== null)
        )
          throw ports.STOPPED;
        continue;
      }
      if (!held || !plan) throw ports.STOPPED;
      const x = ports.fields(publish[key], [
          'schema',
          'stage',
          'accountId',
          'jobId',
          'target',
          'binding',
          'scope',
          'hashBases',
          'baseline',
          'evidence',
          'sourceVersionHash',
          'desiredSubmissionHash',
          'preparationJobId',
          'preparationEvidence',
          'termsHash',
          'contractHash',
          'useAi',
          'ordinal',
          'transport',
          'eventAt',
        ]),
        baseline = ports.ref(x.baseline),
        evidence = ports.ref(x.evidence),
        preparation = ports.ref(x.preparationEvidence),
        transport: NativeShortSubmissionTransport = {
          schema: 'native-short-submission-publish-transport/v1',
          provenance: 'static-unobserved',
          method: 'POST',
          url: plan.request.url,
          encoding: 'application/x-www-form-urlencoded;charset=UTF-8',
        };
      if (
        x.schema !== `native-short-submission-${stage}-receipt/v1` ||
        x.stage !== stage ||
        typeof x.accountId !== 'string' ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(x.accountId) ||
        typeof x.jobId !== 'string' ||
        !ports.UUID.test(x.jobId) ||
        x.jobId === held.servicePrepared.preparationJobId ||
        !ports.same(x.target, { kind: 'short-story', id: binding.workId }) ||
        !ports.same(x.binding, plan.expectation.binding) ||
        x.scope !== NATIVE_SHORT_SUBMISSION_SCOPE ||
        !ports.same(x.hashBases, ports.NATIVE_SHORT_SUBMISSION_RECEIPT_HASH_BASES) ||
        x.sourceVersionHash !== plan.expectation.sourceVersionHash ||
        x.desiredSubmissionHash !== plan.desiredContentHash ||
        x.preparationJobId !== held.servicePrepared.preparationJobId ||
        !ports.same(preparation, held.servicePrepared.preparationEvidence) ||
        x.termsHash !== held.contract.terms.sha256 ||
        x.contractHash !== held.contract.sourceHash ||
        x.useAi !== plan.expectation.useAi ||
        x.ordinal !== (stage === 'attempt' ? 1 : null) ||
        !ports.same(x.transport, stage === 'attempt' ? transport : null) ||
        baseline.id === evidence.id ||
        receiptRefs.has(evidence.id) ||
        !ports.time(x.eventAt)
      )
        throw ports.STOPPED;
      ordered(baseline.capturedAt, held.read.proof.readStartedAt);
      ordered(x.eventAt, evidence.capturedAt);
      if (
        (stage === 'intent' && x.eventAt !== held.checkedAt) ||
        (stage === 'attempt' && x.eventAt !== post.markedAt) ||
        (stage === 'acknowledgement' &&
          x.eventAt !==
            (publish.observation as NativeShortSubmissionAcknowledgement | null)?.acknowledgedAt) ||
        (priorReceipt &&
          (x.accountId !== priorReceipt.accountId ||
            x.jobId !== priorReceipt.jobId ||
            !ports.same(baseline, priorReceipt.baseline)))
      )
        throw ports.STOPPED;
      if (priorReceipt) ordered(priorReceipt.evidence.capturedAt, x.eventAt);
      receiptRefs.add(evidence.id);
      priorReceipt = x as unknown as NativeShortSubmissionReceipt;
    }
    if (
      (post.attempts === 1 && (!publish.attemptReceipt || !ports.time(post.startedAt))) ||
      (post.attempts === 0 &&
        (post.startedAt !== null ||
          post.acknowledged !== false ||
          post.disposed !== 0 ||
          publish.observation !== null)) ||
      (post.markedAt !== null && !publish.attemptReceipt) ||
      (publish.outcome === 'not_attempted' && post.attempts !== 0) ||
      (post.attempts === 1 && publish.outcome === 'not_attempted')
    )
      throw ports.STOPPED;
    if (post.startedAt !== null)
      ordered(
        (publish.attemptReceipt as NativeShortSubmissionReceipt).evidence.capturedAt,
        post.startedAt,
      );
    if (publish.observation !== null) {
      const a = publish.observation as NativeShortSubmissionAcknowledgement;
      if (
        !plan ||
        a.sourceVersionHash !== plan.expectation.sourceVersionHash ||
        a.desiredSubmissionHash !== plan.desiredContentHash ||
        a.useAi !== plan.expectation.useAi
      )
        throw ports.STOPPED;
      ordered(post.startedAt, a.acknowledgedAt);
      if (after)
        ordered(
          a.acknowledgedAt,
          (phases.after as NativeShortMetadataWriteReadPhase).proof.readStartedAt,
        );
    }
    if (
      (publish.outcome === 'rejected' &&
        (publish.observation === null ||
          (publish.observation as NativeShortSubmissionAcknowledgement).accepted !== false)) ||
      (['acknowledged', 'verified'].includes(String(publish.outcome)) &&
        !(publish.observation as NativeShortSubmissionAcknowledgement | null)?.accepted)
    )
      throw ports.STOPPED;
    if (
      publish.outcome === 'verified' &&
      (!after ||
        !(r.comparison as NativeShortSubmissionComparison | null)?.matches ||
        !['reviewing', 'published'].includes(after.state))
    )
      throw ports.STOPPED;
    if (
      (r.mode === 'prepare' &&
        (post.attempts !== 0 ||
          publish.held !== null ||
          r.plan !== null ||
          r.expectation !== null ||
          r.comparison !== null ||
          preSubmit !== null ||
          after !== null ||
          !ports.same(current, before))) ||
      (r.mode === 'read' && (!ports.same(current, after) || before !== null || preSubmit !== null))
    )
      throw ports.STOPPED;
    if (
      (r.status === 'success' &&
        r.mode === 'prepare' &&
        (!prepared || !contract || !ports.same(prepared.contract, contract))) ||
      (r.status === 'success' &&
        r.mode === 'submit' &&
        (!held || !plan || !after || r.comparison === null))
    )
      throw ports.STOPPED;
    if (proof.proofCapturedAt !== null && cleanup.checkedAt !== null)
      ordered(proof.proofCapturedAt, cleanup.checkedAt);
    return value as NativeShortSubmissionApiResult;
  };
}
