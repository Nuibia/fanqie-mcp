import {
  type ShortDraftDirectoryResult,
  exact,
  invalid,
  type ShortDraftDirectoryEvidence,
  ORIGIN,
  SHORT_DRAFT_DIRECTORY_PATH,
  string,
  array,
  type ShortDraftDirectorySafeRef,
  SHORT_DRAFT_DIRECTORY_DATASET,
  type ShortDraftDirectorySafeManifest,
  SHORT_DRAFT_DIRECTORY_OPERATION,
  SHORT_DRAFT_DIRECTORY_SCOPE,
  UUID,
  HASH,
  type ShortDraftDirectoryBusiness,
  type ShortDraftDirectoryContext,
  type ShortDraftDirectoryProjection,
  type ShortDraftDirectorySafeJob,
  isShortDraftDirectoryTime,
} from './unicode.js';

import { COMMON_KEYS, readCommon, time, freeze } from './time.js';

import { type EvidenceRef, type Manifest, type Job, type JobStatus } from '../../runtime/store.js';

import { createHash } from 'node:crypto';

import { validateShortDraftDirectoryContext } from '../short-draft-directory.js';

export function validateShortDraftDirectoryApiResult(value: unknown): ShortDraftDirectoryResult {
  const v = exact(value, ['schema', 'provenance', ...COMMON_KEYS]);
  if (v.schema !== 'short-draft-directory-api/v1') return invalid();
  const p = exact(v.provenance, ['transport']);
  if (
    typeof p.transport !== 'string' ||
    !['default-request', 'fixture-request'].includes(p.transport)
  )
    return invalid();
  readCommon(v);
  return value as ShortDraftDirectoryResult;
}

export function validateShortDraftDirectoryEvidence(value: unknown): ShortDraftDirectoryEvidence {
  const v = exact(value, ['schema', 'source', 'bodyIncluded', ...COMMON_KEYS]);
  if (v.schema !== 'short-draft-directory-evidence/v1' || v.bodyIncluded !== false)
    return invalid();
  const s = exact(v.source, ['mode', 'transport', 'application', 'origin', 'path']);
  if (
    typeof s.mode !== 'string' ||
    !['live', 'fixture'].includes(s.mode) ||
    typeof s.transport !== 'string' ||
    !['default-request', 'fixture-request'].includes(s.transport) ||
    typeof s.application !== 'string' ||
    !['default', 'injected'].includes(s.application) ||
    s.origin !== ORIGIN ||
    s.path !== SHORT_DRAFT_DIRECTORY_PATH ||
    s.mode !==
      (s.transport === 'default-request' && s.application === 'default' ? 'live' : 'fixture')
  )
    return invalid();
  readCommon(v);
  return value as ShortDraftDirectoryEvidence;
}

export function canonical(value: unknown): string {
  let visits = 0;
  function visit(v: unknown, depth: number): unknown {
    if (++visits > 4096 || depth > 16) return invalid();
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      if (!string(v, 4096)) return invalid();
      return v;
    }
    if (typeof v === 'number') {
      if (!Number.isFinite(v) || Object.is(v, -0)) return invalid();
      return v;
    }
    if (Array.isArray(v)) return array(v, 100).map((x) => visit(x, depth + 1));
    if (!v || typeof v !== 'object') return invalid();
    const keys = Object.keys(Object.getOwnPropertyDescriptors(v));
    const obj = exact(v, keys);
    return Object.fromEntries(keys.sort().map((key) => [key, visit(obj[key], depth + 1)]));
  }
  return JSON.stringify(visit(value, 0));
}

