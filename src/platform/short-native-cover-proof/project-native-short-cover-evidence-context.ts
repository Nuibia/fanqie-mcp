import {
  type NativeShortCoverEvidenceContext,
  type NativeShortCoverProjection,
  freeze,
  fail,
  type NativeShortCoverStage,
  copy,
  STAGES,
  exact,
  validateNativeShortCoverBusinessInput,
  provenance,
  nativeShortCoverBusinessInputHash,
  ORIGIN,
  same,
  order,
  UUID,
  HASH,
  time,
  NATIVE_SHORT_COVER_OPERATION,
  WORK,
  type NativeShortCoverAttemptRow,
} from './fail.js';

import { projectState, stateFor } from './state-for.js';

import {
  type NativeShortCoverPhase,
  type NativeShortCoverReceiptStage,
  type NativeShortCoverReceiptFields,
} from '../short-native-cover-api.js';

import {
  stageFor,
  receiptFields,
  intentPayload,
  linkBase,
  transport,
  cleanResult,
} from './transport.js';

import { modernHeld, acknowledgement, snapshot } from './has-reserved-native-short-cover-signal.js';

import {
  NATIVE_SHORT_COVER_SCOPE,
  NATIVE_SHORT_COVER_HASH_BASES,
  type NativeShortCoverComparison,
} from '../short-native-cover.js';

import { apiResult, resultPayload } from './api-result.js';

import {
  type EvidenceRef,
  type Manifest,
  type Job,
  type EvidenceDocument,
} from '../../runtime/store.js';

import {
  isCanonicalNativeTime,
  type NativeShortProvenance,
  type StoredNativeShortMetadataApiResult,
} from '../short-native-metadata-proof.js';

import { type NativeShortMetadataApiResult } from '../short-native-metadata-api.js';

export function projectNativeShortCoverEvidenceContext(
  context: NativeShortCoverEvidenceContext,
): NativeShortCoverProjection {
  try {
    return freeze(projectState(stateFor(context)));
  } catch {
    return { validated: false, result: null, evidence: [], data: [], collectionMode: null };
  }
}

export function nativeShortCoverReceiptFields(
  context: NativeShortCoverEvidenceContext,
  phase: NativeShortCoverPhase,
  stage: NativeShortCoverReceiptStage,
): NativeShortCoverReceiptFields {
  try {
    const state = stateFor(context);
    if (state.mode !== 'modern' || state.kinds.at(-1) !== stageFor(phase, stage)) fail();
    return freeze(receiptFields(state, phase, stage));
  } catch {
    fail();
  }
}

/** Builders validate the prior prefix. Persist, reread, add the phase ledger, then validate again. */
export function createNativeShortCoverStageEvidence(
  kind: NativeShortCoverStage,
  input: unknown,
  context: NativeShortCoverEvidenceContext,
): any {
  try {
    const state = stateFor(context),
      value = copy(input, kind === 'after' ? 96 * 1024 * 1024 : 24 * 1024 * 1024);
    if (state.mode !== null && state.mode !== 'modern') fail();
    if (
      state.kinds.includes(kind) ||
      (kind !== STAGES[state.kinds.length] && kind !== 'after') ||
      (state.kinds.includes('after') && kind !== 'result')
    )
      fail();
    if (kind === 'baseline') {
      const d = exact(value, ['held', 'business', 'provenance']),
        b = validateNativeShortCoverBusinessInput(d.business),
        p = provenance(d.provenance),
        h = modernHeld(d.held, 'upload', b);
      if (
        nativeShortCoverBusinessInputHash(b) !== context.job.inputHash ||
        h.snapshot.binding.work.id !== /^short_native_cover\.(.+)$/.exec(context.job.scope)?.[1]
      )
        fail();
      return freeze({
        schema: 'native-short-cover-baseline-evidence/v1',
        scope: NATIVE_SHORT_COVER_SCOPE,
        held: h,
        businessInput: b,
        source: { origin: ORIGIN, mode: p.mode },
        provenance: p,
      });
    }
    if (!state.baseline) fail();
    if (kind === 'uploadIntent' || kind === 'saveIntent') {
      const d = exact(value, ['held']),
        h = kind === 'uploadIntent' ? state.baseline : state.preSave;
      if (!h || !same(d.held, h)) fail();
      return freeze(intentPayload(state, kind === 'uploadIntent' ? 'upload' : 'save'));
    }
    if (kind === 'uploadAttempt' || kind === 'saveAttempt') {
      const d = exact(value, ['eventAt']),
        phase = kind === 'uploadAttempt' ? 'upload' : 'save';
      order([context.refs.at(-1)!.capturedAt, d.eventAt]);
      return freeze({
        ...linkBase(state, kind),
        phase,
        stage: 'attempt',
        ordinal: 1,
        eventAt: d.eventAt,
        transport: transport(phase, state.business!.target.workId),
      });
    }
    if (kind === 'uploadAck' || kind === 'saveAck') {
      const d = exact(value, ['observation']),
        a = acknowledgement(d.observation, kind === 'uploadAck' ? 'upload' : 'save', state);
      order([context.refs.at(-1)!.capturedAt, a.acknowledgedAt]);
      return freeze({ ...linkBase(state, kind), observation: a });
    }
    if (kind === 'preSave') {
      const d = exact(value, ['held']);
      return freeze({
        ...linkBase(state, kind),
        held: modernHeld(d.held, 'save', state.business!, state.baseline, state.uploadAck!),
      });
    }
    if (kind === 'after') {
      const d = exact(value, ['result']);
      for (const native of [
        d.result.snapshot,
        ...Object.values(exact(d.result.snapshots, ['before', 'preSave', 'after'])),
      ])
        if (native !== null) snapshot(native);
      const raw = apiResult(d.result, state);
      return freeze({ ...linkBase(state, kind), result: cleanResult(raw) });
    }
    exact(value, []);
    return freeze(resultPayload(state));
  } catch {
    fail();
  }
}

