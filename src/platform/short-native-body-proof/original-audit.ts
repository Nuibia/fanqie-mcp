import {
  type NativeShortBodyHistoryFrame,
  type NativeShortBodyRecoveryContextV2,
  type NativeShortBodyOriginalAudit,
  type ClosurePointer,
  type NativeShortBodyOwnedGetRecoveryV2,
} from './native-short-body-attempt-row.js';

import { contextCopy, type DurableState, verifyBodyRef } from './context-copy.js';

import {
  fail,
  same,
  exact,
  copy,
  hash,
  freeze,
  digest,
  time,
  MIB,
  NativeShortBodyProofError,
  sourceError,
  storedNative,
} from './fail.js';

import { type RuntimeFailure } from '../../runtime/store.js';

import { inspectBody } from './inspect-body.js';

import {
  safeInitialError,
  auditShape,
  closureShape,
  pointerForClosure,
  originalForAudit,
} from './validate-native-short-body-evidence-context.js';

import {
  bodyRefLink,
  uuid,
  link,
  durableTime,
  BODY_JOB_KEYS,
  BODY_MANIFEST_KEYS,
  boundedCount,
  ordered,
} from './native-short-body-scope.js';

import {
  type NativeShortEvidenceContext,
  validateNativeShortEvidenceContext,
} from '../short-native-metadata-proof.js';

import { storedBodyMath, type StoredBodySnapshot } from '../short-native-legacy-codec.js';

import {
  type NativeShortBodyPlan,
  type NativeShortBodyComparison,
  compareNativeShortBodyReadback,
} from '../short-native-body.js';

import { nativeShortBodyGraphHash } from './same-mode.js';

export function originalAudit(
  context: unknown,
  history?: NativeShortBodyHistoryFrame,
  recoveryContext?: NativeShortBodyRecoveryContextV2,
  allowUncleanForIssue = false,
): NativeShortBodyOriginalAudit {
  const c = contextCopy(context),
    j = c.job;
  if (j.status !== 'uncertain' || j.endedAt === null || j.error === null) fail('invalid_trace');
  let originalEndedAt = j.endedAt,
    originalError: RuntimeFailure,
    firstClosure: ClosurePointer | null = null,
    previousClosure: ClosurePointer | null = null;
  if (history === undefined) {
    inspectBody(c, 'prefix');
    if (!same(j.result, { evidence: c.refs })) fail('source_mismatch');
    originalError = safeInitialError(j.error);
  } else {
    const h = exact(copy(history, 512 * 1024), ['firstAudit', 'previousClosure']),
      first = auditShape(h.firstAudit),
      previous = closureShape(h.previousClosure);
    if (
      first.firstClosure !== null ||
      first.previousClosure !== null ||
      previous.status !== 'uncertain' ||
      previous.accountId !== j.accountId ||
      previous.originalJobId !== j.id ||
      previous.settledAt !== j.endedAt ||
      !same(j.result, previous) ||
      first.originalJobId !== j.id ||
      !same(first.target, j.target) ||
      first.inputHash !== j.inputHash ||
      first.originalEndedAt !== previous.originalAudit.originalEndedAt ||
      first.originalErrorHash !== previous.originalAudit.originalErrorHash ||
      first.originalResultHash !== previous.originalAudit.originalResultHash ||
      first.evidenceHash !== previous.originalAudit.evidenceHash ||
      first.attemptsHash !== previous.originalAudit.attemptsHash
    )
      fail('source_mismatch');
    originalEndedAt = first.originalEndedAt;
    originalError = first.originalError;
    firstClosure = previous.originalAudit.firstClosure ?? pointerForClosure(previous);
    previousClosure = pointerForClosure(previous);
  }
  const audit = auditShape({
    schema: 'native-short-body-original-audit/v1',
    accountId: j.accountId,
    originalJobId: j.id,
    target: j.target,
    inputHash: j.inputHash,
    originalEndedAt,
    priorEndedAt: j.endedAt,
    originalResultHash: hash({ evidence: c.refs }),
    originalErrorHash: hash(originalError),
    originalError,
    evidenceHash: hash({
      basis: 'native-short-body-original-evidence/v1',
      links: c.refs.map(bodyRefLink),
    }),
    attemptsHash: hash({ basis: 'native-short-body-original-attempts/v1', attempts: c.attempts }),
    firstClosure,
    previousClosure,
  });
  originalForAudit(c, audit, recoveryContext, allowUncleanForIssue);
  return freeze(audit);
}

