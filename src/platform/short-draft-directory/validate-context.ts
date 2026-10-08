import { createHash } from 'node:crypto';

import { type EvidenceRef, type Job, type Manifest } from '../../runtime/store.js';
import {
  type ShortDraftDirectoryEvidence,
  type ShortDraftDirectorySafeRef,
  type ShortDraftDirectoryBusiness,
  type ShortDraftDirectorySafeManifest,
  type ShortDraftDirectoryContext,
  type ShortDraftDirectoryProjection,
} from '../short-draft-directory.js';

interface Ports {
  exact: (
    value: unknown,
    keys: readonly string[],
    optional?: readonly string[],
  ) => Record<string, unknown>;
  string: (value: unknown, max?: number) => value is string;
  invalid: () => never;
  time: (value: unknown) => string;
  JOB_KEYS: readonly [
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
  UUID: RegExp;
  SHORT_DRAFT_DIRECTORY_OPERATION: 'list_short_drafts';
  SHORT_DRAFT_DIRECTORY_SCOPE: 'native_short_draft_directory.v1';
  same: (a: unknown, b: unknown) => boolean;
  SHORT_DRAFT_DIRECTORY_DATASET: 'short_drafts';
  SHORT_DRAFT_DIRECTORY_INPUT_HASH: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';
  nullableTime: (value: unknown) => string | null;
  count: (value: unknown, max: number) => number;
  array: (value: unknown, max: number) => unknown[];
  validateRef: (value: unknown, job: Job) => EvidenceRef;
  ANCHOR_KEYS: readonly [
    'shortDraftDirectorySchema',
    'shortDraftDirectoryOwnerKind',
    'shortDraftDirectoryOwnerId',
    'shortDraftDirectorySource',
  ];
  freeze: <T>(value: T) => T;
  JOB_SCHEMA: 'short-draft-directory-job/v1';
  ACCOUNT: RegExp;
  validateShortDraftDirectoryEvidence: (value: unknown) => ShortDraftDirectoryEvidence;
  issuedPayloads: Map<
    string,
    { transport: 'default-request' | 'fixture-request'; application: 'default' | 'injected' }
  >;
  canonical: (value: unknown) => string;
  validateManifest: (value: unknown, job: Job, refs: readonly EvidenceRef[]) => Manifest;
  safeRef: (ref: EvidenceRef) => ShortDraftDirectorySafeRef;
  business: (payload: ShortDraftDirectoryEvidence) => ShortDraftDirectoryBusiness;
  safeManifest: (m: Manifest) => ShortDraftDirectorySafeManifest;
}
export function createDirectoryContextValidator(ports: Ports) {
  return function validateShortDraftDirectoryContext(
    context: ShortDraftDirectoryContext,
    mode: 'prefix' | 'completion' | 'public',
  ): ShortDraftDirectoryProjection {
    const c = ports.exact(context, [
      'accountId',
      'job',
      'manifest',
      'refs',
      'documents',
      'evaluationAt',
    ]);
    if (!['prefix', 'completion', 'public'].includes(mode) || !ports.string(c.accountId, 128))
      return ports.invalid();
    const evaluationAt = ports.time(c.evaluationAt),
      j = ports.exact(c.job, ports.JOB_KEYS),
      job = c.job as Job;
    if (
      !ports.string(j.id) ||
      !ports.UUID.test(j.id) ||
      j.accountId !== c.accountId ||
      !ports.string(j.ownerId) ||
      !ports.UUID.test(j.ownerId) ||
      j.kind !== 'read' ||
      j.operation !== ports.SHORT_DRAFT_DIRECTORY_OPERATION ||
      j.scope !== ports.SHORT_DRAFT_DIRECTORY_SCOPE ||
      !ports.same(j.datasets, [ports.SHORT_DRAFT_DIRECTORY_DATASET]) ||
      !ports.string(j.idempotencyKey) ||
      !ports.UUID.test(j.idempotencyKey) ||
      j.inputHash !== ports.SHORT_DRAFT_DIRECTORY_INPUT_HASH ||
      j.target !== null ||
      j.platformWriteStartedAt !== null ||
      typeof j.status !== 'string' ||
      ![
        'queued',
        'running',
        'waiting_for_login',
        'succeeded',
        'partial',
        'failed',
        'cancelled',
      ].includes(j.status)
    )
      return ports.invalid();
    const requestedAt = ports.time(j.requestedAt),
      startedAt = ports.nullableTime(j.startedAt),
      readAt = ports.nullableTime(j.platformReadStartedAt),
      endedAt = ports.nullableTime(j.endedAt),
      deadlineAt = ports.nullableTime(j.deadlineAt),
      updatedAt = ports.time(j.updatedAt);
    ports.count(j.timeoutMs, 2_147_483_647);
    if (
      j.timeoutMs === 0 ||
      requestedAt > evaluationAt ||
      updatedAt > evaluationAt ||
      requestedAt > updatedAt ||
      (startedAt && (startedAt < requestedAt || startedAt > updatedAt)) ||
      (readAt && (!startedAt || readAt < startedAt || readAt > updatedAt)) ||
      (endedAt && endedAt < (readAt ?? startedAt ?? requestedAt))
    )
      return ports.invalid();
    if (
      startedAt
        ? !deadlineAt || Date.parse(deadlineAt) !== Date.parse(startedAt) + (j.timeoutMs as number)
        : deadlineAt !== null
    )
      return ports.invalid();
    if (
      mode === 'prefix' &&
      (j.status !== 'running' ||
        !deadlineAt ||
        evaluationAt > deadlineAt ||
        j.cancellationRequestedAt !== null ||
        j.cancellationReason !== null ||
        j.error !== null ||
        j.result !== null ||
        endedAt !== null)
    )
      return ports.invalid();
    if (
      mode === 'completion' &&
      (j.status !== 'succeeded' ||
        j.cancellationRequestedAt !== null ||
        j.cancellationReason !== null ||
        j.error !== null ||
        !deadlineAt ||
        !endedAt ||
        endedAt > deadlineAt ||
        endedAt !== evaluationAt)
    )
      return ports.invalid();
    if (j.cancellationRequestedAt !== null) {
      const at = ports.time(j.cancellationRequestedAt);
      if (at < requestedAt || at > evaluationAt || j.cancellationReason === null)
        return ports.invalid();
    }
    if (j.cancellationReason !== null) {
      const cancel = ports.exact(j.cancellationReason, ['code', 'message']);
      if (
        typeof cancel.code !== 'string' ||
        !['cancelled', 'timeout', 'shutdown'].includes(cancel.code) ||
        !ports.string(cancel.message, 1000)
      )
        return ports.invalid();
    }
    if (j.error !== null) {
      const error = ports.exact(j.error, ['code', 'message']);
      if (
        typeof error.code !== 'string' ||
        ![
          'capability_unavailable',
          'cancelled',
          'timeout',
          'shutdown',
          'interrupted',
          'requires_login',
        ].includes(error.code) ||
        !ports.string(error.message, 1000)
      )
        return ports.invalid();
    }
    const refs = ports.array(c.refs, 1).map((r) => ports.validateRef(r, job)),
      documents = ports.array(c.documents, 1);
    if (refs.length !== documents.length) return ports.invalid();
    if (refs.length === 0) {
      if (
        mode !== 'public' ||
        c.manifest !== null ||
        j.status === 'succeeded' ||
        j.status === 'partial' ||
        (j.result !== null && !ports.same(j.result, { evidence: [] }))
      )
        return ports.invalid();
      if (
        !ports.same(j.metadata, {}) &&
        !ports.same(
          Object.keys(ports.exact(j.metadata, ports.ANCHOR_KEYS)).sort(),
          [...ports.ANCHOR_KEYS].sort(),
        )
      )
        return ports.invalid();
      return ports.freeze<ShortDraftDirectoryProjection>({
        validated: true,
        collectionMode: null,
        verifiedLive: false,
        reason: 'response_unavailable',
        evidence: [],
        data: [],
        manifest: null,
      });
    }
    const anchor = ports.exact(j.metadata, ports.ANCHOR_KEYS);
    if (
      anchor.shortDraftDirectorySchema !== ports.JOB_SCHEMA ||
      anchor.shortDraftDirectoryOwnerKind !== 'account' ||
      !ports.string(anchor.shortDraftDirectoryOwnerId, 30) ||
      !ports.ACCOUNT.test(anchor.shortDraftDirectoryOwnerId) ||
      typeof anchor.shortDraftDirectorySource !== 'string' ||
      !['live', 'fixture'].includes(anchor.shortDraftDirectorySource)
    )
      return ports.invalid();
    const ref = refs[0]!,
      d = ports.exact(documents[0], [
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
      d.schemaVersion !== 1 ||
      d.evidenceId !== ref.id ||
      d.accountId !== job.accountId ||
      d.jobId !== job.id ||
      d.dataset !== ports.SHORT_DRAFT_DIRECTORY_DATASET ||
      d.capturedAt !== ref.capturedAt ||
      d.evidenceKind !== 'observation' ||
      typeof d.collectionMode !== 'string' ||
      !['live', 'fixture'].includes(d.collectionMode)
    )
      return ports.invalid();
    const payload = ports.validateShortDraftDirectoryEvidence(d.payload);
    if (mode === 'completion') {
      const fact = ports.issuedPayloads.get(
        createHash('sha256').update(ports.canonical(payload)).digest('hex'),
      );
      if (
        !fact ||
        fact.transport !== payload.source.transport ||
        fact.application !== payload.source.application
      )
        return ports.invalid();
    }
    if (
      createHash('sha256')
        .update(`${ports.canonical(documents[0])}\n`)
        .digest('hex') !== ref.sha256 ||
      !payload.owner ||
      payload.owner.id !== anchor.shortDraftDirectoryOwnerId ||
      payload.source.mode !== anchor.shortDraftDirectorySource ||
      (d.collectionMode === 'fixture' && payload.source.mode !== 'fixture')
    )
      return ports.invalid();
    if (
      !readAt ||
      (payload.coverage.readStartedAt !== null && payload.coverage.readStartedAt < readAt) ||
      (payload.proof.platformStarted && payload.coverage.readStartedAt === null) ||
      payload.cleanup.checkedAt < readAt ||
      ref.capturedAt < payload.cleanup.checkedAt ||
      ref.capturedAt < (payload.coverage.proofCapturedAt ?? payload.cleanup.checkedAt) ||
      ref.capturedAt > evaluationAt ||
      readAt < requestedAt
    )
      return ports.invalid();
    let manifest: Manifest | null = null;
    if (mode === 'completion' || job.status === 'succeeded') {
      if (
        payload.status !== 'success' ||
        !payload.coverage.complete ||
        !endedAt ||
        !deadlineAt ||
        endedAt > deadlineAt ||
        endedAt < ref.capturedAt ||
        job.error !== null ||
        job.cancellationRequestedAt !== null ||
        job.cancellationReason !== null
      )
        return ports.invalid();
      manifest = ports.validateManifest(c.manifest, job, refs);
      const result = ports.exact(job.result, ['manifest']);
      if (!ports.same(result.manifest, manifest)) return ports.invalid();
    } else {
      if (
        c.manifest !== null ||
        (mode === 'public' && payload.status === 'success') ||
        (mode === 'public' &&
          ((!endedAt && job.status !== 'running' && job.status !== 'queued') ||
            (endedAt && !ports.same(job.result, { evidence: refs }))))
      )
        return ports.invalid();
      if (mode === 'public' && job.status === 'partial' && job.error === null)
        return ports.invalid();
    }
    return ports.freeze<ShortDraftDirectoryProjection>({
      validated: true,
      collectionMode: payload.source.mode,
      verifiedLive:
        manifest !== null && payload.status === 'success' && payload.source.mode === 'live',
      reason: payload.reason,
      evidence: [ports.safeRef(ref)],
      data: [ports.business(payload)],
      manifest: manifest ? ports.safeManifest(manifest) : null,
    });
  };
}
