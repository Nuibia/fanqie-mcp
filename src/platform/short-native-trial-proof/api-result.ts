import { type State, held, acknowledgement, receiptFields } from './stored-native-snapshot.js';

import {
  type AuditResult,
  fail,
  copy,
  exact,
  type AuditSave,
  integer,
  time,
  order,
  type AuditSnapshot,
} from './fail.js';

import { sourceFields, assertExpected, readPhase, storedSnapshot } from './read-phase.js';

import {
  NATIVE_SHORT_TRIAL_API_REASONS,
  type NativeShortTrialApiResult,
} from '../short-native-trial-api.js';

import {
  type NativeShortTrialComparison,
  NATIVE_SHORT_TRIAL_SCOPE,
  NATIVE_SHORT_TRIAL_HASH_BASES,
} from '../short-native-trial.js';

import { storedTrialMath } from '../short-native-legacy-codec.js';

import { observedHash } from './observed-hash.js';

/** API outcome observations never substitute for independently persisted ACK or attempt rows. */
export function apiResult(input: unknown, state: State): AuditResult {
  const r = sourceFields(input, [
    'schema',
    'mode',
    'status',
    'reason',
    'plan',
    'expectation',
    'snapshot',
    'comparison',
    'desiredContentHash',
    'observedContentHash',
    'phases',
    'snapshots',
    'save',
    'proof',
    'cleanup',
  ]);
  if (
    r.schema !== 'native-short-trial-api/v1' ||
    r.mode !== 'write' ||
    !['success', 'capability_unavailable'].includes(r.status)
  )
    fail();
  const success = r.status === 'success';
  if (success ? r.reason !== null : !NATIVE_SHORT_TRIAL_API_REASONS.includes(r.reason)) fail();
  if (!state.baseline || !state.plan) fail();
  assertExpected(r.plan, state.plan);
  assertExpected(r.expectation, state.plan.expectation);
  if (r.desiredContentHash !== state.plan.desiredContentHash) fail();
  const phaseSource = sourceFields(r.phases, ['before', 'preSave', 'after']),
    snapshotSource = sourceFields(r.snapshots, ['before', 'preSave', 'after']);
  const phases = {} as NativeShortTrialApiResult['phases'],
    snapshots = {} as AuditResult['snapshots'];
  for (const key of ['before', 'preSave', 'after'] as const) {
    phases[key] = readPhase(
      copy(phaseSource[key], 64 * 1024),
      success || key === 'before' || (key === 'preSave' && state.preSave !== null),
    );
    snapshots[key] =
      snapshotSource[key] === null
        ? null
        : storedSnapshot(snapshotSource[key], state.mode).snapshot;
  }
  assertExpected(snapshots.before, state.baseline.snapshot);
  assertExpected(phases.before, state.baseline.read);
  if (state.preSave) {
    assertExpected(snapshots.preSave, state.preSave.snapshot);
    assertExpected(phases.preSave, state.preSave.read);
  }
  const snapshot = r.snapshot === null ? null : storedSnapshot(r.snapshot, state.mode).snapshot;
  assertExpected(snapshot, snapshots.after);
  const sourceSave = sourceFields(r.save, [
    'held',
    'intentReceipt',
    'attemptReceipt',
    'acknowledgementReceipt',
    'observation',
    'post',
    'outcome',
  ]);
  const saveHeld =
    sourceSave.held === null ? null : held(sourceSave.held, state.business!, state.baseline);
  if (saveHeld !== null) {
    if (state.preSave) assertExpected(saveHeld, state.preSave);
    else {
      if (success) fail();
      assertExpected(saveHeld.snapshot, snapshots.preSave);
      assertExpected(saveHeld.read, phases.preSave);
    }
  } else if (state.preSave) fail();
  const save = {
    held: saveHeld,
    intentReceipt:
      sourceSave.intentReceipt === null ? null : copy(sourceSave.intentReceipt, 64 * 1024),
    attemptReceipt:
      sourceSave.attemptReceipt === null ? null : copy(sourceSave.attemptReceipt, 64 * 1024),
    acknowledgementReceipt:
      sourceSave.acknowledgementReceipt === null
        ? null
        : copy(sourceSave.acknowledgementReceipt, 64 * 1024),
    observation:
      sourceSave.observation === null
        ? null
        : acknowledgement(copy(sourceSave.observation, 16 * 1024), state),
    post: exact(copy(sourceSave.post, 4096), [
      'attempts',
      'disposed',
      'markedAt',
      'startedAt',
      'acknowledgedAt',
      'acknowledged',
    ]),
    outcome: sourceSave.outcome,
  } as AuditSave;
  const post = save.post;
  integer(post.attempts, 1);
  integer(post.disposed, 1);
  if (
    post.disposed > post.attempts ||
    typeof post.acknowledged !== 'boolean' ||
    !['not_attempted', 'unknown', 'acknowledged', 'verified'].includes(save.outcome)
  )
    fail();
  for (const t of [post.markedAt, post.startedAt, post.acknowledgedAt]) if (t !== null) time(t);
  for (const [stage, field] of [
    ['intent', 'intentReceipt'],
    ['attempt', 'attemptReceipt'],
    ['acknowledgement', 'acknowledgementReceipt'],
  ] as const) {
    const index = state.kinds.indexOf(stage);
    if (save[field] !== null) {
      if (index < 0) fail();
      assertExpected(save[field], {
        schema: `native-short-trial-${stage}-receipt/v1`,
        ...receiptFields(state, stage),
      });
    } else if (success) fail();
  }
  const attemptIndex = state.kinds.indexOf('attempt'),
    ackIndex = state.kinds.indexOf('acknowledgement');
  if (
    attemptIndex < 0 &&
    (post.attempts !== 0 ||
      post.markedAt !== null ||
      post.startedAt !== null ||
      save.observation !== null ||
      post.acknowledged)
  )
    fail();
  if (
    post.markedAt !== null &&
    (attemptIndex < 0 || post.markedAt !== state.payloads[attemptIndex]!.eventAt)
  )
    fail();
  if (post.attempts === 1) {
    if (attemptIndex < 0 || post.startedAt === null) fail();
    order([state.context.refs[attemptIndex]!.capturedAt, post.startedAt]);
  }
  if (
    post.acknowledged !== (save.observation !== null) ||
    (save.observation === null
      ? post.acknowledgedAt !== null
      : post.acknowledgedAt !== save.observation.acknowledgedAt)
  )
    fail();
  if (save.observation) {
    if (post.attempts !== 1) fail();
    order([post.startedAt, save.observation.acknowledgedAt]);
    if (ackIndex >= 0) assertExpected(save.observation, state.payloads[ackIndex]!.observation);
  }
  if (
    (post.attempts === 0 && save.outcome !== 'not_attempted') ||
    (post.attempts === 1 && save.outcome === 'not_attempted') ||
    (save.outcome === 'unknown' && post.acknowledged) ||
    (['acknowledged', 'verified'].includes(save.outcome) && !post.acknowledged) ||
    (save.outcome === 'verified' && !success)
  )
    fail();
  const proof = exact(copy(r.proof, 4096), [
      'platformStarted',
      'ownerCallback',
      'atomicRevision',
      'proofCapturedAt',
    ]),
    cleanup = exact(copy(r.cleanup, 4096), [
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
  for (const key of ['sessionCreated', 'sessionDisposed', 'quarantined'])
    if (typeof cleanup[key] !== 'boolean') fail();
  integer(cleanup.pendingAtEnd);
  integer(cleanup.disposalFailures);
  time(cleanup.checkedAt);
  if (
    !cleanup.sessionCreated ||
    cleanup.pendingAtEnd !== 0 ||
    (cleanup.disposalFailures > 0 && !cleanup.quarantined)
  )
    fail();
  if (proof.proofCapturedAt !== null) time(proof.proofCapturedAt);
  let comparison: NativeShortTrialComparison | null = null;
  if (snapshot !== null) {
    const actual = storedTrialMath.compareReadback(
      state.plan.expectation,
      storedSnapshot(snapshot, state.mode),
    );
    if (r.comparison !== null) {
      assertExpected(r.comparison, actual);
      comparison = actual;
    }
    if (
      success &&
      (!actual.matches ||
        comparison === null ||
        r.observedContentHash !== state.plan.desiredContentHash)
    )
      fail();
    if (
      r.observedContentHash !== null &&
      r.observedContentHash !== observedHash(state.plan, snapshot, actual)
    )
      fail();
  } else if (r.comparison !== null || r.observedContentHash !== null || success) fail();
  if (success) {
    if (
      !state.preSave ||
      attemptIndex < 0 ||
      ackIndex < 0 ||
      post.attempts !== 1 ||
      post.disposed !== 1 ||
      !post.acknowledged ||
      save.outcome !== 'verified' ||
      !proof.platformStarted ||
      !proof.ownerCallback ||
      !cleanup.sessionDisposed ||
      cleanup.quarantined ||
      cleanup.disposalFailures !== 0
    )
      fail();
    order([phases.after.proof.proofCapturedAt, cleanup.checkedAt, proof.proofCapturedAt]);
  } else if (proof.ownerCallback || proof.proofCapturedAt !== null) fail();
  return {
    schema: 'native-short-trial-api/v1',
    mode: 'write',
    status: r.status,
    reason: r.reason,
    plan: state.plan,
    expectation: state.plan.expectation,
    snapshot,
    comparison,
    desiredContentHash: state.plan.desiredContentHash,
    observedContentHash: r.observedContentHash,
    phases,
    snapshots,
    save,
    proof,
    cleanup,
  } as AuditResult;
}

export function safeSnapshot(s: AuditSnapshot): Record<string, unknown> {
  const d = s.document;
  return {
    scope: NATIVE_SHORT_TRIAL_SCOPE,
    hashBases: NATIVE_SHORT_TRIAL_HASH_BASES,
    target: { kind: 'short-story', id: s.binding.work.id },
    state: s.native.state,
    snapshotVersionHash: s.snapshotVersionHash,
    catalogHash: s.catalogHash,
    documentHash: s.documentHash,
    savedFieldsHash: s.savedFieldsHash,
    categorySelectionHash: s.categorySelectionHash,
    trialDocumentHash: s.trialDocumentHash,
    bodyHash: s.bodyHash,
    paragraphsHash: s.paragraphsHash,
    coversHash: s.coversHash,
    paragraphCount: d.paragraphCount,
    eligibleParagraphCount: d.eligibleParagraphCount,
    characterCount: d.characterCount,
    markerCount: d.markerCount,
    boundary: d.boundary,
    prefixCharacterCount: d.prefixCharacterCount,
    displayPercent: d.displayPercent,
    bodyIncluded: false,
  };
}
