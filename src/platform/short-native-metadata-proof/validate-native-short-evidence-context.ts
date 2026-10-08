import {
  type NativeShortEvidenceContext,
  validateStoredReadEvidence,
  contextEnvelope,
  rejectAdditionalNativeSignals,
} from './validate-api-result-core.js';

import {
  type StoredReadEvidence,
  NATIVE_SHORT_READ_OPERATION,
  nativeShortReadScope,
  NATIVE_SHORT_READ_DATASET,
  NATIVE_SHORT_READ_SCHEMA,
  equal,
  reject,
  nativeShortInputHash,
  HASH,
  ordered,
  isCanonicalNativeTime,
  UUID,
  type StoredSnapshot,
} from './reject.js';

import {
  type Job,
  type Manifest,
  type EvidenceRef,
  type EvidenceDocument,
  canonicalJson,
} from '../../runtime/store.js';

import {
  NATIVE_SHORT_RESOURCE_LIMITS,
  NATIVE_SHORT_METADATA_SCOPE,
  NATIVE_SHORT_HASH_BASES,
} from '../short-native-metadata.js';

import { createHash } from 'node:crypto';

export function validateNativeShortEvidenceContext(
  input: unknown,
  context: NativeShortEvidenceContext,
): StoredReadEvidence {
  const wrapper = validateStoredReadEvidence(input),
    snapshot = wrapper.result.snapshot!;
  const { envelope, payload } = contextEnvelope(context);
  const allowed = new Map<string, unknown>();
  const allow = (path: string[], value: unknown) => allowed.set(JSON.stringify(path), value);
  const manifestSignals = (path: string[]) => {
    allow([...path, 'operation'], NATIVE_SHORT_READ_OPERATION);
    allow([...path, 'scope'], nativeShortReadScope(snapshot.binding.work.id));
    allow([...path, 'datasets'], [NATIVE_SHORT_READ_DATASET]);
    allow([...path, 'evidence', '0', 'dataset'], NATIVE_SHORT_READ_DATASET);
  };
  allow(['job', 'operation'], NATIVE_SHORT_READ_OPERATION);
  allow(['job', 'scope'], nativeShortReadScope(snapshot.binding.work.id));
  allow(['job', 'datasets'], [NATIVE_SHORT_READ_DATASET]);
  manifestSignals(['manifest']);
  manifestSignals(['job', 'result', 'manifest']);
  allow(['ref', 'dataset'], NATIVE_SHORT_READ_DATASET);
  allow(['document', 'dataset'], NATIVE_SHORT_READ_DATASET);
  rejectAdditionalNativeSignals(envelope, allowed);
  const payloadSignals = new Map<string, unknown>([
    [JSON.stringify(['schema']), NATIVE_SHORT_READ_SCHEMA],
    [JSON.stringify(['result', 'schema']), 'native-short-metadata-api-read/v1'],
  ]);
  // Only the two factory-validated original response subtrees are opaque source
  // JSON. A similarly named field under runtime metadata/error is not exempt.
  rejectAdditionalNativeSignals(wrapper, payloadSignals, [
    JSON.stringify(['result', 'snapshot', 'editData']),
    JSON.stringify(['result', 'snapshot', 'categoryData']),
  ]);
  const durableWrapper = payload === input ? wrapper : validateStoredReadEvidence(payload);
  if (!equal(wrapper, durableWrapper)) reject();
  const accountId = envelope.accountId;
  const job = envelope.job as Job | null,
    manifest = envelope.manifest as Manifest | null,
    ref = envelope.ref as EvidenceRef,
    document = envelope.document as EvidenceDocument;
  // Runtime context is checked independently of payload self-description.
  if (
    !job ||
    !manifest ||
    job.kind !== 'read' ||
    job.status !== 'succeeded' ||
    job.operation !== NATIVE_SHORT_READ_OPERATION ||
    job.scope !== nativeShortReadScope(snapshot.binding.work.id) ||
    !equal(job.datasets, [NATIVE_SHORT_READ_DATASET]) ||
    job.inputHash !== nativeShortInputHash(snapshot.binding.work.id) ||
    !equal(job.target, { kind: 'short-story', id: snapshot.binding.work.id })
  )
    reject();
  if (
    [job.accountId, manifest.accountId, ref.accountId, document.accountId].some(
      (id) => id !== accountId,
    ) ||
    [manifest.jobId, ref.jobId, document.jobId].some((id) => id !== job.id)
  )
    reject();
  if (
    manifest.schemaVersion !== 1 ||
    manifest.operation !== job.operation ||
    manifest.scope !== job.scope ||
    !equal(manifest.datasets, job.datasets) ||
    manifest.requestedAt !== job.requestedAt ||
    manifest.platformReadStartedAt !== job.platformReadStartedAt ||
    manifest.evidence.length !== 1 ||
    !equal(manifest.evidence[0], ref)
  )
    reject();
  if (
    !equal(job.result, { manifest }) ||
    document.schemaVersion !== 1 ||
    document.evidenceKind !== 'observation' ||
    !['live', 'fixture'].includes(document.collectionMode) ||
    (wrapper.source.mode === 'live' && document.collectionMode !== 'live') ||
    document.evidenceId !== ref.id ||
    document.dataset !== NATIVE_SHORT_READ_DATASET ||
    ref.dataset !== NATIVE_SHORT_READ_DATASET ||
    document.capturedAt !== ref.capturedAt ||
    typeof ref.sha256 !== 'string' ||
    !HASH.test(ref.sha256)
  )
    reject();
  if (job.platformWriteStartedAt !== null || job.endedAt !== manifest.committedAt) reject();
  ordered([
    job.requestedAt,
    job.platformReadStartedAt,
    wrapper.result.proof.readStartedAt,
    wrapper.result.proof.readFinishedAt,
    wrapper.result.cleanup.checkedAt,
    wrapper.result.proof.proofCapturedAt,
    ref.capturedAt,
    manifest.committedAt,
  ]);
  return wrapper;
}

