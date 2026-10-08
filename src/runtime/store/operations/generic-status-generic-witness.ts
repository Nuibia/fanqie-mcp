import { validateGenericJobLifecycle } from '../generic-witness/validate-job-lifecycle.js';
import {
  type JobStatus,
  type Job,
  type GenericShortTrustedContext,
  type EvidenceRef,
  writeTaskUuid,
  writeTaskTime,
  type EvidenceDocument,
  GENERIC_SHORT_STATUS_PROTOCOL,
} from '../runtime-error.js';
import {
  canonicalJson,
  identifier,
  datasetName,
  genericBindings,
  genericStages,
} from '../native-closure-signal.js';
import {
  genericUnavailable,
  genericObject,
  genericSame,
  hasGenericShortStatusSignal,
  genericWitnessKeys,
  genericRefKeys,
} from '../has-generic-short-status-signal.js';
import {
  type ModernShortSnapshot,
  validateGenericShortSnapshot,
} from '../../../platform/writes.js';
import { type GenericWitnessOperation } from '../contracts/generic-status-generic-refs.js';

interface GenericWitnessDependencies {
  WRITE_TASK_STATUSES: Set<JobStatus>;
  newGenericJobs: Map<string, Job>;
  genericShortStatusContext: ((jobId: string) => GenericShortTrustedContext | null) | undefined;
  ownerId: `${string}-${string}-${string}-${string}-${string}`;
}

