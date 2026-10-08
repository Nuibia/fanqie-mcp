import {
  type NativeShortReconciliationContext,
  auditSignalPaths,
  type NativeShortClosure,
} from './safe-native-short-write-job.js';

import {
  type StoredReconciliation,
  reject,
  object,
  copyBoundedNativeJson,
  equal,
  ordered,
  time,
  UUID,
  exact,
  HASH,
  NATIVE_SHORT_READ_DATASET,
} from './reject.js';

import {
  nativeReconciliationDocumentParts,
  reconciliationBusiness,
} from './create-native-short-reconciliation-evidence.js';

import { NATIVE_SHORT_RESOURCE_LIMITS } from '../short-native-metadata.js';

import { type NativeShortWriteEvidenceContext, safeWriteRef } from './clean-after-business.js';

import {
  type Job,
  type EvidenceRef,
  type Manifest,
  type EvidenceDocument,
  canonicalJson,
} from '../../runtime/store.js';

import {
  recomputeReconciliation,
  validateNativeShortClosureShape,
  originalForAudit,
} from './create-native-short-original-audit.js';

import { digest, safeNativeShortJob } from './validate-native-short-evidence-context.js';

import {
  carrier,
  carrierVersion,
  statusProjection,
} from './validate-native-short-write-business-input.js';

import { rejectAdditionalNativeSignals } from './validate-api-result-core.js';

import { createHash } from 'node:crypto';

