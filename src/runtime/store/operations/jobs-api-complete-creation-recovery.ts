import { RuntimeError, type Job, existingGenericReads, type Manifest } from '../runtime-error.js';
import {
  canonicalJson,
  timestamp,
  bodyUnavailable,
  nativeRegistrationDataset,
  nativeReconciliationUnavailable,
  sameNativeValue,
} from '../native-closure-signal.js';
import { PublicReadCoordinator } from '../../public-read.js';
import { hasGenericShortStatusSignal } from '../has-generic-short-status-signal.js';
import {
  type TransactionOperation,
  type PrepareOperation,
  type EnsureOpenOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';

import { type GetJobOperation } from '../contracts/jobs-api-with-public-projection-read.js';
import {
  type ListEvidenceOperation,
  type ReadEvidenceOperation,
  type GetManifestForJobOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

import { type GenericWitnessOperation } from '../contracts/generic-status-generic-refs.js';
import {
  type CompleteCreationRecoveryOperation,
  type GetCurrentOperation,
  type HistoryOperation,
} from '../contracts/jobs-api-reconcile-native-short-submission-write.js';

import * as bodyProof from '../../../platform/short-native-body-proof.js';

interface CompleteCreationRecoveryDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  prepare: PrepareOperation;
  getJob: GetJobOperation;
  listEvidence: ListEvidenceOperation;
  readEvidence: ReadEvidenceOperation;
  genericWitness: GenericWitnessOperation;
}

export function createCompleteCreationRecovery(
  deps: CompleteCreationRecoveryDependencies,
): CompleteCreationRecoveryOperation {
  function completeCreationRecovery(originalId: string, resumeJobId: string): Job {
    deps.publicReads.assertMutationAllowed();
    return deps.transaction(() => {
      const reject = (): never => {
        throw new RuntimeError(
          'creation_recovery_incomplete',
          'A successful same-target recovery and its durable desired-version proof are required.',
        );
      };
      const object = (value: unknown): Record<string, unknown> =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      const row = deps.prepare(existingGenericReads.recovery).get(originalId);
      const original = deps.getJob(originalId),
        resume = deps.getJob(resumeJobId);
      if (
        !row ||
        row.resume_job_id !== resumeJobId ||
        !original ||
        !resume ||
        original.accountId !== resume.accountId ||
        resume.kind !== 'write' ||
        resume.operation !== 'resume_create_draft' ||
        resume.status !== 'succeeded' ||
        !resume.endedAt ||
        !resume.platformReadStartedAt ||
        !original.target ||
        canonicalJson(resume.target) !== canonicalJson(original.target)
      )
        return reject();
      if (row.closed_at) {
        if (original.status !== 'succeeded' || canonicalJson(original.result) !== row.closure_json)
          return reject();
        return original;
      }
      if (original.status !== 'uncertain') return reject();
      const refs = deps.listEvidence(resumeJobId),
        bindings = object(JSON.parse(String(row.bindings_json)));
      if (hasGenericShortStatusSignal([resume, ...refs.map((ref) => deps.readEvidence(ref))]))
        deps.genericWitness(
          resume,
          refs,
          refs.map((ref) => deps.readEvidence(ref)),
        );
      const baselineRef = refs.find((ref) => ref.dataset === 'creation-resume-baseline');
      const intentRefs = refs.filter((ref) => ref.dataset === 'write-intent');
      if (!baselineRef || intentRefs.length !== 1) return reject();
      const baselineDoc = deps.readEvidence(baselineRef),
        baseline = object(baselineDoc.payload),
        snapshot = object(baseline.snapshot),
        source = object(baseline.source);
      const writeTarget = { kind: 'short', workId: original.target.id };
      if (
        baselineDoc.collectionMode !== 'live' ||
        baselineDoc.evidenceKind !== 'observation' ||
        source.mode !== 'live' ||
        source.origin !== 'https://fanqienovel.com' ||
        baseline.originalJobId !== originalId ||
        baseline.requestedContentHash !== bindings.requestedContentHash ||
        canonicalJson(baseline.target) !== canonicalJson(original.target) ||
        canonicalJson(snapshot.target) !== canonicalJson(writeTarget) ||
        snapshot.state !== 'draft' ||
        snapshot.title !== '' ||
        snapshot.body !== '' ||
        typeof snapshot.contentHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(snapshot.contentHash) ||
        typeof snapshot.platformReadAt !== 'string' ||
        snapshot.platformReadAt < resume.platformReadStartedAt ||
        snapshot.platformReadAt > baselineRef.capturedAt
      )
        return reject();
      const intentDoc = deps.readEvidence(intentRefs[0]!),
        intent = object(intentDoc.payload);
      if (
        intentDoc.collectionMode !== 'live' ||
        intentDoc.evidenceKind !== 'local-intent' ||
        canonicalJson(intent.target) !== canonicalJson(original.target) ||
        typeof intent.desiredContentHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(intent.desiredContentHash) ||
        canonicalJson(intent.expectedStates) !== canonicalJson(['draft_saved']) ||
        baselineRef.capturedAt > intentRefs[0]!.capturedAt ||
        !resume.platformWriteStartedAt ||
        intentRefs[0]!.capturedAt > resume.platformWriteStartedAt
      )
        return reject();
      const result = object(resume.result),
        resultRefs = refs.filter((ref) => ref.dataset === 'write-result');
      let proof: unknown;
      if (typeof result.reconciliationJobId !== 'string') {
        if (resultRefs.length !== 1) return reject();
        const resultDoc = deps.readEvidence(resultRefs[0]!);
        if (
          resultDoc.collectionMode !== 'live' ||
          resultDoc.evidenceKind !== 'observation' ||
          canonicalJson(resultDoc.payload) !== canonicalJson(result) ||
          result.status !== 'succeeded' ||
          result.capability !== 'update_draft' ||
          canonicalJson(result.target) !== canonicalJson(writeTarget) ||
          result.contentHash !== intent.desiredContentHash ||
          result.platformState !== 'draft' ||
          typeof result.verifiedAt !== 'string' ||
          result.verifiedAt < intentRefs[0]!.capturedAt ||
          result.verifiedAt > resultRefs[0]!.capturedAt ||
          resultRefs[0]!.capturedAt > resume.endedAt
        )
          return reject();
        proof = { kind: 'saved-write-result', evidence: resultRefs[0] };
      } else {
        const reconciliation = deps
          .prepare(existingGenericReads.ledgerJoin)
          .get(resumeJobId, String(result.reconciliationJobId ?? ''), 'succeeded');
        // A crash after saving write-result may leave that earlier immutable
        // observation behind. Only the actual persisted reconciliation wrapper
        // authorizes this branch; the earlier result never authorizes closure.
        if (
          resultRefs.length > 1 ||
          !reconciliation ||
          canonicalJson(JSON.parse(String(reconciliation.result_json))) !== canonicalJson(result)
        )
          return reject();
        const readJob = deps.getJob(String(result.reconciliationJobId)),
          ref = deps
            .listEvidence(String(result.reconciliationJobId))
            .find((item) => item.id === reconciliation.evidence_id);
        if (
          !readJob ||
          readJob.status !== 'succeeded' ||
          readJob.accountId !== resume.accountId ||
          !ref ||
          ref.dataset !== 'reconciliation' ||
          canonicalJson(result.evidence) !== canonicalJson(ref) ||
          result.observedStatus !== 'draft_saved'
        )
          return reject();
        const document = deps.readEvidence(ref),
          payload = object(document.payload),
          observed = object(payload.reconciliation);
        if (
          document.collectionMode !== 'live' ||
          document.evidenceKind !== 'observation' ||
          object(payload.source).mode !== 'live' ||
          object(payload.source).origin !== 'https://fanqienovel.com' ||
          observed.originalJobId !== resumeJobId ||
          observed.inputHash !== resume.inputHash ||
          canonicalJson(observed.target) !== canonicalJson(original.target) ||
          observed.observedContentHash !== intent.desiredContentHash ||
          observed.observedStatus !== 'draft_saved' ||
          object(result.result).contentHash !== intent.desiredContentHash ||
          object(result.result).platformState !== 'draft_saved'
        )
          return reject();
        proof = { kind: 'reconciled-recovery', reconciliationJobId: readJob.id, evidence: ref };
      }
      const now = timestamp();
      const closure = {
        creationRecovery: {
          originalJobId: originalId,
          resumeJobId,
          target: original.target,
          requestedContentHash: bindings.requestedContentHash,
          desiredContentHash: intent.desiredContentHash,
          proof,
          closedAt: now,
        },
        prior: JSON.parse(String(row.prior_json)),
      };
      deps
        .prepare(
          'UPDATE creation_recoveries SET closed_at = ?, closure_json = ? WHERE original_job_id = ?',
        )
        .run(now, canonicalJson(closure), originalId);
      deps
        .prepare(
          'UPDATE jobs SET status = ?, result_json = ?, error_json = NULL, ended_at = ?, updated_at = ? WHERE id = ?',
        )
        .run('succeeded', canonicalJson(closure), now, now, originalId);
      return deps.getJob(originalId)!;
    });
  }
  return completeCreationRecovery;
}

interface GetCurrentDependencies {
  publicReads: PublicReadCoordinator;
  ensureOpen: EnsureOpenOperation;
  prepare: PrepareOperation;
  readEvidence: ReadEvidenceOperation;
  getJob: GetJobOperation;
  getManifestForJob: GetManifestForJobOperation;
}

export function createGetCurrent(deps: GetCurrentDependencies): GetCurrentOperation {
  function getCurrent(accountId: string, scope = 'account'): Manifest | null {
    return deps.publicReads.memo('store.getCurrent', [accountId, scope], () => {
      deps.ensureOpen();
      const row = deps
        .prepare(
          'SELECT m.manifest_json FROM current_manifests c JOIN manifests m ON m.id = c.manifest_id WHERE c.account_id = ? AND c.scope = ?',
        )
        .get(accountId, scope);
      if (!row) return null;
      let manifest: Manifest;
      try {
        manifest = JSON.parse(String(row.manifest_json)) as Manifest;
      } catch (error) {
        if (
          scope.startsWith('short_native_body') ||
          String(row.manifest_json).includes('native-short-body')
        )
          return bodyUnavailable();
        throw error;
      }
      if (
        (manifest as unknown as { schema?: unknown }).schema ===
          'native-short-metadata-compensation-registration-manifest/v1' ||
        manifest.scope.startsWith(nativeRegistrationDataset)
      )
        return nativeReconciliationUnavailable();
      for (const reference of manifest.evidence) deps.readEvidence(reference);
      if (
        bodyProof.hasReservedNativeShortBodySignal(manifest) ||
        manifest.evidence.some((ref) =>
          bodyProof.hasReservedNativeShortBodySignal(deps.readEvidence(ref)),
        )
      ) {
        const job = deps.getJob(manifest.jobId, accountId);
        if (
          !job ||
          job.kind !== 'read' ||
          !sameNativeValue(deps.getManifestForJob(accountId, job.id), manifest)
        )
          return bodyUnavailable();
      }
      return manifest;
    });
  }
  return getCurrent;
}

interface HistoryDependencies {
  publicReads: PublicReadCoordinator;
  ensureOpen: EnsureOpenOperation;
  prepare: PrepareOperation;
  getJob: GetJobOperation;
  getManifestForJob: GetManifestForJobOperation;
}

export function createHistory(deps: HistoryDependencies): HistoryOperation {
  function history(accountId: string, scope?: string): Manifest[] {
    return deps.publicReads.memo('store.history', [accountId, scope], () => {
      deps.ensureOpen();
      const rows =
        scope === undefined
          ? deps.prepare(existingGenericReads.accountManifests).all(accountId)
          : deps
              .prepare(
                'SELECT manifest_json FROM manifests WHERE account_id = ? AND scope = ? ORDER BY committed_at DESC, rowid DESC',
              )
              .all(accountId, scope);
      return rows.map((row) => {
        const manifest = JSON.parse(String(row.manifest_json)) as Manifest;
        if (bodyProof.hasReservedNativeShortBodySignal(manifest)) {
          const job = deps.getJob(manifest.jobId, accountId);
          if (!job || !sameNativeValue(deps.getManifestForJob(accountId, job.id), manifest))
            return bodyUnavailable();
        }
        if (
          (manifest as unknown as { schema?: unknown }).schema ===
            'native-short-metadata-compensation-registration-manifest/v1' ||
          manifest.scope.startsWith(nativeRegistrationDataset)
        )
          deps.getJob(manifest.jobId);
        return manifest;
      });
    });
  }
  return history;
}
