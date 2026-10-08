import { type Job, RuntimeError } from '../runtime-error.js';
import {
  canonicalJson,
  nativeReconciliationUnavailable,
  sameNativeValue,
  timestamp,
  nativeUnknownError,
} from '../native-closure-signal.js';
import { randomUUID } from 'node:crypto';
import { PublicReadCoordinator } from '../../public-read.js';
import {
  copyNativeShortJson,
  validateNativeShortReconciliationContext,
  type NativeShortClosure,
  createNativeShortOriginalAudit,
  isCanonicalNativeTime,
} from '../../../platform/short-native-metadata-proof.js';
import { type NativeOriginalEvidenceOperation } from '../contracts/evidence-public-evidence-file-size.js';
import { type NativeReconciliationRowOperation } from '../contracts/native-compensation-validate-native-compensation-source-identity.js';
import {
  type ValidateNativeClosureOperation,
  type NativeLaterReadOperation,
  type AssertNativeLiveSettlementOperation,
  type GetJobOperation,
  type ReconcileNativeShortWriteOperation,
  type AssertNativeShortSubmissionLiveSettlementOperation,
  type ValidateNativeShortSubmissionHistoryOperation,
  type RawJobOperation,
  type GetNativeShortSubmissionOriginalAuditOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';

import {
  type PrepareOperation,
  type AssertOwnershipOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';

import {
  type NativeShortSubmissionOriginalAudit,
  type NativeShortSubmissionClosure,
  createNativeShortSubmissionOriginalAudit,
  type NativeShortSubmissionReconciliationContext,
  validateNativeShortSubmissionClosureContext,
  NATIVE_SHORT_SUBMISSION_OPERATION,
} from '../../../platform/short-native-submission-proof.js';

import {
  type NativeShortSubmissionContextOperation,
  type NativeShortSubmissionSettlementErrorOperation,
  type NativeShortSubmissionLaterReadOperation,
} from '../contracts/native-states-native-short-submission-context.js';

interface ReconcileNativeShortWriteDependencies {
  publicReads: PublicReadCoordinator;
  nativeOriginalEvidence: NativeOriginalEvidenceOperation;
  nativeReconciliationRow: NativeReconciliationRowOperation;
  validateNativeClosure: ValidateNativeClosureOperation;
  nativeLaterRead: NativeLaterReadOperation;
  assertNativeLiveSettlement: AssertNativeLiveSettlementOperation;
  prepare: PrepareOperation;
  getJob: GetJobOperation;
}

export function createReconcileNativeShortWrite(
  deps: ReconcileNativeShortWriteDependencies,
): ReconcileNativeShortWriteOperation {
  function reconcileNativeShortWrite(
    original: Job,
    readJob: Job,
    resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: unknown },
  ): Job {
    deps.publicReads.assertMutationAllowed();
    try {
      const { refs, documents } = deps.nativeOriginalEvidence(original);
      const prior = deps.nativeReconciliationRow(original.id, 'last');
      const version =
        (documents[0]?.payload as { schema?: unknown })?.schema ===
        'native-short-metadata-held-before/v2'
          ? 2
          : 1;
      const audit = prior
        ? (() => {
            const validated = deps.validateNativeClosure(original);
            return createNativeShortOriginalAudit(
              original,
              refs,
              { firstAudit: validated.firstAudit, previousClosure: validated.current },
              version,
            );
          })()
        : createNativeShortOriginalAudit(original, refs, undefined, version);
      const read = deps.nativeLaterRead(original.id, readJob.id);
      if (
        !sameNativeValue(
          audit,
          (read.document.payload as { originalAudit?: unknown })?.originalAudit,
        )
      )
        return nativeReconciliationUnavailable();
      const checked = validateNativeShortReconciliationContext({
        accountId: original.accountId,
        originalJob: original,
        originalRefs: refs,
        originalDocuments: documents,
        readJob: read.job,
        manifest: read.manifest,
        ref: read.ref,
        document: read.document,
      });
      deps.assertNativeLiveSettlement(checked, documents, read.document);
      const requested = copyNativeShortJson(resolution) as typeof resolution;
      if (
        Object.keys(requested).length !== 2 ||
        !Object.hasOwn(requested, 'status') ||
        !Object.hasOwn(requested, 'result') ||
        requested.status !== checked.status ||
        !sameNativeValue(requested.result, checked.result)
      )
        return nativeReconciliationUnavailable();
      const now = timestamp();
      const closure: NativeShortClosure = {
        schema: checked.evidence.schema.endsWith('/v2')
          ? 'native-short-metadata-closure/v2'
          : 'native-short-metadata-closure/v1',
        target: original.target! as NativeShortClosure['target'],
        reconciliationJobId: read.job.id,
        evidence: read.ref,
        observedStatus: checked.observedStatus,
        result: checked.result,
        originalAudit: audit,
        originalAttemptEvidence: prior
          ? (original.result as NativeShortClosure).originalAttemptEvidence
          : { readJobId: read.job.id, evidenceId: read.ref.id, evidenceHash: read.ref.sha256 },
      };
      const serialized = canonicalJson(closure);
      deps
        .prepare(
          'INSERT INTO write_reconciliations(id, original_job_id, read_job_id, evidence_id, status, created_at, result_json) VALUES(?, ?, ?, ?, ?, ?, ?)',
        )
        .run(randomUUID(), original.id, read.job.id, read.ref.id, checked.status, now, serialized);
      deps
        .prepare(
          'UPDATE jobs SET status = ?, result_json = ?, error_json = ?, ended_at = ?, updated_at = ? WHERE id = ?',
        )
        .run(
          checked.status,
          serialized,
          checked.status === 'succeeded' ? null : canonicalJson(nativeUnknownError),
          now,
          now,
          original.id,
        );
      return deps.getJob(original.id)!;
    } catch {
      return nativeReconciliationUnavailable();
    }
  }
  return reconcileNativeShortWrite;
}

interface ValidateNativeShortSubmissionHistoryDependencies {
  publicReads: PublicReadCoordinator;
  prepare: PrepareOperation;
  nativeShortSubmissionContext: NativeShortSubmissionContextOperation;
  nativeShortSubmissionSettlementError: NativeShortSubmissionSettlementErrorOperation;
  nativeShortSubmissionLaterRead: NativeShortSubmissionLaterReadOperation;
  assertNativeShortSubmissionLiveSettlement: AssertNativeShortSubmissionLiveSettlementOperation;
}

export function createValidateNativeShortSubmissionHistory(
  deps: ValidateNativeShortSubmissionHistoryDependencies,
): ValidateNativeShortSubmissionHistoryOperation {
  function validateNativeShortSubmissionHistory(job: Job): {
    firstAudit: NativeShortSubmissionOriginalAudit | null;
    last: NativeShortSubmissionClosure | null;
  } {
    return deps.publicReads.memo('store.validateNativeShortSubmissionHistory', [job], () => {
      const rows = deps
        .prepare(
          'SELECT rowid AS sequence, * FROM write_reconciliations WHERE original_job_id = ? ORDER BY rowid LIMIT 129',
        )
        .all(job.id);
      if (rows.length > 128) throw Error('Submission reconciliation history exceeds its bound');
      const actual = deps.nativeShortSubmissionContext(job);
      let firstAudit: NativeShortSubmissionOriginalAudit | null = null,
        previous: NativeShortSubmissionClosure | null = null;
      let previousSequence = 0;
      for (const row of rows) {
        const closure = JSON.parse(String(row.result_json)) as NativeShortSubmissionClosure;
        if (
          closure.schema !== 'native-short-submission-closure/v1' ||
          row.original_job_id !== job.id ||
          row.read_job_id !== closure.reconciliationJobId ||
          row.evidence_id !== closure.evidence.id ||
          row.status !== closure.status ||
          row.created_at !== closure.settledAt ||
          !isCanonicalNativeTime(row.created_at) ||
          row.created_at > timestamp() ||
          Number(row.sequence) <= previousSequence ||
          (previous &&
            (previous.status !== 'uncertain' ||
              previous.settledAt !== closure.originalAudit.priorEndedAt))
        )
          throw Error('Invalid submission reconciliation row');
        const audit = closure.originalAudit;
        const replayEndedAt = previous?.settledAt ?? audit.originalEndedAt;
        const replayJob: Job = {
          ...job,
          status: 'uncertain',
          endedAt: replayEndedAt,
          updatedAt: replayEndedAt,
          result: previous ?? { evidence: actual.refs },
          error: previous
            ? deps.nativeShortSubmissionSettlementError('uncertain')
            : audit.priorError,
        };
        const original = { ...actual, job: replayJob };
        const expectedAudit = createNativeShortSubmissionOriginalAudit(
          original,
          previous ? { firstAudit: firstAudit!, previousClosure: previous } : undefined,
        );
        const read = deps.nativeShortSubmissionLaterRead(String(row.read_job_id));
        if (
          !sameNativeValue(expectedAudit, audit) ||
          !sameNativeValue(
            expectedAudit,
            (read.document.payload as { originalAudit?: unknown }).originalAudit,
          )
        )
          throw Error('Invalid submission original audit');
        const context: NativeShortSubmissionReconciliationContext = { original, ...read };
        const verified = validateNativeShortSubmissionClosureContext(
          context,
          closure,
          String(row.created_at),
        );
        deps.assertNativeShortSubmissionLiveSettlement(context, verified);
        if (verified.status !== closure.status || !sameNativeValue(verified.result, closure.result))
          throw Error('Invalid submission settlement');
        firstAudit ??= audit;
        previous = closure;
        previousSequence = Number(row.sequence);
      }
      return { firstAudit, last: previous };
    });
  }
  return validateNativeShortSubmissionHistory;
}

interface GetNativeShortSubmissionOriginalAuditDependencies {
  publicReads: PublicReadCoordinator;
  assertOwnership: AssertOwnershipOperation;
  rawJob: RawJobOperation;
  nativeShortSubmissionContext: NativeShortSubmissionContextOperation;
  validateNativeShortSubmissionHistory: ValidateNativeShortSubmissionHistoryOperation;
}

export function createGetNativeShortSubmissionOriginalAudit(
  deps: GetNativeShortSubmissionOriginalAuditDependencies,
): GetNativeShortSubmissionOriginalAuditOperation {
  function getNativeShortSubmissionOriginalAudit(
    jobId: string,
  ): NativeShortSubmissionOriginalAudit {
    return deps.publicReads.memo('store.getNativeShortSubmissionOriginalAudit', [jobId], () => {
      deps.assertOwnership();
      try {
        const job = deps.rawJob(jobId);
        if (
          !job ||
          job.kind !== 'write' ||
          job.status !== 'uncertain' ||
          job.operation !== NATIVE_SHORT_SUBMISSION_OPERATION
        )
          throw Error('Invalid submission original');
        const context = deps.nativeShortSubmissionContext(job),
          history = deps.validateNativeShortSubmissionHistory(job);
        return createNativeShortSubmissionOriginalAudit(
          context,
          history.last
            ? { firstAudit: history.firstAudit!, previousClosure: history.last }
            : undefined,
        );
      } catch {
        throw new RuntimeError(
          'capability_unavailable',
          'Native short submission original evidence is unavailable.',
        );
      }
    });
  }
  return getNativeShortSubmissionOriginalAudit;
}
