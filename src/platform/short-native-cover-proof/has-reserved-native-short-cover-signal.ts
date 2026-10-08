import {
  NATIVE_SHORT_COVER_OPERATION,
  exact,
  copy,
  fail,
  same,
  time,
  order,
  integer,
  type NativeShortCoverBusinessInput,
  type AuditHeld,
  nativeShortCoverWriteRequest,
  type NativeShortCoverEvidenceContext,
  type NativeShortCoverStage,
  type Data,
  type AuditResult,
  type NativeShortCoverWriteResultEvidence,
} from './fail.js';

import {
  type NativeShortMetadataSnapshot,
  createNativeShortMetadataSnapshot,
} from '../short-native-metadata.js';

import { type StoredMetadataSnapshot, storedCoverMath } from '../short-native-legacy-codec.js';

import { type NativeShortMetadataWriteReadPhase } from '../short-native-metadata-api.js';

import {
  type NativeShortCoverPhase,
  type NativeShortCoverAcknowledgement,
  type NativeShortCoverHeldIntent,
} from '../short-native-cover-api.js';

import {
  validateNativeShortCoverAsset,
  type NativeShortCoverPlan,
  NATIVE_SHORT_COVER_SCOPE,
  NATIVE_SHORT_COVER_HASH_BASES,
} from '../short-native-cover.js';

import { type NativeShortProvenance } from '../short-native-metadata-proof.js';

/** Recognize the namespace before generic projections, including accessor descriptors and failed loads. */
export function hasReservedNativeShortCoverSignal(input: unknown): boolean {
  const pending: unknown[] = [input],
    seen = new Set<object>();
  let nodes = 0;
  try {
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      if (++nodes > 200_000) return true;
      seen.add(value);
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (
          ['schema', 'scope', 'snapshotScope', 'operation', 'dataset', 'datasets'].includes(key) &&
          !Object.hasOwn(descriptor, 'value')
        )
          return true;
        if (!Object.hasOwn(descriptor, 'value')) continue;
        const child = descriptor.value;
        const reserved = (s: unknown) =>
          typeof s === 'string' &&
          (s.startsWith('native-short-cover-') ||
            s.startsWith('fanqie-short-native-cover-') ||
            s.startsWith('short_native_cover') ||
            s.startsWith('short-native-recommended-cover/') ||
            s === NATIVE_SHORT_COVER_OPERATION);
        if (
          ['schema', 'scope', 'snapshotScope', 'operation', 'dataset', 'datasets'].includes(key) &&
          (reserved(child) ||
            (Array.isArray(child) &&
              Object.values(Object.getOwnPropertyDescriptors(child)).some(
                (d) => Object.hasOwn(d, 'value') && reserved(d.value),
              )))
        )
          return true;
        if (child && typeof child === 'object') pending.push(child);
      }
    }
    return false;
  } catch {
    return true;
  }
}

export function snapshot(value: unknown): NativeShortMetadataSnapshot {
  const s = exact(copy(value), [
    'scope',
    'hashBases',
    'binding',
    'editData',
    'categoryData',
    'responseBinding',
    'state',
    'catalog',
    'savedFields',
    'snapshotVersionHash',
    'catalogHash',
    'documentHash',
    'savedFieldsHash',
    'categorySelectionHash',
    'statusFacts',
  ]);
  let rebuilt: NativeShortMetadataSnapshot;
  try {
    rebuilt = createNativeShortMetadataSnapshot({
      binding: s.binding,
      editData: s.editData,
      categoryData: s.categoryData,
    });
  } catch {
    fail();
  }
  if (!same(s, rebuilt)) fail();
  return rebuilt;
}

export function storedSnapshot(
  value: unknown,
  mode?: StoredMetadataSnapshot['mode'] | null,
): StoredMetadataSnapshot {
  try {
    const decoded = storedCoverMath.decodeSnapshot(value);
    if (mode && decoded.mode !== mode) fail();
    return decoded;
  } catch {
    fail();
  }
}

/** Held reads are intermediate fixed reads, never fabricated closed C1 reads. */
export function readPhase(input: unknown, complete: boolean): NativeShortMetadataWriteReadPhase {
  const d = exact(input, ['proof', 'requests', 'list']),
    p = exact(d.proof, [
      'platformStarted',
      'ownerBefore',
      'ownerAfter',
      'fixedSourceVerified',
      'targetUnique',
      'paginationComplete',
      'atomicRevision',
      'readStartedAt',
      'readFinishedAt',
      'proofCapturedAt',
    ]);
  if (p.atomicRevision !== false) fail();
  for (const k of [
    'platformStarted',
    'ownerBefore',
    'ownerAfter',
    'fixedSourceVerified',
    'targetUnique',
    'paginationComplete',
  ])
    if (typeof p[k] !== 'boolean' || (complete && !p[k])) fail();
  for (const k of ['readStartedAt', 'readFinishedAt', 'proofCapturedAt'])
    if (p[k] !== null || complete) time(p[k]);
  if (complete) order([p.readStartedAt, p.readFinishedAt, p.proofCapturedAt]);
  const list = exact(d.list, ['pagesRead', 'rowsRead', 'totalCount']),
    pages = integer(list.pagesRead, 10),
    rows = integer(list.rowsRead, 100);
  if (list.totalCount !== null) integer(list.totalCount, 100);
  if (complete && (rows < 1 || rows !== list.totalCount || pages !== Math.ceil(rows / 10))) fail();
  const requests = exact(d.requests, ['own', 'list', 'edit', 'catalog']);
  for (const [k, max] of [
    ['own', 2],
    ['list', 10],
    ['edit', 1],
    ['catalog', 1],
  ] as const) {
    const c = exact(requests[k], ['attempts', 'disposed']);
    integer(c.attempts, max);
    integer(c.disposed, max);
    if (
      c.disposed > c.attempts ||
      (complete && (c.attempts !== (k === 'list' ? pages : max) || c.disposed !== c.attempts))
    )
      fail();
  }
  return d as NativeShortMetadataWriteReadPhase;
}

