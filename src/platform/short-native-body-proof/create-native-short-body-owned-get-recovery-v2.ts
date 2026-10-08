import { type NativeShortEvidenceContext } from '../short-native-metadata-proof.js';

import {
  type NativeShortBodyHistoryFrame,
  type NativeShortBodyOwnedGetRecoveryV2,
  type NativeShortBodyOriginalAudit,
  type NativeShortBodyRecoveryContextV2,
  type NativeShortBodyReconciliationEvidence,
  type NativeShortBodySettlement,
} from './native-short-body-attempt-row.js';

import { contextCopy } from './context-copy.js';

import { originalAudit, recoveryShape, checkedRecovery } from './original-audit.js';

import { originalForAudit, auditShape } from './validate-native-short-body-evidence-context.js';

import { exact, copy, MIB, fail, freeze, hash, type Data, storedNative, native } from './fail.js';

import { nativeShortBodyGraphHash } from './same-mode.js';

import {
  bodyRefLink,
  account,
  BODY_SETTLEMENT_REASONS,
  source,
  bodyRead,
  durableCleanup,
  ordered,
} from './native-short-body-scope.js';

import {
  NATIVE_SHORT_BODY_COMPARISON_POLICY_V2,
  type NativeShortBodyBusinessInput,
  type NativeShortBodyPlan,
  NATIVE_SHORT_BODY_SCOPE,
} from '../short-native-body.js';

import { type NativeShortBodySource } from './inspect.js';

import { storedBodyMath } from '../short-native-legacy-codec.js';

/** Store alone attests a currently held lease; this pure issuer binds the complete authoritative GET graph. */
export function createNativeShortBodyOwnedGetRecoveryV2(
  context: unknown,
  freshRead: NativeShortEvidenceContext,
  lease: { ownerId: string; checkedAt: string; expiresAt: string },
  history?: NativeShortBodyHistoryFrame,
): NativeShortBodyOwnedGetRecoveryV2 {
  const c = contextCopy(context),
    a = originalAudit(c, history, undefined, true),
    state = originalForAudit(c, a, undefined, true),
    f = exact(copy(freshRead, 32 * MIB), [
      'accountId',
      'job',
      'manifest',
      'ref',
      'document',
    ]) as unknown as NativeShortEvidenceContext,
    l = exact(copy(lease, 16 * 1024), ['ownerId', 'checkedAt', 'expiresAt']);
  if (!f.job || !f.manifest || f.job.ownerId !== l.ownerId) fail('source_mismatch');
  const r = recoveryShape({
    schema: 'native-short-body-owned-get-recovery/v2',
    originalOwnerId: c.job.ownerId,
    leaseOwnerId: l.ownerId,
    freshReadJobId: f.job.id,
    freshReadJobHash: nativeShortBodyGraphHash(f.job),
    freshReadManifestId: f.manifest.id,
    freshReadManifestHash: nativeShortBodyGraphHash(f.manifest),
    freshReadEvidence: bodyRefLink(f.ref),
    leaseCheckedAt: l.checkedAt,
    leaseExpiresAt: l.expiresAt,
  });
  checkedRecovery(state, a, { recovery: r, freshRead: f });
  return r;
}

export function createNativeShortBodyOriginalAudit(
  context: unknown,
  history?: NativeShortBodyHistoryFrame,
): NativeShortBodyOriginalAudit {
  return originalAudit(context, history);
}

export function createNativeShortBodyOriginalAuditForRecovery(
  context: unknown,
  recoveryContext: NativeShortBodyRecoveryContextV2,
  history?: NativeShortBodyHistoryFrame,
): NativeShortBodyOriginalAudit {
  const a = originalAudit(context, history, recoveryContext);
  checkedRecovery(originalForAudit(context, a, recoveryContext), a, recoveryContext);
  return a;
}

/** GET-only expectation material follows a fully authenticated original graph.
 * No snapshot, plan, permit, or modern writer source leaves this adapter. */