export function same(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

export const JOB_KEYS = [
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
] as const;

export function safeRef(ref: EvidenceRef): ShortDraftDirectorySafeRef {
  return {
    id: ref.id,
    jobId: ref.jobId,
    dataset: SHORT_DRAFT_DIRECTORY_DATASET,
    capturedAt: ref.capturedAt,
    sha256: ref.sha256,
  };
}

export function safeManifest(m: Manifest): ShortDraftDirectorySafeManifest {
  return {
    id: m.id,
    jobId: m.jobId,
    operation: SHORT_DRAFT_DIRECTORY_OPERATION,
    scope: SHORT_DRAFT_DIRECTORY_SCOPE,
    datasets: [SHORT_DRAFT_DIRECTORY_DATASET],
    requestedAt: m.requestedAt,
    platformReadStartedAt: m.platformReadStartedAt,
    committedAt: m.committedAt,
    evidence: m.evidence.map(safeRef),
  };
}

export function validateRef(value: unknown, job: Job): EvidenceRef {
  const r = exact(value, ['id', 'accountId', 'jobId', 'dataset', 'capturedAt', 'path', 'sha256']);
  if (
    !string(r.id) ||
    !UUID.test(r.id) ||
    r.accountId !== job.accountId ||
    r.jobId !== job.id ||
    r.dataset !== SHORT_DRAFT_DIRECTORY_DATASET ||
    !string(r.sha256) ||
    !HASH.test(r.sha256)
  )
    return invalid();
  const expectedPath = `${createHash('sha256').update(job.accountId).digest('hex').slice(0, 24)}/${SHORT_DRAFT_DIRECTORY_DATASET}/${r.id}.json`;
  if (r.path !== expectedPath) return invalid();
  time(r.capturedAt);
  return value as EvidenceRef;
}

export function validateManifest(value: unknown, job: Job, refs: readonly EvidenceRef[]): Manifest {
  const m = exact(value, [
    'schemaVersion',
    'id',
    'accountId',
    'jobId',
    'operation',
    'scope',
    'datasets',
    'requestedAt',
    'platformReadStartedAt',
    'committedAt',
    'evidence',
  ]);
  if (
    m.schemaVersion !== 1 ||
    !string(m.id) ||
    !UUID.test(m.id) ||
    m.accountId !== job.accountId ||
    m.jobId !== job.id ||
    m.operation !== SHORT_DRAFT_DIRECTORY_OPERATION ||
    m.scope !== SHORT_DRAFT_DIRECTORY_SCOPE ||
    !same(m.datasets, [SHORT_DRAFT_DIRECTORY_DATASET]) ||
    m.requestedAt !== job.requestedAt ||
    m.platformReadStartedAt !== job.platformReadStartedAt ||
    !same(array(m.evidence, 1), refs)
  )
    return invalid();
  time(m.committedAt);
  if (m.committedAt !== job.endedAt || m.committedAt !== job.updatedAt) return invalid();
  return value as Manifest;
}

export function business(payload: ShortDraftDirectoryEvidence): ShortDraftDirectoryBusiness {
  const common = readCommon(exact(payload, ['schema', 'source', 'bodyIncluded', ...COMMON_KEYS]));
  return freeze<ShortDraftDirectoryBusiness>({
    schema: 'fanqie-short-draft-directory/v1',
    dataset: SHORT_DRAFT_DIRECTORY_DATASET,
    status: common.status,
    reason: common.reason,
    records: common.records,
    coverage: common.coverage,
    source: { mode: payload.source.mode, origin: ORIGIN, path: SHORT_DRAFT_DIRECTORY_PATH },
    proof: common.proof,
    requests: common.requests,
    transport: common.transport,
    cleanup: common.cleanup,
    verifiedLive: common.status === 'success' && payload.source.mode === 'live',
    bodyIncluded: false,
  });
}

export function projectShortDraftDirectoryContext(
  context: ShortDraftDirectoryContext,
): ShortDraftDirectoryProjection {
  return validateShortDraftDirectoryContext(context, 'public');
}

export function hasReservedShortDraftDirectorySignal(value: unknown): boolean {
  const pending: unknown[] = [value],
    seen = new Set<object>();
  let visits = 0;
  while (pending.length) {
    if (++visits > 4096) return true;
    const v = pending.pop();
    if (!v || typeof v !== 'object' || seen.has(v)) continue;
    seen.add(v);
    let descriptors: PropertyDescriptorMap;
    try {
      descriptors = Object.getOwnPropertyDescriptors(v);
    } catch {
      return true;
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!Object.hasOwn(descriptor, 'value')) return true;
      const field = descriptor.value;
      if (
        key === 'datasets' &&
        Array.isArray(field) &&
        Object.values(Object.getOwnPropertyDescriptors(field)).some(
          (d) => Object.hasOwn(d, 'value') && d.value === SHORT_DRAFT_DIRECTORY_DATASET,
        )
      )
        return true;
      if (
        (key === 'operation' && field === SHORT_DRAFT_DIRECTORY_OPERATION) ||
        (key === 'scope' &&
          (field === SHORT_DRAFT_DIRECTORY_SCOPE || field === SHORT_DRAFT_DIRECTORY_DATASET)) ||
        (key === 'dataset' && field === SHORT_DRAFT_DIRECTORY_DATASET) ||
        key === 'shortDraftDirectorySchema' ||
        (key === 'schema' &&
          typeof field === 'string' &&
          /^(?:short-draft-directory|fanqie-short-draft-directory)/.test(field))
      )
        return true;
      if (field && typeof field === 'object') pending.push(field);
    }
  }
  return false;
}

export function safeShortDraftDirectoryJob(
  job: Job | null,
  projection: ShortDraftDirectoryProjection | null,
): ShortDraftDirectorySafeJob {
  const fields: Record<string, unknown> = {};
  if (job && typeof job === 'object') {
    for (const key of [
      'id',
      'status',
      'requestedAt',
      'startedAt',
      'platformReadStartedAt',
      'endedAt',
      'error',
    ]) {
      const descriptor = Object.getOwnPropertyDescriptor(job, key);
      if (descriptor && Object.hasOwn(descriptor, 'value')) fields[key] = descriptor.value;
    }
  }
  const valid = projection?.validated === true;
  const safeTime = (v: unknown) => (isShortDraftDirectoryTime(v) ? v : null);
  const status =
    valid &&
    typeof fields.status === 'string' &&
    [
      'queued',
      'running',
      'waiting_for_login',
      'succeeded',
      'partial',
      'failed',
      'cancelled',
    ].includes(fields.status)
      ? (fields.status as JobStatus)
      : null;
  return {
    id: typeof fields.id === 'string' && UUID.test(fields.id) ? fields.id : null,
    kind: 'read',
    operation: SHORT_DRAFT_DIRECTORY_OPERATION,
    scope: SHORT_DRAFT_DIRECTORY_SCOPE,
    status,
    requestedAt: safeTime(fields.requestedAt),
    startedAt: safeTime(fields.startedAt),
    platformReadStartedAt: safeTime(fields.platformReadStartedAt),
    endedAt: safeTime(fields.endedAt),
    target: null,
    error:
      valid && fields.error === null
        ? null
        : { code: 'capability_unavailable', message: 'Short draft directory is unavailable.' },
  };
}
