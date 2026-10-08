import { createHash } from 'node:crypto';

export const requiredAccountDatasets = [
  'short_works',
  'short_metrics',
  'long_works',
  'long_metrics',
];

const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

const digestPattern = /^[a-f0-9]{64}$/;

export const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export const iso = (value) =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value
    ? value
    : null;

export const opaqueId = (value) =>
  typeof value === 'string' && uuidPattern.test(value) ? value : null;

export const errorCode = (value) =>
  typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : null;

const datasetName = (value) => (requiredAccountDatasets.includes(value) ? value : 'unknown');

const exactDatasets = (value) =>
  Array.isArray(value) &&
  value.length === 4 &&
  new Set(value).size === 4 &&
  requiredAccountDatasets.every((dataset) => value.includes(dataset));

export const fingerprint = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function ensure(condition, code) {
  if (!condition) {
    const error = new Error('The account refresh acceptance contract was not satisfied');
    error.code = code;
    throw error;
  }
}

export function safeRef(ref) {
  return {
    sourceRef: opaqueId(ref?.id),
    dataset: datasetName(ref?.dataset),
    jobId: opaqueId(ref?.jobId),
    sha256: digestPattern.test(ref?.sha256 ?? '') ? ref.sha256 : null,
    capturedAt: iso(ref?.capturedAt),
  };
}

function safeData(item) {
  const coverage = object(item?.coverage);
  const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
  return {
    dataset: datasetName(item?.dataset),
    status: ['success', 'partial', 'login_required', 'capability_unavailable'].includes(
      item?.status,
    )
      ? item.status
      : 'unknown',
    count: Array.isArray(item?.records) ? item.records.length : null,
    sourceRef: opaqueId(item?.sourceRef),
    evidenceHash: digestPattern.test(item?.evidenceHash ?? '') ? item.evidenceHash : null,
    evidenceCapturedAt: iso(item?.evidenceCapturedAt),
    capturedAt: iso(item?.capturedAt),
    coverage: {
      complete: coverage.complete === true,
      paginationComplete: coverage.paginationComplete === true,
      pagesFetched: count(coverage.pagesFetched),
      pagesDiscovered: count(coverage.pagesDiscovered),
      recordsFetched: count(coverage.recordsFetched),
      totalRecords: count(coverage.totalRecords),
    },
    statisticsThrough:
      typeof item?.statisticsThrough === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(item.statisticsThrough)
        ? item.statisticsThrough
        : null,
    errorCodes: Array.isArray(item?.errors)
      ? item.errors.map((error) => errorCode(error?.code)).filter(Boolean)
      : [],
    limitationCount: Array.isArray(item?.limitations) ? item.limitations.length : 0,
  };
}

function safeManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return null;
  return {
    id: opaqueId(manifest.id),
    jobId: opaqueId(manifest.jobId),
    scope: manifest.scope === 'account' ? 'account' : 'other',
    requestedAt: iso(manifest.requestedAt),
    platformReadStartedAt: iso(manifest.platformReadStartedAt),
    committedAt: iso(manifest.committedAt),
    datasets: Array.isArray(manifest.datasets) ? manifest.datasets.map(datasetName).sort() : [],
    evidence: Array.isArray(manifest.evidence)
      ? manifest.evidence.map(safeRef).sort((a, b) => a.dataset.localeCompare(b.dataset))
      : [],
  };
}

export function safeSnapshot(envelope) {
  const result = object(envelope?.result);
  return {
    isError: envelope?.isError === true,
    sourceMode: ['saved', 'live', 'incomplete'].includes(result.sourceMode)
      ? result.sourceMode
      : 'unknown',
    manifest: safeManifest(result.manifest),
    datasets: Array.isArray(result.data)
      ? result.data.map(safeData).sort((a, b) => a.dataset.localeCompare(b.dataset))
      : [],
  };
}

export function safeRefresh(envelope) {
  const result = object(envelope?.result);
  const job = object(result.job);
  return {
    isError: envelope?.isError === true,
    jobId: opaqueId(job.id),
    status: [
      'succeeded',
      'failed',
      'partial',
      'waiting_for_login',
      'cancelled',
      'uncertain',
      'queued',
      'running',
    ].includes(job.status)
      ? job.status
      : 'unknown',
    errorCode: errorCode(job.error?.code),
    requestedAt: iso(job.requestedAt),
    platformReadStartedAt: iso(job.platformReadStartedAt),
    endedAt: iso(job.endedAt),
    retrievalMode: ['saved', 'live'].includes(result.retrievalMode)
      ? result.retrievalMode
      : 'unknown',
    sourceMode: ['saved', 'live', 'incomplete'].includes(result.sourceMode)
      ? result.sourceMode
      : 'unknown',
    evidence: Array.isArray(result.evidence)
      ? result.evidence.map(safeRef).sort((a, b) => a.dataset.localeCompare(b.dataset))
      : [],
    datasets: Array.isArray(result.data)
      ? result.data.map(safeData).sort((a, b) => a.dataset.localeCompare(b.dataset))
      : [],
    manifest: safeManifest(object(job.result).manifest),
  };
}

