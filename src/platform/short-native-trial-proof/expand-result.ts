import { type State, storedNativeSnapshot, held } from './stored-native-snapshot.js';

import { type AuditResult, exact, type AuditHeld, fail } from './fail.js';

export function expandResult(input: unknown, state: State): AuditResult {
  const d = exact(input, [
    'schema',
    'mode',
    'status',
    'reason',
    'snapshot',
    'comparison',
    'desiredContentHash',
    'observedContentHash',
    'phases',
    'save',
    'proof',
    'cleanup',
    'observedPreSaveSnapshot',
    'observedSaveHeld',
  ]);
  exact(d.save, [
    'intentReceipt',
    'attemptReceipt',
    'acknowledgementReceipt',
    'observation',
    'post',
    'outcome',
  ]);
  const preSave =
    d.observedPreSaveSnapshot === null
      ? null
      : storedNativeSnapshot(d.observedPreSaveSnapshot, state.mode).snapshot;
  const after = d.snapshot === null ? null : storedNativeSnapshot(d.snapshot, state.mode).snapshot;
  let saveHeld: AuditHeld | null = null;
  if (d.observedSaveHeld !== null) {
    const h = exact(d.observedSaveHeld, ['read', 'checkedAt']);
    if (!preSave) fail();
    saveHeld = held(
      {
        ...state.baseline!,
        snapshot: preSave,
        beforeSnapshot: state.baseline!.beforeSnapshot,
        read: h.read,
        checkedAt: h.checkedAt,
      },
      state.business!,
      state.baseline!,
    );
  }
  const {
    observedPreSaveSnapshot: _pre,
    observedSaveHeld: _held,
    snapshot: _snapshot,
    save,
    ...rest
  } = d;
  return {
    ...rest,
    plan: state.plan,
    expectation: state.plan!.expectation,
    snapshot: after,
    snapshots: { before: state.baseline!.snapshot, preSave, after },
    save: { ...save, held: saveHeld },
  } as AuditResult;
}