export function recoveryShape(input: unknown): NativeShortBodyOwnedGetRecoveryV2 {
  const r = exact(copy(input, 16 * 1024), [
    'schema',
    'originalOwnerId',
    'leaseOwnerId',
    'freshReadJobId',
    'freshReadJobHash',
    'freshReadManifestId',
    'freshReadManifestHash',
    'freshReadEvidence',
    'leaseCheckedAt',
    'leaseExpiresAt',
  ]);
  if (r.schema !== 'native-short-body-owned-get-recovery/v2') fail('invalid_shape');
  for (const key of ['originalOwnerId', 'leaseOwnerId', 'freshReadJobId', 'freshReadManifestId'])
    uuid(r[key]);
  if (r.originalOwnerId === r.leaseOwnerId) fail('source_mismatch');
  digest(r.freshReadJobHash);
  digest(r.freshReadManifestHash);
  link(r.freshReadEvidence);
  durableTime(r.leaseCheckedAt);
  time(r.leaseExpiresAt);
  if ((r.leaseExpiresAt as string) <= (r.leaseCheckedAt as string)) fail('invalid_trace');
  return freeze(r as unknown as NativeShortBodyOwnedGetRecoveryV2);
}

export function recoveryContextCopy(input: unknown): NativeShortBodyRecoveryContextV2 {
  const c = exact(copy(input, 32 * MIB), ['recovery', 'freshRead']),
    fresh = exact(c.freshRead, ['accountId', 'job', 'manifest', 'ref', 'document']);
  return freeze({
    recovery: recoveryShape(c.recovery),
    freshRead: fresh as unknown as NativeShortEvidenceContext,
  });
}

/** Replayed old stages remain v1. A separate v2 comparison must prove every historical effect. */
function historicalDerivedEffects(state: DurableState): void {
  const r = state.result;
  if (
    !state.baseline ||
    !state.plan ||
    !state.after ||
    !state.source ||
    !r ||
    r.outcome !== 'unknown' ||
    r.post.attempts !== 1 ||
    r.post.disposed !== 1 ||
    !r.post.acknowledged ||
    !state.stages.some((s) => s.kind === 'acknowledgement') ||
    !state.stages.some((s) => s.kind === 'after')
  )
    fail('durability_unverified');
  try {
    if (
      !storedBodyMath.compareReadback(
        storedBodyMath.upgradeExpectationForGetV2(state.baseline, state.plan),
        state.after,
      ).matches
    )
      fail('durability_unverified');
  } catch (error) {
    if (error instanceof NativeShortBodyProofError) throw error;
    sourceError(error);
  }
}

export function sameBodySourceBridge(
  laterInput: StoredBodySnapshot,
  originalInput: StoredBodySnapshot,
): boolean {
  const later = storedBodyMath.decodeSnapshot(laterInput.snapshot),
    original = storedBodyMath.decodeSnapshot(originalInput.snapshot);
  if (later.mode === original.mode) return same(later.snapshot, original.snapshot);
  if (original.mode !== 'legacy' || later.mode !== 'modern') fail('source_mismatch');
  const l = later.snapshot,
    o = original.snapshot;
  if (
    !same(
      { binding: l.binding, editData: l.native.editData, categoryData: l.native.categoryData },
      { binding: o.binding, editData: o.native.editData, categoryData: o.native.categoryData },
    )
  )
    return false;
  for (const key of [
    'scope',
    'representation',
    'hashBases',
    'document',
    'sourceParagraphs',
    'marker',
    'snapshotVersionHash',
    'catalogHash',
    'documentHash',
    'savedFieldsHash',
    'categorySelectionHash',
    'sourceVectorHash',
    'observedWireVectorHash',
    'bodyHash',
    'paragraphsHash',
    'markerHash',
    'coversHash',
  ] as const)
    if (!same(l[key], o[key])) return false;
  return true;
}

