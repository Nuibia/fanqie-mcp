import {
  type JobKind,
  RuntimeError,
  type RuntimeFailure,
  type EvidenceRef,
} from './runtime-error.js';

import { createHash } from 'node:crypto';

import * as bodyProof from '../../platform/short-native-body-proof.js';

import { type APIRequest } from 'playwright';

import {
  type NativeShortBodyExpectation,
  createNativeShortBodySnapshot,
} from '../../platform/short-native-body.js';

import { type NativeShortBodyAttemptPermit } from './authority.js';

import { createNativeShortMetadataSnapshot } from '../../platform/short-native-metadata.js';

import { validateShortStatusFacts } from '../../platform/short-status.js';

export const genericBindings: Record<string, string[]> = {
  create_draft: [
    'inputHash',
    'clientReferenceHash',
    'requestedContentHash',
    'requestedTitleHash',
    'requestedBodyHash',
  ],
  update_draft: ['inputHash', 'expectedContentHash', 'desiredContentHash'],
  resume_create_draft: [
    'accountId',
    'originalInputHash',
    'resumeInputHash',
    'clientReferenceHash',
    'requestedContentHash',
  ],
  repair_created_draft: [
    'accountId',
    'originalInputHash',
    'recoveryInputHash',
    'repairInputHash',
    'clientReferenceHash',
    'requestedContentHash',
    'desiredContentHash',
    'expectedContentHash',
    'requestedTitleHash',
    'requestedBodyHash',
  ],
  editable_snapshot: ['inputHash'],
  reconcile_write: ['inputHash', 'originalInputHash'],
};

export const genericStages = [
  'before_first_read',
  'allocation_marked',
  'baseline_saved',
  'precondition_blocked',
  'save_marked',
  'after_saved',
  'final_observed',
  'final_verified',
  'read_saved',
  'completed',
  'source_unavailable',
  'capture_failed',
  'persist_failed',
];

export interface NewJob {
  accountId: string;
  kind: JobKind;
  operation: string;
  scope?: string;
  datasets?: string[];
  idempotencyKey?: string;
  inputHash?: string;
  timeoutMs?: number;
}

export const timestamp = () => new Date().toISOString();

export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export const datasetName = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export interface NativeReconciliationRow {
  sequence: number;
  id: string;
  originalJobId: string;
  readJobId: string;
  evidenceId: string;
  status: string;
  createdAt: string;
  resultJson: string;
}

export const nativeReconciliationUnavailable = (): never => {
  throw new RuntimeError(
    'capability_unavailable',
    'Native short metadata reconciliation is unavailable.',
  );
};

export const sameNativeValue = (left: unknown, right: unknown) =>
  canonicalJson(left) === canonicalJson(right);

export const nativeCompensatedError: RuntimeFailure = {
  code: 'native_write_compensated',
  message:
    'The original write remains unverified; a separately authenticated compensation restored its original content.',
};

export const nativeRegistrationOperation = 'register_native_compensation_attestation';

export const nativeRegistrationDataset = 'native_compensation_attestation';

export const nativeRegistrationScope = (originalId: string) =>
  `${nativeRegistrationDataset}.${hash(originalId).slice(0, 32)}`;

export const nativeUnknownError: RuntimeFailure = {
  code: 'outcome_unknown',
  message: 'The later platform read still cannot determine the write outcome.',
};

export function nativeClosureSignal(value: unknown): boolean {
  const pending = [value],
    seen = new Set<object>();
  while (pending.length) {
    const item = pending.pop();
    if (item === null || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
      if (!Object.hasOwn(descriptor, 'value')) continue;
      if (
        name === 'schema' &&
        typeof descriptor.value === 'string' &&
        (descriptor.value.startsWith('native-short-metadata-closure') ||
          descriptor.value.startsWith('native-short-metadata-compensated-closure'))
      )
        return true;
      if (name !== 'length') pending.push(descriptor.value);
    }
  }
  return false;
}

