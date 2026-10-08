import {
  type Job,
  type EvidenceRef,
  type EvidenceDocument,
  type Manifest,
} from '../../runtime/store.js';

import { type NativeShortWriteProjection, WRITE_DATASETS } from './clean-after-business.js';

import {
  safeNativeShortJob,
  NATIVE_SHORT_WRITE_OPERATION,
  NATIVE_SHORT_COMPARISON_BASIS,
} from './validate-native-short-evidence-context.js';

import {
  NATIVE_SHORT_METADATA_SCOPE,
  NATIVE_SHORT_HASH_BASES,
  NATIVE_SHORT_WRITE_HASH_BASES_V2,
  type WriteComparison,
} from '../short-native-metadata.js';

import {
  NATIVE_SHORT_COMPARISON_BASIS_V2,
  type EvidenceLink,
} from './validate-native-short-write-business-input.js';

import { type NativeShortMetadataApiResult } from '../short-native-metadata-api.js';

import {
  type NativeShortReadEvidence,
  type NativeShortProvenance,
  exact,
  UUID,
  HASH,
  reject,
  NATIVE_SHORT_READ_DATASET,
  object,
  copyBoundedNativeJson,
  WORK,
  nativeShortReadScope,
  equal,
  ordered,
  time,
} from './reject.js';

import { rejectAdditionalNativeSignals } from './validate-api-result-core.js';

export function safeNativeShortWriteJob(job: Job, projection: NativeShortWriteProjection | null) {
  const workId = /^short_native_metadata\.([1-9][0-9]{9,21})$/.exec(job.scope)?.[1];
  return {
    ...safeNativeShortJob(job, null),
    operation:
      job.kind === 'write' && job.operation === NATIVE_SHORT_WRITE_OPERATION && workId
        ? NATIVE_SHORT_WRITE_OPERATION
        : null,
    projectionStatus: projection?.validated ? 'validated' : 'capability_unavailable',
    result: projection?.result ?? null,
  };
}

export interface NativeShortAttemptPointer {
  readJobId: string;
  evidenceId: string;
  evidenceHash: string;
}

export interface NativeShortPreviousPointer {
  reconciliationJobId: string;
  evidenceId: string;
  evidenceHash: string;
  resultHash: string;
  settledAt: string;
}

interface NativeShortOriginalAuditBase {
  schema: 'native-short-metadata-original-audit/v1' | 'native-short-metadata-original-audit/v2';
  phase: 'initial' | 'continuation';
  originalJobId: string;
  accountId: string;
  operation: 'update_work_metadata';
  scope: string;
  inputHash: string;
  target: { kind: 'short-story'; id: string };
  datasets: [];
  requestedAt: string;
  startedAt: string;
  platformReadStartedAt: string;
  platformWriteStartedAt: string;
  originalEndedAt: string;
  priorEndedAt: string;
  status: 'uncertain';
  priorError: Job['error'];
  priorEvidence: EvidenceRef[];
}

export type NativeShortOriginalAudit = NativeShortOriginalAuditBase &
  (
    | {
        phase: 'initial';
        originalResult: { evidence: EvidenceRef[] };
        originalAttemptEvidence: null;
        previousClosure: null;
      }
    | {
        phase: 'continuation';
        priorResultHash: string;
        originalAttemptEvidence: NativeShortAttemptPointer;
        previousClosure: NativeShortPreviousPointer;
      }
  );

