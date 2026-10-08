import { type EvidenceRef } from '../runtime-error.js';
import { bodyUnavailable, sameNativeValue, timestamp } from '../native-closure-signal.js';
import * as bodyProof from '../../../platform/short-native-body-proof.js';

import { isCanonicalNativeTime } from '../../../platform/short-native-metadata-proof.js';

import { type CreateNativeShortBodyAuthorityDependencies } from '../operations/jobs-api-create-native-short-body-authority.js';
interface Ports {
  deps: CreateNativeShortBodyAuthorityDependencies;
  recoveryContext: bodyProof.NativeShortBodyRecoveryContextV2 | undefined;
  mode: 'write' | 'reconcile';
  comparisonPolicy: 'native-short-body-derived-word-number/v2' | undefined;
  reconciliationRows: { rows: string; refs: EvidenceRef[] } | null;
  accountId: string;
  jobId: string;
  workId: string;
  firstGet: boolean;
  inputHash: string;
  audit: bodyProof.NativeShortBodyOriginalAudit | null;
}
export function createBodyAuthorityLifecycleCheck(ports: Ports) {
  const audit = ports.audit;
  return (allowReadBoundary: boolean = false) => {
    ports.deps.publicReads.assertMutationAllowed();
    ports.deps.nativeShortBodyIssuer();
    if (ports.recoveryContext) {
      if (
        ports.mode !== 'reconcile' ||
        ports.comparisonPolicy !== 'native-short-body-derived-word-number/v2' ||
        ports.recoveryContext.recovery.leaseOwnerId !== ports.deps.ownerId ||
        ports.recoveryContext.recovery.leaseCheckedAt > timestamp() ||
        (ports.reconciliationRows === null &&
          !sameNativeValue(
            ports.recoveryContext.freshRead,
            ports.deps.nativeShortBodyRecoveryFreshRead(
              ports.recoveryContext.recovery,
              ports.accountId,
            ),
          ))
      )
        return bodyUnavailable();
    }
    const job = ports.deps.rawJob(ports.jobId);
    if (
      !job ||
      job.accountId !== ports.accountId ||
      job.ownerId !== ports.deps.ownerId ||
      job.status !== 'running' ||
      job.cancellationRequestedAt !== null ||
      job.deadlineAt === null ||
      !isCanonicalNativeTime(job.deadlineAt) ||
      job.startedAt === null ||
      !isCanonicalNativeTime(job.startedAt) ||
      job.startedAt > timestamp() ||
      !Number.isInteger(job.timeoutMs) ||
      job.timeoutMs < 1 ||
      job.deadlineAt !== new Date(Date.parse(job.startedAt) + job.timeoutMs).toISOString() ||
      Date.parse(job.deadlineAt) <= Date.now()
    )
      return bodyUnavailable();
    const refs = ports.deps.listEvidence(ports.jobId);
    const target = { kind: 'short-story', id: ports.workId };
    if (job.target === null) {
      if (
        !ports.firstGet ||
        (!allowReadBoundary && job.platformReadStartedAt !== null) ||
        (job.platformReadStartedAt !== null &&
          (!isCanonicalNativeTime(job.platformReadStartedAt) ||
            job.platformReadStartedAt < job.startedAt ||
            job.platformReadStartedAt > timestamp())) ||
        job.platformWriteStartedAt !== null ||
        refs.length !== 0 ||
        ports.deps.listNativeShortBodyAttempts(ports.jobId, ports.accountId).length !== 0
      )
        return bodyUnavailable();
    } else if (!sameNativeValue(job.target, target)) return bodyUnavailable();
    if (ports.mode === 'write') {
      if (
        job.kind !== 'write' ||
        job.operation !== bodyProof.NATIVE_SHORT_BODY_OPERATION ||
        job.scope !== bodyProof.nativeShortBodyScope(ports.workId) ||
        job.datasets.length !== 0 ||
        job.inputHash !== ports.inputHash
      )
        return bodyUnavailable();
      if (
        ports.deps
          .prepare(
            "SELECT 1 FROM jobs WHERE account_id=? AND kind='write' AND status='uncertain' AND id<>? LIMIT 1",
          )
          .get(ports.accountId, ports.jobId)
      )
        return bodyUnavailable();
    } else {
      if (
        !audit ||
        job.kind !== 'read' ||
        job.operation !== bodyProof.NATIVE_SHORT_BODY_RECONCILE_OPERATION ||
        job.scope !== bodyProof.nativeShortBodyReconciliationScope(audit.originalJobId) ||
        !sameNativeValue(job.datasets, [bodyProof.NATIVE_SHORT_BODY_DATASETS.reconciliation]) ||
        job.inputHash !==
          bodyProof.nativeShortBodyReconciliationInputHash(
            ports.accountId,
            audit,
            ports.recoveryContext?.recovery,
            ports.comparisonPolicy,
          ) ||
        job.platformWriteStartedAt !== null
      )
        return bodyUnavailable();
      if (ports.reconciliationRows === null) {
        ports.reconciliationRows = ports.deps.transaction(() => {
          const rows = ports.deps.nativeShortBodyReconciliationRows(
            audit.originalJobId,
            ports.accountId,
            ports.recoveryContext?.recovery,
          );
          if (
            !sameNativeValue(
              audit,
              ports.deps.getNativeShortBodyOriginalAudit(
                audit.originalJobId,
                ports.accountId,
                ports.recoveryContext,
              ),
            )
          )
            return bodyUnavailable();
          return rows;
        });
      } else if (
        ports.reconciliationRows.rows !==
        ports.deps.nativeShortBodyReconciliationRows(
          audit.originalJobId,
          ports.accountId,
          ports.recoveryContext?.recovery,
        ).rows
      )
        return bodyUnavailable();
      // Retain immediate SQL/path/file/SHA fences without replaying the native body proof for each GET.
      for (const ref of ports.reconciliationRows.refs) ports.deps.readEvidence(ref);
      if (job.platformReadStartedAt !== null && job.platformReadStartedAt <= audit.priorEndedAt)
        return bodyUnavailable();
    }
    return job;
  };
}
