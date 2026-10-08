import { type StoredBodySnapshot } from '../short-native-legacy-codec.js';

import {
  fail,
  type NativeShortBodyFixtureStageKind,
  type Data,
  native,
  hash,
  copy,
  MIB,
  type NativeShortBodyFixtureStageEvidence,
  exact,
  STAGE_KEYS,
  KINDS,
  count,
  time,
  digest,
  PAYLOAD_KEYS,
  freeze,
  type NativeShortBodyFixtureTrace,
  type Reason,
} from './fail.js';

import {
  NATIVE_SHORT_BODY_COMPARISON_POLICY_V2,
  nativeShortBodyHashBasesForRequest,
} from '../short-native-body.js';

export function sameMode(
  snapshot: StoredBodySnapshot,
  baseline: StoredBodySnapshot,
): StoredBodySnapshot {
  if (snapshot.mode !== baseline.mode) fail('source_mismatch');
  return snapshot;
}

export function assertModernStage(kind: NativeShortBodyFixtureStageKind, payload: Data): void {
  if (
    !['baseline', 'preSave', 'after'].includes(kind) ||
    (payload.native === null && kind === 'after')
  )
    return;
  const snapshot = native(payload.native);
  if ((kind === 'baseline' || kind === 'preSave') && !snapshot.native.statusFacts.draftEditable)
    fail('source_mismatch');
}

export function nativeShortBodyHashBasesHash(request?: {
  readonly comparisonPolicy?: typeof NATIVE_SHORT_BODY_COMPARISON_POLICY_V2;
}): string {
  return hash({
    schema:
      request?.comparisonPolicy === undefined
        ? 'native-short-body-fixed-hash-bases/v1'
        : 'native-short-body-fixed-hash-bases/v2',
    hashBases: nativeShortBodyHashBasesForRequest(request),
  });
}

/** Fixed canonical UTF-8 graph digest; accepts no getter or caller serializer. */
export function nativeShortBodyGraphHash(value: unknown): string {
  return hash(copy(value, 32 * MIB));
}

export function capturedFixtureStage(input: unknown): NativeShortBodyFixtureStageEvidence {
  const d = exact(copy(input, 16 * MIB), STAGE_KEYS);
  if (
    d.schema !== 'native-short-body-fixture-stage/v1' ||
    typeof d.kind !== 'string' ||
    !KINDS.includes(d.kind as NativeShortBodyFixtureStageKind)
  )
    fail('invalid_shape');
  const kind = d.kind as NativeShortBodyFixtureStageKind;
  const sequence = count(d.sequence);
  if (sequence < 1 || sequence > 7) fail('invalid_trace');
  time(d.eventAt);
  if (d.priorStageHash !== null) digest(d.priorStageHash);
  exact(d.payload, PAYLOAD_KEYS[kind]);
  return freeze(d as unknown as NativeShortBodyFixtureStageEvidence);
}

export function createNativeShortBodyFixtureStageEvidence(
  input: unknown,
): NativeShortBodyFixtureStageEvidence {
  const stage = capturedFixtureStage(input);
  assertModernStage(stage.kind, stage.payload as Data);
  return stage;
}

export interface Cleanup {
  sessionCreated: boolean;
  sessionDisposed: boolean;
  disposalFailures: number;
  pendingAtEnd: number;
  quarantined: boolean;
  checkedAt: string;
}

export function cleanup(input: unknown, resultAt: string, priorAt: string | null): Cleanup {
  const d = exact(input, [
    'sessionCreated',
    'sessionDisposed',
    'disposalFailures',
    'pendingAtEnd',
    'quarantined',
    'checkedAt',
  ]);
  if (
    typeof d.sessionCreated !== 'boolean' ||
    typeof d.sessionDisposed !== 'boolean' ||
    typeof d.quarantined !== 'boolean' ||
    (d.sessionDisposed && !d.sessionCreated)
  )
    fail('invalid_trace');
  const checkedAt = time(d.checkedAt);
  if (checkedAt > resultAt || (priorAt !== null && checkedAt < priorAt)) fail('invalid_trace');
  return {
    sessionCreated: d.sessionCreated,
    sessionDisposed: d.sessionDisposed,
    disposalFailures: count(d.disposalFailures),
    pendingAtEnd: count(d.pendingAtEnd),
    quarantined: d.quarantined,
    checkedAt,
  };
}

export function clean(d: Cleanup): boolean {
  return (
    d.sessionCreated &&
    d.sessionDisposed &&
    d.disposalFailures === 0 &&
    d.pendingAtEnd === 0 &&
    !d.quarantined
  );
}

export interface Inspected {
  trace: NativeShortBodyFixtureTrace;
  hashes: string[];
  baseline: boolean;
  preSave: boolean;
  attempted: boolean;
  acknowledged: boolean;
  after: boolean;
  matched: boolean;
  final: { outcome: string; reason: Reason; cleanup: Cleanup } | null;
}

export const NEXT: Record<
  NativeShortBodyFixtureStageKind,
  readonly NativeShortBodyFixtureStageKind[]
> = {
  baseline: ['preSave', 'result'],
  preSave: ['intent', 'result'],
  intent: ['attempt', 'result'],
  attempt: ['acknowledgement', 'after', 'result'],
  acknowledgement: ['after', 'result'],
  after: ['result'],
  result: [],
};
