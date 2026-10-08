import {
  type NativeShortSubmissionBusinessInput as ModelBusiness,
  NATIVE_SHORT_SUBMISSION_SCOPE,
} from '../short-native-submission.js';

import {
  type Job,
  type Manifest,
  type EvidenceRef,
  type EvidenceDocument,
  canonicalJson,
} from '../../runtime/store.js';

import {
  type NativeShortMetadataSnapshot,
  NATIVE_SHORT_RESOURCE_LIMITS,
  createNativeShortMetadataSnapshot,
} from '../short-native-metadata.js';

import {
  type NativeShortSubmissionApiResult,
  NATIVE_SHORT_SUBMISSION_RECEIPT_HASH_BASES,
} from '../short-native-submission-api.js';

import { createHash } from 'node:crypto';

import {
  isCanonicalNativeTime,
  type NativeShortProvenance,
} from '../short-native-metadata-proof.js';

import { assertExpected } from './source-fields.js';

export const NATIVE_SHORT_SUBMISSION_OPERATION = 'submit_short_story' as const;

export const NATIVE_SHORT_SUBMISSION_READ_OPERATION = 'prepare_submission' as const;

export const NATIVE_SHORT_SUBMISSION_READ_DATASET = 'short_native_submission_preparation' as const;

export const nativeShortSubmissionScope = (id: string): string => `short_native_submission.${id}`;

export const NATIVE_SHORT_SUBMISSION_DATASETS = Object.freeze({
  baseline: 'short_native_submission_baseline',
  preSubmit: 'short_native_submission_pre_submit',
  intent: 'write-intent',
  attempt: 'short_native_submission_attempt',
  acknowledgement: 'short_native_submission_acknowledgement',
  after: 'short_native_submission_after',
  result: 'write-result',
  reconciliation: 'reconciliation',
});

export type NativeShortSubmissionStage = Exclude<
  keyof typeof NATIVE_SHORT_SUBMISSION_DATASETS,
  'reconciliation'
>;

export interface NativeShortSubmissionBusinessInput extends ModelBusiness {
  preparationJobId: string;
  acceptPublicationTerms: true;
}

export interface NativeShortSubmissionAttemptRow {
  jobId: string;
  accountId: string;
  ordinal: 1;
  evidence: { id: string; sha256: string; capturedAt: string };
  eventAt: string;
}

export interface NativeShortSubmissionPreparationContext {
  job: Job;
  manifest: Manifest;
  ref: EvidenceRef;
  document: EvidenceDocument;
}

export interface NativeShortSubmissionContext {
  accountId: string;
  job: Job;
  manifest: Manifest | null;
  refs: EvidenceRef[];
  documents: EvidenceDocument[];
  attempts: NativeShortSubmissionAttemptRow[];
  preparation?: NativeShortSubmissionPreparationContext | null;
}

export type NativeShortSubmissionEvidenceContext = NativeShortSubmissionContext;

export interface NativeShortSubmissionWriteResultEvidence {
  schema: 'native-short-submission-write-result/v1';
  scope: typeof NATIVE_SHORT_SUBMISSION_SCOPE;
  baselineEvidence: NativeShortSubmissionAttemptRow['evidence'];
  afterEvidence: NativeShortSubmissionAttemptRow['evidence'];
  business: Record<string, unknown>;
}

export interface NativeShortSubmissionProjection {
  validated: boolean;
  result: NativeShortSubmissionWriteResultEvidence | Record<string, unknown> | null;
  evidence: Record<string, unknown>[];
  data: Record<string, unknown>[];
  collectionMode: 'live' | 'fixture' | null;
}

export class NativeShortSubmissionProofError extends Error {
  constructor() {
    super('Native short submission did not meet the fixed evidence contract');
  }
}

export type Data = Record<string, any>;

export type AuditSnapshot = NativeShortMetadataSnapshot;

export type AuditResult = NativeShortSubmissionApiResult;

export const NATIVE_SHORT_SUBMISSION_HASH_BASES = NATIVE_SHORT_SUBMISSION_RECEIPT_HASH_BASES;

export const WORK = /^[1-9][0-9]{9,21}$/,
  UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
  HASH = /^[a-f0-9]{64}$/;

export const STAGES: NativeShortSubmissionStage[] = [
  'baseline',
  'preSubmit',
  'intent',
  'attempt',
  'acknowledgement',
  'after',
  'result',
];

export const ORIGIN = 'https://fanqienovel.com';

export function fail(): never {
  throw new NativeShortSubmissionProofError();
}

export const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

export const hash = (a: unknown) => createHash('sha256').update(canonicalJson(a)).digest('hex');

const bytesHash = (a: string) => createHash('sha256').update(a).digest('hex');

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
  // Full source snapshots recur in the immutable prepared/plan/held graph.
  // A large private graph has its own bounded extent, never a reduced source budget.
  const nodeBudget =
    (limit <= 512 * 1024 ? 4 : limit <= 64 * 1024 * 1024 ? 16 : 48) *
    NATIVE_SHORT_RESOURCE_LIMITS.nodes;
  function visit(value: unknown, depth: number): unknown {
    if (++nodes > nodeBudget || depth > NATIVE_SHORT_RESOURCE_LIMITS.depth + 8) fail();
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

export function nativeSnapshot(value: unknown): NativeShortMetadataSnapshot {
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

export function verifyRef(
  ref: EvidenceRef,
  document: EvidenceDocument,
  accountId: string,
  jobId: string,
): void {
  exact(ref, ['id', 'accountId', 'jobId', 'dataset', 'capturedAt', 'path', 'sha256']);
  exact(document, [
    'schemaVersion',
    'evidenceId',
    'accountId',
    'jobId',
    'dataset',
    'capturedAt',
    'collectionMode',
    'evidenceKind',
    'payload',
  ]);
  if (
    !UUID.test(ref.id) ||
    !HASH.test(ref.sha256) ||
    typeof ref.path !== 'string' ||
    ref.accountId !== accountId ||
    ref.jobId !== jobId ||
    document.schemaVersion !== 1 ||
    document.evidenceId !== ref.id ||
    document.accountId !== accountId ||
    document.jobId !== jobId ||
    document.dataset !== ref.dataset ||
    document.capturedAt !== ref.capturedAt ||
    !['live', 'fixture'].includes(document.collectionMode) ||
    document.evidenceKind !== (ref.dataset === 'write-intent' ? 'local-intent' : 'observation')
  )
    fail();
  time(ref.capturedAt);
  if (
    ref.capturedAt > new Date().toISOString() ||
    bytesHash(`${canonicalJson(document)}\n`) !== ref.sha256
  )
    fail();
}
