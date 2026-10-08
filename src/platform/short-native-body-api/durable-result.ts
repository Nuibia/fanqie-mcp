import {
  type NativeShortBodyApiReason,
  type NativeShortBodyDurableApiReason,
  type NativeShortBodyDurablePostObservation,
  type NativeShortBodyDurableApiResult,
  type FixtureRunOwner,
  type FixtureRunGlobals,
} from '../short-native-body-api.js';

import {
  nativeShortBodyHashBasesHash,
  type NativeShortBodyWriteResultEvidence,
} from '../short-native-body-proof.js';

export function createFixtureRunDurableResult(
  deps: Pick<
    FixtureRunOwner,
    | 'binding'
    | 'attemptBoundaryEntered'
    | 'links'
    | 'committedAttemptRecoveryFailed'
    | 'noChange'
    | 'result'
    | 'ownerCheckedAt'
    | 'business'
    | 'persisted'
  >,
  globals: Pick<FixtureRunGlobals, 'STOPPED' | 'compact' | 'freeze'>,
) {
  function durableResult(
    clean: boolean,
    failed: NativeShortBodyApiReason | null,
  ): NativeShortBodyDurableApiResult {
    const binding = deps.binding!;
    // A committed SQL attempt can exist even if begin/consume fails before returning its Link.
    // This readback grants no permit, never retries POST, and cannot bypass the current fence.
    if (binding.mode === 'write' && deps.attemptBoundaryEntered && deps.links.attempt === null) {
      try {
        deps.links.attempt = binding.readCommittedAttempt();
      } catch {
        deps.committedAttemptRecoveryFailed = true;
      }
    }
    let reason: NativeShortBodyDurableApiReason =
      failed ??
      (deps.noChange && clean
        ? 'no_change'
        : clean
          ? binding.source.mode === 'live'
            ? 'match'
            : 'fixture_not_live'
          : 'cleanup_failed');
    let status: NativeShortBodyDurableApiResult['status'] =
      !failed && clean ? (deps.noChange ? 'no_change' : 'complete') : 'capability_unavailable';
    const observation: NativeShortBodyDurablePostObservation | null = deps.result.save.observation
      ? { ...deps.result.save.observation, schema: 'native-short-body-acknowledgement/v1' }
      : null;
    const outcome: NativeShortBodyDurableApiResult['save']['outcome'] =
      binding.mode === 'reconcile'
        ? 'not_attempted'
        : deps.committedAttemptRecoveryFailed
          ? 'unknown'
          : !deps.links.attempt
            ? 'not_attempted'
            : status === 'complete'
              ? 'matched'
              : 'unknown';
    try {
      if (deps.committedAttemptRecoveryFailed) throw globals.STOPPED; // Keep the existing prefix; do not invent a result stage.
      if (binding.mode === 'reconcile') {
        binding.recordReconciliation({
          native: deps.result.snapshots.after ? globals.compact(deps.result.snapshots.after) : null,
          read: deps.result.phases.after,
          ownerCheckedAt: deps.ownerCheckedAt,
          cleanup: { ...deps.result.cleanup },
          comparison: deps.result.comparison,
          reason:
            deps.result.snapshots.after && clean && deps.ownerCheckedAt
              ? deps.result.comparison?.matches
                ? 'match'
                : deps.result.snapshots.after.native.snapshotVersionHash ===
                    binding.reconciliationExpectation?.sourceVersionHash
                  ? 'not_applied'
                  : 'readback_mismatch'
              : 'partial_read',
        });
      } else {
        const evidence: NativeShortBodyWriteResultEvidence = {
          schema: 'native-short-body-write-result/v1',
          outcome: deps.noChange && status === 'no_change' ? 'not_attempted' : outcome,
          reason,
          source: binding.source,
          desiredContentHash: deps.result.plan?.desiredContentHash ?? null,
          preservationHash: deps.result.plan?.expectation.preservationHash ?? null,
          hashBasesHash: nativeShortBodyHashBasesHash(deps.business!),
          evidence: { ...deps.links },
          post: { ...deps.result.save.post },
          ownerCheckedAt: deps.ownerCheckedAt,
          cleanup: { ...deps.result.cleanup },
          atomicRevision: false,
        };
        binding.recordResult(evidence);
      }
      deps.persisted = true;
    } catch {
      status = 'capability_unavailable';
      if (!failed) reason = 'durability_unverified';
    }
    return globals.freeze<NativeShortBodyDurableApiResult>({
      ...deps.result,
      schema: 'native-short-body-durable-api-result/v1',
      mode: binding.mode,
      provenance: binding.source,
      status,
      reason,
      verifiedLive:
        deps.persisted && status !== 'capability_unavailable' && binding.source.mode === 'live',
      durable: deps.persisted,
      phases: {
        before: structuredClone(deps.result.phases.before),
        preSave: structuredClone(deps.result.phases.preSave),
        after: structuredClone(deps.result.phases.after),
      },
      snapshots: { ...deps.result.snapshots },
      save: {
        trace: null,
        observation,
        post: { ...deps.result.save.post },
        outcome:
          status === 'complete'
            ? outcome
            : deps.links.attempt || deps.committedAttemptRecoveryFailed
              ? 'unknown'
              : 'not_attempted',
      },
      cleanup: { ...deps.result.cleanup },
      proof: { ...deps.result.proof, ownerCheckedAt: deps.ownerCheckedAt },
    });
  }
  return { durableResult };
}