export function createGenericWitness(deps: GenericWitnessDependencies): GenericWitnessOperation {
  function genericWitness(
    job: Job,
    refs: EvidenceRef[],
    documents: EvidenceDocument[],
    production = false,
  ): Record<string, unknown> | null {
    const { metadata, value } = validateGenericJobLifecycle(job, deps.WRITE_TASK_STATUSES);
    if (Buffer.byteLength(canonicalJson(metadata)) > 8192) return genericUnavailable();
    if (value === undefined) {
      if (hasGenericShortStatusSignal([job, documents])) return genericUnavailable();
      return null;
    }
    const witness = genericObject(value, genericWitnessKeys),
      keys = genericBindings[job.operation];
    if (
      !keys ||
      witness.schema !== 'fanqie-generic-short-execution/v1' ||
      witness.operation !== job.operation ||
      !genericStages.includes(String(witness.stage)) ||
      !writeTaskUuid(job.id) ||
      !writeTaskUuid(job.ownerId) ||
      !writeTaskTime(job.requestedAt) ||
      !/^[a-f0-9]{64}$/.test(job.inputHash)
    )
      return genericUnavailable();
    if (
      job.kind === 'write'
        ? job.scope !== 'account' || job.datasets.length !== 0
        : job.operation === 'editable_snapshot'
          ? job.scope !== 'editable_snapshot' || !genericSame(job.datasets, ['editable_snapshot'])
          : job.scope !== 'reconciliation' || !genericSame(job.datasets, ['reconciliation'])
    )
      return genericUnavailable();
    if (
      (witness.identityType !== 'account' && witness.identityType !== 'author') ||
      typeof witness.platformOwnerId !== 'string' ||
      !/^[0-9]{1,30}$/.test(witness.platformOwnerId) ||
      typeof witness.profileId !== 'string' ||
      !identifier.test(witness.profileId) ||
      typeof witness.profileVerifiedAt !== 'string' ||
      !Number.isFinite(Date.parse(witness.profileVerifiedAt)) ||
      !writeTaskTime(witness.startedAt) ||
      witness.startedAt < job.requestedAt
    )
      return genericUnavailable();
    const provenance = genericObject(witness.provenance, ['executor', 'mode']);
    if (
      provenance.executor === 'application-default-browser/v1'
        ? provenance.mode !== 'live'
        : provenance.executor !== 'dependency-injected-browser/v1' || provenance.mode !== 'fixture'
    )
      return genericUnavailable();
    const bindings = genericObject(witness.requestBindings, keys);
    if (
      Object.values(bindings).some((v) => typeof v !== 'string') ||
      Object.entries(bindings).some(([key, v]) =>
        key === 'accountId' ? v !== job.accountId : !/^[a-f0-9]{64}$/.test(v as string),
      )
    )
      return genericUnavailable();
    const boundInput =
      job.operation === 'resume_create_draft'
        ? bindings.resumeInputHash
        : job.operation === 'repair_created_draft'
          ? bindings.repairInputHash
          : bindings.inputHash;
    if (boundInput !== job.inputHash) return genericUnavailable();
    if (witness.target !== null) {
      const target = genericObject(witness.target, ['kind', 'id']);
      if (
        target.kind !== 'short-story' ||
        typeof target.id !== 'string' ||
        !/^\d{10,22}$/.test(target.id) ||
        (job.target !== null && !genericSame(target, job.target))
      )
        return genericUnavailable();
    } else if (
      job.operation !== 'create_draft' ||
      refs.some((ref) => ref.dataset === 'editable_snapshot')
    )
      return genericUnavailable();
    if (job.operation === 'resume_create_draft' || job.operation === 'repair_created_draft') {
      const context = genericObject(witness.creationContext, [
        'originalJobId',
        'recoveryJobId',
        'previousRepairJobId',
      ]);
      if (
        !writeTaskUuid(context.originalJobId) ||
        (job.operation === 'resume_create_draft'
          ? context.recoveryJobId !== null || context.previousRepairJobId !== null
          : !writeTaskUuid(context.recoveryJobId) ||
            (context.previousRepairJobId !== null && !writeTaskUuid(context.previousRepairJobId)))
      )
        return genericUnavailable();
    } else if (witness.creationContext !== null) return genericUnavailable();
    if (witness.failure !== null) {
      const f = genericObject(witness.failure, ['kind', 'at']);
      if (
        ![
          'source_unavailable',
          'pre_read_blocked',
          'precondition_blocked',
          'capture_failed',
          'persist_failed',
        ].includes(String(f.kind)) ||
        !writeTaskTime(f.at) ||
        f.at < witness.startedAt
      )
        return genericUnavailable();
    }
    if (!Array.isArray(witness.observations)) return genericUnavailable();
    const expectedRoles =
      job.operation === 'resume_create_draft'
        ? [
            ['creation-resume-baseline', 'baseline'],
            ['editable_snapshot', 'baseline'],
            ['editable_snapshot', 'after'],
          ]
        : job.operation === 'repair_created_draft'
          ? [
              ['creation-repair-baseline', 'baseline'],
              ['editable_snapshot', 'baseline'],
              ['editable_snapshot', 'after'],
              ['creation-repair-verification', 'after'],
            ]
          : job.operation === 'editable_snapshot'
            ? [['editable_snapshot', 'snapshot_read']]
            : job.operation === 'reconcile_write'
              ? [['reconciliation', 'later_read']]
              : [
                  ['editable_snapshot', 'baseline'],
                  ['editable_snapshot', 'after'],
                ];
    const observed: Array<{ ref: EvidenceRef; snapshot: ModernShortSnapshot; phase: string }> = [];
    if (
      refs.length !== documents.length ||
      refs.length >
        (job.operation === 'repair_created_draft'
          ? 6
          : job.operation === 'create_draft' || job.operation === 'resume_create_draft'
            ? 5
            : job.kind === 'read'
              ? 1
              : 4)
    )
      return genericUnavailable();
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i]!,
        document = documents[i]!;
      genericObject(ref, genericRefKeys);
      genericObject(document, [
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
        !writeTaskUuid(ref.id) ||
        !datasetName.test(ref.dataset) ||
        ref.jobId !== job.id ||
        ref.accountId !== job.accountId ||
        document.schemaVersion !== 1 ||
        document.evidenceId !== ref.id ||
        document.jobId !== ref.jobId ||
        document.accountId !== ref.accountId ||
        document.dataset !== ref.dataset ||
        document.capturedAt !== ref.capturedAt ||
        !writeTaskTime(ref.capturedAt) ||
        !/^[a-f0-9]{64}$/.test(ref.sha256) ||
        document.collectionMode !== provenance.mode ||
        document.evidenceKind !==
          (ref.dataset === 'write-intent' ? 'local-intent' : 'observation') ||
        (job.platformReadStartedAt && ref.capturedAt < job.platformReadStartedAt) ||
        (job.endedAt && ref.capturedAt > job.endedAt)
      )
        return genericUnavailable();
      const payload = genericObject(document.payload);
      let snapshot: unknown,
        phase: string | null = null;
      if (ref.dataset === 'editable_snapshot') {
        genericObject(payload, ['schema', 'phase', 'snapshot', 'source']);
        if (payload.schema !== 'fanqie-generic-short-editor-observation/v1')
          return genericUnavailable();
        snapshot = payload.snapshot;
        phase = String(payload.phase);
      } else if (ref.dataset === 'creation-resume-baseline') {
        genericObject(payload, [
          'originalJobId',
          'requestedContentHash',
          'target',
          'snapshot',
          'source',
          'statusProtocol',
        ]);
        snapshot = payload.snapshot;
        phase = 'baseline';
      } else if (ref.dataset === 'creation-repair-baseline') {
        genericObject(payload, [
          'originalJobId',
          'recoveryJobId',
          'requestedContentHash',
          'expectedContentHash',
          'target',
          'snapshot',
          'source',
          'statusProtocol',
        ]);
        snapshot = payload.snapshot;
        phase = 'baseline';
      } else if (ref.dataset === 'creation-repair-verification') {
        genericObject(payload, [
          'originalJobId',
          'recoveryJobId',
          'target',
          'snapshot',
          'source',
          'statusProtocol',
        ]);
        snapshot = payload.snapshot;
        phase = 'after';
      } else if (ref.dataset === 'reconciliation') {
        genericObject(
          payload,
          [
            'source',
            'reconciliation',
            'sourceUrl',
            'platformReadAt',
            'statusProtocol',
            'statusSnapshot',
            'originalAudit',
          ],
          ['repairVerification'],
        );
        snapshot = payload.statusSnapshot;
        phase = 'later_read';
      } else if (ref.dataset === 'write-intent') {
        if (payload.phase === 'creation-entry') {
          genericObject(
            payload,
            [
              'phase',
              'capability',
              'clientReferenceHash',
              'requestedContentHash',
              'statusProtocol',
            ],
            ['target'],
          );
          if (
            job.operation !== 'create_draft' ||
            payload.capability !== 'create_draft' ||
            payload.clientReferenceHash !== bindings.clientReferenceHash ||
            payload.requestedContentHash !== bindings.requestedContentHash
          )
            return genericUnavailable();
        } else {
          genericObject(payload, [
            'desiredContentHash',
            'expectedStates',
            'target',
            'statusProtocol',
          ]);
          if (
            !genericSame(payload.target, witness.target) ||
            !genericSame(payload.expectedStates, ['draft_saved']) ||
            typeof payload.desiredContentHash !== 'string' ||
            (['update_draft', 'repair_created_draft'].includes(job.operation)
              ? payload.desiredContentHash !== bindings.desiredContentHash
              : ['create_draft', 'resume_create_draft'].includes(job.operation)
                ? payload.desiredContentHash !== bindings.requestedContentHash
                : true)
          )
            return genericUnavailable();
        }
        if (payload.statusProtocol !== GENERIC_SHORT_STATUS_PROTOCOL) return genericUnavailable();
      } else if (ref.dataset === 'write-result') {
        genericObject(payload, [
          'status',
          'capability',
          'target',
          'contentHash',
          'platformState',
          'verifiedAt',
          'sourceUrl',
        ]);
        if (payload.status !== 'succeeded' || payload.platformState !== 'draft')
          return genericUnavailable();
      } else return genericUnavailable();
      if (phase !== null) {
        if (
          (ref.dataset !== 'editable_snapshot' &&
            payload.statusProtocol !== GENERIC_SHORT_STATUS_PROTOCOL) ||
          !genericSame(payload.source, { mode: 'live', origin: 'https://fanqienovel.com' })
        )
          return genericUnavailable();
        if (
          [
            'creation-resume-baseline',
            'creation-repair-baseline',
            'creation-repair-verification',
          ].includes(ref.dataset)
        ) {
          const context = genericObject(witness.creationContext, [
            'originalJobId',
            'recoveryJobId',
            'previousRepairJobId',
          ]);
          if (
            payload.originalJobId !== context.originalJobId ||
            (ref.dataset !== 'creation-resume-baseline' &&
              payload.recoveryJobId !== context.recoveryJobId) ||
            !genericSame(payload.target, witness.target) ||
            (ref.dataset !== 'creation-repair-verification' &&
              payload.requestedContentHash !== bindings.requestedContentHash) ||
            (ref.dataset === 'creation-repair-baseline' &&
              payload.expectedContentHash !== bindings.expectedContentHash)
          )
            return genericUnavailable();
        }
        let value: ModernShortSnapshot;
        try {
          value = validateGenericShortSnapshot(snapshot);
        } catch {
          return genericUnavailable();
        }
        if (
          value.accountId !== witness.platformOwnerId ||
          !genericSame({ kind: 'short-story', id: value.target.workId }, witness.target) ||
          value.statusProof.owner.kind !== witness.identityType ||
          value.statusProof.profileId !== witness.profileId ||
          value.statusProof.profileVerifiedAt !== witness.profileVerifiedAt ||
          value.platformReadAt > ref.capturedAt ||
          (job.platformReadStartedAt && value.statusProof.readStartedAt < job.platformReadStartedAt)
        )
          return genericUnavailable();
        const expected = expectedRoles[observed.length];
        if (!expected || expected[0] !== ref.dataset || expected[1] !== phase)
          return genericUnavailable();
        observed.push({ ref, snapshot: value, phase });
      }
    }
    const entries = refs.filter(
        (ref, i) =>
          ref.dataset === 'write-intent' &&
          genericObject(documents[i]!.payload).phase === 'creation-entry',
      ),
      desired = refs.filter(
        (ref, i) =>
          ref.dataset === 'write-intent' &&
          genericObject(documents[i]!.payload).phase !== 'creation-entry',
      ),
      results = refs.filter((ref) => ref.dataset === 'write-result');
    if (
      entries.length > 1 ||
      desired.length > 1 ||
      results.length > 1 ||
      (job.operation !== 'create_draft' && entries.length) ||
      (job.kind === 'read' && (entries.length || desired.length || results.length)) ||
      (job.operation === 'create_draft' && observed.length && !entries.length)
    )
      return genericUnavailable();
    const baseline = observed.find(
        (value) => value.ref.dataset === 'editable_snapshot' && value.phase === 'baseline',
      ),
      after = observed.find(
        (value) => value.ref.dataset === 'editable_snapshot' && value.phase === 'after',
      );
    if (
      (entries.length && baseline && entries[0]!.capturedAt > baseline.ref.capturedAt) ||
      (desired.length &&
        (!baseline ||
          desired[0]!.capturedAt < baseline.ref.capturedAt ||
          (job.platformWriteStartedAt && desired[0]!.capturedAt > job.platformWriteStartedAt))) ||
      (after && (!desired.length || desired[0]!.capturedAt > after.ref.capturedAt)) ||
      (results.length && (!after || results[0]!.capturedAt < observed.at(-1)!.ref.capturedAt))
    )
      return genericUnavailable();
    if (
      after &&
      desired.length &&
      genericObject(documents[refs.indexOf(desired[0]!)]!.payload).desiredContentHash !==
        after.snapshot.contentHash &&
      job.status === 'succeeded'
    )
      return genericUnavailable();
    if (
      witness.observations.length > observed.length ||
      ((!production || witness.stage === 'completed') &&
        witness.observations.length !== observed.length)
    )
      return genericUnavailable();
    witness.observations.forEach((value, i) => {
      const o = genericObject(value, ['ordinal', 'dataset', 'phase', 'evidenceId', 'evidenceHash']),
        actual = observed[i];
      if (
        !actual ||
        o.ordinal !== i + 1 ||
        o.dataset !== actual.ref.dataset ||
        o.phase !== actual.phase ||
        o.evidenceId !== actual.ref.id ||
        o.evidenceHash !== actual.ref.sha256
      )
        return genericUnavailable();
    });
    if (production) {
      const registered = deps.newGenericJobs.get(job.id),
        trusted = deps.genericShortStatusContext?.(job.id);
      if (!registered || !trusted || job.ownerId !== deps.ownerId || job.status !== 'running')
        return genericUnavailable();
      for (const key of [
        'id',
        'ownerId',
        'accountId',
        'kind',
        'operation',
        'scope',
        'datasets',
        'inputHash',
        'requestedAt',
      ] as const)
        if (!genericSame(job[key], registered[key])) return genericUnavailable();
      const expected = {
        jobId: job.id,
        accountId: job.accountId,
        kind: job.kind,
        operation: job.operation,
        scope: job.scope,
        datasets: job.datasets,
        inputHash: job.inputHash,
        target: witness.target,
        creationContext: witness.creationContext,
        requestBindings: witness.requestBindings,
        identityType: witness.identityType,
        platformOwnerId: witness.platformOwnerId,
        profileId: witness.profileId,
        profileVerifiedAt: witness.profileVerifiedAt,
        provenance: witness.provenance,
      };
      if (!genericSame(trusted, expected)) return genericUnavailable();
    }
    return witness;
  }
  return genericWitness;
}