export function bridgeComparison(
  state: DurableState,
  expectation: NativeShortBodyPlan['expectation'],
  later: StoredBodySnapshot,
): NativeShortBodyComparison {
  if (!state.baseline) fail('source_mismatch');
  if (
    later.mode !== state.baseline.mode &&
    !(state.baseline.mode === 'legacy' && later.mode === 'modern')
  )
    fail('source_mismatch');
  return storedBodyMath.compareReadback(expectation, later);
}

export function checkedRecovery(
  state: DurableState,
  a: NativeShortBodyOriginalAudit,
  input: NativeShortBodyRecoveryContextV2,
): NativeShortBodyRecoveryContextV2 {
  const c = recoveryContextCopy(input),
    r = c.recovery,
    f = c.freshRead,
    j = f.job,
    m = f.manifest;
  if (
    !j ||
    !m ||
    r.originalOwnerId !== state.context.job.ownerId ||
    r.leaseOwnerId !== j.ownerId ||
    r.freshReadJobId !== j.id ||
    r.freshReadManifestId !== m.id ||
    r.freshReadJobHash !== nativeShortBodyGraphHash(j) ||
    r.freshReadManifestHash !== nativeShortBodyGraphHash(m) ||
    !same(r.freshReadEvidence, bodyRefLink(f.ref))
  )
    fail('source_mismatch');
  exact(j, BODY_JOB_KEYS);
  exact(m, BODY_MANIFEST_KEYS);
  uuid(j.id);
  uuid(j.ownerId);
  uuid(m.id);
  if (
    f.accountId !== a.accountId ||
    j.id === a.originalJobId ||
    j.ownerId === r.originalOwnerId ||
    j.error !== null ||
    j.cancellationRequestedAt !== null ||
    j.cancellationReason !== null ||
    j.platformWriteStartedAt !== null ||
    j.endedAt === null ||
    j.updatedAt !== j.endedAt ||
    j.metadata.explicitBodyRead !== true ||
    !same(j.target, a.target) ||
    j.requestedAt <= a.priorEndedAt ||
    j.platformReadStartedAt === null ||
    j.platformReadStartedAt <= a.priorEndedAt
  )
    fail('source_mismatch');
  if (boundedCount(j.timeoutMs, 2_147_483_647) < 1) fail('invalid_trace');
  if (j.deadlineAt !== null) {
    time(j.deadlineAt);
    if (j.startedAt === null || j.deadlineAt < j.startedAt) fail('invalid_trace');
  }
  verifyBodyRef(f.ref, f.document, a.accountId, j.id);
  let wrapper;
  try {
    wrapper = validateNativeShortEvidenceContext(f.document.payload, f);
  } catch (error) {
    sourceError(error);
  }
  if (
    wrapper.source.mode !== state.source?.mode ||
    wrapper.provenance.mode !== state.source?.mode ||
    wrapper.provenance.executor !==
      (state.source?.mode === 'live'
        ? 'application-default-browser/v1'
        : 'dependency-injected-browser/v1') ||
    f.document.collectionMode !== state.source?.mode ||
    !wrapper.result.snapshot
  )
    fail('source_mismatch');
  ordered([
    a.priorEndedAt,
    j.requestedAt,
    j.startedAt,
    j.platformReadStartedAt,
    wrapper.result.proof.readStartedAt,
    wrapper.result.proof.readFinishedAt,
    wrapper.result.cleanup.checkedAt,
    wrapper.result.proof.proofCapturedAt,
    f.ref.capturedAt,
    j.endedAt,
    r.leaseCheckedAt,
  ]);
  historicalDerivedEffects(state);
  const metadata = wrapper.result.snapshot;
  if (!Object.hasOwn(metadata, 'statusFacts')) fail('source_mismatch');
  const fresh = storedNative({
    binding: metadata.binding,
    editData: metadata.editData,
    categoryData: metadata.categoryData,
    statusFacts: Object.getOwnPropertyDescriptor(metadata, 'statusFacts')!.value,
  });
  if (fresh.mode !== 'modern' || !fresh.snapshot.native.statusFacts.draftEditable)
    fail('source_mismatch');
  const observed = fresh.snapshot;
  if (
    !sameBodySourceBridge(storedBodyMath.decodeSnapshot(observed), state.after!) ||
    !compareNativeShortBodyReadback(
      storedBodyMath.upgradeExpectationForGetV2(state.baseline!, state.plan!),
      observed,
    ).matches
  )
    fail('source_mismatch');
  return c;
}
