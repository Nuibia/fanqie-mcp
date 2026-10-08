import {
  NATIVE_SHORT_TRIAL_SCOPE,
  type NativeShortTrialWriteRequest,
  type NativeShortTrialSnapshot,
  type LegacyNativeShortTrialSnapshot,
} from '../short-native-trial.js';

import {
  NATIVE_SHORT_HASH_BASES,
  NATIVE_SHORT_RESOURCE_LIMITS,
  type NativeShortMetadataSnapshot,
  createNativeShortMetadataSnapshot,
} from '../short-native-metadata.js';

import {
  type Job,
  type Manifest,
  type EvidenceRef,
  type EvidenceDocument,
  canonicalJson,
} from '../../runtime/store.js';

import {
  type NativeShortTrialHeldIntent,
  type NativeShortTrialApiResult,
} from '../short-native-trial-api.js';

import { createHash } from 'node:crypto';

import {
  isCanonicalNativeTime,
  type NativeShortProvenance,
} from '../short-native-metadata-proof.js';

import { assertExpected } from './read-phase.js';

export const NATIVE_SHORT_TRIAL_OPERATION = 'update_short_trial' as const;

export const NATIVE_SHORT_TRIAL_READ_OPERATION = 'native_short_trial_snapshot' as const;

export const NATIVE_SHORT_TRIAL_READ_DATASET = 'short_native_trial' as const;

export const nativeShortTrialScope = (workId: string): string => `short_native_trial.${workId}`;

export const nativeShortTrialReadInputHash = (workId: string): string => hash({ workId });

export const NATIVE_SHORT_TRIAL_DATASETS = Object.freeze({
  baseline: 'short_native_trial_baseline',
  preSave: 'short_native_trial_pre_save',
  intent: 'write-intent',
  attempt: 'short_native_trial_attempt',
  acknowledgement: 'short_native_trial_acknowledgement',
  after: 'short_native_trial_after',
  result: 'write-result',
  reconciliation: 'reconciliation',
});

export type NativeShortTrialStage = Exclude<
  keyof typeof NATIVE_SHORT_TRIAL_DATASETS,
  'reconciliation'
>;

export interface NativeShortTrialBusinessInput {
  target: { kind: 'short'; workId: string };
  snapshotScope: typeof NATIVE_SHORT_TRIAL_SCOPE;
  hashBasis: typeof NATIVE_SHORT_HASH_BASES.snapshot;
  expectedSnapshotVersionHash: string;
  expectedState: 'draft';
  metadata: NativeShortTrialWriteRequest['metadata'];
}

export interface NativeShortTrialAttemptRow {
  jobId: string;
  accountId: string;
  ordinal: 1;
  evidence: { id: string; sha256: string; capturedAt: string };
  eventAt: string;
}

export interface NativeShortTrialEvidenceContext {
  accountId: string;
  job: Job;
  manifest: Manifest | null;
  refs: EvidenceRef[];
  documents: EvidenceDocument[];
  attempts: NativeShortTrialAttemptRow[];
}

export type NativeShortTrialContext = NativeShortTrialEvidenceContext;

export interface NativeShortTrialWriteResultEvidence {
  schema: 'native-short-trial-write-result/v1';
  scope: typeof NATIVE_SHORT_TRIAL_SCOPE;
  baselineEvidence: NativeShortTrialAttemptRow['evidence'];
  afterEvidence: NativeShortTrialAttemptRow['evidence'];
  business: Record<string, unknown>;
}

export interface NativeShortTrialProjection {
  validated: boolean;
  result: NativeShortTrialWriteResultEvidence | Record<string, unknown> | null;
  evidence: Record<string, unknown>[];
  data: Record<string, unknown>[];
  collectionMode: 'live' | 'fixture' | null;
}

export class NativeShortTrialProofError extends Error {
  constructor() {
    super('Native short trial did not meet the fixed evidence contract');
  }
}

export type Data = Record<string, any>;

export type AuditSnapshot = NativeShortTrialSnapshot | LegacyNativeShortTrialSnapshot;

export type AuditHeld = Omit<NativeShortTrialHeldIntent, 'snapshot' | 'beforeSnapshot'> & {
  readonly snapshot: AuditSnapshot;
  readonly beforeSnapshot: AuditSnapshot;
};

