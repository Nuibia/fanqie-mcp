import {
  Store,
  RuntimeError,
  GENERIC_SHORT_STATUS_PROTOCOL,
  type GenericShortTrustedContext,
  type EvidenceRef,
} from '../runtime/store.js';
import { type JobContext } from '../runtime/jobs.js';
import * as writes from '../platform/writes.js';
import { hash } from './shared.js';
import {
  type PersistGenericShortObservationOperation,
  type AdvanceGenericShortStatusOperation,
  type GenericCaptureOperation,
} from './contracts/generic-write.js';
import { type RuntimeTargetOperation } from './contracts/maintenance.js';

interface Dependencies {
  genericShortContexts: Map<
    string,
    {
      context: GenericShortTrustedContext;
      witness: Record<string, unknown>;
      sticky: 'capture_failed' | 'persist_failed' | null;
    }
  >;
  runtimeTarget: RuntimeTargetOperation;
  advanceGenericShortStatus: AdvanceGenericShortStatusOperation;
  genericCapture: GenericCaptureOperation;
  store: Store;
}

export function createPersistGenericShortObservation(
  deps: Dependencies,
): PersistGenericShortObservationOperation {
  function persistGenericShortObservation(
    ctx: JobContext,
    role: { dataset: string; phase: string; payload?: Record<string, unknown> },
    snapshotInput: unknown,
  ): EvidenceRef {
    const active = deps.genericShortContexts.get(ctx.jobId);
    if (!active || active.sticky)
      throw new RuntimeError(
        'capability_unavailable',
        'The actual generic short execution context is unavailable.',
      );
    let snapshot: writes.ModernShortSnapshot;
    try {
      snapshot = writes.validateGenericShortSnapshot(snapshotInput);
      if (
        snapshot.accountId !== active.context.platformOwnerId ||
        snapshot.statusProof.owner.kind !== active.context.identityType ||
        hash(deps.runtimeTarget(snapshot.target)) !== hash(active.context.target) ||
        snapshot.statusProof.profileId !== active.context.profileId ||
        snapshot.statusProof.profileVerifiedAt !== active.context.profileVerifiedAt
      )
        throw Error('Context mismatch');
    } catch (error) {
      active.sticky = 'capture_failed';
      try {
        deps.advanceGenericShortStatus(ctx, 'capture_failed', {
          kind: 'capture_failed',
          at: new Date().toISOString(),
        });
      } catch {}
      throw error;
    }
    const source = { mode: 'live', origin: 'https://fanqienovel.com' };
    const payload =
      role.dataset === 'editable_snapshot'
        ? deps.genericCapture({
            schema: 'fanqie-generic-short-editor-observation/v1',
            phase: role.phase,
            snapshot,
            source,
          })
        : deps.genericCapture({
            ...role.payload,
            statusProtocol: GENERIC_SHORT_STATUS_PROTOCOL,
            ...(role.dataset === 'reconciliation' ? { statusSnapshot: snapshot } : { snapshot }),
            source,
          });
    let ref: EvidenceRef;
    try {
      ref = ctx.saveEvidence(role.dataset, payload);
      const doc = deps.store.readEvidence(ref);
      if (
        hash(doc.payload) !== hash(payload) ||
        doc.jobId !== ctx.jobId ||
        doc.accountId !== ctx.accountId ||
        doc.dataset !== role.dataset
      )
        throw Error('Persisted observation mismatch');
      const observations = active.witness.observations as unknown[];
      active.witness = deps.genericCapture({
        ...active.witness,
        observations: [
          ...observations,
          {
            ordinal: observations.length + 1,
            dataset: role.dataset,
            phase: role.phase,
            evidenceId: ref.id,
            evidenceHash: ref.sha256,
          },
        ],
      });
      deps.advanceGenericShortStatus(
        ctx,
        role.dataset === 'creation-repair-verification'
          ? 'final_observed'
          : ctx.accountId && active.context.kind === 'read'
            ? 'read_saved'
            : role.phase === 'after'
              ? 'after_saved'
              : 'baseline_saved',
      );
      return ref;
    } catch (error) {
      active.sticky = 'persist_failed';
      try {
        deps.advanceGenericShortStatus(ctx, 'persist_failed', {
          kind: 'persist_failed',
          at: new Date().toISOString(),
        });
      } catch {}
      throw error;
    }
  }
  return persistGenericShortObservation;
}
