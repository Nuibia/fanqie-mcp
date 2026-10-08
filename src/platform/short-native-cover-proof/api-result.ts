import {
  type State,
  readPhase,
  storedSnapshot,
  held,
  acknowledgement,
} from './has-reserved-native-short-cover-signal.js';

import {
  type AuditResult,
  exact,
  fail,
  same,
  integer,
  time,
  order,
  type NativeShortCoverStage,
  NATIVE_SHORT_COVER_DATASETS,
  type NativeShortCoverWriteResultEvidence,
  refLink,
} from './fail.js';

import { NATIVE_SHORT_API_REASONS } from '../short-native-metadata-api.js';

import { stageFor, receiptFields } from './transport.js';

import { storedCoverMath } from '../short-native-legacy-codec.js';

import {
  nativeShortCoverDesiredContentHash,
  NATIVE_SHORT_COVER_SCOPE,
  NATIVE_SHORT_COVER_HASH_BASES,
} from '../short-native-cover.js';

export function apiResult(input: unknown, state: State): AuditResult {
  const r = exact(input, [
      'schema',
      'status',
      'reason',
      'asset',
      'uploadIntent',
      'expectation',
      'snapshot',
      'comparison',
      'desiredContentHash',
      'observedContentHash',
      'phases',
      'snapshots',
      'upload',
      'save',
      'proof',
      'cleanup',
    ]),
    success = r.status === 'success';
  if (
    r.schema !== 'native-short-cover-api-write/v1' ||
    !['success', 'capability_unavailable'].includes(r.status) ||
    (success
      ? r.reason !== null
      : ![
          ...NATIVE_SHORT_API_REASONS,
          'version_conflict',
          'readback_mismatch',
          'durability_unverified',
          'image_unavailable',
        ].includes(r.reason))
  )
    fail();
  const baseline = state.baseline!;
  if (
    !same(r.asset, baseline.uploadIntent.asset) ||
    !same(r.uploadIntent, baseline.uploadIntent) ||
    !same(r.upload.held, baseline)
  )
    fail();
  const phases = exact(r.phases, ['before', 'preSave', 'after']),
    snapshots = exact(r.snapshots, ['before', 'preSave', 'after']);
  if (!same(snapshots.before, baseline.snapshot) || !same(phases.before, baseline.read)) fail();
  for (const kind of ['before', 'preSave', 'after'] as const) {
    readPhase(phases[kind], snapshots[kind] !== null);
    if (snapshots[kind] !== null) storedSnapshot(snapshots[kind], state.mode);
  }
  if (
    state.preSave &&
    (!same(r.save.held, state.preSave) ||
      !same(snapshots.preSave, state.preSave.snapshot) ||
      !same(phases.preSave, state.preSave.read) ||
      !same(r.expectation, state.preSave.expectation) ||
      r.desiredContentHash !== state.preSave.desiredContentHash)
  )
    fail();
  if (!state.preSave) {
    if (success) fail();
    if (r.save.held !== null) {
      if (!state.uploadAck) fail();
      const observedHeld = held(r.save.held, 'save', state.business!, baseline, state.uploadAck);
      if (
        !same(observedHeld.snapshot, snapshots.preSave) ||
        !same(observedHeld.read, phases.preSave) ||
        !same(r.expectation, observedHeld.expectation) ||
        r.desiredContentHash !== observedHeld.desiredContentHash
      )
        fail();
    } else if (r.expectation !== null || r.desiredContentHash !== null) fail();
  }
  if (!same(r.snapshot, snapshots.after)) fail();
  for (const phase of ['upload', 'save'] as const) {
    const p = exact(r[phase], [
        'held',
        'intentReceipt',
        'attemptReceipt',
        'acknowledgementReceipt',
        'observation',
        'post',
        'outcome',
      ]),
      post = exact(p.post, [
        'attempts',
        'disposed',
        'markedAt',
        'startedAt',
        'acknowledgedAt',
        'acknowledged',
      ]);
    integer(post.attempts, 1);
    integer(post.disposed, 1);
    if (
      post.disposed > post.attempts ||
      typeof post.acknowledged !== 'boolean' ||
      !['not_attempted', 'unknown', 'acknowledged', 'verified'].includes(p.outcome)
    )
      fail();
    for (const k of ['markedAt', 'startedAt', 'acknowledgedAt'])
      if (post[k] !== null) time(post[k]);
    for (const stage of ['intent', 'attempt', 'acknowledgement'] as const) {
      const key = stage === 'acknowledgement' ? 'acknowledgementReceipt' : `${stage}Receipt`,
        index = state.kinds.indexOf(stageFor(phase, stage));
      if (p[key] !== null) {
        if (
          index < 0 ||
          !same(p[key], {
            schema: `native-short-cover-${phase}-${stage}-receipt/v1`,
            ...receiptFields(state, phase, stage),
          })
        )
          fail();
      }
      if (success && p[key] === null) fail();
    }
    const attemptIndex = state.kinds.indexOf(stageFor(phase, 'attempt'));
    if (
      attemptIndex < 0 &&
      (post.attempts !== 0 ||
        post.markedAt !== null ||
        post.startedAt !== null ||
        p.observation !== null ||
        post.acknowledged)
    )
      fail();
    if (
      post.markedAt !== null &&
      (attemptIndex < 0 || post.markedAt !== state.payloads[attemptIndex]!.eventAt)
    )
      fail();
    if (post.attempts === 1) {
      if (attemptIndex < 0 || post.markedAt === null || post.startedAt === null) fail();
      order([state.context.refs[attemptIndex]!.capturedAt, post.startedAt]);
    }
    if (
      post.acknowledged !== (p.observation !== null) ||
      (p.observation === null
        ? post.acknowledgedAt !== null
        : post.acknowledgedAt !== acknowledgement(p.observation, phase, state).acknowledgedAt)
    )
      fail();
    if (p.observation) {
      if (post.attempts !== 1) fail();
      order([post.startedAt, p.observation.acknowledgedAt]);
      const index = state.kinds.indexOf(stageFor(phase, 'acknowledgement'));
      if (index >= 0 && !same(p.observation, state.payloads[index]!.observation)) fail();
    }
    if (
      (post.attempts === 0 && p.outcome !== 'not_attempted') ||
      (post.attempts === 1 && p.outcome === 'not_attempted') ||
      (p.outcome === 'unknown' && post.acknowledged) ||
      (['acknowledged', 'verified'].includes(p.outcome) && !post.acknowledged) ||
      (p.outcome === 'verified' && (!success || phase !== 'save'))
    )
      fail();
    if (
      success &&
      (post.attempts !== 1 ||
        post.disposed !== 1 ||
        !post.acknowledged ||
        p.outcome !== (phase === 'save' ? 'verified' : 'acknowledged'))
    )
      fail();
  }
  const proof = exact(r.proof, [
      'platformStarted',
      'ownerCallback',
      'atomicRevision',
      'proofCapturedAt',
    ]),
    cleanup = exact(r.cleanup, [
      'sessionCreated',
      'sessionDisposed',
      'pendingAtEnd',
      'disposalFailures',
      'quarantined',
      'checkedAt',
    ]);
  if (
    proof.atomicRevision !== false ||
    typeof proof.platformStarted !== 'boolean' ||
    typeof proof.ownerCallback !== 'boolean'
  )
    fail();
  for (const k of ['sessionCreated', 'sessionDisposed', 'quarantined'])
    if (typeof cleanup[k] !== 'boolean') fail();
  integer(cleanup.pendingAtEnd);
  integer(cleanup.disposalFailures);
  time(cleanup.checkedAt);
  if (
    cleanup.pendingAtEnd !== 0 ||
    !cleanup.sessionCreated ||
    (cleanup.disposalFailures > 0 && !cleanup.quarantined)
  )
    fail();
  if (proof.proofCapturedAt !== null) time(proof.proofCapturedAt);
  if (r.snapshot !== null) {
    if (!state.plan) fail();
    const comparison = storedCoverMath.compareReadback(
      state.plan.expectation,
      storedSnapshot(r.snapshot, state.mode),
    );
    if (r.comparison !== null && !same(r.comparison, comparison)) fail();
    if (r.observedContentHash !== null) {
      const actual = comparison.actual,
        observed = nativeShortCoverDesiredContentHash({
          ...state.plan.expectation,
          binding: r.snapshot.binding,
          catalogHash: actual.catalogHash,
          documentHash: actual.documentHash,
          savedFieldsHash: actual.savedFieldsHash,
          categorySelectionHash: actual.categorySelectionHash,
          preservationHash: actual.preservationHash,
          coverUriHash: actual.coverUriHash,
        });
      if (r.observedContentHash !== observed) fail();
    }
    if (
      success &&
      (r.comparison === null ||
        !comparison.matches ||
        r.observedContentHash !== state.plan.desiredContentHash)
    )
      fail();
  } else if (r.comparison !== null || r.observedContentHash !== null || success) fail();
  if (success) {
    if (
      !proof.platformStarted ||
      !proof.ownerCallback ||
      !cleanup.sessionDisposed ||
      cleanup.quarantined ||
      cleanup.disposalFailures !== 0
    )
      fail();
    order([phases.after.proof.proofCapturedAt, cleanup.checkedAt, proof.proofCapturedAt]);
  } else if (proof.ownerCallback || proof.proofCapturedAt !== null) fail();
  return r as AuditResult;
}

