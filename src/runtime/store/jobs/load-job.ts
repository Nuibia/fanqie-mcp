import { RuntimeError, type Job, existingGenericReads, type Manifest } from '../runtime-error.js';
import {
  canonicalJson,
  bodyUnavailable,
  nativeRegistrationDataset,
  nativeRegistrationOperation,
  nativeReconciliationUnavailable,
  sameNativeValue,
  nativeClosureSignal,
} from '../native-closure-signal.js';

import * as draftDirectory from '../../../platform/short-draft-directory.js';
import {
  hasReservedNativeShortTrialSignal,
  validateNativeShortTrialCompletion,
  type NativeShortTrialOriginalAudit,
  validateNativeShortTrialReconciliationContext,
  NATIVE_SHORT_TRIAL_READ_OPERATION,
  validateNativeShortTrialReadContext,
} from '../../../platform/short-native-trial-proof.js';
import {
  hasReservedNativeShortSubmissionSignal,
  validateNativeShortSubmissionCompletion,
  validateNativeShortSubmissionEvidenceContext,
  type NativeShortSubmissionOriginalAudit,
  validateNativeShortSubmissionReconciliationContext,
  NATIVE_SHORT_SUBMISSION_READ_OPERATION,
  validateNativeShortSubmissionReadContext,
} from '../../../platform/short-native-submission-proof.js';
import {
  hasReservedNativeShortCoverSignal,
  validateNativeShortCoverCompletion,
  type NativeShortCoverOriginalAudit,
  validateNativeShortCoverReconciliationContext,
} from '../../../platform/short-native-cover-proof.js';
import { hasReservedNativeShortSignal } from '../../../platform/short-native-metadata-proof.js';