/** Stable serialization rejects values which JSON would silently change or discard. */
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  function visit(item: unknown): unknown {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object' || item === null)
      throw new RuntimeError('invalid_json', 'Evidence must contain JSON values only.');
    if (seen.has(item))
      throw new RuntimeError('invalid_json', 'Evidence contains a circular reference.');
    seen.add(item);
    let output: unknown;
    if (Array.isArray(item)) output = item.map(visit);
    else {
      if (
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null
      ) {
        throw new RuntimeError('invalid_json', 'Evidence must use plain JSON objects.');
      }
      output = Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, visit((item as Record<string, unknown>)[key])]),
      );
    }
    seen.delete(item);
    return output;
  }
  return JSON.stringify(visit(value));
}

export interface NativeShortBodyAuthorityBinding {
  readonly mode: 'write' | 'reconcile';
  readonly accountId: string;
  readonly jobId: string;
  readonly workId: string;
  readonly inputHash: string;
  readonly expectedPlatformAccount: string;
  readonly source: bodyProof.NativeShortBodySource;
  readonly deadlineAt: string;
  readonly requestFactory: Pick<APIRequest, 'newContext'>;
  readonly reconciliationExpectation: NativeShortBodyExpectation | null;
  readonly reconciliationPolicy: 'native-short-body-derived-word-number/v2' | null;
  readonly recovery: bodyProof.NativeShortBodyOwnedGetRecoveryV2 | null;
  check(): void;
  beforeGet(): void;
  recordBaseline(native: unknown, read: unknown): bodyProof.NativeShortBodyRefLink;
  recordPreSave(native: unknown, read: unknown): bodyProof.NativeShortBodyRefLink;
  recordIntent(): bodyProof.NativeShortBodyRefLink;
  beginAttempt(transport: bodyProof.NativeShortBodyTransport): NativeShortBodyAttemptPermit;
  consumeAttempt(permit: NativeShortBodyAttemptPermit): bodyProof.NativeShortBodyRefLink;
  readCommittedAttempt(): bodyProof.NativeShortBodyRefLink | null;
  recordAcknowledgement(observation: unknown): bodyProof.NativeShortBodyRefLink;
  recordAfter(
    native: unknown | null,
    read: unknown,
    comparison: unknown | null,
  ): bodyProof.NativeShortBodyRefLink;
  recordResult(result: unknown): bodyProof.NativeShortBodyRefLink;
  recordReconciliation(input: unknown): bodyProof.NativeShortBodyRefLink;
}

export function bodyUnavailable(): never {
  throw new RuntimeError('capability_unavailable', 'Native short body is unavailable.');
}

function bodyStrict(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (typeof encoded !== 'string') return bodyUnavailable();
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(bodyStrict).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${bodyStrict((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}

export const bodyDigest = (value: unknown): string => hash(bodyStrict(value));

export const bodyLink = (ref: EvidenceRef): bodyProof.NativeShortBodyRefLink => ({
  id: ref.id,
  sha256: ref.sha256,
  capturedAt: ref.capturedAt,
});

export function bodyObject(input: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Object.getOwnPropertySymbols(input).length
  )
    return bodyUnavailable();
  const descriptors = Object.getOwnPropertyDescriptors(input),
    names = Object.keys(descriptors);
  if (
    keys &&
    (names.length !== keys.length || keys.some((key) => !Object.hasOwn(descriptors, key)))
  )
    return bodyUnavailable();
  const out: Record<string, unknown> = Object.create(null);
  for (const name of names) {
    const descriptor = descriptors[name]!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return bodyUnavailable();
    out[name] = descriptor.value;
  }
  return out;
}

export function bodyNative(input: unknown) {
  const native = bodyObject(input, ['binding', 'editData', 'categoryData', 'statusFacts']);
  const snapshot = createNativeShortBodySnapshot(
    createNativeShortMetadataSnapshot({
      binding: native.binding as Parameters<typeof createNativeShortMetadataSnapshot>[0]['binding'],
      editData: native.editData,
      categoryData: native.categoryData,
    }),
  );
  let facts;
  try {
    facts = validateShortStatusFacts(native.statusFacts);
  } catch {
    return bodyUnavailable();
  }
  if (!sameNativeValue(facts, snapshot.native.statusFacts)) return bodyUnavailable();
  return {
    snapshot,
    native: {
      binding: snapshot.binding,
      editData: snapshot.native.editData,
      categoryData: snapshot.native.categoryData,
      statusFacts: snapshot.native.statusFacts,
    },
  };
}

export interface ServiceLeaseLostSignal {
  readonly code: 'service_lease_lost';
}