export interface NativeShortReconciliationEvidence {
  schema: 'native-short-metadata-reconciliation/v1' | 'native-short-metadata-reconciliation/v2';
  scope: typeof NATIVE_SHORT_METADATA_SCOPE;
  hashBases: typeof NATIVE_SHORT_HASH_BASES | typeof NATIVE_SHORT_WRITE_HASH_BASES_V2;
  comparisonBasis: typeof NATIVE_SHORT_COMPARISON_BASIS | typeof NATIVE_SHORT_COMPARISON_BASIS_V2;
  baselineEvidence: EvidenceLink;
  intentEvidence: EvidenceLink;
  originalAudit: NativeShortOriginalAudit;
  result: NativeShortMetadataApiResult;
  comparison: WriteComparison;
  source: NativeShortReadEvidence['source'];
  provenance: NativeShortProvenance;
  reconciliation: {
    originalJobId: string;
    target: { kind: 'short-story'; id: string };
    inputHash: string;
    observedContentHash: string;
    observedStatus: 'draft_saved' | 'unknown';
  };
}

export interface NativeShortClosure {
  schema: 'native-short-metadata-closure/v1' | 'native-short-metadata-closure/v2';
  target: { kind: 'short-story'; id: string };
  reconciliationJobId: string;
  evidence: EvidenceRef;
  observedStatus: 'draft_saved' | 'unknown';
  result: Record<string, unknown>;
  originalAudit: NativeShortOriginalAudit;
  originalAttemptEvidence: NativeShortAttemptPointer;
}

export interface NativeShortSafeClosure {
  schema: 'native-short-metadata-closure/v1' | 'native-short-metadata-closure/v2';
  target: { kind: 'short-story'; id: string };
  reconciliationJobId: string;
  evidence: Record<string, unknown>;
  observedStatus: 'draft_saved' | 'unknown';
  result: Record<string, unknown>;
  originalAttemptEvidence: NativeShortAttemptPointer;
  originalEndedAt: string;
  priorEndedAt: string;
}

export interface NativeShortReconciliationContext {
  accountId: string;
  originalJob: Job;
  originalRefs: EvidenceRef[];
  originalDocuments: EvidenceDocument[];
  readJob: Job;
  manifest: Manifest;
  ref: EvidenceRef;
  document: EvidenceDocument;
}

const AUDIT_COMMON = [
  'schema',
  'phase',
  'originalJobId',
  'accountId',
  'operation',
  'scope',
  'inputHash',
  'target',
  'datasets',
  'requestedAt',
  'startedAt',
  'platformReadStartedAt',
  'platformWriteStartedAt',
  'originalEndedAt',
  'priorEndedAt',
  'status',
  'priorError',
  'priorEvidence',
];

export const AUDIT_STABLE = [
  'accountId',
  'operation',
  'scope',
  'inputHash',
  'target',
  'datasets',
  'requestedAt',
  'startedAt',
  'platformReadStartedAt',
  'platformWriteStartedAt',
] as const;

export function attemptPointer(value: unknown): NativeShortAttemptPointer {
  const pointer = exact(value, ['readJobId', 'evidenceId', 'evidenceHash']);
  if (
    !UUID.test(String(pointer.readJobId)) ||
    !UUID.test(String(pointer.evidenceId)) ||
    !HASH.test(String(pointer.evidenceHash))
  )
    reject();
  return pointer as unknown as NativeShortAttemptPointer;
}

export function auditSignalPaths(audit: NativeShortOriginalAudit, prefix: string[] = []) {
  const allowed = new Map<string, unknown>([
    [JSON.stringify([...prefix, 'schema']), audit.schema],
    [JSON.stringify([...prefix, 'scope']), audit.scope],
  ]);
  audit.priorEvidence.forEach((ref, index) => {
    if (ref.dataset.startsWith(NATIVE_SHORT_READ_DATASET)) {
      allowed.set(
        JSON.stringify([...prefix, 'priorEvidence', String(index), 'dataset']),
        ref.dataset,
      );
      if (audit.phase === 'initial')
        allowed.set(
          JSON.stringify([...prefix, 'originalResult', 'evidence', String(index), 'dataset']),
          ref.dataset,
        );
    }
  });
  return allowed;
}

