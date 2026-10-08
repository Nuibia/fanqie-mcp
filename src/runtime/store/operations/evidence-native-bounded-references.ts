import {
  type EvidenceRef,
  type Job,
  RuntimeError,
  existingGenericReads,
  type Manifest,
} from '../runtime-error.js';
import {
  nativeReconciliationUnavailable,
  bodyUnavailable,
  nativeRegistrationDataset,
} from '../native-closure-signal.js';
import { PublicReadCoordinator } from '../../public-read.js';
import path from 'node:path';
import {
  type PrepareOperation,
  type EnsureOpenOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';
import {
  type NativeBoundedReferencesOperation,
  type ReadEvidenceOperation,
  type NativeOriginalEvidenceOperation,
  type GetManifestForJobOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

import {
  type GetJobOperation,
  type NativeRegistrationSignalOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';

interface NativeBoundedReferencesDependencies {
  publicReads: PublicReadCoordinator;
  prepare: PrepareOperation;
}

export function createNativeBoundedReferences(
  deps: NativeBoundedReferencesDependencies,
): NativeBoundedReferencesOperation {
  function nativeBoundedReferences(jobId: string, maximum: number): EvidenceRef[] {
    return deps.publicReads.memo('store.nativeBoundedReferences', [jobId, maximum], () => {
      const rows = deps
        .prepare('SELECT * FROM evidence WHERE job_id = ? ORDER BY rowid LIMIT ?')
        .all(jobId, maximum + 1);
      if (rows.length > maximum) return nativeReconciliationUnavailable();
      return rows.map((row) => ({
        id: String(row.id),
        accountId: String(row.account_id),
        jobId: String(row.job_id),
        dataset: String(row.dataset),
        capturedAt: String(row.captured_at),
        path: String(row.path),
        sha256: String(row.sha256),
      }));
    });
  }
  return nativeBoundedReferences;
}

interface NativeOriginalEvidenceDependencies {
  publicReads: PublicReadCoordinator;
  nativeBoundedReferences: NativeBoundedReferencesOperation;
  readEvidence: ReadEvidenceOperation;
}

export function createNativeOriginalEvidence(
  deps: NativeOriginalEvidenceDependencies,
): NativeOriginalEvidenceOperation {
  function nativeOriginalEvidence(original: Job) {
    return deps.publicReads.memo('store.nativeOriginalEvidence', [original], () => {
      const refs = deps.nativeBoundedReferences(original.id, 4);
      return { refs, documents: refs.map((ref) => deps.readEvidence(ref)) };
    });
  }
  return nativeOriginalEvidence;
}

interface GetManifestForJobDependencies {
  publicReads: PublicReadCoordinator;
  ensureOpen: EnsureOpenOperation;
  prepare: PrepareOperation;
  getJob: GetJobOperation;
  nativeRegistrationSignal: NativeRegistrationSignalOperation;
}

export function createGetManifestForJob(
  deps: GetManifestForJobDependencies,
): GetManifestForJobOperation {
  function getManifestForJob(accountId: string, jobId: string): Manifest | null {
    return deps.publicReads.memo('store.getManifestForJob', [accountId, jobId], () => {
      deps.ensureOpen();
      const rows = deps.prepare(existingGenericReads.manifest).all(accountId, jobId);
      if (rows.length !== 1) return null;
      const row = rows[0]!;
      let manifest: Manifest;
      try {
        manifest = JSON.parse(String(row.manifest_json)) as Manifest;
      } catch (error) {
        if (
          String(row.scope).startsWith('short_native_body') ||
          String(row.manifest_json).includes('native-short-body')
        )
          return bodyUnavailable();
        throw error;
      }
      if (
        !manifest ||
        typeof manifest !== 'object' ||
        Array.isArray(manifest) ||
        row.id !== manifest.id ||
        row.account_id !== manifest.accountId ||
        row.job_id !== manifest.jobId ||
        row.scope !== manifest.scope ||
        row.committed_at !== manifest.committedAt
      )
        throw new RuntimeError(
          'evidence_binding_invalid',
          'The saved manifest does not match its durable binding.',
        );
      const schema = (manifest as unknown as { schema?: unknown }).schema;
      if (
        (typeof schema === 'string' &&
          schema.startsWith('native-short-metadata-compensation-registration')) ||
        String(row.scope).startsWith(nativeRegistrationDataset) ||
        manifest.scope.startsWith(nativeRegistrationDataset)
      ) {
        // getJob rebuilds the registration's actual SQL/file/authority graph.
        // A forged registration manifest cannot relabel an ordinary job.
        const job = deps.getJob(jobId);
        if (!job || job.accountId !== accountId || !deps.nativeRegistrationSignal(job))
          return nativeReconciliationUnavailable();
      }
      return manifest;
    });
  }
  return getManifestForJob;
}
