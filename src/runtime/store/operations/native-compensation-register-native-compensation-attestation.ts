import { type Job, type EvidenceRef, type EvidenceDocument } from '../runtime-error.js';
import {
  canonicalJson,
  nativeRegistrationDataset,
  nativeRegistrationOperation,
  nativeReconciliationUnavailable,
  sameNativeValue,
  identifier,
  hash,
  timestamp,
  nativeRegistrationScope,
  nativeCompensatedError,
} from '../native-closure-signal.js';
import { randomUUID } from 'node:crypto';
import { PublicReadCoordinator } from '../../public-read.js';
import path from 'node:path';
import {
  mkdirSync,
  lstatSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  existsSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import {
  isCanonicalNativeTime,
  type NativeShortCompensationAuthority,
  type NativeShortCompensationRegistrationManifest,
  validateNativeShortCompensationSourceContext,
  copyNativeShortJson,
  createNativeShortCompensationAttestation,
  validateNativeShortCompensationContext,
  type NativeShortCompensatedClosure,
} from '../../../platform/short-native-metadata-proof.js';
import {
  type TransactionOperation,
  type AssertOwnershipOperation,
  type PrepareOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';
import {
  type RawJobOperation,
  type NativeRegistrationRowsOperation,
  type GetJobOperation,
  type NativeLaterReadOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';

import {
  type ValidateNativeCompensationInstalledSourceOperation,
  type NativeCompensationSourceOperation,
  type RegisterNativeCompensationAttestationOperation,
  type NativeReconciliationRowOperation,
  type GetNativeCompensationContextOperation,
  type ValidateNativeCompensatedClosureOperation,
} from '../contracts/native-compensation-validate-native-compensation-source-identity.js';

interface RegisterNativeCompensationAttestationDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  rawJob: RawJobOperation;
  nativeRegistrationRows: NativeRegistrationRowsOperation;
  validateNativeCompensationInstalledSource: ValidateNativeCompensationInstalledSourceOperation;
  nativeCompensationSource: NativeCompensationSourceOperation;
  evidenceMode: 'live' | 'fixture';
  evidenceDirectory: string;
  assertOwnership: AssertOwnershipOperation;
  prepare: PrepareOperation;
  ownerId: `${string}-${string}-${string}-${string}-${string}`;
  getJob: GetJobOperation;
}

export function createRegisterNativeCompensationAttestation(
  deps: RegisterNativeCompensationAttestationDependencies,
): RegisterNativeCompensationAttestationOperation {
  function registerNativeCompensationAttestation(input: unknown): Job {
    deps.publicReads.assertMutationAllowed();
    let published: string | undefined;
    try {
      const data = copyNativeShortJson(input) as Record<string, unknown>;
      const keys = [
        'schema',
        'accountId',
        'originalJobId',
        'operatorJobId',
        'authority',
        'approvedAt',
        'effectsEndedAt',
      ];
      if (
        !sameNativeValue(Object.keys(data).sort(), keys.sort()) ||
        data.schema !== 'native-short-metadata-compensation-registration-input/v1' ||
        ![data.accountId, data.originalJobId, data.operatorJobId].every(
          (value) => typeof value === 'string' && identifier.test(value),
        ) ||
        !isCanonicalNativeTime(data.approvedAt) ||
        !isCanonicalNativeTime(data.effectsEndedAt) ||
        Buffer.byteLength(canonicalJson(data.authority)) > 64 * 1024
      )
        return nativeReconciliationUnavailable();
      return deps.transaction(() => {
        const original = deps.rawJob(data.originalJobId as string);
        if (
          !original ||
          original.accountId !== data.accountId ||
          original.status !== 'uncertain' ||
          deps.nativeRegistrationRows(original).length !== 0
        )
          return nativeReconciliationUnavailable();
        deps.validateNativeCompensationInstalledSource(
          data.authority as NativeShortCompensationAuthority,
        );
        const source = validateNativeShortCompensationSourceContext(
          deps.nativeCompensationSource(original.id, null, {
            operatorJobId: data.operatorJobId as string,
            authority: data.authority as NativeShortCompensationAuthority,
          }),
        );
        const payload = createNativeShortCompensationAttestation(
          source,
          data.approvedAt as string,
          data.effectsEndedAt as string,
        );
        const now = timestamp(),
          id = randomUUID(),
          evidenceId = randomUUID(),
          manifestId = randomUUID();
        if (now < (data.approvedAt as string) || now < (data.effectsEndedAt as string))
          return nativeReconciliationUnavailable();
        const scope = nativeRegistrationScope(original.id),
          inputHash = hash(canonicalJson(data));
        const doc: EvidenceDocument = {
          schemaVersion: 1,
          evidenceId,
          accountId: original.accountId,
          jobId: id,
          dataset: nativeRegistrationDataset,
          capturedAt: now,
          collectionMode: deps.evidenceMode,
          evidenceKind: 'observation',
          payload,
        };
        const bytes = Buffer.from(`${canonicalJson(doc)}\n`);
        if (bytes.length > 64 * 1024) return nativeReconciliationUnavailable();
        const relative = path.join(
            hash(original.accountId).slice(0, 24),
            nativeRegistrationDataset,
            `${evidenceId}.json`,
          ),
          destination = path.join(deps.evidenceDirectory, relative);
        mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
        let cursor = deps.evidenceDirectory;
        for (const component of ['', ...path.dirname(relative).split(path.sep)]) {
          if (component) cursor = path.join(cursor, component);
          const stat = lstatSync(cursor);
          if (!stat.isDirectory() || stat.isSymbolicLink())
            return nativeReconciliationUnavailable();
        }
        const temporary = `${destination}.${randomUUID()}.tmp`;
        let fd: number | undefined;
        try {
          fd = openSync(temporary, 'wx', 0o600);
          writeFileSync(fd, bytes);
          fsyncSync(fd);
          closeSync(fd);
          fd = undefined;
          if (existsSync(destination)) return nativeReconciliationUnavailable();
          renameSync(temporary, destination);
          published = destination;
          const directory = openSync(path.dirname(destination), 'r');
          try {
            fsyncSync(directory);
          } finally {
            closeSync(directory);
          }
        } finally {
          if (fd !== undefined) closeSync(fd);
          if (existsSync(temporary)) unlinkSync(temporary);
        }
        const ref: EvidenceRef = {
          id: evidenceId,
          accountId: original.accountId,
          jobId: id,
          dataset: nativeRegistrationDataset,
          capturedAt: now,
          path: relative.split(path.sep).join('/'),
          sha256: hash(bytes),
        };
        const manifest: NativeShortCompensationRegistrationManifest = {
          schema: 'native-short-metadata-compensation-registration-manifest/v1',
          id: manifestId,
          accountId: original.accountId,
          jobId: id,
          operation: nativeRegistrationOperation,
          scope,
          datasets: [nativeRegistrationDataset],
          inputHash,
          requestedAt: now,
          startedAt: now,
          platformReadStartedAt: null,
          platformWriteStartedAt: null,
          committedAt: now,
          evidence: [ref],
          authorityHash: payload.authorityHash,
          policyHash: payload.policyHash,
        };
        const metadata = {
          schema: 'native-short-metadata-compensation-registration-job/v1',
          originalJobId: original.id,
          operatorJobId: data.operatorJobId,
          authorityHash: payload.authorityHash,
          policyHash: payload.policyHash,
        };
        deps.assertOwnership();
        deps
          .prepare(
            'INSERT INTO jobs(id,account_id,owner_id,kind,operation,scope,datasets_json,idempotency_key,input_hash,status,requested_at,started_at,read_started_at,write_started_at,ended_at,updated_at,result_json,error_json,target_json,metadata_json,timeout_ms,deadline_at,cancellation_requested_at,cancellation_reason_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .run(
            id,
            original.accountId,
            deps.ownerId,
            'read',
            nativeRegistrationOperation,
            scope,
            canonicalJson([nativeRegistrationDataset]),
            original.id,
            inputHash,
            'succeeded',
            now,
            now,
            null,
            null,
            now,
            now,
            canonicalJson({ manifest }),
            null,
            canonicalJson(source.original.job.target),
            canonicalJson(metadata),
            120000,
            null,
            null,
            null,
          );
        deps
          .prepare(
            'INSERT INTO evidence(id,account_id,job_id,dataset,captured_at,path,sha256) VALUES(?,?,?,?,?,?,?)',
          )
          .run(ref.id, ref.accountId, ref.jobId, ref.dataset, ref.capturedAt, ref.path, ref.sha256);
        deps
          .prepare(
            'INSERT INTO manifests(id,account_id,job_id,scope,committed_at,manifest_json) VALUES(?,?,?,?,?,?)',
          )
          .run(manifest.id, original.accountId, id, scope, now, canonicalJson(manifest));
        const job = deps.getJob(id)!; // Validate the actual SQL/file tuple before COMMIT.
        deps.validateNativeCompensationInstalledSource(
          data.authority as NativeShortCompensationAuthority,
        );
        deps.assertOwnership();
        return job;
      });
    } catch {
      if (published && existsSync(published)) unlinkSync(published);
      return nativeReconciliationUnavailable();
    }
  }
  return registerNativeCompensationAttestation;
}

interface ValidateNativeCompensatedClosureDependencies {
  publicReads: PublicReadCoordinator;
  nativeReconciliationRow: NativeReconciliationRowOperation;
  getNativeCompensationContext: GetNativeCompensationContextOperation;
  nativeLaterRead: NativeLaterReadOperation;
}

export function createValidateNativeCompensatedClosure(
  deps: ValidateNativeCompensatedClosureDependencies,
): ValidateNativeCompensatedClosureOperation {
  function validateNativeCompensatedClosure(original: Job): void {
    return deps.publicReads.memo('store.validateNativeCompensatedClosure', [original], () => {
      const current = deps.nativeReconciliationRow(original.id, 'last');
      if (
        !current ||
        original.status !== 'failed' ||
        current.status !== 'failed' ||
        original.endedAt !== current.createdAt ||
        original.updatedAt !== current.createdAt ||
        current.resultJson !== canonicalJson(original.result) ||
        !sameNativeValue(original.error, nativeCompensatedError)
      )
        return nativeReconciliationUnavailable();
      const source = deps.getNativeCompensationContext(original.id);
      if (!source) return nativeReconciliationUnavailable();
      const read = deps.nativeLaterRead(original.id, current.readJobId),
        checked = validateNativeShortCompensationContext({
          source,
          readJob: read.job,
          manifest: read.manifest,
          ref: read.ref,
          document: read.document,
        });
      const closure = copyNativeShortJson(original.result) as NativeShortCompensatedClosure;
      const first = source.history.first;
      const firstPointer =
        first && first.row.sequence !== current.sequence
          ? {
              readJobId: first.row.readJobId,
              evidenceId: first.row.evidenceId,
              evidenceHash: first.read.ref.sha256,
            }
          : null;
      if (!sameNativeValue(closure.originalAttemptEvidence, firstPointer))
        return nativeReconciliationUnavailable();
      if (
        !sameNativeValue(
          Object.keys(closure).sort(),
          [
            'schema',
            'target',
            'reconciliationJobId',
            'evidence',
            'observedStatus',
            'result',
            'originalAudit',
            'originalAttemptEvidence',
          ].sort(),
        ) ||
        closure.schema !== 'native-short-metadata-compensated-closure/v1' ||
        current.evidenceId !== read.ref.id ||
        closure.reconciliationJobId !== read.job.id ||
        !sameNativeValue(closure.target, original.target) ||
        !sameNativeValue(closure.evidence, read.ref) ||
        closure.observedStatus !== checked.observedStatus ||
        !sameNativeValue(closure.result, checked.result) ||
        !sameNativeValue(closure.originalAudit, checked.evidence.originalAudit) ||
        read.job.endedAt === null ||
        read.job.endedAt > current.createdAt
      )
        return nativeReconciliationUnavailable();
    });
  }
  return validateNativeCompensatedClosure;
}
