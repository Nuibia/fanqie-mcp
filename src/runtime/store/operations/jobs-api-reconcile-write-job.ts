import {
  RuntimeError,
  type Job,
  type RuntimeFailure,
  type PlatformTarget,
  existingGenericReads,
} from '../runtime-error.js';
import {
  canonicalJson,
  bodyUnavailable,
  nativeReconciliationUnavailable,
  timestamp,
} from '../native-closure-signal.js';
import * as bodyProof from '../../../platform/short-native-body-proof.js';
import { randomUUID } from 'node:crypto';
import { PublicReadCoordinator } from '../../public-read.js';
import {
  genericUnavailable,
  genericObject,
  genericSame,
  hasGenericShortStatusSignal,
} from '../has-generic-short-status-signal.js';
import { hasReservedNativeShortTrialSignal } from '../../../platform/short-native-trial-proof.js';
import { hasReservedNativeShortSubmissionSignal } from '../../../platform/short-native-submission-proof.js';
import { hasReservedNativeShortCoverSignal } from '../../../platform/short-native-cover-proof.js';
import { hasReservedNativeShortSignal } from '../../../platform/short-native-metadata-proof.js';
import {
  type TransactionOperation,
  type PrepareOperation,
  type EnsureOpenOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';
import {
  type GetJobOperation,
  type ReconcileNativeShortBodyWriteOperation,
  type ReconcileNativeShortWriteOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';
import {
  type GetCreationRepairOperation,
  type GetCreationRepairSuccessorOperation,
} from '../contracts/creation-recovery-generic-creation-prior.js';

import {
  type ListEvidenceOperation,
  type ReadEvidenceOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

import {
  type ReconcileNativeShortSubmissionWriteOperation,
  type ReconcileNativeShortTrialWriteOperation,
  type ReconcileNativeShortCoverWriteOperation,
  type ReconcileWriteJobOperation,
  type GetCreationRecoveryOperation,
} from '../contracts/jobs-api-reconcile-native-short-submission-write.js';

import {
  type GetNativeCompensationContextOperation,
  type ReconcileNativeCompensationOperation,
} from '../contracts/native-compensation-validate-native-compensation-source-identity.js';

import {
  type GenericMutationGraphOperation,
  type GenericReadCompleteOperation,
  type GenericValidateAuditOperation,
} from '../contracts/generic-status-generic-refs.js';

interface ReconcileWriteJobDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  getJob: GetJobOperation;
  getCreationRepair: GetCreationRepairOperation;
  getCreationRepairSuccessor: GetCreationRepairSuccessorOperation;
  listEvidence: ListEvidenceOperation;
  readEvidence: ReadEvidenceOperation;
  reconcileNativeShortSubmissionWrite: ReconcileNativeShortSubmissionWriteOperation;
  reconcileNativeShortBodyWrite: ReconcileNativeShortBodyWriteOperation;
  reconcileNativeShortTrialWrite: ReconcileNativeShortTrialWriteOperation;
  reconcileNativeShortCoverWrite: ReconcileNativeShortCoverWriteOperation;
  getNativeCompensationContext: GetNativeCompensationContextOperation;
  reconcileNativeCompensation: ReconcileNativeCompensationOperation;
  reconcileNativeShortWrite: ReconcileNativeShortWriteOperation;
  genericMutationGraph: GenericMutationGraphOperation;
  genericReadComplete: GenericReadCompleteOperation;
  genericValidateAudit: GenericValidateAuditOperation;
  prepare: PrepareOperation;
}

export function createReconcileWriteJob(
  deps: ReconcileWriteJobDependencies,
): ReconcileWriteJobOperation {
  function reconcileWriteJob(
    originalId: string,
    reconciliationJobId: string,
    resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: unknown },
  ): Job {
    deps.publicReads.assertMutationAllowed();
    return deps.transaction(() => {
      const original = deps.getJob(originalId);
      const readJob = deps.getJob(reconciliationJobId);
      if (!original || original.kind !== 'write' || original.status !== 'uncertain')
        throw new RuntimeError(
          'invalid_reconciliation',
          'Only an uncertain platform write may be reconciled.',
        );
      if (
        (original.operation === 'resume_create_draft' && deps.getCreationRepair(originalId)) ||
        (original.operation === 'repair_created_draft' &&
          deps.getCreationRepairSuccessor(originalId))
      )
        throw new RuntimeError(
          'creation_repair_conflict',
          'Only the latest repair may be reconciled; older attempts retain their prior audit.',
        );
      if (!original.target)
        throw new RuntimeError(
          'reconciliation_target_missing',
          'The uncertain write has no known stable target; manual investigation is required.',
        );
      if (
        !readJob ||
        readJob.kind !== 'read' ||
        readJob.status !== 'succeeded' ||
        readJob.accountId !== original.accountId ||
        !readJob.platformReadStartedAt ||
        !original.endedAt
      ) {
        throw new RuntimeError(
          'invalid_reconciliation',
          'Reconciliation requires a completed real read for the same account.',
        );
      }
      const latestPossibleEffect = [
        original.endedAt,
        original.platformWriteStartedAt ?? original.startedAt ?? original.requestedAt,
      ]
        .sort()
        .at(-1)!;
      if (readJob.platformReadStartedAt <= latestPossibleEffect)
        throw new RuntimeError(
          'reconciliation_stale',
          'Reconciliation must read the platform after the uncertain write ended.',
        );
      // Native markers anywhere in the actual job/ref/document contexts cannot
      // fall back to the legacy caller-selected content-hash resolution.
      const originalRefs = deps.listEvidence(originalId),
        readRefs = deps.listEvidence(readJob.id);
      const contexts: unknown[] = [original, readJob, ...originalRefs, ...readRefs];
      for (const ref of [...originalRefs, ...readRefs]) {
        try {
          const doc = deps.readEvidence(ref);
          contexts.push(doc, doc.payload);
        } catch (error) {
          if (hasReservedNativeShortSubmissionSignal(contexts))
            throw new RuntimeError(
              'capability_unavailable',
              'Native submission reconciliation is unavailable',
            );
          if (contexts.some(bodyProof.hasReservedNativeShortBodySignal)) return bodyUnavailable();
          if (hasReservedNativeShortTrialSignal(contexts))
            throw new RuntimeError(
              'capability_unavailable',
              'Native short trial reconciliation is unavailable.',
            );
          if (hasReservedNativeShortCoverSignal(contexts))
            throw new RuntimeError(
              'capability_unavailable',
              'Native short cover reconciliation is unavailable.',
            );
          if (hasReservedNativeShortSignal(contexts)) return nativeReconciliationUnavailable();
        }
      }
      if (hasReservedNativeShortSubmissionSignal(contexts))
        return deps.reconcileNativeShortSubmissionWrite(original, readJob, resolution);
      if (contexts.some(bodyProof.hasReservedNativeShortBodySignal))
        return deps.reconcileNativeShortBodyWrite(original, readJob, resolution);
      if (hasReservedNativeShortTrialSignal(contexts))
        return deps.reconcileNativeShortTrialWrite(original, readJob, resolution);
      if (hasReservedNativeShortCoverSignal(contexts))
        return deps.reconcileNativeShortCoverWrite(original, readJob, resolution);
      if (hasReservedNativeShortSignal(contexts)) {
        const source = deps.getNativeCompensationContext(original.id);
        return source
          ? deps.reconcileNativeCompensation(source, readJob, resolution)
          : deps.reconcileNativeShortWrite(original, readJob, resolution);
      }
      if (!['succeeded', 'failed', 'uncertain'].includes(resolution.status))
        throw new RuntimeError('invalid_reconciliation', 'Invalid reconciliation status.');
      const reference = deps
        .listEvidence(readJob.id)
        .find((ref) => ref.dataset === 'reconciliation');
      if (!reference)
        throw new RuntimeError(
          'reconciliation_evidence_missing',
          'The read job must bind reconciliation evidence.',
        );
      const document = deps.readEvidence(reference);
      const payload = document.payload as {
        source?: { mode?: string; origin?: string };
        reconciliation?: {
          originalJobId?: string;
          target?: PlatformTarget;
          inputHash?: string;
          observedStatus?: string;
          observedContentHash?: string;
        };
      } | null;
      const observation = payload?.reconciliation;
      if (
        document.collectionMode !== 'live' ||
        document.evidenceKind !== 'observation' ||
        payload?.source?.mode !== 'live' ||
        payload?.source?.origin !== 'https://fanqienovel.com'
      ) {
        throw new RuntimeError(
          'reconciliation_not_live',
          'Fixture or unverified sources cannot close an unknown platform write.',
        );
      }
      if (
        !observation ||
        observation.originalJobId !== originalId ||
        observation.inputHash !== original.inputHash ||
        !observation.target ||
        canonicalJson(observation.target) !== canonicalJson(original.target)
      ) {
        throw new RuntimeError(
          'reconciliation_binding_invalid',
          'Reconciliation must match the original job, target and input hash.',
        );
      }
      const intentRef = deps
        .listEvidence(originalId)
        .filter((ref) => ref.dataset === 'write-intent')
        .at(-1);
      const intent = intentRef
        ? (deps.readEvidence(intentRef).payload as {
            desiredContentHash?: string;
            expectedStates?: string[];
          })
        : null;
      if (
        resolution.status !== 'uncertain' &&
        (!intent ||
          !/^[a-f0-9]{64}$/.test(intent.desiredContentHash ?? '') ||
          !Array.isArray(intent.expectedStates) ||
          intent.expectedStates.length === 0 ||
          intent.expectedStates.some((state) => typeof state !== 'string' || !state))
      ) {
        throw new RuntimeError(
          'reconciliation_intent_missing',
          'The original write lacks a verifiable content hash and expected states; keep its outcome uncertain.',
        );
      }
      if (
        (resolution.status === 'succeeded' &&
          (!intent!.expectedStates!.includes(observation.observedStatus ?? '') ||
            observation.observedContentHash !== intent!.desiredContentHash)) ||
        (resolution.status === 'failed' && observation.observedStatus !== 'not_applied') ||
        (resolution.status === 'uncertain' && observation.observedStatus !== 'unknown')
      ) {
        throw new RuntimeError(
          'reconciliation_status_conflict',
          'Requested resolution is unsupported by the observed platform state.',
        );
      }
      if (hasGenericShortStatusSignal(contexts)) {
        const graph = deps.genericMutationGraph(originalId, original.accountId),
          node = graph.jobs[reconciliationJobId]!;
        deps.genericReadComplete(node, true);
        deps.genericValidateAudit(node, graph);
        const actual = {
          contentHash: observation.observedContentHash,
          platformState: observation.observedStatus,
        };
        if (
          !genericSame(resolution.result, actual) ||
          resolution.status !==
            (observation.observedStatus === 'unknown' ? 'uncertain' : 'succeeded')
        )
          return genericUnavailable();
        const audit = genericObject(genericObject(node.documents[0]!.payload).originalAudit);
        if (audit.schema === 'generic-short-terminal-publication-bridge/v1')
          return genericUnavailable();
      }
      const now = timestamp();
      const result = {
        target: original.target,
        reconciliationJobId,
        evidence: reference,
        observedStatus: observation.observedStatus,
        result: resolution.result,
      };
      deps
        .prepare(
          'INSERT INTO write_reconciliations(id, original_job_id, read_job_id, evidence_id, status, created_at, result_json) VALUES(?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          randomUUID(),
          originalId,
          readJob.id,
          reference.id,
          resolution.status,
          now,
          canonicalJson(result),
        );
      const error: RuntimeFailure | null =
        resolution.status === 'succeeded'
          ? null
          : resolution.status === 'failed'
            ? {
                code: 'reconciled_not_applied',
                message:
                  'The platform read confirms the requested write was not applied; this idempotency key will not be replayed.',
              }
            : {
                code: 'outcome_unknown',
                message: 'The later platform read still cannot determine the write outcome.',
              };
      deps
        .prepare(
          'UPDATE jobs SET status = ?, result_json = ?, error_json = ?, ended_at = ?, updated_at = ? WHERE id = ?',
        )
        .run(
          resolution.status,
          canonicalJson(result),
          error ? canonicalJson(error) : null,
          now,
          now,
          originalId,
        );
      return deps.getJob(originalId)!;
    });
  }
  return reconcileWriteJob;
}

interface GetCreationRecoveryDependencies {
  publicReads: PublicReadCoordinator;
  ensureOpen: EnsureOpenOperation;
  prepare: PrepareOperation;
}

export function createGetCreationRecovery(
  deps: GetCreationRecoveryDependencies,
): GetCreationRecoveryOperation {
  function getCreationRecovery(
    originalId: string,
  ): { resumeJobId: string; closedAt: string | null } | null {
    return deps.publicReads.memo('store.getCreationRecovery', [originalId], () => {
      deps.ensureOpen();
      const row = deps.prepare(existingGenericReads.recoverySummary).get(originalId);
      return row
        ? { resumeJobId: String(row.resume_job_id), closedAt: row.closed_at as string | null }
        : null;
    });
  }
  return getCreationRecovery;
}