export function getNativeShortBodyExpectationMaterial(
  context: unknown,
  audit: NativeShortBodyOriginalAudit,
  comparisonPolicy?: typeof NATIVE_SHORT_BODY_COMPARISON_POLICY_V2,
  recoveryContext?: NativeShortBodyRecoveryContextV2,
): Readonly<{
  business: NativeShortBodyBusinessInput;
  source: NativeShortBodySource;
  platformAccountId: string;
  wordNumberObserved: boolean;
  expectation: NativeShortBodyPlan['expectation'];
}> {
  const a = auditShape(audit),
    state = originalForAudit(context, a, recoveryContext);
  if (!state.baseline || !state.plan || !state.business || !state.source) fail('source_mismatch');
  if (comparisonPolicy !== undefined && comparisonPolicy !== NATIVE_SHORT_BODY_COMPARISON_POLICY_V2)
    fail('source_mismatch');
  const before = state.baseline.snapshot;
  return freeze({
    business: state.business,
    source: state.source,
    platformAccountId: before.binding.account.id,
    wordNumberObserved: Object.hasOwn(before.native.editData, 'word_number'),
    expectation:
      comparisonPolicy === undefined
        ? state.plan.expectation
        : storedBodyMath.upgradeExpectationForGetV2(state.baseline, state.plan),
  });
}

export function nativeShortBodyReconciliationInputHash(
  accountId: string,
  audit: NativeShortBodyOriginalAudit,
  recovery?: NativeShortBodyOwnedGetRecoveryV2 | null,
  comparisonPolicy?: typeof NATIVE_SHORT_BODY_COMPARISON_POLICY_V2,
): string {
  account(accountId);
  const a = auditShape(audit);
  if (a.accountId !== accountId) fail('source_mismatch');
  if (comparisonPolicy === undefined && recovery === undefined)
    return hash({
      basis: 'native-short-body-get-only-reconciliation-input/v1',
      accountId,
      originalAuditHash: hash(a),
    });
  if (comparisonPolicy !== NATIVE_SHORT_BODY_COMPARISON_POLICY_V2) fail('source_mismatch');
  const r = recovery == null ? null : recoveryShape(recovery);
  return hash({
    basis: 'native-short-body-get-only-reconciliation-input/v2',
    accountId,
    originalAuditHash: hash(a),
    comparisonPolicy,
    recoveryHash: r === null ? null : hash(r),
  });
}

export function capturedReconciliationEvidence(
  input: unknown,
): NativeShortBodyReconciliationEvidence {
  const captured = copy(input, 16 * MIB) as Data,
    v2 = captured?.schema === 'native-short-body-reconciliation/v2';
  const d = exact(captured, [
    'schema',
    'scope',
    'source',
    'originalAudit',
    'native',
    'read',
    'ownerCheckedAt',
    'cleanup',
    'comparison',
    'reason',
    ...(v2 ? ['comparisonPolicy', 'recovery'] : []),
  ]);
  if (v2) {
    if (d.comparisonPolicy !== NATIVE_SHORT_BODY_COMPARISON_POLICY_V2) fail('source_mismatch');
    if (d.recovery !== null) recoveryShape(d.recovery);
  }
  if (
    !['native-short-body-reconciliation/v1', 'native-short-body-reconciliation/v2'].includes(
      d.schema as string,
    ) ||
    d.scope !== NATIVE_SHORT_BODY_SCOPE ||
    !BODY_SETTLEMENT_REASONS.includes(d.reason as NativeShortBodySettlement['reason']) ||
    (d.native === null) !== (d.comparison === null)
  )
    fail('invalid_shape');
  source(d.source);
  const a = auditShape(d.originalAudit),
    read = bodyRead(d.read, d.native !== null);
  if (d.native !== null) {
    const snapshot = storedNative(d.native);
    if (snapshot.snapshot.binding.work.id !== a.target.id) fail('source_mismatch');
    exact(d.comparison, ['matches', 'reason', 'scope', 'hashBases', 'actual']);
  }
  const c = durableCleanup(d.cleanup, new Date().toISOString(), null);
  if (d.ownerCheckedAt !== null) ordered([read.proof.readStartedAt, d.ownerCheckedAt, c.checkedAt]);
  if (read.proof.readStartedAt === null || read.proof.readStartedAt <= a.priorEndedAt)
    fail('invalid_trace');
  ordered([
    ...[read.proof.readStartedAt, read.proof.readFinishedAt, read.proof.proofCapturedAt].filter(
      (v) => v !== null,
    ),
    c.checkedAt,
  ]);
  if (d.native === null && d.reason !== 'partial_read' && d.reason !== 'reconciliation_not_live')
    fail('invalid_trace');
  return freeze(d as unknown as NativeShortBodyReconciliationEvidence);
}

export function createNativeShortBodyReconciliationEvidence(
  input: unknown,
): NativeShortBodyReconciliationEvidence {
  const evidence = capturedReconciliationEvidence(input);
  if (evidence.native !== null) native(evidence.native);
  return evidence;
}