/** Full durable external-read context; Store calls this with its own decoded rows. */
export function validateNativeShortReconciliationContext(
  context: NativeShortReconciliationContext,
): {
  evidence: StoredReconciliation;
  status: 'succeeded' | 'uncertain';
  observedStatus: 'draft_saved' | 'unknown';
  result: Record<string, unknown>;
} {
  if (
    !context ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(context)) ||
    Object.getOwnPropertySymbols(context).length
  )
    reject();
  const descriptors = Object.getOwnPropertyDescriptors(context),
    names = [
      'accountId',
      'originalJob',
      'originalRefs',
      'originalDocuments',
      'readJob',
      'manifest',
      'ref',
      'document',
    ];
  if (
    Object.keys(descriptors).length !== names.length ||
    names.some(
      (name) =>
        !descriptors[name] ||
        !descriptors[name]!.enumerable ||
        !Object.hasOwn(descriptors[name]!, 'value'),
    )
  )
    reject();
  const documentParts = nativeReconciliationDocumentParts(context.document);
  const copied = object(
    copyBoundedNativeJson(
      {
        accountId: context.accountId,
        originalJob: context.originalJob,
        readJob: context.readJob,
        manifest: context.manifest,
        ref: context.ref,
        document: { ...documentParts.head, payload: null },
        originalRefs: context.originalRefs,
      },
      4 * NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes + 192 * 1024,
      5 * NATIVE_SHORT_RESOURCE_LIMITS.nodes,
      NATIVE_SHORT_RESOURCE_LIMITS.depth + 12,
    ),
  );
  const original: NativeShortWriteEvidenceContext = {
    accountId: copied.accountId as string,
    job: copied.originalJob as Job,
    manifest: null,
    refs: copied.originalRefs as EvidenceRef[],
    documents: context.originalDocuments,
  };
  const evidence = recomputeReconciliation(documentParts.payload, original),
    audit = evidence.originalAudit;
  const read = copied.readJob as Job,
    manifest = copied.manifest as Manifest,
    ref = copied.ref as EvidenceRef,
    document = copied.document as EvidenceDocument,
    job = copied.originalJob as Job;
  const closed = recordClosure(job.result);
  if (closed?.reconciliationJobId === read.id) {
    if (
      !equal(closed.originalAudit, audit) ||
      job.status !==
        (evidence.reconciliation.observedStatus === 'draft_saved' ? 'succeeded' : 'uncertain')
    )
      reject();
    ordered([manifest.committedAt, job.endedAt]);
  } else if (closed && job.endedAt !== audit.priorEndedAt) {
    // Immutable historical reads remain observable after a later settlement.
    // SQL settlement itself separately requires its independently rebuilt audit
    // to equal this payload before any UPDATE; this does not authorize a replay.
    if (
      !['succeeded', 'uncertain'].includes(job.status) ||
      closed.originalAudit.originalEndedAt !== audit.originalEndedAt ||
      time(job.endedAt) < time(manifest.committedAt) ||
      (audit.phase === 'continuation' &&
        !equal(audit.originalAttemptEvidence, closed.originalAttemptEvidence))
    )
      reject();
  } else {
    if (
      job.status !== 'uncertain' ||
      job.endedAt !== audit.priorEndedAt ||
      !equal(job.error, audit.priorError)
    )
      reject();
    if (
      audit.phase === 'initial'
        ? !equal(job.result, audit.originalResult)
        : !closed ||
          digest(job.result) !== audit.priorResultHash ||
          closed.reconciliationJobId !== audit.previousClosure.reconciliationJobId ||
          closed.evidence.id !== audit.previousClosure.evidenceId ||
          closed.evidence.sha256 !== audit.previousClosure.evidenceHash
    )
      reject();
  }
  if (
    read.kind !== 'read' ||
    read.status !== 'succeeded' ||
    read.operation !== 'reconcile_write' ||
    read.scope !== 'reconciliation' ||
    !equal(read.datasets, ['reconciliation']) ||
    read.inputHash !== digest({ jobId: job.id }) ||
    read.accountId !== context.accountId ||
    read.error !== null ||
    read.cancellationRequestedAt !== null ||
    read.platformWriteStartedAt !== null ||
    !equal(read.target, audit.target)
  )
    reject();
  if (
    read.id === job.id ||
    !UUID.test(read.id) ||
    read.requestedAt <= audit.priorEndedAt ||
    read.platformReadStartedAt! <= audit.priorEndedAt
  )
    reject();
  if (
    read.updatedAt !== read.endedAt ||
    read.cancellationReason !== null ||
    read.idempotencyKey !== null ||
    !Number.isSafeInteger(read.timeoutMs) ||
    read.timeoutMs < 1 ||
    read.timeoutMs > 2_147_483_647
  )
    reject();
  if (read.deadlineAt !== null) ordered([read.startedAt, read.deadlineAt]);

  if (
    manifest.schemaVersion !== 1 ||
    manifest.accountId !== read.accountId ||
    manifest.jobId !== read.id ||
    manifest.operation !== read.operation ||
    manifest.scope !== read.scope ||
    !equal(manifest.datasets, read.datasets) ||
    manifest.requestedAt !== read.requestedAt ||
    manifest.platformReadStartedAt !== read.platformReadStartedAt ||
    manifest.committedAt !== read.endedAt ||
    !equal(manifest.evidence, [ref]) ||
    !equal(read.result, { manifest })
  )
    reject();
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
    ref.accountId !== context.accountId ||
    ref.jobId !== read.id ||
    ref.dataset !== 'reconciliation' ||
    document.schemaVersion !== 1 ||
    document.evidenceId !== ref.id ||
    document.accountId !== ref.accountId ||
    document.jobId !== ref.jobId ||
    document.dataset !== ref.dataset ||
    document.capturedAt !== ref.capturedAt ||
    document.evidenceKind !== 'observation' ||
    !['live', 'fixture'].includes(document.collectionMode) ||
    (evidence.source.mode === 'live' && document.collectionMode !== 'live')
  )
    reject();
  if (digestBytes(`${canonicalJson({ ...document, payload: evidence })}\n`) !== ref.sha256)
    reject();
  ordered([
    read.requestedAt,
    read.startedAt,
    read.platformReadStartedAt,
    evidence.result.proof.readStartedAt,
    evidence.result.proof.readFinishedAt,
    evidence.result.cleanup.checkedAt,
    evidence.result.proof.proofCapturedAt,
    ref.capturedAt,
    manifest.committedAt,
  ]);
  const signals = new Map<string, unknown>([
    [JSON.stringify(['originalJob', 'scope']), audit.scope],
  ]);
  // The original envelope's complete write or closure has already been checked.
  // All remaining envelope positions must stay ordinary reconciliation runtime fields.
  if (closed) {
    validateNativeShortClosureShape(job.result);
    signals.set(JSON.stringify(['originalJob', 'result', 'schema']), closed.schema);
    signals.set(
      JSON.stringify(['originalJob', 'result', 'result', 'schema']),
      carrier(
        'fanqie-short-native-metadata-reconciliation-business',
        carrierVersion(closed.schema, 'native-short-metadata-closure'),
      ),
    );
    for (const [path, value] of auditSignalPaths(closed.originalAudit, [
      'originalJob',
      'result',
      'originalAudit',
    ]))
      signals.set(path, value);
  } else
    for (let index = 0; index < original.refs.length; index++)
      if (original.refs[index]!.dataset.startsWith(NATIVE_SHORT_READ_DATASET))
        signals.set(
          JSON.stringify(['originalJob', 'result', 'evidence', String(index), 'dataset']),
          original.refs[index]!.dataset,
        );
  for (let index = 0; index < original.refs.length; index++)
    if (original.refs[index]!.dataset.startsWith(NATIVE_SHORT_READ_DATASET))
      signals.set(
        JSON.stringify(['originalRefs', String(index), 'dataset']),
        original.refs[index]!.dataset,
      );
  rejectAdditionalNativeSignals(copied, signals);
  const { intent } = originalForAudit(original, audit),
    result = reconciliationBusiness(evidence, context.accountId, ref, intent.desiredContentHash);
  if (
    closed?.reconciliationJobId === read.id &&
    (!equal(closed.result, result) ||
      !equal(closed.evidence, ref) ||
      closed.observedStatus !== evidence.reconciliation.observedStatus)
  )
    reject();
  return {
    evidence,
    status: evidence.reconciliation.observedStatus === 'draft_saved' ? 'succeeded' : 'uncertain',
    observedStatus: evidence.reconciliation.observedStatus,
    result,
  };
}

