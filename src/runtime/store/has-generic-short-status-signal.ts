import {
  type Job,
  type EvidenceRef,
  type EvidenceDocument,
  type Manifest,
  RuntimeError,
  type GenericShortPublicationTuple,
} from './runtime-error.js';

import { genericBindings, canonicalJson, hash } from './native-closure-signal.js';

import { captureShortStatusJson } from '../../platform/short-status.js';

export function hasGenericShortStatusSignal(input: unknown): boolean {
  const pending = [input],
    seen = new Set<object>();
  let nodes = 0;
  while (pending.length) {
    if (++nodes > 200_000) return true;
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!Object.hasOwn(d, 'value')) continue;
      if (
        [
          'statusProtocol',
          'shortObservation',
          'statusInput',
          'statusFacts',
          'statusProof',
          'genericShortStatus',
        ].includes(key) ||
        (key === 'schema' &&
          typeof d.value === 'string' &&
          /^(fanqie-generic-short-|generic-short-write-|generic-short-terminal-)/.test(d.value))
      )
        return true;
      if (key !== 'length') pending.push(d.value);
    }
  }
  return false;
}

// Namespace selection alone exempts the direct management-facts slot in
// actual short_works records. The global reserved-marker detector is unchanged.
export function hasGenericShortExecutionSignal(
  job: Job | null,
  refs: readonly EvidenceRef[],
  documents: readonly EvidenceDocument[],
  manifest: Manifest | null = null,
): boolean {
  const managementRows = new Set<object>();
  if (
    job?.kind === 'read' &&
    !Object.hasOwn(genericBindings, job.operation) &&
    job.datasets.includes('short_works')
  ) {
    for (const document of documents) {
      const ref = refs.find(
        (value) =>
          value.id === document.evidenceId &&
          value.dataset === 'short_works' &&
          value.jobId === job.id &&
          value.accountId === job.accountId &&
          value.capturedAt === document.capturedAt,
      );
      if (
        !ref ||
        document.dataset !== 'short_works' ||
        document.jobId !== job.id ||
        document.accountId !== job.accountId ||
        !document.payload ||
        typeof document.payload !== 'object' ||
        Array.isArray(document.payload)
      )
        continue;
      const records = Object.getOwnPropertyDescriptor(document.payload, 'records');
      if (!records || !Object.hasOwn(records, 'value') || !Array.isArray(records.value)) continue;
      if (records.value.length > 200_000) return true;
      for (const row of records.value)
        if (
          row &&
          typeof row === 'object' &&
          !Array.isArray(row) &&
          Object.getPrototypeOf(row) === Object.prototype
        )
          managementRows.add(row);
    }
  }
  const pending: unknown[] = [job, manifest, refs, documents],
    seen = new Set<object>();
  let nodes = 0;
  while (pending.length) {
    if (++nodes > 200_000) return true;
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!Object.hasOwn(d, 'value')) continue;
      if (
        ([
          'statusProtocol',
          'shortObservation',
          'statusInput',
          'statusFacts',
          'statusProof',
          'genericShortStatus',
        ].includes(key) &&
          !(key === 'statusFacts' && managementRows.has(value))) ||
        (key === 'schema' &&
          typeof d.value === 'string' &&
          /^(fanqie-generic-short-|generic-short-write-|generic-short-terminal-)/.test(d.value))
      )
        return true;
      if (key !== 'length') pending.push(d.value); // Other markers inside facts remain reserved.
    }
  }
  return false;
}