export function scalar(object: unknown, key: string): unknown {
  try {
    const d =
      object && typeof object === 'object'
        ? Object.getOwnPropertyDescriptor(object, key)
        : undefined;
    return d && Object.hasOwn(d, 'value') ? d.value : null;
  } catch {
    return null;
  }
}

function safeString(value: unknown, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

export function safeNativeShortCoverRef(ref: EvidenceRef): Record<string, unknown> {
  return {
    id: safeString(scalar(ref, 'id'), UUID),
    accountId: safeString(scalar(ref, 'accountId'), /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
    jobId: safeString(scalar(ref, 'jobId'), UUID),
    dataset: safeString(
      scalar(ref, 'dataset'),
      /^(short_native_cover_[a-z_]+|reconciliation|write-result)$/,
    ),
    capturedAt: isCanonicalNativeTime(scalar(ref, 'capturedAt')) ? scalar(ref, 'capturedAt') : null,
    sha256: safeString(scalar(ref, 'sha256'), HASH),
  };
}

export function safeNativeShortCoverManifest(manifest: Manifest): Record<string, unknown> {
  try {
    const d = copy(manifest, 64 * 1024);
    return {
      schemaVersion: 1,
      id: safeString(d.id, UUID),
      accountId: safeString(d.accountId, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
      jobId: safeString(d.jobId, UUID),
      operation: 'reconcile_write',
      scope: 'reconciliation',
      datasets: ['reconciliation'],
      requestedAt: time(d.requestedAt),
      platformReadStartedAt: time(d.platformReadStartedAt),
      committedAt: time(d.committedAt),
      evidence: Array.isArray(d.evidence) ? d.evidence.map(safeNativeShortCoverRef) : [],
    };
  } catch {
    return {
      schemaVersion: 1,
      id: null,
      accountId: null,
      jobId: null,
      operation: 'reconcile_write',
      scope: 'reconciliation',
      datasets: ['reconciliation'],
      evidence: [],
    };
  }
}

export function safeNativeShortCoverJob(
  job: Job,
  projection: NativeShortCoverProjection | null,
): Record<string, unknown> {
  const id = safeString(scalar(job, 'id'), UUID),
    accountId = safeString(scalar(job, 'accountId'), /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
    scope = scalar(job, 'scope'),
    operation = scalar(job, 'operation');
  const out: Record<string, unknown> = {
    id,
    accountId,
    kind: scalar(job, 'kind') === 'read' ? 'read' : 'write',
    operation:
      operation === NATIVE_SHORT_COVER_OPERATION
        ? NATIVE_SHORT_COVER_OPERATION
        : operation === 'reconcile_write'
          ? 'reconcile_write'
          : null,
    scope:
      typeof scope === 'string' &&
      (/^short_native_cover\.[1-9][0-9]{9,21}$/.test(scope) || scope === 'reconciliation')
        ? scope
        : null,
    datasets: operation === 'reconcile_write' ? ['reconciliation'] : [],
    status: safeString(
      scalar(job, 'status'),
      /^(queued|running|succeeded|failed|uncertain|cancelled|waiting_for_login)$/,
    ),
    projectionStatus: projection?.validated ? 'validated' : 'capability_unavailable',
    inputHash: safeString(scalar(job, 'inputHash'), HASH),
    result: projection?.validated ? projection.result : null,
    target: null,
    error:
      scalar(job, 'error') === null
        ? null
        : {
            code: 'native_cover_outcome_unavailable',
            message: 'Native short cover outcome is unavailable.',
          },
  };
  for (const k of [
    'requestedAt',
    'startedAt',
    'platformReadStartedAt',
    'platformWriteStartedAt',
    'endedAt',
    'updatedAt',
    'deadlineAt',
    'cancellationRequestedAt',
  ])
    out[k] = isCanonicalNativeTime(scalar(job, k)) ? scalar(job, k) : null;
  const target = scalar(job, 'target');
  if (scalar(target, 'kind') === 'short-story' && safeString(scalar(target, 'id'), WORK))
    out.target = { kind: 'short-story', id: scalar(target, 'id') };
  return out;
}

export interface NativeShortCoverAttemptPointer {
  readJobId: string;
  evidenceId: string;
  evidenceHash: string;
}

export interface NativeShortCoverPreviousPointer {
  reconciliationJobId: string;
  evidenceId: string;
  evidenceHash: string;
  resultHash: string;
  settledAt: string;
}

export interface NativeShortCoverOriginalAudit {
  schema: 'native-short-cover-original-audit/v1';
  phase: 'initial' | 'continuation';
  originalJobId: string;
  accountId: string;
  operation: typeof NATIVE_SHORT_COVER_OPERATION;
  scope: string;
  inputHash: string;
  target: { kind: 'short-story'; id: string };
  datasets: [];
  requestedAt: string;
  startedAt: string;
  platformReadStartedAt: string;
  platformWriteStartedAt: string | null;
  originalEndedAt: string;
  priorEndedAt: string;
  priorError: Job['error'];
  priorEvidence: EvidenceRef[];
  attempts: NativeShortCoverAttemptRow[];
  previousClosure: NativeShortCoverPreviousPointer | null;
  originalAttemptEvidence: NativeShortCoverAttemptPointer | null;
}

export interface NativeShortCoverReconciliationEvidence {
  schema: 'native-short-cover-reconciliation-evidence/v1';
  scope: typeof NATIVE_SHORT_COVER_SCOPE;
  hashBases: typeof NATIVE_SHORT_COVER_HASH_BASES;
  originalAudit: NativeShortCoverOriginalAudit;
  baselineEvidence: NativeShortCoverAttemptRow['evidence'];
  uploadAckEvidence: NativeShortCoverAttemptRow['evidence'] | null;
  result: NativeShortMetadataApiResult;
  comparison: NativeShortCoverComparison | null;
  source: { origin: typeof ORIGIN; mode: 'live' | 'fixture' };
  provenance: NativeShortProvenance;
  reconciliation: {
    originalJobId: string;
    target: { kind: 'short-story'; id: string };
    inputHash: string;
    status: 'succeeded' | 'failed' | 'uncertain';
    reason: 'saved_by_later_read' | 'save_not_attempted' | 'outcome_unknown' | 'fixture_only';
    assetOutcome: 'bound_verified' | 'orphan_possible' | 'unknown';
    observedContentHash: string | null;
    originalSaveAcknowledged: boolean;
    originalSaveDurableAcknowledged: boolean;
  };
}

export type AuditReconciliationEvidence = Omit<NativeShortCoverReconciliationEvidence, 'result'> & {
  result: StoredNativeShortMetadataApiResult;
};

export interface NativeShortCoverReconciliationContext {
  original: NativeShortCoverEvidenceContext;
  readJob: Job;
  manifest: Manifest;
  ref: EvidenceRef;
  document: EvidenceDocument;
}
