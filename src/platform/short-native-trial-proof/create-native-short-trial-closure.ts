import {
  type NativeShortTrialReconciliationContext,
  type NativeShortTrialClosure,
  closureShape,
  sourceForAudit,
} from './pointer.js';

import { validateNativeShortTrialReconciliationContext } from './observed-hash.js';

import { order, fail, freeze, copy, same, type NativeShortTrialProjection } from './fail.js';

import {
  scalar,
  nativeObservation,
  statusObservation,
  safeNativeShortTrialRef,
} from './validate-native-short-trial-evidence-context.js';

export function createNativeShortTrialClosure(
  context: NativeShortTrialReconciliationContext,
  settledAt: string,
): NativeShortTrialClosure {
  const verified = validateNativeShortTrialReconciliationContext(context),
    audit = verified.evidence.originalAudit;
  order([context.manifest.committedAt, settledAt]);
  if (settledAt > new Date().toISOString()) fail();
  return freeze<NativeShortTrialClosure>({
    schema: 'native-short-trial-closure/v1',
    target: audit.target,
    reconciliationJobId: context.readJob.id,
    evidence: copy(context.ref, 16_384),
    status: verified.status,
    result: verified.result,
    originalAudit: audit,
    originalAttemptEvidence: audit.originalAttemptEvidence ?? {
      readJobId: context.readJob.id,
      evidenceId: context.ref.id,
      evidenceHash: context.ref.sha256,
    },
    settledAt,
  });
}

export function validateNativeShortTrialClosureContext(
  context: NativeShortTrialReconciliationContext,
  closure: unknown,
  settledAt: string,
): ReturnType<typeof validateNativeShortTrialReconciliationContext> {
  try {
    const c = closureShape(closure),
      expected = createNativeShortTrialClosure(context, settledAt);
    if (!same(c, expected)) fail();
    return validateNativeShortTrialReconciliationContext(context);
  } catch {
    fail();
  }
}

export function projectNativeShortTrialReconciliationContext(
  context: NativeShortTrialReconciliationContext,
): NativeShortTrialProjection {
  try {
    const verified = validateNativeShortTrialReconciliationContext(context),
      current = scalar(context.original.job, 'result');
    let result: Record<string, unknown> | null = null;
    const status = verified.evidence.result.snapshot
        ? nativeObservation(verified.evidence.result.snapshot, 'later_read', context.ref)
        : statusObservation(sourceForAudit(context.original, verified.evidence.originalAudit)),
      publicBusiness = { ...verified.result, ...status };
    if (
      scalar(current, 'schema') === 'native-short-trial-closure/v1' &&
      scalar(current, 'reconciliationJobId') === context.readJob.id
    ) {
      const c = closureShape(current);
      validateNativeShortTrialClosureContext(context, c, c.settledAt);
      result = {
        schema: c.schema,
        target: c.target,
        reconciliationJobId: c.reconciliationJobId,
        evidence: safeNativeShortTrialRef(c.evidence),
        status: c.status,
        result: publicBusiness,
        originalAttemptEvidence: c.originalAttemptEvidence,
        settledAt: c.settledAt,
        originalEndedAt: c.originalAudit.originalEndedAt,
        priorEndedAt: c.originalAudit.priorEndedAt,
      };
    }
    return freeze({
      validated: true,
      result,
      evidence: [safeNativeShortTrialRef(context.ref)],
      data: [publicBusiness],
      collectionMode: verified.evidence.provenance.mode,
    });
  } catch {
    return { validated: false, result: null, evidence: [], data: [], collectionMode: null };
  }
}