export type AuditSave = Omit<NativeShortTrialApiResult['save'], 'held'> & {
  held: AuditHeld | null;
};

export type AuditResult = Omit<NativeShortTrialApiResult, 'snapshot' | 'snapshots' | 'save'> & {
  snapshot: AuditSnapshot | null;
  snapshots: {
    before: AuditSnapshot | null;
    preSave: AuditSnapshot | null;
    after: AuditSnapshot | null;
  };
  save: AuditSave;
};

export const WORK = /^[1-9][0-9]{9,21}$/,
  UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
  HASH = /^[a-f0-9]{64}$/;

export const STAGES: NativeShortTrialStage[] = [
  'baseline',
  'preSave',
  'intent',
  'attempt',
  'acknowledgement',
  'after',
  'result',
];

export const ORIGIN = 'https://fanqienovel.com';

export function fail(): never {
  throw new NativeShortTrialProofError();
}

export const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

export const hash = (a: unknown) => createHash('sha256').update(canonicalJson(a)).digest('hex');

export const bytesHash = (a: string) => createHash('sha256').update(a).digest('hex');

export const refLink = (ref: EvidenceRef) => ({
  id: ref.id,
  sha256: ref.sha256,
  capturedAt: ref.capturedAt,
});

export function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Every caller value is copied through descriptors; no getter, coercion or toJSON is evaluated. */
export function copy(input: unknown, limit = 16 * 1024 * 1024): any {
  let nodes = 0,
    size = 0;
  const active = new Set<object>();
  function visit(value: unknown, depth: number): unknown {
    if (
      ++nodes > 4 * NATIVE_SHORT_RESOURCE_LIMITS.nodes ||
      depth > NATIVE_SHORT_RESOURCE_LIMITS.depth + 8
    )
      fail();
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Object.is(value, -0)) fail();
      return value;
    }
    if (typeof value === 'string') {
      if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value))
        fail();
      size += Buffer.byteLength(value);
      if (size > limit) fail();
      return value;
    }
    if (!value || typeof value !== 'object' || active.has(value)) fail();
    const array = Array.isArray(value),
      proto = Object.getPrototypeOf(value);
    if (
      (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) ||
      Object.getOwnPropertySymbols(value).length
    )
      fail();
    const descriptors = Object.getOwnPropertyDescriptors(value),
      keys = Object.keys(descriptors).filter((key) => !array || key !== 'length');
    if (
      keys.some(
        (key) => !Object.hasOwn(descriptors[key]!, 'value') || !descriptors[key]!.enumerable,
      ) ||
      (array &&
        (keys.length !== descriptors.length!.value || keys.some((key, i) => key !== String(i))))
    )
      fail();
    active.add(value);
    const out: any = array ? [] : Object.create(null);
    for (const key of keys) {
      size += Buffer.byteLength(key);
      if (size > limit) fail();
      out[key] = visit(descriptors[key]!.value, depth + 1);
    }
    active.delete(value);
    return out;
  }
  try {
    const out = visit(input, 0);
    if (Buffer.byteLength(JSON.stringify(out)) > limit) fail();
    return out;
  } catch {
    fail();
  }
}

export function object(value: unknown): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Data;
}

export function exact(value: unknown, keys: readonly string[]): Data {
  const data = object(value);
  if (
    Object.keys(data).length !== keys.length ||
    Object.keys(data).some((key) => !keys.includes(key))
  )
    fail();
  return data;
}

export function time(value: unknown): string {
  if (!isCanonicalNativeTime(value) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    fail();
  return value;
}

export function order(values: unknown[]): void {
  let prior = '';
  for (const value of values) {
    const next = time(value);
    if (next < prior) fail();
    prior = next;
  }
}

export function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) fail();
  return value;
}

export function provenance(value: unknown): NativeShortProvenance {
  const p = exact(value, ['executor', 'mode']);
  if (
    !['live', 'fixture'].includes(p.mode) ||
    p.executor !==
      (p.mode === 'live' ? 'application-default-browser/v1' : 'dependency-injected-browser/v1')
  )
    fail();
  return p as NativeShortProvenance;
}

function nativeSnapshot(value: unknown): NativeShortMetadataSnapshot {
  const s = exact(value, [
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
  assertExpected(s, rebuilt);
  return rebuilt;
}