export function held(
  input: unknown,
  phase: NativeShortCoverPhase,
  business: NativeShortCoverBusinessInput,
  baseline?: AuditHeld,
  ack?: NativeShortCoverAcknowledgement,
): AuditHeld {
  const h = exact(input, [
    'schema',
    'phase',
    'snapshot',
    'businessRequest',
    'uploadIntent',
    'expectation',
    'uploadAcknowledgement',
    'desiredContentHash',
    'read',
    'checkedAt',
  ]);
  if (
    h.schema !== 'native-short-cover-held-intent/v1' ||
    h.phase !== phase ||
    !same(h.businessRequest, nativeShortCoverWriteRequest(business))
  )
    fail();
  const decoded = storedSnapshot(
      h.snapshot,
      baseline ? storedSnapshot(baseline.snapshot).mode : null,
    ),
    s = decoded.snapshot,
    asset = validateNativeShortCoverAsset(h.uploadIntent.asset);
  const intent = storedCoverMath.createUploadIntent(decoded, {
    expectedSnapshotVersionHash: business.expectedSnapshotVersionHash,
    hashBasis: business.hashBasis,
    expectedState: business.expectedState,
    asset,
  });
  if (
    s.binding.work.id !== business.target.workId ||
    asset.sourceSha256 !== business.cover.sha256 ||
    asset.policy.fit !== (business.cover.fit ?? 'cover') ||
    !same(h.uploadIntent, intent)
  )
    fail();
  readPhase(h.read, true);
  order([h.read.proof.proofCapturedAt, h.checkedAt]);
  if (phase === 'upload') {
    if (h.expectation !== null || h.uploadAcknowledgement !== null || h.desiredContentHash !== null)
      fail();
  } else {
    if (
      !baseline ||
      !ack ||
      !same(intent, baseline.uploadIntent) ||
      !same(h.uploadAcknowledgement, ack)
    )
      fail();
    storedCoverMath.assertPreSave(decoded, baseline.uploadIntent);
    const plan = storedCoverMath.planSave(decoded, intent, {
      picUri: ack.picUri!,
      picUrl: ack.picUrl!,
    });
    if (!same(h.expectation, plan.expectation) || h.desiredContentHash !== plan.desiredContentHash)
      fail();
  }
  return h as AuditHeld;
}

export function modernHeld(
  input: unknown,
  phase: NativeShortCoverPhase,
  business: NativeShortCoverBusinessInput,
  baseline?: AuditHeld,
  ack?: NativeShortCoverAcknowledgement,
): NativeShortCoverHeldIntent {
  const h = exact(copy(input), [
    'schema',
    'phase',
    'snapshot',
    'businessRequest',
    'uploadIntent',
    'expectation',
    'uploadAcknowledgement',
    'desiredContentHash',
    'read',
    'checkedAt',
  ]);
  snapshot(h.snapshot);
  if (baseline) snapshot(baseline.snapshot);
  return held(h, phase, business, baseline, ack) as NativeShortCoverHeldIntent;
}

export interface State {
  context: NativeShortCoverEvidenceContext;
  mode: StoredMetadataSnapshot['mode'] | null;
  kinds: NativeShortCoverStage[];
  payloads: Data[];
  baseline: AuditHeld | null;
  business: NativeShortCoverBusinessInput | null;
  provenance: NativeShortProvenance | null;
  uploadAck: NativeShortCoverAcknowledgement | null;
  preSave: AuditHeld | null;
  plan: NativeShortCoverPlan | null;
  after: AuditResult | null;
  result: NativeShortCoverWriteResultEvidence | null;
}

export function acknowledgement(
  input: unknown,
  phase: NativeShortCoverPhase,
  state: State,
): NativeShortCoverAcknowledgement {
  const a = exact(input, [
    'schema',
    'phase',
    'binding',
    'scope',
    'hashBases',
    'sourceVersionHash',
    'assetHash',
    'intentHash',
    'uploadAckHash',
    'preSaveVersionHash',
    'desiredContentHash',
    'acknowledgedAt',
    'picUri',
    'picUrl',
  ]);
  const h = state.baseline!,
    intent = h.uploadIntent;
  if (
    a.schema !== 'native-short-cover-acknowledgement-observation/v1' ||
    a.phase !== phase ||
    !same(a.binding, intent.binding) ||
    a.scope !== NATIVE_SHORT_COVER_SCOPE ||
    !same(a.hashBases, NATIVE_SHORT_COVER_HASH_BASES) ||
    a.sourceVersionHash !== intent.sourceVersionHash ||
    a.assetHash !== intent.assetHash ||
    a.intentHash !== intent.intentHash
  )
    fail();
  let plan: NativeShortCoverPlan;
  if (phase === 'upload') {
    if (a.preSaveVersionHash !== null) fail();
    plan = storedCoverMath.planSave(storedSnapshot(h.snapshot, state.mode), intent, {
      picUri: a.picUri,
      picUrl: a.picUrl,
    });
  } else {
    if (
      !state.preSave ||
      !state.plan ||
      a.picUri !== null ||
      a.picUrl !== null ||
      a.preSaveVersionHash !== state.preSave.snapshot.snapshotVersionHash
    )
      fail();
    plan = state.plan;
  }
  if (a.uploadAckHash !== plan.uploadAckHash || a.desiredContentHash !== plan.desiredContentHash)
    fail();
  time(a.acknowledgedAt);
  return a as NativeShortCoverAcknowledgement;
}
