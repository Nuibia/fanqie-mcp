import { RuntimeError, type Job, type EvidenceRef, type Manifest } from '../runtime-error.js';
import {
  canonicalJson,
  bodyUnavailable,
  sameNativeValue,
  timestamp,
  bodyObject,
} from '../native-closure-signal.js';
import * as bodyProof from '../../../platform/short-native-body-proof.js';
import { randomUUID } from 'node:crypto';
import { PublicReadCoordinator } from '../../public-read.js';
import {
  genericUnavailable,
  genericSame,
  hasGenericShortExecutionSignal,
} from '../has-generic-short-status-signal.js';
import * as draftDirectory from '../../../platform/short-draft-directory.js';
import {
  hasReservedNativeShortTrialSignal,
  type NativeShortTrialOriginalAudit,
  validateNativeShortTrialReconciliationContext,
  NATIVE_SHORT_TRIAL_READ_OPERATION,
  validateNativeShortTrialReadContext,
} from '../../../platform/short-native-trial-proof.js';
import {
  hasReservedNativeShortSubmissionSignal,
  type NativeShortSubmissionOriginalAudit,
  validateNativeShortSubmissionReconciliationContext,
  NATIVE_SHORT_SUBMISSION_READ_OPERATION,
  validateNativeShortSubmissionReadContext,
} from '../../../platform/short-native-submission-proof.js';
import { hasReservedNativeShortCoverSignal } from '../../../platform/short-native-cover-proof.js';
import { hasReservedNativeShortSignal } from '../../../platform/short-native-metadata-proof.js';
import {
  type TransactionOperation,
  type PrepareOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';
import {
  type RunningJobOperation,
  type AssertNotCancelledOperation,
  type GetJobOperation,
  type GetNativeShortSubmissionOriginalAuditOperation,
  type RawJobOperation,
  type GetNativeShortBodyOriginalAuditOperation,
  type CompleteReadJobOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';

import {
  type ReadEvidenceOperation,
  type ListEvidenceOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

import {
  type NativeShortSubmissionContextOperation,
  type NativeShortTrialContextOperation,
} from '../contracts/native-states-native-short-submission-context.js';
import {
  type NativeShortBodyRecoveryFromPayloadOperation,
  type NativeShortBodyContextOperation,
} from '../contracts/native-body-native-short-body-signal.js';

import {
  type GetNativeShortTrialOriginalAuditOperation,
  type GetCurrentOperation,
} from '../contracts/jobs-api-reconcile-native-short-submission-write.js';

import {
  type GenericWitnessOperation,
  type GenericMutationGraphOperation,
  type GenericReadCompleteOperation,
  type GenericValidateAuditOperation,
} from '../contracts/generic-status-generic-refs.js';

interface CompleteReadJobDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  runningJob: RunningJobOperation;
  assertNotCancelled: AssertNotCancelledOperation;
  readEvidence: ReadEvidenceOperation;
  getJob: GetJobOperation;
  getNativeShortSubmissionOriginalAudit: GetNativeShortSubmissionOriginalAuditOperation;
  nativeShortSubmissionContext: NativeShortSubmissionContextOperation;
  nativeShortBodyRecoveryFromPayload: NativeShortBodyRecoveryFromPayloadOperation;
  rawJob: RawJobOperation;
  getNativeShortBodyOriginalAudit: GetNativeShortBodyOriginalAuditOperation;
  nativeShortBodyContext: NativeShortBodyContextOperation;
  getNativeShortTrialOriginalAudit: GetNativeShortTrialOriginalAuditOperation;
  nativeShortTrialContext: NativeShortTrialContextOperation;
  listEvidence: ListEvidenceOperation;
  getCurrent: GetCurrentOperation;
  genericWitness: GenericWitnessOperation;
  genericMutationGraph: GenericMutationGraphOperation;
  genericReadComplete: GenericReadCompleteOperation;
  genericValidateAudit: GenericValidateAuditOperation;
  prepare: PrepareOperation;
}

export function createCompleteReadJob(deps: CompleteReadJobDependencies): CompleteReadJobOperation {
  function completeReadJob(jobId: string, references: EvidenceRef[]): Manifest {
    deps.publicReads.assertMutationAllowed();
    return deps.transaction(() => {
      const job = deps.runningJob(jobId);
      deps.assertNotCancelled(job);
      if (job.kind !== 'read' || !job.platformReadStartedAt)
        throw new RuntimeError(
          'platform_not_accessed',
          'A read manifest requires a real platform access boundary.',
        );
      if (
        references.length !== job.datasets.length ||
        new Set(references.map((ref) => ref.dataset)).size !== job.datasets.length ||
        references.some((ref) => !job.datasets.includes(ref.dataset))
      ) {
        throw new RuntimeError(
          'incomplete_collection',
          'Every requested dataset must have exactly one verified evidence file.',
        );
      }
      let directoryReserved = [job, ...references].some(
        draftDirectory.hasReservedShortDraftDirectorySignal,
      );
      const readCompletionEvidence = (reference: EvidenceRef) => {
        try {
          const document = deps.readEvidence(reference);
          directoryReserved ||= draftDirectory.hasReservedShortDraftDirectorySignal(document);
          return document;
        } catch (error) {
          if (directoryReserved)
            throw new RuntimeError(
              'capability_unavailable',
              'Short draft directory is unavailable.',
            );
          throw error;
        }
      };
      for (const reference of references) {
        if (
          reference.jobId !== jobId ||
          reference.accountId !== job.accountId ||
          reference.capturedAt < job.platformReadStartedAt ||
          reference.capturedAt < job.requestedAt
        )
          throw new RuntimeError(
            'evidence_binding_invalid',
            'Read evidence must come from this request and account.',
          );
        readCompletionEvidence(reference);
      }
      const committedAt = timestamp();
      const manifest: Manifest = {
        schemaVersion: 1,
        id: randomUUID(),
        accountId: job.accountId,
        jobId,
        operation: job.operation,
        scope: job.scope,
        datasets: job.datasets,
        requestedAt: job.requestedAt,
        platformReadStartedAt: job.platformReadStartedAt,
        committedAt,
        evidence: [...references].sort((a, b) => a.dataset.localeCompare(b.dataset)),
      };
      const trialReadDocuments = references.map(readCompletionEvidence);
      const bodyRead = [job, manifest, ...references, ...trialReadDocuments].some(
        bodyProof.hasReservedNativeShortBodySignal,
      );
      if (
        [job, manifest, ...references, ...trialReadDocuments].some(
          hasReservedNativeShortSubmissionSignal,
        )
      ) {
        try {
          const prospective: Job = {
            ...job,
            status: 'succeeded',
            endedAt: committedAt,
            updatedAt: committedAt,
            result: { manifest },
            error: null,
          };
          if (job.operation === NATIVE_SHORT_SUBMISSION_READ_OPERATION) {
            validateNativeShortSubmissionReadContext({
              accountId: job.accountId,
              job: prospective,
              manifest,
              refs: references,
              documents: trialReadDocuments,
              attempts: [],
            });
          } else if (job.operation === 'reconcile_write') {
            if (
              references.length !== 1 ||
              trialReadDocuments.length !== 1 ||
              references[0]!.dataset !== 'reconciliation'
            )
              throw Error('Invalid submission later read');
            const document = trialReadDocuments[0]!,
              audit = (document.payload as { originalAudit?: NativeShortSubmissionOriginalAudit })
                .originalAudit;
            const original = audit && deps.getJob(audit.originalJobId, job.accountId);
            if (
              !original ||
              original.accountId !== job.accountId ||
              !sameNativeValue(audit, deps.getNativeShortSubmissionOriginalAudit(original.id))
            )
              throw Error('Invalid submission original audit');
            validateNativeShortSubmissionReconciliationContext({
              original: deps.nativeShortSubmissionContext(original),
              readJob: prospective,
              manifest,
              ref: references[0]!,
              document,
            });
          } else throw Error('Invalid submission read operation');
        } catch (error) {
          throw new RuntimeError(
            'capability_unavailable',
            'Native short submission read completion is unavailable.',
          );
        }
      } else if (bodyRead) {
        try {
          const prospective: Job = {
            ...job,
            status: 'succeeded',
            endedAt: committedAt,
            updatedAt: committedAt,
            result: { manifest },
            error: null,
          };
          if (
            job.operation !== bodyProof.NATIVE_SHORT_BODY_RECONCILE_OPERATION ||
            references.length !== 1 ||
            trialReadDocuments.length !== 1
          )
            throw Error('Invalid body later read');
          const ref = references[0]!,
            document = trialReadDocuments[0]!,
            audit = bodyObject(document.payload)
              .originalAudit as bodyProof.NativeShortBodyOriginalAudit;
          const recoveryContext = deps.nativeShortBodyRecoveryFromPayload(
            document.payload,
            job.accountId,
          );
          const original = deps.rawJob(audit.originalJobId);
          if (
            !original ||
            original.accountId !== job.accountId ||
            !sameNativeValue(
              audit,
              deps.getNativeShortBodyOriginalAudit(original.id, job.accountId, recoveryContext),
            )
          )
            throw Error('Invalid body audit');
          bodyProof.validateNativeShortBodyReconciliationContext({
            original: deps.nativeShortBodyContext(original),
            readJob: prospective,
            manifest,
            ref,
            document,
            ...(recoveryContext ? { recoveryContext } : {}),
          });
        } catch {
          return bodyUnavailable();
        }
      } else if (
        [job, manifest, ...references, ...trialReadDocuments].some(
          hasReservedNativeShortTrialSignal,
        )
      ) {
        try {
          const prospective: Job = {
            ...job,
            status: 'succeeded',
            endedAt: committedAt,
            updatedAt: committedAt,
            result: { manifest },
            error: null,
          };
          if (job.operation === NATIVE_SHORT_TRIAL_READ_OPERATION) {
            validateNativeShortTrialReadContext({
              accountId: job.accountId,
              job: prospective,
              manifest,
              refs: references,
              documents: trialReadDocuments,
              attempts: [],
            });
          } else if (job.operation === 'reconcile_write') {
            if (
              references.length !== 1 ||
              trialReadDocuments.length !== 1 ||
              references[0]!.dataset !== 'reconciliation'
            )
              throw Error('Invalid trial later read');
            const document = trialReadDocuments[0]!,
              audit = (document.payload as { originalAudit?: NativeShortTrialOriginalAudit })
                .originalAudit;
            const original = audit && deps.getJob(audit.originalJobId, job.accountId);
            if (
              !original ||
              original.accountId !== job.accountId ||
              !sameNativeValue(audit, deps.getNativeShortTrialOriginalAudit(original.id))
            )
              throw Error('Invalid trial original audit');
            validateNativeShortTrialReconciliationContext({
              original: deps.nativeShortTrialContext(original),
              readJob: prospective,
              manifest,
              ref: references[0]!,
              document,
            });
          } else throw Error('Invalid trial read operation');
        } catch {
          throw new RuntimeError(
            'capability_unavailable',
            'Native short trial read completion is unavailable.',
          );
        }
      }
      // Re-read the complete SQL-owned reference set and physical documents inside
      // this transaction. App prefix validation cannot authorize promotion.
      const directoryRefs = deps.listEvidence(jobId);
      if (
        directoryReserved ||
        directoryRefs.some(draftDirectory.hasReservedShortDraftDirectorySignal)
      ) {
        try {
          const documents = directoryRefs.map((ref) => deps.readEvidence(ref));
          const prospective: Job = {
            ...job,
            status: 'succeeded',
            endedAt: committedAt,
            updatedAt: committedAt,
            result: { manifest },
            error: null,
          };
          const projection = draftDirectory.validateShortDraftDirectoryContext(
            {
              accountId: job.accountId,
              job: prospective,
              manifest,
              refs: directoryRefs,
              documents,
              evaluationAt: committedAt,
            },
            'completion',
          );
          if (!job.deadlineAt || timestamp() > job.deadlineAt)
            throw Error('Directory completion deadline');
          if (projection.collectionMode === 'fixture') {
            const previous = deps.getCurrent(
              job.accountId,
              draftDirectory.SHORT_DRAFT_DIRECTORY_SCOPE,
            );
            if (previous) {
              const previousJob = deps.getJob(previous.jobId, job.accountId);
              if (!previousJob) throw Error('Invalid current directory');
              const refs = deps.listEvidence(previousJob.id);
              const existing = draftDirectory.projectShortDraftDirectoryContext({
                accountId: job.accountId,
                job: previousJob,
                manifest: previous,
                refs,
                documents: refs.map((ref) => deps.readEvidence(ref)),
                evaluationAt: committedAt,
              });
              if (existing.collectionMode !== 'fixture')
                throw Error('Fixture cannot replace live directory');
            }
          }
        } catch {
          throw new RuntimeError('capability_unavailable', 'Short draft directory is unavailable.');
        }
      }
      if (
        ![job, ...trialReadDocuments].some(hasReservedNativeShortSubmissionSignal) &&
        !bodyRead &&
        ![job, ...trialReadDocuments].some(hasReservedNativeShortTrialSignal) &&
        ![job, ...trialReadDocuments].some(hasReservedNativeShortCoverSignal) &&
        ![job, ...trialReadDocuments].some(hasReservedNativeShortSignal) &&
        !directoryReserved &&
        hasGenericShortExecutionSignal(job, references, trialReadDocuments)
      ) {
        const actualRefs = deps.listEvidence(job.id);
        if (!genericSame(actualRefs, references)) return genericUnavailable();
        const documents = actualRefs.map((ref) => deps.readEvidence(ref));
        deps.genericWitness(job, actualRefs, documents, true);
        const prospective: Job = {
          ...job,
          status: 'succeeded',
          endedAt: committedAt,
          updatedAt: committedAt,
          result: { manifest },
          error: null,
        };
        const graph = deps.genericMutationGraph(job.id, job.accountId),
          node = {
            ...graph.jobs[job.id]!,
            job: prospective,
            manifest,
            refs: actualRefs,
            documents,
          };
        graph.jobs[job.id] = node;
        deps.genericReadComplete(node, true);
        if (job.operation === 'reconcile_write') deps.genericValidateAudit(node, graph);
        const repeated = deps.genericMutationGraph(job.id, job.accountId);
        for (const [id, value] of Object.entries(graph.jobs))
          if (id !== job.id && !genericSame(value, repeated.jobs[id])) return genericUnavailable();
      }
      const serialized = canonicalJson(manifest);
      deps
        .prepare(
          'INSERT INTO manifests(id, account_id, job_id, scope, committed_at, manifest_json) VALUES(?, ?, ?, ?, ?, ?)',
        )
        .run(manifest.id, job.accountId, jobId, job.scope, committedAt, serialized);
      deps
        .prepare(
          'INSERT INTO current_manifests(account_id, scope, manifest_id) VALUES(?, ?, ?) ON CONFLICT(account_id, scope) DO UPDATE SET manifest_id = excluded.manifest_id',
        )
        .run(job.accountId, job.scope, manifest.id);
      deps
        .prepare(
          'UPDATE jobs SET status = ?, ended_at = ?, updated_at = ?, result_json = ?, error_json = NULL WHERE id = ?',
        )
        .run('succeeded', committedAt, committedAt, canonicalJson({ manifest }), jobId);
      return manifest;
    });
  }
  return completeReadJob;
}
