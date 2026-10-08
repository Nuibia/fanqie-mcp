import {
  type NativeShortReconciliationContext,
  type NativeShortSafeClosure,
  type NativeShortAttemptPointer,
} from './safe-native-short-write-job.js';

import {
  type NativeShortWriteProjection,
  safeWriteRef,
  type NativeShortWriteEvidenceContext,
} from './clean-after-business.js';

import {
  validateNativeShortReconciliationContext,
  digestBytes,
} from './validate-native-short-reconciliation-context.js';

import { validateNativeShortClosureShape } from './create-native-short-original-audit.js';

import {
  equal,
  reject,
  type NativeShortReadEvidence,
  type NativeShortProvenance,
  type StoredNativeShortMetadataApiResult,
  type Data,
  exact,
  copyBoundedNativeJson,
  UUID,
  HASH,
  ordered,
  object,
} from './reject.js';

import { statusProjection } from './validate-native-short-write-business-input.js';

import {
  type Job,
  type Manifest,
  type EvidenceRef,
  type EvidenceDocument,
  canonicalJson,
} from '../../runtime/store.js';

import {
  NATIVE_SHORT_METADATA_SCOPE,
  NATIVE_SHORT_RESOURCE_LIMITS,
} from '../short-native-metadata.js';

import { type NativeShortMetadataApiResult } from '../short-native-metadata-api.js';

import { nativeReconciliationDocumentParts } from './create-native-short-reconciliation-evidence.js';

export function projectNativeShortClosure(
  context: NativeShortReconciliationContext,
): NativeShortWriteProjection {
  const verified = validateNativeShortReconciliationContext(context),
    closure = validateNativeShortClosureShape(context.originalJob.result);
  if (
    closure.reconciliationJobId !== context.readJob.id ||
    !equal(closure.originalAudit, verified.evidence.originalAudit)
  )
    reject();
  const safe: NativeShortSafeClosure = {
    schema: closure.schema,
    target: closure.target,
    reconciliationJobId: closure.reconciliationJobId,
    evidence: safeWriteRef(context.ref),
    observedStatus: closure.observedStatus,
    result: {
      ...verified.result,
      ...statusProjection(verified.evidence.result.snapshot!, context.ref, 'later_read'),
    },
    originalAttemptEvidence: closure.originalAttemptEvidence,
    originalEndedAt: closure.originalAudit.originalEndedAt,
    priorEndedAt: closure.originalAudit.priorEndedAt,
  };
  return {
    validated: true,
    result: safe,
    evidence: [
      ...context.originalRefs.filter((ref) => ref.dataset !== 'write-intent').map(safeWriteRef),
      safeWriteRef(context.ref),
    ],
    data: [
      {
        ...verified.result,
        ...statusProjection(verified.evidence.result.snapshot!, context.ref, 'later_read'),
      },
    ],
    collectionMode: verified.evidence.source.mode,
  };
}

/** Private administrative/compensation contexts are independent of the C2 read
 * manifest. SQL selection and adjacency belong to Store, never to a caller. */
export interface NativeShortCompensationReadFrame {
  job: Job;
  manifest: Manifest;
  ref: EvidenceRef;
  document: EvidenceDocument;
}

export interface NativeShortCompensationHistoryFrame {
  row: {
    id: string;
    sequence: number;
    originalJobId: string;
    readJobId: string;
    evidenceId: string;
    status: string;
    createdAt: string;
    resultJson: string;
  };
  read: NativeShortCompensationReadFrame;
}

export interface NativeShortCompensationAuthority {
  policy: { basis: string; sha256: string };
  source: {
    executionManifestSha256: string;
    executionInventory: Record<string, string>;
    registrationManifestSha256: string;
    registrationInventory: Record<string, string>;
  };
  actor: { sha256: string };
  controller: { sha256: string };
  receipts: {
    actor: { sha256: string; bytes: string };
    controller: { sha256: string; bytes: string };
  };
}

export interface NativeShortCompensationRegistrationManifest {
  schema: 'native-short-metadata-compensation-registration-manifest/v1';
  id: string;
  accountId: string;
  jobId: string;
  operation: 'register_native_compensation_attestation';
  scope: string;
  datasets: ['native_compensation_attestation'];
  inputHash: string;
  requestedAt: string;
  startedAt: string;
  platformReadStartedAt: null;
  platformWriteStartedAt: null;
  committedAt: string;
  evidence: [EvidenceRef];
  authorityHash: string;
  policyHash: string;
}

export interface NativeShortCompensationSourceContext {
  accountId: string;
  original: NativeShortWriteEvidenceContext;
  history: {
    first: NativeShortCompensationHistoryFrame | null;
    current: NativeShortCompensationHistoryFrame | null;
    previous: NativeShortCompensationHistoryFrame | null;
  };
  registration: {
    job: Job;
    manifest: NativeShortCompensationRegistrationManifest;
    ref: EvidenceRef;
    document: EvidenceDocument;
  } | null;
  operatorBefore: NativeShortCompensationReadFrame;
  operator: NativeShortWriteEvidenceContext;
  authority: NativeShortCompensationAuthority;
}

