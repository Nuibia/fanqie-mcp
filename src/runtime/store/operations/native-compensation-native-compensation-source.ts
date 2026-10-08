import {
  type Job,
  type EvidenceRef,
  type Manifest,
  type EvidenceDocument,
} from '../runtime-error.js';
import {
  canonicalJson,
  nativeRegistrationDataset,
  nativeRegistrationOperation,
  nativeReconciliationUnavailable,
  sameNativeValue,
  hash,
  type NativeReconciliationRow,
  nativeRegistrationScope,
} from '../native-closure-signal.js';
import { PublicReadCoordinator } from '../../public-read.js';
import path from 'node:path';
import {
  isCanonicalNativeTime,
  type NativeShortCompensationAuthority,
  type NativeShortCompensationSourceContext,
  type NativeShortCompensationRegistrationManifest,
  validateNativeShortCompensationSourceContext,
} from '../../../platform/short-native-metadata-proof.js';
import {
  type RawJobOperation,
  type NativeRegistrationRowsOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';
import {
  type PublicEvidenceFileSizeOperation,
  type ReadEvidenceOperation,
  type NativeBoundedReferencesOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

import { type PrepareOperation } from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';
import {
  type ValidateNativeCompensationSourceIdentityOperation,
  type NativeReconciliationRowOperation,
  type NativeCompensationSourceOperation,
  type GetNativeCompensationContextOperation,
} from '../contracts/native-compensation-validate-native-compensation-source-identity.js';

interface NativeCompensationSourceDependencies {
  publicReads: PublicReadCoordinator;
  rawJob: RawJobOperation;
  evidenceDirectory: string;
  publicEvidenceFileSize: PublicEvidenceFileSizeOperation;
  readEvidence: ReadEvidenceOperation;
  nativeBoundedReferences: NativeBoundedReferencesOperation;
  prepare: PrepareOperation;
  validateNativeCompensationSourceIdentity: ValidateNativeCompensationSourceIdentityOperation;
  nativeReconciliationRow: NativeReconciliationRowOperation;
}

export function createNativeCompensationSource(
  deps: NativeCompensationSourceDependencies,
): NativeCompensationSourceOperation {
  function nativeCompensationSource(
    originalId: string,
    registration: Job | null,
    supplied?: { operatorJobId: string; authority: NativeShortCompensationAuthority },
  ): NativeShortCompensationSourceContext {
    return deps.publicReads.memo(
      'store.nativeCompensationSource',
      [originalId, registration, supplied],
      () => {
        const original = deps.rawJob(originalId);
        if (!original || original.kind !== 'write') return nativeReconciliationUnavailable();
        // Read immutable files only after their fixed count, size and path checks.
        const seen = new Set<string>();
        let byteCount = 0;
        const document = (ref: EvidenceRef, control = false): EvidenceDocument => {
          const file = path.resolve(deps.evidenceDirectory, ref.path),
            relative = path.relative(deps.evidenceDirectory, file);
          if (relative.startsWith('..') || path.isAbsolute(relative))
            return nativeReconciliationUnavailable();
          const size = deps.publicEvidenceFileSize(ref, file);
          if (size > (control ? 64 * 1024 : 6 * 1024 * 1024 + 64 * 1024))
            return nativeReconciliationUnavailable();
          if (!seen.has(ref.id)) {
            seen.add(ref.id);
            byteCount += size;
          }
          if (seen.size > 14 || byteCount > 30 * 1024 * 1024 + 14 * 64 * 1024)
            return nativeReconciliationUnavailable();
          return deps.readEvidence(ref);
        };
        const write = (job: Job, maximum: number) => {
          const refs = deps.nativeBoundedReferences(job.id, maximum);
          if (
            refs.length === 0 ||
            deps.prepare('SELECT id FROM manifests WHERE job_id = ? LIMIT 1').get(job.id)
          )
            return nativeReconciliationUnavailable();
          return {
            accountId: job.accountId,
            job,
            manifest: null,
            refs,
            documents: refs.map((ref) => document(ref, ref.dataset === 'write-intent')),
          };
        };
        const read = (jobId: string) => {
          const job = deps.rawJob(jobId),
            refs = deps.nativeBoundedReferences(jobId, 1),
            rows = deps.prepare('SELECT * FROM manifests WHERE job_id = ? LIMIT 2').all(jobId);
          if (
            !job ||
            job.accountId !== original.accountId ||
            refs.length !== 1 ||
            rows.length !== 1 ||
            Buffer.byteLength(String(rows[0]!.manifest_json)) > 64 * 1024
          )
            return nativeReconciliationUnavailable();
          const row = rows[0]!,
            manifest = JSON.parse(String(row.manifest_json)) as Manifest;
          if (
            String(row.manifest_json) !== canonicalJson(manifest) ||
            row.id !== manifest.id ||
            row.account_id !== job.accountId ||
            row.job_id !== job.id ||
            row.scope !== job.scope ||
            row.committed_at !== manifest.committedAt ||
            !sameNativeValue(manifest.evidence, refs)
          )
            return nativeReconciliationUnavailable();
          return { job, manifest, ref: refs[0]!, document: document(refs[0]!) };
        };
        let registered: NativeShortCompensationSourceContext['registration'] = null;
        let operatorId = supplied?.operatorJobId,
          authority = supplied?.authority;
        if (registration) {
          const refs = deps.nativeBoundedReferences(registration.id, 1),
            rows = deps
              .prepare('SELECT * FROM manifests WHERE job_id = ? LIMIT 2')
              .all(registration.id);
          if (
            refs.length !== 1 ||
            refs[0]!.dataset !== nativeRegistrationDataset ||
            rows.length !== 1 ||
            Buffer.byteLength(String(rows[0]!.manifest_json)) > 64 * 1024
          )
            return nativeReconciliationUnavailable();
          const row = rows[0]!,
            doc = document(refs[0]!, true),
            payload = doc.payload as Record<string, unknown>;
          const manifest = JSON.parse(
            String(row.manifest_json),
          ) as NativeShortCompensationRegistrationManifest;
          if (
            row.manifest_json !== canonicalJson(manifest) ||
            row.id !== manifest.id ||
            row.account_id !== original.accountId ||
            row.job_id !== registration.id ||
            row.scope !== nativeRegistrationScope(original.id) ||
            row.committed_at !== manifest.committedAt ||
            deps
              .prepare('SELECT manifest_id FROM current_manifests WHERE manifest_id = ?')
              .get(manifest.id)
          )
            return nativeReconciliationUnavailable();
          const metadata = registration.metadata;
          if (
            !sameNativeValue(
              Object.keys(metadata).sort(),
              ['schema', 'originalJobId', 'operatorJobId', 'authorityHash', 'policyHash'].sort(),
            ) ||
            metadata.schema !== 'native-short-metadata-compensation-registration-job/v1' ||
            metadata.originalJobId !== original.id ||
            metadata.operatorJobId !== payload.operatorJobId ||
            metadata.authorityHash !== payload.authorityHash ||
            metadata.policyHash !== payload.policyHash ||
            registration.operation !== nativeRegistrationOperation ||
            registration.scope !== nativeRegistrationScope(original.id) ||
            registration.idempotencyKey !== original.id ||
            registration.accountId !== original.accountId
          )
            return nativeReconciliationUnavailable();
          operatorId = payload.operatorJobId as string;
          authority = payload.authority as NativeShortCompensationAuthority;
          const input = {
            schema: 'native-short-metadata-compensation-registration-input/v1',
            accountId: original.accountId,
            originalJobId: original.id,
            operatorJobId: operatorId,
            authority,
            approvedAt: payload.approvedAt,
            effectsEndedAt: payload.effectsEndedAt,
          };
          if (registration.inputHash !== hash(canonicalJson(input)))
            return nativeReconciliationUnavailable();
          registered = { job: registration, manifest, ref: refs[0]!, document: doc };
        }
        if (typeof operatorId !== 'string' || !authority) return nativeReconciliationUnavailable();
        deps.validateNativeCompensationSourceIdentity(authority);
        const operatorJob = deps.rawJob(operatorId);
        if (
          !operatorJob ||
          operatorJob.accountId !== original.accountId ||
          operatorJob.kind !== 'write'
        )
          return nativeReconciliationUnavailable();
        const originalWrite = write(original, 4),
          operator = write(operatorJob, 4);
        if (operator.refs.length !== 4) return nativeReconciliationUnavailable();
        const held = operator.documents.find(
          (doc) => doc.dataset === 'operator_title_restore_baseline',
        )?.payload as { freshBefore?: { id?: unknown } } | undefined;
        const beforeId = held?.freshBefore?.id;
        if (typeof beforeId !== 'string') return nativeReconciliationUnavailable();
        const beforeRow = deps.prepare('SELECT job_id FROM evidence WHERE id = ?').get(beforeId);
        if (!beforeRow) return nativeReconciliationUnavailable();
        const first = deps.nativeReconciliationRow(original.id, 'first'),
          current = deps.nativeReconciliationRow(original.id, 'last'),
          previous = current
            ? deps.nativeReconciliationRow(original.id, 'last', current.sequence)
            : null;
        const frame = (row: NativeReconciliationRow | null) => {
          if (!row) return null;
          if (
            Buffer.byteLength(row.resultJson) > 64 * 1024 ||
            row.resultJson !== canonicalJson(JSON.parse(row.resultJson)) ||
            row.originalJobId !== original.id ||
            !isCanonicalNativeTime(row.createdAt)
          )
            return nativeReconciliationUnavailable();
          const observed = read(row.readJobId);
          if (row.evidenceId !== observed.ref.id) return nativeReconciliationUnavailable();
          return { row, read: observed };
        };
        return {
          accountId: original.accountId,
          original: originalWrite,
          history: { first: frame(first), current: frame(current), previous: frame(previous) },
          registration: registered,
          operatorBefore: read(String(beforeRow.job_id)),
          operator,
          authority,
        };
      },
    );
  }
  return nativeCompensationSource;
}

interface GetNativeCompensationContextDependencies {
  publicReads: PublicReadCoordinator;
  rawJob: RawJobOperation;
  nativeRegistrationRows: NativeRegistrationRowsOperation;
  nativeCompensationSource: NativeCompensationSourceOperation;
}

export function createGetNativeCompensationContext(
  deps: GetNativeCompensationContextDependencies,
): GetNativeCompensationContextOperation {
  function getNativeCompensationContext(
    originalJobId: string,
  ): NativeShortCompensationSourceContext | null {
    return deps.publicReads.memo('store.getNativeCompensationContext', [originalJobId], () => {
      try {
        const original = deps.rawJob(originalJobId);
        if (!original) return null;
        const registrations = deps.nativeRegistrationRows(original);
        if (registrations.length === 0) {
          if (
            original.error?.code === 'native_write_compensated' ||
            /native-short-metadata-compensat|fanqie-short-native-metadata-compensat|native_compensation_attestation/.test(
              canonicalJson(original),
            )
          )
            return nativeReconciliationUnavailable();
          return null;
        }
        return validateNativeShortCompensationSourceContext(
          deps.nativeCompensationSource(original.id, registrations[0]!),
        );
      } catch {
        return nativeReconciliationUnavailable();
      }
    });
  }
  return getNativeCompensationContext;
}