/** The audit is bounded private state, never a caller-supplied decision or public DTO. */
export function validateNativeShortOriginalAudit(input: unknown): NativeShortOriginalAudit {
  const data = object(copyBoundedNativeJson(input, 64 * 1024, 4096, 20));
  const initial = data.phase === 'initial';
  exact(data, [
    ...AUDIT_COMMON,
    ...(initial
      ? ['originalResult', 'originalAttemptEvidence', 'previousClosure']
      : ['priorResultHash', 'originalAttemptEvidence', 'previousClosure']),
  ]);
  const target = exact(data.target, ['kind', 'id']);
  if (
    ![
      'native-short-metadata-original-audit/v1',
      'native-short-metadata-original-audit/v2',
    ].includes(String(data.schema)) ||
    !['initial', 'continuation'].includes(String(data.phase)) ||
    !UUID.test(String(data.originalJobId)) ||
    typeof data.accountId !== 'string' ||
    !data.accountId ||
    data.operation !== NATIVE_SHORT_WRITE_OPERATION ||
    target.kind !== 'short-story' ||
    typeof target.id !== 'string' ||
    !WORK.test(target.id) ||
    data.scope !== nativeShortReadScope(target.id) ||
    !HASH.test(String(data.inputHash)) ||
    !equal(data.datasets, []) ||
    data.status !== 'uncertain'
  )
    reject();
  ordered([
    data.requestedAt,
    data.startedAt,
    data.platformReadStartedAt,
    data.platformWriteStartedAt,
    data.originalEndedAt,
    data.priorEndedAt,
  ]);
  const error = object(data.priorError);
  if (
    error.code !== 'outcome_unknown' ||
    typeof error.message !== 'string' ||
    Object.keys(error).some((name) => !['code', 'message', 'details'].includes(name))
  )
    reject();
  if (
    !Array.isArray(data.priorEvidence) ||
    data.priorEvidence.length < 2 ||
    data.priorEvidence.length > 4
  )
    reject();
  const refs = data.priorEvidence as EvidenceRef[];
  if (new Set(refs.map((ref) => ref.id)).size !== refs.length) reject();
  refs.forEach((ref, index) => {
    exact(ref, ['id', 'accountId', 'jobId', 'dataset', 'capturedAt', 'path', 'sha256']);
    if (
      !UUID.test(ref.id) ||
      !HASH.test(ref.sha256) ||
      ref.accountId !== data.accountId ||
      ref.jobId !== data.originalJobId ||
      ref.dataset !== WRITE_DATASETS[index] ||
      typeof ref.path !== 'string' ||
      !ref.path
    )
      reject();
    ordered([
      index ? refs[index - 1]!.capturedAt : data.platformReadStartedAt,
      ref.capturedAt,
      data.originalEndedAt,
    ]);
  });
  ordered([refs[1]!.capturedAt, data.platformWriteStartedAt]);
  if (initial) {
    if (
      data.originalEndedAt !== data.priorEndedAt ||
      data.originalAttemptEvidence !== null ||
      data.previousClosure !== null ||
      !equal(exact(data.originalResult, ['evidence']).evidence, refs)
    )
      reject();
  } else {
    attemptPointer(data.originalAttemptEvidence);
    const previous = exact(data.previousClosure, [
      'reconciliationJobId',
      'evidenceId',
      'evidenceHash',
      'resultHash',
      'settledAt',
    ]);
    if (
      !UUID.test(String(previous.reconciliationJobId)) ||
      !UUID.test(String(previous.evidenceId)) ||
      !HASH.test(String(previous.evidenceHash)) ||
      !HASH.test(String(previous.resultHash)) ||
      data.priorResultHash !== previous.resultHash ||
      previous.settledAt !== data.priorEndedAt
    )
      reject();
    if (time(data.originalEndedAt) >= time(data.priorEndedAt)) reject();
  }
  const audit = data as unknown as NativeShortOriginalAudit;
  rejectAdditionalNativeSignals(data, auditSignalPaths(audit));
  return audit;
}