export interface NativeShortCompensationAttestation extends Record<string, unknown> {
  schema: 'native-short-metadata-compensation-attestation/v1';
  accountId: string;
  originalJobId: string;
  operatorJobId: string;
  operatorBeforeReadJobId: string;
  target: { kind: 'short-story'; id: string };
  originalInputHash: string;
  originalEvidence: Record<string, unknown>[];
  originalAuditHash: string;
  operatorBeforeEvidence: Record<string, unknown>;
  operatorEvidence: Record<string, unknown>[];
  authority: NativeShortCompensationAuthority;
  authorityHash: string;
  policyHash: string;
  approvedAt: string;
  effectsEndedAt: string;
}

export interface NativeShortCompensationBusiness extends Record<string, unknown> {
  schema: 'fanqie-short-native-metadata-compensation-business/v1';
  terminalState: 'compensated';
  originalOutcome: 'unknown';
  originalAcceptance: 'not_verified';
  compensationOutcome: 'verified_restored';
}

export interface NativeShortCompensationReconciliationEvidence extends Record<string, unknown> {
  schema: 'native-short-metadata-compensation-reconciliation/v1';
  scope: typeof NATIVE_SHORT_METADATA_SCOPE;
  result: NativeShortMetadataApiResult;
  originalAudit: Record<string, unknown>;
  source: NativeShortReadEvidence['source'];
  provenance: NativeShortProvenance;
}

export interface StoredCompensationEvidence extends Record<string, unknown> {
  schema: 'native-short-metadata-compensation-reconciliation/v1';
  scope: typeof NATIVE_SHORT_METADATA_SCOPE;
  result: StoredNativeShortMetadataApiResult;
  originalAudit: Record<string, unknown>;
  source: NativeShortReadEvidence['source'];
  provenance: NativeShortProvenance;
}

export interface NativeShortCompensationContext {
  source: NativeShortCompensationSourceContext;
  readJob: Job;
  manifest: Manifest;
  ref: EvidenceRef;
  document: EvidenceDocument;
}

export interface NativeShortCompensatedClosure extends Record<string, unknown> {
  schema: 'native-short-metadata-compensated-closure/v1';
  target: { kind: 'short-story'; id: string };
  reconciliationJobId: string;
  evidence: EvidenceRef;
  observedStatus: 'compensated';
  result: NativeShortCompensationBusiness;
  originalAudit: Record<string, unknown>;
  originalAttemptEvidence: NativeShortAttemptPointer | null;
}

export const OPERATOR_BASIS = 'operator-title-restore-three-paths/v1';

export const OPERATOR_ACTOR_SHA =
  'd58fa26059041a7913ef5bf696064dcf66c8ea97de361814db2d149351aa1f1c';

export const OPERATOR_CONTROLLER_SHA =
  '76466487dfb1fe97e3acd4b01bf9546257051715532cac6490675c87364b0e93';

export const OPERATOR_POLICY_SHA =
  'bb6e9da2aab7977aad1edfeb270da0677f4ea87062694d95fa4a2348468f373c';

export const COMPENSATED_ERROR = {
  code: 'native_write_compensated',
  message:
    'The original write remains unverified; a separately authenticated compensation restored its original content.',
};

export const OPERATOR_DATASETS = [
  'operator_title_restore_baseline',
  'write-intent',
  'operator_title_restore_native',
  'operator_title_restore_after',
];

export function ownData(input: unknown, names: string[]): Data {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Object.getOwnPropertySymbols(input).length
  )
    reject();
  const fields = Object.getOwnPropertyDescriptors(input);
  if (
    Object.keys(fields).length !== names.length ||
    names.some(
      (name) =>
        !fields[name] || !fields[name]!.enumerable || !Object.hasOwn(fields[name]!, 'value'),
    )
  )
    reject();
  return Object.fromEntries(names.map((name) => [name, fields[name]!.value]));
}

export function compensationDocument(
  refValue: EvidenceRef,
  documentValue: EvidenceDocument,
  job: Job,
  dataset: string,
  control = false,
): Data {
  const ref = exact(copyBoundedNativeJson(refValue, 8192, 64, 8), [
    'id',
    'accountId',
    'jobId',
    'dataset',
    'capturedAt',
    'path',
    'sha256',
  ]);
  const parts = nativeReconciliationDocumentParts(documentValue);
  const document: Data = {
    ...parts.head,
    payload: copyBoundedNativeJson(
      parts.payload,
      control ? 64 * 1024 : 2 * NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes + 128 * 1024,
      control ? 8192 : 3 * NATIVE_SHORT_RESOURCE_LIMITS.nodes,
      control ? 24 : NATIVE_SHORT_RESOURCE_LIMITS.depth + 12,
    ),
  };
  if (
    !UUID.test(String(ref.id)) ||
    !HASH.test(String(ref.sha256)) ||
    ref.accountId !== job.accountId ||
    ref.jobId !== job.id ||
    ref.dataset !== dataset ||
    typeof ref.path !== 'string' ||
    !ref.path ||
    document.schemaVersion !== 1 ||
    document.evidenceId !== ref.id ||
    document.accountId !== ref.accountId ||
    document.jobId !== ref.jobId ||
    document.dataset !== dataset ||
    document.capturedAt !== ref.capturedAt ||
    document.collectionMode !== 'live' ||
    document.evidenceKind !== (dataset === 'write-intent' ? 'local-intent' : 'observation') ||
    digestBytes(`${canonicalJson(document)}\n`) !== ref.sha256
  )
    reject();
  ordered([job.requestedAt, ref.capturedAt, job.endedAt]);
  return object(document.payload);
}