import { type GetJobDependencies } from '../operations/jobs-api-with-public-projection-read.js';
interface Ports {
  deps: GetJobDependencies;
  accountId: string | undefined;
  id: string;
}
export function createJobLoader(ports: Ports) {
  return () => {
    ports.deps.ensureOpen();
    const row =
      ports.accountId === undefined
        ? ports.deps.prepare(existingGenericReads.rawJob).get(ports.id)
        : ports.deps.prepare(existingGenericReads.filteredJob).get(ports.id, ports.accountId);
    if (!row) return null;
    const latest = ports.deps.nativeReconciliationRow(ports.id, 'last');
    let job: Job;
    try {
      job = ports.deps.decodeJob(row as Record<string, unknown>);
    } catch (error) {
      if (
        [row.scope, row.datasets_json, row.result_json, row.metadata_json, latest?.resultJson].some(
          (value) =>
            typeof value === 'string' &&
            /(?:native-short-submission|native-short-prepared-submission|short_native_submission)/.test(
              value,
            ),
        )
      )
        throw new RuntimeError(
          'capability_unavailable',
          'Native submission evidence is unavailable',
        );
      if (
        [
          row.operation,
          row.scope,
          row.datasets_json,
          row.result_json,
          row.metadata_json,
          latest?.resultJson,
        ].some(
          (value) =>
            typeof value === 'string' &&
            /(?:native-short-body|short_native_body|update_short_body|reconcile_short_body_write)/.test(
              value,
            ),
        )
      )
        return bodyUnavailable();
      const directoryRaw = [
        row.datasets_json,
        row.result_json,
        row.metadata_json,
        row.target_json,
        row.error_json,
        row.cancellation_reason_json,
      ].some(
        (value) =>
          typeof value === 'string' &&
          /(?:short_drafts|shortDraftDirectory|short-draft-directory)/.test(value),
      );
      if (
        draftDirectory.hasReservedShortDraftDirectorySignal({
          operation: String(row.operation),
          scope: String(row.scope),
        }) ||
        directoryRaw
      )
        throw new RuntimeError('capability_unavailable', 'Short draft directory is unavailable.');
      const trialRaw = [
        row.datasets_json,
        row.result_json,
        row.metadata_json,
        row.target_json,
        row.error_json,
        row.cancellation_reason_json,
        latest?.resultJson,
      ].some(
        (value) =>
          typeof value === 'string' &&
          /(?:native-short-trial|short_native_trial|"trial"\s*:|"trialRatio"\s*:)/.test(value),
      );
      if (
        hasReservedNativeShortTrialSignal({
          operation: String(row.operation),
          scope: String(row.scope),
        }) ||
        trialRaw
      )
        throw new RuntimeError(
          'capability_unavailable',
          'Native short trial evidence is unavailable.',
        );
      if (
        String(row.scope).startsWith('short_native_cover.') ||
        String(row.result_json).includes('native-short-cover') ||
        latest?.resultJson.includes('native-short-cover')
      )
        throw new RuntimeError(
          'capability_unavailable',
          'Native short cover evidence is unavailable.',
        );
      if (
        String(row.scope).startsWith('short_native_metadata.') ||
        String(row.scope).startsWith(nativeRegistrationDataset) ||
        String(row.operation) === nativeRegistrationOperation ||
        String(row.metadata_json).includes('native-short-metadata-compensation-registration') ||
        String(row.datasets_json).includes(nativeRegistrationDataset) ||
        String(row.result_json).includes('native-short-metadata-compens') ||
        String(row.error_json).includes('native_write_compensated') ||
        latest?.resultJson.includes('native-short-metadata')
      )
        return nativeReconciliationUnavailable();
      throw error;
    }
    // Submission embeds full metadata snapshots: classify it before the older namespace.
    const submissionReadRefs = ports.deps.listEvidence(job.id);
    const submissionSignals: unknown[] = [job, ...submissionReadRefs];
    let submissionRead = false;
    for (const ref of submissionReadRefs) {
      try {
        const document = ports.deps.readEvidence(ref);
        submissionSignals.push(document);
        submissionRead ||= hasReservedNativeShortSubmissionSignal(document);
      } catch {
        if (hasReservedNativeShortSubmissionSignal(submissionSignals))
          throw new RuntimeError(
            'capability_unavailable',
            'Native short submission evidence is unavailable.',
          );
      }
    }
    if (
      hasReservedNativeShortSubmissionSignal(submissionSignals) ||
      submissionRead ||
      latest?.resultJson.includes('native-short-submission')
    ) {
      try {
        if (job.kind === 'write') {
          if (latest) {
            const history = ports.deps.validateNativeShortSubmissionHistory(job);
            if (
              !history.last ||
              !sameNativeValue(job.result, history.last) ||
              job.status !== history.last.status ||
              job.endedAt !== history.last.settledAt ||
              !sameNativeValue(
                job.error,
                ports.deps.nativeShortSubmissionSettlementError(history.last.status),
              )
            )
              throw Error('Invalid submission closure');
          } else if (
            job.status === 'succeeded' ||
            (job.status === 'failed' &&
              (job.result as any)?.schema === 'native-short-submission-write-result/v1')
          )
            validateNativeShortSubmissionCompletion(
              ports.deps.nativeShortSubmissionContext(job),
              job.result,
            );
          else if (canonicalJson(job.result).includes('native-short-submission-closure'))
            throw Error('Missing submission closure row');
          else
            validateNativeShortSubmissionEvidenceContext(
              ports.deps.nativeShortSubmissionContext(job),
              'prefix',
            );
        } else if (
          job.status === 'succeeded' &&
          submissionRead &&
          job.operation === 'reconcile_write'
        ) {
          const read = ports.deps.nativeShortSubmissionLaterRead(job.id);
          const audit = (
            read.document.payload as { originalAudit?: NativeShortSubmissionOriginalAudit }
          ).originalAudit;
          const original = audit && ports.deps.rawJob(audit.originalJobId);
          if (!original) throw Error('Invalid submission original');
          const linked = ports.deps
            .prepare(
              'SELECT id FROM write_reconciliations WHERE original_job_id=? AND read_job_id=?',
            )
            .all(original.id, job.id);
          if (linked.length === 1) ports.deps.validateNativeShortSubmissionHistory(original);
          else if (
            linked.length !== 0 ||
            original.status !== 'uncertain' ||
            !sameNativeValue(audit, ports.deps.getNativeShortSubmissionOriginalAudit(original.id))
          )
            throw Error('Unbound submission reconciliation audit');
          validateNativeShortSubmissionReconciliationContext({
            original: ports.deps.nativeShortSubmissionContext(original),
            ...read,
          });
        } else if (job.kind === 'read' && job.status === 'succeeded') {
          if (job.operation !== NATIVE_SHORT_SUBMISSION_READ_OPERATION)
            throw Error('Invalid submission read operation');
          const rows = ports.deps
            .prepare('SELECT manifest_json FROM manifests WHERE job_id = ? LIMIT 2')
            .all(job.id);
          if (rows.length !== 1) throw Error('Invalid submission read manifest');
          validateNativeShortSubmissionReadContext({
            ...ports.deps.nativeShortSubmissionContext(job),
            manifest: JSON.parse(String(rows[0]!.manifest_json)) as Manifest,
          });
        }
        return job;
      } catch (error) {
        throw new RuntimeError(
          'capability_unavailable',
          'Native short submission evidence is unavailable.',
        );
      }
    }
    // Body may contain legal trial marker fields; its namespace owns the graph.
    if (ports.deps.nativeShortBodySignal(job, latest?.resultJson)) {
      try {
        ports.deps.validateNativeShortBodyJob(job, latest);
        return job;
      } catch {
        return bodyUnavailable();
      }
    }
    // Trial embeds full metadata snapshots: classify it before the older namespace.
    const trialReadRefs = ports.deps.listEvidence(job.id);
    const trialSignals: unknown[] = [job, ...trialReadRefs];
    let trialRead = false;
    for (const ref of trialReadRefs) {
      try {
        const document = ports.deps.readEvidence(ref);
        trialSignals.push(document);
        trialRead ||= hasReservedNativeShortTrialSignal(document);
      } catch {
        if (hasReservedNativeShortTrialSignal(trialSignals))
          throw new RuntimeError(
            'capability_unavailable',
            'Native short trial evidence is unavailable.',
          );
      }
    }
    if (
      hasReservedNativeShortTrialSignal(trialSignals) ||
      trialRead ||
      latest?.resultJson.includes('native-short-trial')
    ) {
      try {
        if (job.kind === 'write') {
          if (latest) {
            const history = ports.deps.validateNativeShortTrialHistory(job);
            if (
              !history.last ||
              !sameNativeValue(job.result, history.last) ||
              job.status !== history.last.status ||
              job.endedAt !== history.last.settledAt ||
              !sameNativeValue(
                job.error,
                ports.deps.nativeShortTrialSettlementError(history.last.status),
              )
            )
              throw Error('Invalid trial closure');
          } else if (job.status === 'succeeded')
            validateNativeShortTrialCompletion(ports.deps.nativeShortTrialContext(job), job.result);
          else if (canonicalJson(job.result).includes('native-short-trial-closure'))
            throw Error('Missing trial closure row');
        } else if (job.status === 'succeeded' && trialRead && job.operation === 'reconcile_write') {
          const read = ports.deps.nativeShortTrialLaterRead(job.id);
          const audit = (read.document.payload as { originalAudit?: NativeShortTrialOriginalAudit })
            .originalAudit;
          const original = audit && ports.deps.rawJob(audit.originalJobId);
          if (!original) throw Error('Invalid trial original');
          const linked = ports.deps
            .prepare(
              'SELECT id FROM write_reconciliations WHERE original_job_id=? AND read_job_id=?',
            )
            .all(original.id, job.id);
          if (linked.length === 1) ports.deps.validateNativeShortTrialHistory(original);
          else if (
            linked.length !== 0 ||
            original.status !== 'uncertain' ||
            !sameNativeValue(audit, ports.deps.getNativeShortTrialOriginalAudit(original.id))
          )
            throw Error('Unbound trial reconciliation audit');
          validateNativeShortTrialReconciliationContext({
            original: ports.deps.nativeShortTrialContext(original),
            ...read,
          });
        } else if (job.kind === 'read' && job.status === 'succeeded') {
          if (job.operation !== NATIVE_SHORT_TRIAL_READ_OPERATION)
            throw Error('Invalid trial read operation');
          const rows = ports.deps
            .prepare('SELECT manifest_json FROM manifests WHERE job_id = ? LIMIT 2')
            .all(job.id);
          if (rows.length !== 1) throw Error('Invalid trial read manifest');
          validateNativeShortTrialReadContext({
            ...ports.deps.nativeShortTrialContext(job),
            manifest: JSON.parse(String(rows[0]!.manifest_json)) as Manifest,
          });
        }
        return job;
      } catch {
        throw new RuntimeError(
          'capability_unavailable',
          'Native short trial evidence is unavailable.',
        );
      }
    }
    // Cover embeds full metadata snapshots: classify it before the older namespace.
    const coverReadRefs =
      job.kind === 'write' || (job.kind === 'read' && job.operation === 'reconcile_write')
        ? ports.deps.listEvidence(job.id)
        : [];
    const coverSignals: unknown[] = [job, ...coverReadRefs];
    let coverRead = false;
    for (const ref of coverReadRefs) {
      try {
        const document = ports.deps.readEvidence(ref);
        coverSignals.push(document);
        coverRead ||= hasReservedNativeShortCoverSignal(document);
      } catch {
        if (hasReservedNativeShortCoverSignal(coverSignals))
          throw new RuntimeError(
            'capability_unavailable',
            'Native short cover evidence is unavailable.',
          );
      }
    }
    if (
      hasReservedNativeShortCoverSignal(coverSignals) ||
      coverRead ||
      latest?.resultJson.includes('native-short-cover')
    ) {
      try {
        if (job.kind === 'write') {
          if (latest) {
            const history = ports.deps.validateNativeShortCoverHistory(job);
            if (
              !history.last ||
              !sameNativeValue(job.result, history.last) ||
              job.status !== history.last.status ||
              job.endedAt !== history.last.settledAt ||
              !sameNativeValue(
                job.error,
                ports.deps.nativeShortCoverSettlementError(history.last.status),
              )
            )
              throw Error('Invalid cover closure');
          } else if (job.status === 'succeeded')
            validateNativeShortCoverCompletion(ports.deps.nativeShortCoverContext(job), job.result);
          else if (canonicalJson(job.result).includes('native-short-cover-closure'))
            throw Error('Missing cover closure row');
        } else if (job.status === 'succeeded' && coverRead) {
          const read = ports.deps.nativeShortCoverLaterRead(job.id);
          const audit = (read.document.payload as { originalAudit?: NativeShortCoverOriginalAudit })
            .originalAudit;
          const original = audit && ports.deps.rawJob(audit.originalJobId);
          if (!original) throw Error('Invalid cover original');
          const linked = ports.deps
            .prepare(
              'SELECT id FROM write_reconciliations WHERE original_job_id=? AND read_job_id=?',
            )
            .all(original.id, job.id);
          if (linked.length === 1) ports.deps.validateNativeShortCoverHistory(original);
          else if (
            linked.length !== 0 ||
            original.status !== 'uncertain' ||
            !sameNativeValue(audit, ports.deps.getNativeShortCoverOriginalAudit(original.id))
          )
            throw Error('Unbound cover reconciliation audit');
          validateNativeShortCoverReconciliationContext({
            original: ports.deps.nativeShortCoverContext(original),
            ...read,
          });
        }
        return job;
      } catch {
        throw new RuntimeError(
          'capability_unavailable',
          'Native short cover evidence is unavailable.',
        );
      }
    }
    if (ports.deps.nativeRegistrationSignal(job)) {
      try {
        ports.deps.validateNativeRegistrationJob(job);
      } catch {
        return nativeReconciliationUnavailable();
      }
    }
    const compensationTerminal =
      /native-short-metadata-compensated-closure|native-short-metadata-compensation-(?!registration)|fanqie-short-native-metadata-compensation-business/.test(
        canonicalJson(job.result),
      ) || job.error?.code === 'native_write_compensated';
    if (compensationTerminal) {
      try {
        ports.deps.validateNativeCompensatedClosure(job);
        return job;
      } catch {
        return nativeReconciliationUnavailable();
      }
    }
    let nativeRow = false;
    if (latest) {
      try {
        nativeRow = hasReservedNativeShortSignal(JSON.parse(latest.resultJson));
      } catch (error) {
        if (
          hasReservedNativeShortSignal(job) ||
          latest.resultJson.includes('native-short-metadata')
        )
          return nativeReconciliationUnavailable();
        throw error;
      }
    }
    if (latest && (hasReservedNativeShortSignal(job) || nativeRow)) {
      try {
        if (
          (job.result as { schema?: unknown })?.schema ===
          'native-short-metadata-compensated-closure/v1'
        )
          ports.deps.validateNativeCompensatedClosure(job);
        else ports.deps.validateNativeClosure(job);
      } catch {
        return nativeReconciliationUnavailable();
      }
    } else if (nativeClosureSignal(job.result)) return nativeReconciliationUnavailable();
    return job;
  };
}