export function hasGenericShortPublicationContext(
  job: Job | null,
  refs: readonly EvidenceRef[],
  documents: readonly EvidenceDocument[],
  manifest: Manifest | null = null,
): boolean {
  if (hasGenericShortExecutionSignal(job, refs, documents, manifest)) return true;
  if (!job) return false;
  const modernOperation = Object.hasOwn(genericBindings, job.operation),
    legacyWrite =
      job.kind === 'write' &&
      ['update_work_metadata', 'submit_short_story'].includes(job.operation);
  if (!modernOperation && !legacyWrite) return false;
  if (modernOperation && job.target?.kind === 'short-story') return true;
  if (job.kind !== 'read' && !legacyWrite) return false;
  return documents.some((document) => {
    const ref = refs.find(
      (value) =>
        value.id === document.evidenceId &&
        value.jobId === job.id &&
        value.accountId === job.accountId &&
        value.dataset === document.dataset &&
        value.capturedAt === document.capturedAt,
    );
    if (!ref || document.jobId !== job.id || document.accountId !== job.accountId) return false;
    if (legacyWrite) {
      if (
        job.target?.kind !== 'short-story' ||
        !['write-intent', 'write-result'].includes(ref.dataset)
      )
        return false;
      // The actual operation, SQL target and durable role select the namespace;
      // full qualification rejects a missing or mismatched payload target.
      return true;
    }
    if (
      ref.dataset !==
      (job.operation === 'editable_snapshot'
        ? 'editable_snapshot'
        : job.operation === 'reconcile_write'
          ? 'reconciliation'
          : null)
    )
      return false;
    const payload = genericObject(document.payload),
      snapshot = payload.snapshot === undefined ? null : genericObject(payload.snapshot),
      reconciliation =
        payload.reconciliation === undefined ? null : genericObject(payload.reconciliation);
    // The old standalone D9 stores the snapshot itself, including its target.
    const standalone =
      job.operation === 'editable_snapshot' && payload.target !== undefined
        ? genericObject(payload.target)
        : null;
    return (
      standalone?.kind === 'short' ||
      (snapshot !== null && genericObject(snapshot.target).kind === 'short') ||
      (reconciliation !== null && genericObject(reconciliation.target).kind === 'short-story')
    );
  });
}

export const genericUnavailable = (): never => {
  throw new RuntimeError(
    'capability_unavailable',
    'Generic short publication status is unavailable.',
  );
};

export function genericObject(
  value: unknown,
  keys?: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  let out: Record<string, unknown>;
  try {
    out = captureShortStatusJson(value) as Record<string, unknown>;
  } catch {
    return genericUnavailable();
  }
  if (
    !out ||
    typeof out !== 'object' ||
    Array.isArray(out) ||
    (keys &&
      (keys.some((key) => !Object.hasOwn(out, key)) ||
        Object.keys(out).some((key) => !keys.includes(key) && !optional.includes(key))))
  )
    return genericUnavailable();
  return out;
}

export const genericSame = (a: unknown, b: unknown): boolean =>
  canonicalJson(captureShortStatusJson(a)) === canonicalJson(captureShortStatusJson(b));

export const genericDigest = (value: unknown) => hash(canonicalJson(captureShortStatusJson(value)));

export const genericSqlCapture = (value: unknown): unknown =>
  value === undefined
    ? { presence: 'absent' }
    : { presence: 'value', value: captureShortStatusJson(value) };

export const genericUnknown = (): GenericShortPublicationTuple => ({
  state: 'unknown',
  statusFacts: null,
  statusSource: null,
  statusEvidence: null,
});

export const genericSnapshotKeys = [
  'title',
  'body',
  'metadata',
  'accountId',
  'target',
  'state',
  'contentHash',
  'sourceUrl',
  'platformReadAt',
  'statusInput',
  'statusFacts',
  'statusProof',
];

export const genericJobKeys = [
  'id',
  'accountId',
  'ownerId',
  'kind',
  'operation',
  'scope',
  'datasets',
  'idempotencyKey',
  'inputHash',
  'status',
  'requestedAt',
  'startedAt',
  'platformReadStartedAt',
  'platformWriteStartedAt',
  'endedAt',
  'updatedAt',
  'result',
  'error',
  'target',
  'metadata',
  'timeoutMs',
  'deadlineAt',
  'cancellationRequestedAt',
  'cancellationReason',
];

export const genericRefKeys = [
  'id',
  'accountId',
  'jobId',
  'dataset',
  'capturedAt',
  'path',
  'sha256',
];

export const genericWitnessKeys = [
  'schema',
  'operation',
  'target',
  'creationContext',
  'requestBindings',
  'identityType',
  'platformOwnerId',
  'profileId',
  'profileVerifiedAt',
  'provenance',
  'startedAt',
  'stage',
  'observations',
  'failure',
];
