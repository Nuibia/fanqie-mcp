import {
  bodyUnavailable,
  canonicalJson,
  timestamp,
  bodyLink,
  sameNativeValue,
  bodyObject,
} from '../native-closure-signal.js';
import * as bodyProof from '../../../platform/short-native-body-proof.js';
import { PublicReadCoordinator } from '../../public-read.js';
import {
  type EnsureOpenOperation,
  type PrepareOperation,
  type TransactionOperation,
  type PreparePhysicalEvidenceOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';
import {
  type RawJobOperation,
  type ListNativeShortBodyAttemptsOperation,
  type PersistNativeShortBodyStageOperation,
  type GetNativeShortBodyRecoveryContextOperation,
  type CreateNativeShortBodyAuthorityOperation,
  type IssueNativeShortBodyWriteAuthorityOperation,
  type GetNativeShortBodyOriginalAuditOperation,
  type IssueNativeShortBodyReconciliationAuthorityOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';

import {
  type NativeShortBodyStageOperation,
  type NativeShortBodyContextOperation,
  type NativeShortBodyRecoveryFromPayloadOperation,
  type NativeShortBodyIssuerOperation,
} from '../contracts/native-body-native-short-body-signal.js';

import {
  type InsertPhysicalEvidenceOperation,
  type ReadEvidenceOperation,
  type ListEvidenceOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

import {
  type NativeShortBodyBusinessInput,
  validateNativeShortBodyBusinessInput,
} from '../../../platform/short-native-body.js';
import { type NativeShortBodyStoreAuthority } from '../authority.js';

interface ListNativeShortBodyAttemptsDependencies {
  publicReads: PublicReadCoordinator;
  ensureOpen: EnsureOpenOperation;
  rawJob: RawJobOperation;
  prepare: PrepareOperation;
}

export function createListNativeShortBodyAttempts(
  deps: ListNativeShortBodyAttemptsDependencies,
): ListNativeShortBodyAttemptsOperation {
  function listNativeShortBodyAttempts(
    jobId: string,
    accountId: string,
  ): bodyProof.NativeShortBodyAttemptRow[] {
    return deps.publicReads.memo('store.listNativeShortBodyAttempts', [jobId, accountId], () => {
      deps.ensureOpen();
      const job = deps.rawJob(jobId);
      if (!job || job.accountId !== accountId) return bodyUnavailable();
      const rows = deps
        .prepare('SELECT * FROM native_short_body_attempts WHERE job_id=? ORDER BY ordinal LIMIT 2')
        .all(jobId);
      if (rows.length > 1) return bodyUnavailable();
      return rows.map((row) => {
        if (row.account_id !== accountId || Number(row.ordinal) !== 1) return bodyUnavailable();
        return {
          jobId: String(row.job_id),
          accountId: String(row.account_id),
          ordinal: 1 as const,
          evidence: {
            id: String(row.evidence_id),
            sha256: String(row.evidence_sha256),
            capturedAt: String(row.evidence_captured_at),
          },
          eventAt: String(row.event_at),
        };
      });
    });
  }
  return listNativeShortBodyAttempts;
}

interface PersistNativeShortBodyStageDependencies {
  publicReads: PublicReadCoordinator;
  transaction: TransactionOperation;
  rawJob: RawJobOperation;
  ownerId: `${string}-${string}-${string}-${string}-${string}`;
  nativeShortBodyStage: NativeShortBodyStageOperation;
  preparePhysicalEvidence: PreparePhysicalEvidenceOperation;
  insertPhysicalEvidence: InsertPhysicalEvidenceOperation;
  nativeShortBodyContext: NativeShortBodyContextOperation;
  readEvidence: ReadEvidenceOperation;
}

export function createPersistNativeShortBodyStage(
  deps: PersistNativeShortBodyStageDependencies,
): PersistNativeShortBodyStageOperation {
  function persistNativeShortBodyStage(
    jobId: string,
    kind: bodyProof.NativeShortBodyStageKind,
    payload: unknown,
    eventAt = timestamp(),
  ): bodyProof.NativeShortBodyRefLink {
    deps.publicReads.assertMutationAllowed();
    const ref = deps.transaction(() => {
      const job = deps.rawJob(jobId);
      if (
        !job ||
        job.ownerId !== deps.ownerId ||
        job.status !== 'running' ||
        job.kind !== 'write' ||
        job.operation !== bodyProof.NATIVE_SHORT_BODY_OPERATION
      )
        return bodyUnavailable();
      const stage = deps.nativeShortBodyStage(job, kind, payload, eventAt);
      if (kind === 'intent') {
        const serialized = canonicalJson(stage),
          prohibited =
            /"(?:body|content|text|html|markdown|args|arguments|cookie|cookies|authorization|token|accessToken|refreshToken|password|secret|credentials|headers|storageState)"\s*:/i;
        if (prohibited.test(serialized) || Buffer.byteLength(serialized) > 16384)
          return bodyUnavailable();
      }
      const prepared = deps.preparePhysicalEvidence(
        job,
        bodyProof.NATIVE_SHORT_BODY_DATASETS[kind],
        stage,
      );
      deps.insertPhysicalEvidence(prepared.reference);
      bodyProof.validateNativeShortBodyEvidenceContext(deps.nativeShortBodyContext(job), 'prefix');
      return prepared.reference;
    });
    const actual = deps.rawJob(jobId);
    if (!actual) return bodyUnavailable();
    deps.readEvidence(ref);
    bodyProof.validateNativeShortBodyEvidenceContext(deps.nativeShortBodyContext(actual), 'prefix');
    return bodyLink(ref);
  }
  return persistNativeShortBodyStage;
}

interface GetNativeShortBodyRecoveryContextDependencies {
  publicReads: PublicReadCoordinator;
  ensureOpen: EnsureOpenOperation;
  rawJob: RawJobOperation;
  nativeShortBodyRecoveryFromPayload: NativeShortBodyRecoveryFromPayloadOperation;
  listEvidence: ListEvidenceOperation;
  readEvidence: ReadEvidenceOperation;
}

export function createGetNativeShortBodyRecoveryContext(
  deps: GetNativeShortBodyRecoveryContextDependencies,
): GetNativeShortBodyRecoveryContextOperation {
  function getNativeShortBodyRecoveryContext(
    jobId: string,
    accountId: string,
  ): bodyProof.NativeShortBodyRecoveryContextV2 | undefined {
    return deps.publicReads.memo(
      'store.getNativeShortBodyRecoveryContext',
      [jobId, accountId],
      () => {
        deps.ensureOpen();
        const job = deps.rawJob(jobId);
        if (!job || job.accountId !== accountId) return bodyUnavailable();
        if (job.kind === 'write')
          return deps.nativeShortBodyRecoveryFromPayload(job.result ?? {}, accountId);
        if (job.operation !== bodyProof.NATIVE_SHORT_BODY_RECONCILE_OPERATION) return undefined;
        const refs = deps.listEvidence(job.id);
        if (refs.length === 0) return undefined;
        if (
          refs.length !== 1 ||
          refs[0]!.dataset !== bodyProof.NATIVE_SHORT_BODY_DATASETS.reconciliation
        )
          return bodyUnavailable();
        return deps.nativeShortBodyRecoveryFromPayload(
          deps.readEvidence(refs[0]!).payload,
          accountId,
        );
      },
    );
  }
  return getNativeShortBodyRecoveryContext;
}

interface IssueNativeShortBodyWriteAuthorityDependencies {
  publicReads: PublicReadCoordinator;
  nativeShortBodyIssuer: NativeShortBodyIssuerOperation;
  nativeShortBodyWriteEnabled: boolean;
  createNativeShortBodyAuthority: CreateNativeShortBodyAuthorityOperation;
}

export function createIssueNativeShortBodyWriteAuthority(
  deps: IssueNativeShortBodyWriteAuthorityDependencies,
): IssueNativeShortBodyWriteAuthorityOperation {
  function issueNativeShortBodyWriteAuthority(
    jobId: string,
    accountId: string,
    input: NativeShortBodyBusinessInput,
    expectedPlatformAccount: string,
  ): NativeShortBodyStoreAuthority {
    deps.publicReads.assertMutationAllowed();
    deps.nativeShortBodyIssuer();
    if (!deps.nativeShortBodyWriteEnabled) return bodyUnavailable();
    const business = validateNativeShortBodyBusinessInput(input),
      workId = business.target.workId;
    return deps.createNativeShortBodyAuthority(
      'write',
      jobId,
      accountId,
      business,
      expectedPlatformAccount,
      null,
      null,
    );
  }
  return issueNativeShortBodyWriteAuthority;
}

interface IssueNativeShortBodyReconciliationAuthorityDependencies {
  publicReads: PublicReadCoordinator;
  nativeShortBodyIssuer: NativeShortBodyIssuerOperation;
  rawJob: RawJobOperation;
  getNativeShortBodyOriginalAudit: GetNativeShortBodyOriginalAuditOperation;
  nativeShortBodyContext: NativeShortBodyContextOperation;
  nativeShortBodySource: bodyProof.NativeShortBodySource;
  createNativeShortBodyAuthority: CreateNativeShortBodyAuthorityOperation;
}

export function createIssueNativeShortBodyReconciliationAuthority(
  deps: IssueNativeShortBodyReconciliationAuthorityDependencies,
): IssueNativeShortBodyReconciliationAuthorityOperation {
  function issueNativeShortBodyReconciliationAuthority(
    readJobId: string,
    accountId: string,
    originalJobId: string,
    audit: bodyProof.NativeShortBodyOriginalAudit,
    expectedPlatformAccount: string,
    recoveryContext?: bodyProof.NativeShortBodyRecoveryContextV2,
    comparisonPolicy?: 'native-short-body-derived-word-number/v2',
  ): NativeShortBodyStoreAuthority {
    deps.publicReads.assertMutationAllowed();
    deps.nativeShortBodyIssuer();
    const original = deps.rawJob(originalJobId);
    if (
      !original ||
      original.accountId !== accountId ||
      original.kind !== 'write' ||
      original.status !== 'uncertain' ||
      !sameNativeValue(
        audit,
        deps.getNativeShortBodyOriginalAudit(originalJobId, accountId, recoveryContext),
      )
    )
      return bodyUnavailable();
    const context = bodyProof.validateNativeShortBodyEvidenceContext(
      deps.nativeShortBodyContext(original),
      'prefix',
    );
    const baseline = context.documents.find(
      (doc) => doc.dataset === bodyProof.NATIVE_SHORT_BODY_DATASETS.baseline,
    );
    if (!baseline) return bodyUnavailable();
    const payload = bodyObject(bodyObject(baseline.payload).payload),
      business = validateNativeShortBodyBusinessInput(payload.businessInput);
    if (!sameNativeValue(payload.source, deps.nativeShortBodySource)) return bodyUnavailable();
    const material = bodyProof.getNativeShortBodyExpectationMaterial(
      context,
      audit,
      comparisonPolicy,
      recoveryContext,
    );
    if (
      material.platformAccountId !== expectedPlatformAccount ||
      !sameNativeValue(material.source, deps.nativeShortBodySource) ||
      !sameNativeValue(material.business, business)
    )
      return bodyUnavailable();
    return deps.createNativeShortBodyAuthority(
      'reconcile',
      readJobId,
      accountId,
      business,
      expectedPlatformAccount,
      audit,
      material.expectation,
      recoveryContext,
      comparisonPolicy,
    );
  }
  return issueNativeShortBodyReconciliationAuthority;
}
