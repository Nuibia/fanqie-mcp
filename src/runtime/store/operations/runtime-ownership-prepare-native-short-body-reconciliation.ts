import {
  bodyUnavailable,
  sameNativeValue,
  timestamp,
  canonicalJson,
  hash,
} from '../native-closure-signal.js';
import * as bodyProof from '../../../platform/short-native-body-proof.js';
import { PublicReadCoordinator } from '../../public-read.js';
import {
  type NativeShortEvidenceContext,
  NATIVE_SHORT_READ_OPERATION,
} from '../../../platform/short-native-metadata-proof.js';
import {
  type NativeShortBodyIssuerOperation,
  type NativeShortBodyContextOperation,
  type NativeShortBodyRecoveryFreshReadOperation,
} from '../contracts/native-body-native-short-body-signal.js';
import {
  type RawJobOperation,
  type ValidateNativeShortBodyHistoryOperation,
  type GetNativeShortBodyOriginalAuditOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';

import {
  type PrepareOperation,
  type PrepareNativeShortBodyReconciliationOperation,
  type PreparePhysicalEvidenceOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';
import { type GetCurrentOperation } from '../contracts/jobs-api-reconcile-native-short-submission-write.js';
import {
  type ListEvidenceOperation,
  type ReadEvidenceOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

import {
  RuntimeError,
  type Job,
  type EvidenceRef,
  type EvidenceDocument,
} from '../runtime-error.js';

import { randomUUID } from 'node:crypto';
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

interface PrepareNativeShortBodyReconciliationDependencies {
  publicReads: PublicReadCoordinator;
  nativeShortBodyIssuer: NativeShortBodyIssuerOperation;
  rawJob: RawJobOperation;
  nativeShortBodyContext: NativeShortBodyContextOperation;
  validateNativeShortBodyHistory: ValidateNativeShortBodyHistoryOperation;
  ownerId: `${string}-${string}-${string}-${string}-${string}`;
  prepare: PrepareOperation;
  getCurrent: GetCurrentOperation;
  listEvidence: ListEvidenceOperation;
  readEvidence: ReadEvidenceOperation;
  nativeShortBodyRecoveryFreshRead: NativeShortBodyRecoveryFreshReadOperation;
  getNativeShortBodyOriginalAudit: GetNativeShortBodyOriginalAuditOperation;
}

export function createPrepareNativeShortBodyReconciliation(
  deps: PrepareNativeShortBodyReconciliationDependencies,
): PrepareNativeShortBodyReconciliationOperation {
  function prepareNativeShortBodyReconciliation(
    jobId: string,
    accountId: string,
  ): {
    audit: bodyProof.NativeShortBodyOriginalAudit;
    recoveryContext?: bodyProof.NativeShortBodyRecoveryContextV2;
    comparisonPolicy?: 'native-short-body-derived-word-number/v2';
  } {
    deps.publicReads.assertMutationAllowed();
    deps.nativeShortBodyIssuer();
    const job = deps.rawJob(jobId);
    if (
      !job ||
      job.accountId !== accountId ||
      job.kind !== 'write' ||
      job.status !== 'uncertain' ||
      job.operation !== bodyProof.NATIVE_SHORT_BODY_OPERATION ||
      job.target?.kind !== 'short-story'
    )
      return bodyUnavailable();
    const context = deps.nativeShortBodyContext(job),
      history = deps.validateNativeShortBodyHistory(job);
    let recoveryContext: bodyProof.NativeShortBodyRecoveryContextV2 | undefined;
    let audit: bodyProof.NativeShortBodyOriginalAudit;
    try {
      audit = bodyProof.createNativeShortBodyOriginalAudit(
        context,
        history.last
          ? { firstAudit: history.firstAudit!, previousClosure: history.last }
          : undefined,
      );
    } catch {
      if (job.ownerId === deps.ownerId) return bodyUnavailable();
      const checkedAt = timestamp(),
        lease = deps.prepare('SELECT owner_id,expires_at FROM service_lease WHERE id=1').get();
      if (
        !lease ||
        lease.owner_id !== deps.ownerId ||
        !Number.isSafeInteger(lease.expires_at) ||
        Number(lease.expires_at) <= Date.parse(checkedAt)
      )
        return bodyUnavailable();
      const current = deps.getCurrent(accountId, `short_native_metadata.${job.target.id}`);
      if (!current) return bodyUnavailable();
      const freshJob = deps.rawJob(current.jobId),
        refs = deps.listEvidence(current.jobId);
      if (
        !freshJob ||
        freshJob.ownerId !== deps.ownerId ||
        freshJob.metadata.explicitBodyRead !== true ||
        freshJob.operation !== NATIVE_SHORT_READ_OPERATION ||
        refs.length !== 1 ||
        !sameNativeValue(current.evidence, refs)
      )
        return bodyUnavailable();
      const freshRead: NativeShortEvidenceContext = {
        accountId,
        job: freshJob,
        manifest: current,
        ref: refs[0]!,
        document: deps.readEvidence(refs[0]!),
      };
      const recovery = bodyProof.createNativeShortBodyOwnedGetRecoveryV2(
        context,
        freshRead,
        {
          ownerId: deps.ownerId,
          checkedAt,
          expiresAt: new Date(Number(lease.expires_at)).toISOString(),
        },
        history.last
          ? { firstAudit: history.firstAudit!, previousClosure: history.last }
          : undefined,
      );
      recoveryContext = {
        recovery,
        freshRead: deps.nativeShortBodyRecoveryFreshRead(recovery, accountId),
      };
      audit = deps.getNativeShortBodyOriginalAudit(jobId, accountId, recoveryContext);
    }
    const baseline = context.documents.find(
      (document) => document.dataset === bodyProof.NATIVE_SHORT_BODY_DATASETS.baseline,
    );
    if (!baseline) return bodyUnavailable();
    const material = bodyProof.getNativeShortBodyExpectationMaterial(
      context,
      audit,
      undefined,
      recoveryContext,
    );
    const comparisonPolicy =
      recoveryContext ||
      material.business.comparisonPolicy === 'native-short-body-derived-word-number/v2' ||
      material.wordNumberObserved
        ? ('native-short-body-derived-word-number/v2' as const)
        : undefined;
    return {
      audit,
      ...(recoveryContext ? { recoveryContext } : {}),
      ...(comparisonPolicy ? { comparisonPolicy } : {}),
    };
  }
  return prepareNativeShortBodyReconciliation;
}

interface PreparePhysicalEvidenceDependencies {
  publicReads: PublicReadCoordinator;
  evidenceMode: 'live' | 'fixture';
  evidenceDirectory: string;
}

export function createPreparePhysicalEvidence(
  deps: PreparePhysicalEvidenceDependencies,
): PreparePhysicalEvidenceOperation {
  function preparePhysicalEvidence(
    job: Job,
    dataset: string,
    payload: unknown,
    capturedAt = timestamp(),
  ): { reference: EvidenceRef; document: EvidenceDocument } {
    deps.publicReads.assertMutationAllowed();
    const id = randomUUID();
    const document: EvidenceDocument = {
      schemaVersion: 1,
      evidenceId: id,
      accountId: job.accountId,
      jobId: job.id,
      dataset,
      capturedAt,
      collectionMode: deps.evidenceMode,
      evidenceKind:
        job.kind === 'write' && dataset === 'write-intent' ? 'local-intent' : 'observation',
      payload,
    };
    const bytes = Buffer.from(`${canonicalJson(document)}\n`, 'utf8');
    if (
      bodyProof.hasReservedNativeShortBodySignal(document) &&
      (bytes.length > 16 * 1024 * 1024 || (dataset === 'write-intent' && bytes.length > 16384))
    )
      return bodyUnavailable();
    const relative = path.join(hash(job.accountId).slice(0, 24), dataset, `${id}.json`),
      destination = path.join(deps.evidenceDirectory, relative);
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    let cursor = deps.evidenceDirectory;
    for (const component of ['', ...path.dirname(relative).split(path.sep)]) {
      if (component) cursor = path.join(cursor, component);
      const stat = lstatSync(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new RuntimeError(
          'evidence_path_invalid',
          'Evidence paths must not contain symbolic links.',
        );
    }
    const temporary = `${destination}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporary, 'wx', 0o600);
      writeFileSync(descriptor, bytes);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      if (existsSync(destination))
        throw new RuntimeError('evidence_exists', 'Immutable evidence already exists.');
      renameSync(temporary, destination);
      const directory = openSync(path.dirname(destination), 'r');
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (existsSync(temporary)) unlinkSync(temporary);
      throw error;
    }
    return {
      document,
      reference: {
        id,
        accountId: job.accountId,
        jobId: job.id,
        dataset,
        capturedAt,
        path: relative.split(path.sep).join('/'),
        sha256: hash(bytes),
      },
    };
  }
  return preparePhysicalEvidence;
}
