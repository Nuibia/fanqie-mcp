import { RuntimeError, type Job, type PlatformTarget } from '../runtime-error.js';
import { canonicalJson, identifier, timestamp } from '../native-closure-signal.js';
import { PublicReadCoordinator } from '../../public-read.js';
import {
  genericUnavailable,
  genericObject,
  genericSame,
  genericWitnessKeys,
} from '../has-generic-short-status-signal.js';
import {
  type TransactionOperation,
  type PrepareOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';
import {
  type RunningJobOperation,
  type RawJobOperation,
  type AddJobMetadataOperation,
  type RecordTargetOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';
import {
  type ListEvidenceOperation,
  type ReadEvidenceOperation,
} from '../contracts/evidence-public-evidence-file-size.js';
import { type GenericWitnessOperation } from '../contracts/generic-status-generic-refs.js';

interface AddJobMetadataDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  runningJob: RunningJobOperation;
  listEvidence: ListEvidenceOperation;
  genericWitness: GenericWitnessOperation;
  readEvidence: ReadEvidenceOperation;
  prepare: PrepareOperation;
  rawJob: RawJobOperation;
  ownerId: `${string}-${string}-${string}-${string}-${string}`;
}

export function createAddJobMetadata(deps: AddJobMetadataDependencies): AddJobMetadataOperation {
  function addJobMetadata(id: string, values: Record<string, unknown>): Job {
    deps.publicReads.assertMutationAllowed();
    const banned =
      /^(body|content|text|html|markdown|args|arguments|payload|cookie|cookies|authorization|token|accessToken|refreshToken|password|secret|credentials|headers|storageState|target)$/i;
    if (!values || Object.getPrototypeOf(values) !== Object.prototype)
      throw new RuntimeError(
        'invalid_metadata',
        'Metadata must be a plain object of identifiers, hashes and flags.',
      );
    const flat = (key: string, value: unknown) =>
      identifier.test(key) &&
      !banned.test(key.replace(/[_-]/g, '')) &&
      (value === null ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'string' && value.length <= 512));
    if (Object.getOwnPropertySymbols(values).length)
      throw new RuntimeError('invalid_metadata', 'Metadata must contain ordinary string fields.');
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(values))) {
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
        throw new RuntimeError('invalid_metadata', 'Metadata must contain ordinary data fields.', {
          field: key,
        });
      if (key !== 'genericShortStatus' && !flat(key, descriptor.value))
        throw new RuntimeError(
          'invalid_metadata',
          'Do not persist content, arguments, credentials or nested objects as job metadata.',
          { field: key },
        );
    }
    const captured = genericObject(values);
    return deps.transaction(() => {
      const job = deps.runningJob(id),
        old = genericObject(job.metadata),
        metadata = { ...old, ...captured };
      for (const [key, value] of Object.entries(metadata))
        if (key !== 'genericShortStatus' && !flat(key, value))
          throw new RuntimeError(
            'invalid_metadata',
            'Do not persist content, arguments, credentials or nested objects as job metadata.',
            { field: key },
          );
      if (Object.hasOwn(captured, 'genericShortStatus')) {
        const proposed = genericObject(captured.genericShortStatus, genericWitnessKeys),
          previous =
            old.genericShortStatus === undefined
              ? null
              : genericObject(old.genericShortStatus, genericWitnessKeys);
        const strings = (value: unknown): void => {
          if (typeof value === 'string' && value.length > 512)
            throw new RuntimeError('invalid_metadata', 'Metadata strings exceed 512 characters.');
          if (value && typeof value === 'object')
            for (const child of Object.values(value)) strings(child);
        };
        strings(proposed);
        if (previous) {
          for (const key of genericWitnessKeys.filter(
            (key) => !['target', 'stage', 'observations', 'failure'].includes(key),
          ))
            if (!genericSame(previous[key], proposed[key])) return genericUnavailable();
          if (
            !genericSame(previous.target, proposed.target) &&
            !(
              job.operation === 'create_draft' &&
              previous.target === null &&
              genericSame(proposed.target, job.target)
            )
          )
            return genericUnavailable();
          if (previous.failure !== null && !genericSame(previous.failure, proposed.failure))
            return genericUnavailable();
          if (
            [
              'capture_failed',
              'persist_failed',
              'completed',
              'source_unavailable',
              'precondition_blocked',
            ].includes(String(previous.stage)) &&
            previous.stage !== proposed.stage
          )
            return genericUnavailable();
          const before = previous.observations as unknown[],
            after = proposed.observations as unknown[];
          if (
            !Array.isArray(before) ||
            !Array.isArray(after) ||
            after.length < before.length ||
            before.some((v, i) => !genericSame(v, after[i]))
          )
            return genericUnavailable();
          const allowed: Record<string, string[]> = {
            before_first_read: [
              'allocation_marked',
              'baseline_saved',
              'read_saved',
              'source_unavailable',
              'capture_failed',
              'persist_failed',
            ],
            allocation_marked: [
              'baseline_saved',
              'source_unavailable',
              'capture_failed',
              'persist_failed',
            ],
            baseline_saved: [
              'baseline_saved',
              'save_marked',
              'precondition_blocked',
              'capture_failed',
              'persist_failed',
            ],
            save_marked: ['after_saved', 'capture_failed', 'persist_failed'],
            after_saved: ['final_observed', 'completed', 'capture_failed', 'persist_failed'],
            final_observed: [
              'final_verified',
              'precondition_blocked',
              'capture_failed',
              'persist_failed',
            ],
            final_verified: ['completed', 'capture_failed', 'persist_failed'],
            read_saved: ['completed', 'capture_failed', 'persist_failed'],
          };
          if (
            previous.stage !== proposed.stage &&
            !(allowed[String(previous.stage)] ?? []).includes(String(proposed.stage))
          )
            return genericUnavailable();
        } else if (
          proposed.stage !== 'before_first_read' ||
          !genericSame(proposed.observations, []) ||
          proposed.failure !== null
        )
          return genericUnavailable();
        const refs = deps.listEvidence(id);
        deps.genericWitness(
          { ...job, metadata },
          refs,
          refs.map((ref) => deps.readEvidence(ref)),
          true,
        );
      } else if (Object.hasOwn(old, 'genericShortStatus')) {
        const refs = deps.listEvidence(id);
        deps.genericWitness(
          job,
          refs,
          refs.map((ref) => deps.readEvidence(ref)),
          true,
        );
      }
      const serialized = canonicalJson(metadata);
      if (Buffer.byteLength(serialized) > 8192)
        throw new RuntimeError('invalid_metadata', 'Metadata exceeds 8 KiB.');
      deps
        .prepare('UPDATE jobs SET metadata_json = ?, updated_at = ? WHERE id = ?')
        .run(serialized, timestamp(), id);
      const saved = deps.rawJob(id);
      if (
        !saved ||
        saved.ownerId !== deps.ownerId ||
        saved.status !== 'running' ||
        !genericSame(saved.metadata, metadata)
      )
        return genericUnavailable();
      if (Object.hasOwn(captured, 'genericShortStatus')) {
        const refs = deps.listEvidence(id);
        deps.genericWitness(
          saved,
          refs,
          refs.map((ref) => deps.readEvidence(ref)),
          true,
        );
      }
      return saved;
    });
  }
  return addJobMetadata;
}

