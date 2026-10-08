import {
  type NativeShortCoverReconciliationContext,
  scalar,
  safeNativeShortCoverRef,
} from './project-native-short-cover-evidence-context.js';

import { type NativeShortCoverProjection, freeze } from './fail.js';

import {
  validateNativeShortCoverReconciliationContext,
  validateNativeShortCoverClosureContext,
} from './reconciliation.js';

import { observation, statusObservation } from './state-for.js';

import { sourceForAudit, closureShape } from './pointer.js';

export function projectNativeShortCoverReconciliationContext(
  context: NativeShortCoverReconciliationContext,
): NativeShortCoverProjection {
  try {
    const verified = validateNativeShortCoverReconciliationContext(context),
      current = scalar(context.original.job, 'result');
    let result: Record<string, unknown> | null = null;
    const status = verified.evidence.result.snapshot
      ? observation(verified.evidence.result.snapshot, 'later_read', context.ref)
      : statusObservation(sourceForAudit(context.original, verified.evidence.originalAudit));
    const publicBusiness = { ...verified.result, ...status };
    if (
      scalar(current, 'schema') === 'native-short-cover-closure/v1' &&
      scalar(current, 'reconciliationJobId') === context.readJob.id
    ) {
      const c = closureShape(current);
      validateNativeShortCoverClosureContext(context, c, c.settledAt);
      result = {
        schema: c.schema,
        target: c.target,
        reconciliationJobId: c.reconciliationJobId,
        evidence: safeNativeShortCoverRef(c.evidence),
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
      evidence: [safeNativeShortCoverRef(context.ref)],
      data: [publicBusiness],
      collectionMode: verified.evidence.provenance.mode,
    });
  } catch {
    return { validated: false, result: null, evidence: [], data: [], collectionMode: null };
  }
}
