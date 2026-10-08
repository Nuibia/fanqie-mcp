import {
  bodyUnavailable,
  sameNativeValue,
  bodyLink,
  bodyObject,
  bodyNative,
} from '../native-closure-signal.js';
import * as bodyProof from '../../../platform/short-native-body-proof.js';

import {
  type NativeShortBodyExpectation,
  compareNativeShortBodyReadback,
} from '../../../platform/short-native-body.js';

import { type CreateNativeShortBodyAuthorityDependencies } from '../operations/jobs-api-create-native-short-body-authority.js';
interface Ports {
  deps: CreateNativeShortBodyAuthorityDependencies;
  check: (allowReadBoundary?: boolean) => import('../runtime-error.js').Job;
  mode: 'write' | 'reconcile';
  audit: bodyProof.NativeShortBodyOriginalAudit | null;
  firstGet: boolean;
  reconciliationCount: number;
  accountId: string;
  recoveryContext: bodyProof.NativeShortBodyRecoveryContextV2 | undefined;
  comparisonPolicy: 'native-short-body-derived-word-number/v2' | undefined;
  source: bodyProof.NativeShortBodySource;
  expectation: NativeShortBodyExpectation | null;
  jobId: string;
}
export function createBodyAuthorityReconciliationRecorder(ports: Ports) {
  return (input: unknown) => {
    ports.deps.publicReads.assertMutationAllowed();
    ports.check();
    if (
      ports.mode !== 'reconcile' ||
      !ports.audit ||
      ports.firstGet ||
      ++ports.reconciliationCount !== 1
    )
      return bodyUnavailable();
    const value = bodyObject(input, [
      'native',
      'read',
      'ownerCheckedAt',
      'cleanup',
      'comparison',
      'reason',
    ]);
    const freshAudit = ports.deps.getNativeShortBodyOriginalAudit(
      ports.audit.originalJobId,
      ports.accountId,
      ports.recoveryContext,
    );
    if (!sameNativeValue(freshAudit, ports.audit)) return bodyUnavailable();
    const payload = bodyProof.createNativeShortBodyReconciliationEvidence({
      schema: ports.comparisonPolicy
        ? 'native-short-body-reconciliation/v2'
        : 'native-short-body-reconciliation/v1',
      scope: 'short-native-body/v1',
      source: ports.source,
      originalAudit: freshAudit,
      ...(ports.comparisonPolicy
        ? {
            comparisonPolicy: ports.comparisonPolicy,
            recovery: ports.recoveryContext?.recovery ?? null,
          }
        : {}),
      native: value.native === null ? null : bodyNative(value.native).native,
      read: value.read,
      ownerCheckedAt: value.ownerCheckedAt,
      cleanup: value.cleanup,
      comparison: value.comparison,
      reason: value.reason,
    });
    if (payload.native !== null) {
      if (!ports.expectation) return bodyUnavailable();
      const comparison = compareNativeShortBodyReadback(
        ports.expectation,
        bodyNative(payload.native).snapshot,
      );
      if (!sameNativeValue(payload.comparison, comparison)) return bodyUnavailable();
      const cleanup = payload.cleanup,
        clean =
          cleanup.sessionCreated &&
          cleanup.sessionDisposed &&
          cleanup.pendingAtEnd === 0 &&
          cleanup.disposalFailures === 0 &&
          cleanup.quarantined === false;
      const original = ports.deps.rawJob(ports.audit.originalJobId);
      if (!original) return bodyUnavailable();
      const baseline = ports.deps
        .nativeShortBodyContext(original)
        .documents.find(
          (document) => document.dataset === bodyProof.NATIVE_SHORT_BODY_DATASETS.baseline,
        );
      if (!baseline) return bodyUnavailable();
      const untouched =
        bodyNative(payload.native).snapshot.snapshotVersionHash ===
        ports.expectation.sourceVersionHash;
      const reason =
        clean && payload.ownerCheckedAt !== null
          ? comparison.matches
            ? 'match'
            : untouched
              ? 'not_applied'
              : 'readback_mismatch'
          : 'partial_read';
      if (payload.reason !== reason) return bodyUnavailable();
    }
    const job = ports.check(),
      prepared = ports.deps.preparePhysicalEvidence(
        job,
        bodyProof.NATIVE_SHORT_BODY_DATASETS.reconciliation,
        payload,
      );
    const ref = ports.deps.transaction(() => {
      const current = ports.check();
      if (
        current.kind !== 'read' ||
        !sameNativeValue(current.datasets, [bodyProof.NATIVE_SHORT_BODY_DATASETS.reconciliation]) ||
        ports.deps.listEvidence(ports.jobId).length !== 0
      )
        return bodyUnavailable();
      ports.deps.insertPhysicalEvidence(prepared.reference);
      return prepared.reference;
    });
    const saved = ports.deps.readEvidence(ref);
    if (
      !sameNativeValue(saved.payload, payload) ||
      !sameNativeValue(
        freshAudit,
        ports.deps.getNativeShortBodyOriginalAudit(
          ports.audit.originalJobId,
          ports.accountId,
          ports.recoveryContext,
        ),
      )
    )
      return bodyUnavailable();
    if (job.platformWriteStartedAt !== null) return bodyUnavailable();
    return bodyLink(ref);
  };
}