/** Inspect nested envelopes too (restart/uncertain/reconciliation), without getters. */
export function hasReservedNativeShortSignal(value: unknown): boolean {
  // Persisted legacy observations are not subjected to native resource limits.
  // Iteration avoids deep legacy JSON causing an ambient recursion failure.
  const visited = new Set<object>(),
    pending: unknown[] = [value];
  while (pending.length) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    const descriptors = Object.getOwnPropertyDescriptors(current);
    for (const name of ['schema', 'scope', 'operation', 'dataset', 'datasets']) {
      const descriptor = descriptors[name];
      if (descriptor && !Object.hasOwn(descriptor, 'value')) return true;
      const field = descriptor?.value;
      if (
        name === 'schema' &&
        typeof field === 'string' &&
        (field.startsWith('fanqie-short-native-metadata') ||
          field.startsWith('native-short-metadata'))
      )
        return true;
      if (
        name === 'scope' &&
        typeof field === 'string' &&
        field.startsWith('short_native_metadata.')
      )
        return true;
      if (name === 'operation' && field === NATIVE_SHORT_READ_OPERATION) return true;
      if (
        name === 'dataset' &&
        typeof field === 'string' &&
        field.startsWith(NATIVE_SHORT_READ_DATASET)
      )
        return true;
      if (name === 'datasets' && Array.isArray(field)) {
        for (const item of Object.values(Object.getOwnPropertyDescriptors(field)))
          if (
            Object.hasOwn(item, 'value') &&
            typeof item.value === 'string' &&
            item.value.startsWith(NATIVE_SHORT_READ_DATASET)
          )
            return true;
      }
    }
    for (const [name, descriptor] of Object.entries(descriptors))
      if (name !== 'length' && Object.hasOwn(descriptor, 'value')) pending.push(descriptor.value);
  }
  return false;
}

export function safeNativeShortRef(ref: EvidenceRef) {
  return {
    id: ref.id,
    accountId: ref.accountId,
    jobId: ref.jobId,
    dataset: NATIVE_SHORT_READ_DATASET,
    capturedAt: ref.capturedAt,
    sha256: ref.sha256,
  };
}

export function safeNativeShortManifest(manifest: Manifest) {
  return {
    schemaVersion: 1,
    id: manifest.id,
    accountId: manifest.accountId,
    jobId: manifest.jobId,
    operation: NATIVE_SHORT_READ_OPERATION,
    scope: /^short_native_metadata\.[1-9][0-9]{9,21}$/.test(manifest.scope) ? manifest.scope : null,
    datasets: [NATIVE_SHORT_READ_DATASET],
    requestedAt: isCanonicalNativeTime(manifest.requestedAt) ? manifest.requestedAt : null,
    platformReadStartedAt: isCanonicalNativeTime(manifest.platformReadStartedAt)
      ? manifest.platformReadStartedAt
      : null,
    committedAt: isCanonicalNativeTime(manifest.committedAt) ? manifest.committedAt : null,
    evidence: manifest.evidence.map(safeNativeShortRef),
  };
}