interface RecordTargetDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  runningJob: RunningJobOperation;
  prepare: PrepareOperation;
}

export function createRecordTarget(deps: RecordTargetDependencies): RecordTargetOperation {
  function recordTarget(id: string, value: PlatformTarget | string): PlatformTarget {
    deps.publicReads.assertMutationAllowed();
    const target: PlatformTarget =
      typeof value === 'string' ? { kind: 'short-story', id: value } : value;
    if (
      !target ||
      !['short-story', 'long-book', 'chapter'].includes(target.kind) ||
      !identifier.test(target.id) ||
      (target.parentId !== undefined && !identifier.test(target.parentId)) ||
      Object.keys(target).some((key) => !['kind', 'id', 'parentId'].includes(key))
    ) {
      throw new RuntimeError(
        'invalid_target',
        'Target must contain a stable platform ID, kind and optional parent ID.',
      );
    }
    return deps.transaction(() => {
      const job = deps.runningJob(id);
      if (!job.platformReadStartedAt && !job.platformWriteStartedAt)
        throw new RuntimeError(
          'platform_not_accessed',
          'Record targets at the platform discovery boundary.',
        );
      if (job.target && canonicalJson(job.target) !== canonicalJson(target))
        throw new RuntimeError(
          'target_conflict',
          'The job already identifies another platform target.',
        );
      deps
        .prepare('UPDATE jobs SET target_json = ?, updated_at = ? WHERE id = ?')
        .run(canonicalJson(target), timestamp(), id);
      return structuredClone(target);
    });
  }
  return recordTarget;
}