export const digestBytes = (value: string) => createHash('sha256').update(value).digest('hex');

function recordClosure(value: unknown): NativeShortClosure | null {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    ['native-short-metadata-closure/v1', 'native-short-metadata-closure/v2'].includes(
      Object.getOwnPropertyDescriptor(value, 'schema')?.value,
    )
  )
    return validateNativeShortClosureShape(value);
  return null;
}

export function safeNativeShortReconciliationManifest(manifest: Manifest) {
  return {
    schemaVersion: 1,
    id: manifest.id,
    accountId: manifest.accountId,
    jobId: manifest.jobId,
    operation: 'reconcile_write',
    scope: 'reconciliation',
    datasets: ['reconciliation'],
    requestedAt: manifest.requestedAt,
    platformReadStartedAt: manifest.platformReadStartedAt,
    committedAt: manifest.committedAt,
    evidence: manifest.evidence.map(safeWriteRef),
  };
}

export function safeNativeShortReconciliationJob(
  job: Job,
  manifest: Manifest | null,
  target?: { kind: 'short-story'; id: string },
) {
  return {
    ...safeNativeShortJob(job, null),
    operation: job.operation === 'reconcile_write' ? 'reconcile_write' : null,
    scope: job.scope === 'reconciliation' ? 'reconciliation' : null,
    datasets: equal(job.datasets, ['reconciliation']) ? ['reconciliation'] : [],
    projectionStatus: manifest ? 'validated' : 'capability_unavailable',
    target: target ?? null,
    result: manifest ? { manifest: safeNativeShortReconciliationManifest(manifest) } : null,
  };
}

/** Public projection is separate from canonical settlement equality. */
export function projectNativeShortReconciliationEvidenceContext(
  context: NativeShortReconciliationContext,
): Record<string, unknown> {
  const verified = validateNativeShortReconciliationContext(context);
  return {
    ...verified.result,
    ...statusProjection(verified.evidence.result.snapshot!, context.ref, 'later_read'),
  };
}