export function safeNativeShortJob(job: Job, manifest: Manifest | null) {
  const safeFailure = (failure: Job['error']) =>
    failure
      ? {
          code: [
            'cancelled',
            'job_timeout',
            'lease_unavailable',
            'capability_unavailable',
          ].includes(failure.code)
            ? failure.code
            : 'capability_unavailable',
          message: 'Native short metadata is unavailable',
        }
      : null;
  const workId = /^short_native_metadata\.([1-9][0-9]{9,21})$/.exec(job.scope)?.[1];
  return {
    id: UUID.test(job.id) ? job.id : null,
    accountId: job.accountId,
    kind: job.kind,
    operation: job.operation === NATIVE_SHORT_READ_OPERATION ? NATIVE_SHORT_READ_OPERATION : null,
    projectionStatus: manifest ? 'validated' : 'capability_unavailable',
    scope: workId ? nativeShortReadScope(workId) : null,
    datasets:
      job.datasets.length === 1 && job.datasets[0] === NATIVE_SHORT_READ_DATASET
        ? [NATIVE_SHORT_READ_DATASET]
        : [],
    status: job.status,
    requestedAt: isCanonicalNativeTime(job.requestedAt) ? job.requestedAt : null,
    startedAt: isCanonicalNativeTime(job.startedAt) ? job.startedAt : null,
    platformReadStartedAt: isCanonicalNativeTime(job.platformReadStartedAt)
      ? job.platformReadStartedAt
      : null,
    platformWriteStartedAt: isCanonicalNativeTime(job.platformWriteStartedAt)
      ? job.platformWriteStartedAt
      : null,
    endedAt: isCanonicalNativeTime(job.endedAt) ? job.endedAt : null,
    updatedAt: isCanonicalNativeTime(job.updatedAt) ? job.updatedAt : null,
    inputHash: HASH.test(job.inputHash) ? job.inputHash : null,
    result: manifest ? { manifest: safeNativeShortManifest(manifest) } : null,
    error: safeFailure(job.error),
    target:
      workId && equal(job.target, { kind: 'short-story', id: workId })
        ? { kind: 'short-story', id: workId }
        : null,
    metadata: {},
    timeoutMs: job.timeoutMs,
    deadlineAt: isCanonicalNativeTime(job.deadlineAt) ? job.deadlineAt : null,
    cancellationRequestedAt: isCanonicalNativeTime(job.cancellationRequestedAt)
      ? job.cancellationRequestedAt
      : null,
    cancellationReason: safeFailure(job.cancellationReason),
  };
}

export function categoryMaximum(snapshot: StoredSnapshot) {
  if (!Object.hasOwn(snapshot.editData, 'category_max_count'))
    return { status: 'supported', value: 8, basis: 'public-client-default-8' };
  const value = snapshot.editData.category_max_count;
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= NATIVE_SHORT_RESOURCE_LIMITS.categoryCount
    ? { status: 'supported', value, basis: 'source' }
    : { status: 'unsupported', value: null, basis: 'unsupported-source' };
}

export const digest = (value: unknown) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');

export const NATIVE_SHORT_WRITE_OPERATION = 'update_work_metadata';

export const NATIVE_SHORT_BASELINE_DATASET = 'short_native_metadata_baseline';

export const NATIVE_SHORT_AFTER_DATASET = 'short_native_metadata_after';

export const NATIVE_SHORT_COMPARISON_BASIS = 'native-short-metadata-desired-and-preservation/v1';

export interface NativeShortWriteBusinessInput {
  target: { kind: 'short'; workId: string };
  snapshotScope: typeof NATIVE_SHORT_METADATA_SCOPE;
  hashBasis: typeof NATIVE_SHORT_HASH_BASES.snapshot;
  expectedSnapshotVersionHash: string;
  expectedState: 'draft';
  title?: string;
  metadata?: { categories?: string[] };
}