export function businessResult(
  state: State,
  status = 'succeeded',
  reason: string | null = null,
): Record<string, unknown> {
  const intent = state.baseline!.uploadIntent,
    raw = state.after;
  const has = (kind: NativeShortCoverStage) => state.kinds.includes(kind);
  return {
    schema: 'fanqie-short-native-cover-write-business/v1',
    dataset: NATIVE_SHORT_COVER_DATASETS.after,
    status,
    reason,
    accountId: state.context.accountId,
    target: { kind: 'short-story', id: intent.binding.work.id },
    inputHash: state.context.job.inputHash,
    scope: NATIVE_SHORT_COVER_SCOPE,
    hashBases: NATIVE_SHORT_COVER_HASH_BASES,
    sourceVersionHash: intent.sourceVersionHash,
    assetHash: intent.assetHash,
    intentHash: intent.intentHash,
    uploadAckHash: state.uploadAck?.uploadAckHash ?? null,
    desiredContentHash:
      state.plan?.desiredContentHash ?? state.uploadAck?.desiredContentHash ?? null,
    observedContentHash: raw?.observedContentHash ?? null,
    upload: {
      attempted: has('uploadAttempt'),
      durableAcknowledged: has('uploadAck'),
      originalAcknowledged: raw?.upload.post.acknowledged ?? has('uploadAck'),
    },
    save: {
      attempted: has('saveAttempt'),
      durableAcknowledged: has('saveAck'),
      originalAcknowledged: raw?.save.post.acknowledged ?? has('saveAck'),
    },
    assetOutcome:
      status === 'succeeded' ? 'bound_verified' : state.uploadAck ? 'orphan_possible' : 'unknown',
    provenance: state.provenance,
  };
}

export function resultPayload(state: State): NativeShortCoverWriteResultEvidence {
  if (!state.after || state.after.status !== 'success' || state.kinds.at(-1) !== 'after') fail();
  return {
    schema: 'native-short-cover-write-result/v1',
    scope: NATIVE_SHORT_COVER_SCOPE,
    baselineEvidence: refLink(state.context.refs[0]!),
    afterEvidence: refLink(state.context.refs.at(-1)!),
    business: businessResult(state),
  };
}