function verifyRows(result, references, jobId) {
  ensure(
    Array.isArray(result.data) && exactDatasets(result.data.map((item) => item?.dataset)),
    'four_dataset_records_required',
  );
  for (const ref of references) {
    ensure(
      uuidPattern.test(ref?.id ?? '') &&
        digestPattern.test(ref?.sha256 ?? '') &&
        ref.jobId === jobId &&
        iso(ref.capturedAt),
      'invalid_source_reference',
    );
    const row = result.data.find((item) => item?.dataset === ref.dataset);
    ensure(
      row.status === 'success' &&
        Array.isArray(row.records) &&
        row.coverage?.complete === true &&
        row.coverage?.paginationComplete === true &&
        row.coverage.recordsFetched === row.records.length &&
        (row.coverage.totalRecords == null || row.coverage.totalRecords === row.records.length),
      'incomplete_dataset_coverage',
    );
    ensure(iso(row.capturedAt) && row.capturedAt <= ref.capturedAt, 'invalid_dataset_capture_time');
    ensure(
      row.source?.mode === 'live' &&
        row.sourceRef === ref.id &&
        row.evidenceHash === ref.sha256 &&
        row.evidenceCapturedAt === ref.capturedAt,
      'source_reference_mismatch',
    );
  }
}

export function verifyCompleteRefresh(envelope, savedEnvelope, clientRequestedAt = undefined) {
  const result = object(envelope?.result);
  const job = object(result.job);
  const manifest = object(object(job.result).manifest);
  ensure(
    envelope?.isError !== true &&
      job.status === 'succeeded' &&
      !job.error &&
      job.kind === 'read' &&
      job.operation === 'refresh' &&
      job.scope === 'account',
    'single_successful_account_job_required',
  );
  ensure(result.sourceMode === 'live' && result.retrievalMode === 'live', 'live_refresh_required');
  ensure(
    uuidPattern.test(job.id ?? '') &&
      exactDatasets(job.datasets) &&
      exactDatasets(manifest.datasets),
    'four_dataset_manifest_required',
  );
  ensure(
    manifest.jobId === job.id &&
      manifest.scope === 'account' &&
      manifest.operation === 'refresh' &&
      uuidPattern.test(manifest.id ?? ''),
    'manifest_job_mismatch',
  );
  const refs = Array.isArray(result.evidence) ? result.evidence : [];
  ensure(
    exactDatasets(refs.map((ref) => ref?.dataset)) && new Set(refs.map((ref) => ref.id)).size === 4,
    'four_unique_sources_required',
  );
  ensure(
    iso(job.requestedAt) &&
      iso(job.platformReadStartedAt) &&
      iso(job.endedAt) &&
      job.platformReadStartedAt >= job.requestedAt &&
      job.endedAt >= job.platformReadStartedAt,
    'invalid_job_timestamps',
  );
  if (clientRequestedAt !== undefined)
    ensure(
      iso(clientRequestedAt) && job.platformReadStartedAt >= clientRequestedAt,
      'cached_platform_read_rejected',
    );
  ensure(
    manifest.requestedAt === job.requestedAt &&
      manifest.platformReadStartedAt === job.platformReadStartedAt &&
      manifest.committedAt === job.endedAt,
    'manifest_time_mismatch',
  );
  ensure(
    refs.every(
      (ref) => ref.capturedAt >= job.platformReadStartedAt && ref.capturedAt <= job.endedAt,
    ),
    'invalid_evidence_timestamps',
  );
  const matchingRefs = (left, right) =>
    Array.isArray(left) &&
    Array.isArray(right) &&
    fingerprint(left.map(safeRef).sort((a, b) => a.dataset.localeCompare(b.dataset))) ===
      fingerprint(right.map(safeRef).sort((a, b) => a.dataset.localeCompare(b.dataset)));
  ensure(matchingRefs(manifest.evidence, refs), 'manifest_sources_mismatch');
  verifyRows(result, refs, job.id);
  const saved = object(savedEnvelope?.result);
  ensure(
    savedEnvelope?.isError !== true && saved.sourceMode === 'saved',
    'saved_snapshot_mode_required',
  );
  ensure(
    saved.manifest?.id === manifest.id &&
      fingerprint(safeManifest(saved.manifest)) === fingerprint(safeManifest(manifest)),
    'saved_snapshot_manifest_mismatch',
  );
  verifyRows(saved, refs, job.id);
}
