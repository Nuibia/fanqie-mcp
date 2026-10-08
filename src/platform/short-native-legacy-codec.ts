/** @internal Stored graph math only. No IO, runtime, proof, permit or save authority. */
import {
  historicalMetadataMath,
  createNativeShortMetadataSnapshot,
  planNativeShortMetadataUpdate,
  planNativeShortMetadataUpdateV2,
  compareNativeShortMetadataReadback,
  compareNativeShortMetadataReadbackV2,
  compareNativeShortMetadataReadbackVersioned,
  type NativeShortBinding,
  type NativeShortMetadataSnapshot,
  type LegacyNativeShortMetadataSnapshot,
  type NativeShortMetadataRequest,
  type NativeShortMetadataExpectation,
  type NativeShortMetadataExpectationV2,
  type NativeShortMetadataWriteExpectation,
} from './short-native-metadata.js';
import {
  historicalTrialMath,
  createNativeShortTrialSnapshot,
  validateNativeShortTrialSnapshot,
  planNativeShortTrialUpdate,
  assertNativeShortTrialPreSave,
  compareNativeShortTrialReadback,
  type NativeShortTrialSnapshot,
  type LegacyNativeShortTrialSnapshot,
  type NativeShortTrialWriteRequest,
  type NativeShortTrialExpectation,
} from './short-native-trial.js';
import {
  historicalBodyMath,
  createNativeShortBodySnapshot,
  validateNativeShortBodySnapshot,
  planNativeShortBodyUpdate,
  assertNativeShortBodyPreSave,
  compareNativeShortBodyReadback,
  upgradeNativeShortBodyExpectationForGetV2,
  type NativeShortBodySnapshot,
  type LegacyNativeShortBodySnapshot,
  type NativeShortBodyWriteRequest,
  type NativeShortBodyPlan,
  type NativeShortBodyExpectation,
} from './short-native-body.js';
import {
  historicalCoverMath,
  createNativeShortCoverUploadIntent,
  assertNativeShortCoverPreSave,
  planNativeShortCoverSave,
  compareNativeShortCoverReadback,
  type NativeShortCoverUploadRequest,
  type NativeShortCoverUploadIntent,
  type NativeShortCoverExpectation,
} from './short-native-cover.js';
import { validateShortStatusFacts } from './short-status.js';
export type StoredMetadataSnapshot =
  | Readonly<{ mode: 'legacy'; snapshot: LegacyNativeShortMetadataSnapshot }>
  | Readonly<{ mode: 'modern'; snapshot: NativeShortMetadataSnapshot }>;
export type StoredTrialSnapshot =
  | Readonly<{ mode: 'legacy'; snapshot: LegacyNativeShortTrialSnapshot }>
  | Readonly<{ mode: 'modern'; snapshot: NativeShortTrialSnapshot }>;
export type StoredBodySnapshot =
  | Readonly<{ mode: 'legacy'; snapshot: LegacyNativeShortBodySnapshot }>
  | Readonly<{ mode: 'modern'; snapshot: NativeShortBodySnapshot }>;
function reject(): never {
  throw new Error('invalid_native_stored_snapshot');
}
function capture(input: unknown): unknown {
  let nodes = 0,
    characters = 0;
  const active = new Set<object>();
  function visit(value: unknown, depth: number): unknown {
    if (++nodes > 1_000_000 || depth > 96) reject();
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      characters += value.length;
      if (
        characters > 96 * 1024 * 1024 ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
      )
        reject();
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Object.is(value, -0)) reject();
      return value;
    }
    if (
      !value ||
      typeof value !== 'object' ||
      active.has(value) ||
      Object.getOwnPropertySymbols(value).length
    )
      reject();
    const array = Array.isArray(value),
      proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) reject();
    const ds = Object.getOwnPropertyDescriptors(value),
      keys = Object.keys(ds).filter((k) => !array || k !== 'length');
    if (keys.some((k) => !ds[k]!.enumerable || !Object.hasOwn(ds[k]!, 'value'))) reject();
    if (array && (ds.length?.value !== keys.length || keys.some((k, i) => k !== String(i))))
      reject();
    active.add(value);
    const out: Record<string, unknown> | unknown[] = array ? [] : Object.create(null);
    for (const k of keys) {
      const child = visit(ds[k]!.value, depth + 1);
      if (array) (out as unknown[]).push(child);
      else (out as Record<string, unknown>)[k] = child;
    }
    active.delete(value);
    return out;
  }
  return visit(input, 0);
}
function record(input: unknown): Record<string, unknown> {
  const value = capture(input);
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject();
  return value as Record<string, unknown>;
}
function exact(input: unknown, keys: readonly string[]): Record<string, unknown> {
  const value = record(input);
  if (Object.keys(value).length !== keys.length || keys.some((k) => !Object.hasOwn(value, k)))
    reject();
  return value;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
function same(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}
const metadataDeps = Object.freeze({ rebuildMetadata: historicalMetadataMath.createSnapshot });
const bodyDeps = Object.freeze({
  ...metadataDeps,
  rebuildTrial: (native: LegacyNativeShortMetadataSnapshot) =>
    historicalTrialMath.createSnapshot(native, metadataDeps),
});
const META_KEYS = [
  'scope',
  'hashBases',
  'binding',
  'editData',
  'categoryData',
  'responseBinding',
  'state',
  'catalog',
  'savedFields',
  'snapshotVersionHash',
  'catalogHash',
  'documentHash',
  'savedFieldsHash',
  'categorySelectionHash',
];
function decodeMetadata(input: unknown): StoredMetadataSnapshot {
  const value = record(input),
    modern = Object.hasOwn(value, 'statusFacts');
  exact(value, modern ? [...META_KEYS, 'statusFacts'] : META_KEYS);
  if (!modern)
    return Object.freeze({
      mode: 'legacy',
      snapshot: historicalMetadataMath.validateSnapshot(value),
    });
  validateShortStatusFacts(value.statusFacts);
  const snapshot = createNativeShortMetadataSnapshot({
    binding: value.binding as NativeShortBinding,
    editData: value.editData,
    categoryData: value.categoryData,
  });
  if (!same(value, snapshot)) reject();
  return Object.freeze({ mode: 'modern', snapshot });
}
function decodeTrial(input: unknown): StoredTrialSnapshot {
  const value = record(input),
    native = decodeMetadata(value.native);
  return native.mode === 'legacy'
    ? Object.freeze({
        mode: 'legacy',
        snapshot: historicalTrialMath.validateSnapshot(value, metadataDeps),
      })
    : Object.freeze({ mode: 'modern', snapshot: validateNativeShortTrialSnapshot(value) });
}
function decodeBody(input: unknown): StoredBodySnapshot {
  const value = record(input),
    native = decodeMetadata(value.native);
  return native.mode === 'legacy'
    ? Object.freeze({
        mode: 'legacy',
        snapshot: historicalBodyMath.validateSnapshot(value, bodyDeps),
      })
    : Object.freeze({ mode: 'modern', snapshot: validateNativeShortBodySnapshot(value) });
}
function decodedMetadata(input: StoredMetadataSnapshot): StoredMetadataSnapshot {
  const value = exact(input, ['mode', 'snapshot']),
    decoded = decodeMetadata(value.snapshot);
  if (decoded.mode !== value.mode) reject();
  return decoded;
}
function decodedTrial(input: StoredTrialSnapshot): StoredTrialSnapshot {
  const value = exact(input, ['mode', 'snapshot']),
    decoded = decodeTrial(value.snapshot);
  if (decoded.mode !== value.mode) reject();
  return decoded;
}
function decodedBody(input: StoredBodySnapshot): StoredBodySnapshot {
  const value = exact(input, ['mode', 'snapshot']),
    decoded = decodeBody(value.snapshot);
  if (decoded.mode !== value.mode) reject();
  return decoded;
}
/** Dispatch is an authenticated read-only shape decision, never a writer mode switch. */
export const storedMetadataMath = Object.freeze({
  decodeSnapshot: decodeMetadata,
  planUpdate(input: StoredMetadataSnapshot, request: NativeShortMetadataRequest) {
    const d = decodedMetadata(input);
    return d.mode === 'legacy'
      ? historicalMetadataMath.planUpdate(d.snapshot, request)
      : planNativeShortMetadataUpdate(d.snapshot, request);
  },
  planUpdateV2(input: StoredMetadataSnapshot, request: NativeShortMetadataRequest) {
    const d = decodedMetadata(input);
    return d.mode === 'legacy'
      ? historicalMetadataMath.planUpdateV2(d.snapshot, request)
      : planNativeShortMetadataUpdateV2(d.snapshot, request);
  },
  compareReadback(expected: NativeShortMetadataExpectation, input: StoredMetadataSnapshot) {
    const d = decodedMetadata(input);
    return d.mode === 'legacy'
      ? historicalMetadataMath.compareReadback(expected, d.snapshot)
      : compareNativeShortMetadataReadback(expected, d.snapshot);
  },
  compareReadbackV2(expected: NativeShortMetadataExpectationV2, input: StoredMetadataSnapshot) {
    const d = decodedMetadata(input);
    return d.mode === 'legacy'
      ? historicalMetadataMath.compareReadbackV2(expected, d.snapshot)
      : compareNativeShortMetadataReadbackV2(expected, d.snapshot);
  },
  compareReadbackVersioned(
    expected: NativeShortMetadataWriteExpectation,
    input: StoredMetadataSnapshot,
  ) {
    const d = decodedMetadata(input);
    return d.mode === 'legacy'
      ? historicalMetadataMath.compareReadbackVersioned(expected, d.snapshot)
      : compareNativeShortMetadataReadbackVersioned(expected, d.snapshot);
  },
});
export const storedTrialMath = Object.freeze({
  decodeSnapshot: decodeTrial,
  decodeNativeSnapshot(input: unknown): StoredTrialSnapshot {
    const d = decodeMetadata(input);
    return d.mode === 'legacy'
      ? Object.freeze({
          mode: 'legacy',
          snapshot: historicalTrialMath.createSnapshot(d.snapshot, metadataDeps),
        })
      : Object.freeze({ mode: 'modern', snapshot: createNativeShortTrialSnapshot(d.snapshot) });
  },
  planUpdate(input: StoredTrialSnapshot, request: NativeShortTrialWriteRequest) {
    const d = decodedTrial(input);
    return d.mode === 'legacy'
      ? historicalTrialMath.planUpdate(d.snapshot, request, metadataDeps)
      : planNativeShortTrialUpdate(d.snapshot, request);
  },
  assertPreSave(input: StoredTrialSnapshot, expected: NativeShortTrialExpectation) {
    const d = decodedTrial(input);
    return d.mode === 'legacy'
      ? historicalTrialMath.assertPreSave(d.snapshot, expected, metadataDeps)
      : assertNativeShortTrialPreSave(d.snapshot, expected);
  },
  compareReadback(expected: NativeShortTrialExpectation, input: StoredTrialSnapshot) {
    const d = decodedTrial(input);
    return d.mode === 'legacy'
      ? historicalTrialMath.compareReadback(expected, d.snapshot, metadataDeps)
      : compareNativeShortTrialReadback(expected, d.snapshot);
  },
});
export const storedBodyMath = Object.freeze({
  decodeSnapshot: decodeBody,
  decodeCompact(input: unknown): StoredBodySnapshot {
    const value = record(input),
      modern = Object.hasOwn(value, 'statusFacts');
    exact(
      value,
      modern
        ? ['binding', 'editData', 'categoryData', 'statusFacts']
        : ['binding', 'editData', 'categoryData'],
    );
    const raw = {
      binding: value.binding as NativeShortBinding,
      editData: value.editData,
      categoryData: value.categoryData,
    };
    if (!modern)
      return Object.freeze({
        mode: 'legacy',
        snapshot: historicalBodyMath.createSnapshot(
          historicalMetadataMath.createSnapshot(raw),
          bodyDeps,
        ),
      });
    const native = createNativeShortMetadataSnapshot(raw);
    validateShortStatusFacts(value.statusFacts);
    if (!same(value.statusFacts, native.statusFacts)) reject();
    return Object.freeze({ mode: 'modern', snapshot: createNativeShortBodySnapshot(native) });
  },
  planUpdate(input: StoredBodySnapshot, request: NativeShortBodyWriteRequest) {
    const d = decodedBody(input);
    return d.mode === 'legacy'
      ? historicalBodyMath.planUpdate(d.snapshot, request, bodyDeps)
      : planNativeShortBodyUpdate(d.snapshot, request);
  },
  assertPreSave(input: StoredBodySnapshot, plan: NativeShortBodyPlan) {
    const d = decodedBody(input);
    return d.mode === 'legacy'
      ? historicalBodyMath.assertPreSave(d.snapshot, plan, bodyDeps)
      : assertNativeShortBodyPreSave(d.snapshot, plan);
  },
  compareReadback(expected: NativeShortBodyExpectation, input: StoredBodySnapshot) {
    const d = decodedBody(input);
    return d.mode === 'legacy'
      ? historicalBodyMath.compareReadback(expected, d.snapshot, bodyDeps)
      : compareNativeShortBodyReadback(expected, d.snapshot);
  },
  upgradeExpectationForGetV2(input: StoredBodySnapshot, plan: NativeShortBodyPlan) {
    const d = decodedBody(input);
    return d.mode === 'legacy'
      ? historicalBodyMath.upgradeExpectationForGetV2(d.snapshot, plan, bodyDeps)
      : upgradeNativeShortBodyExpectationForGetV2(d.snapshot, plan);
  },
});
export const storedCoverMath = Object.freeze({
  decodeSnapshot: decodeMetadata,
  createUploadIntent(input: StoredMetadataSnapshot, request: NativeShortCoverUploadRequest) {
    const d = decodedMetadata(input);
    return d.mode === 'legacy'
      ? historicalCoverMath.createUploadIntent(d.snapshot, request, metadataDeps)
      : createNativeShortCoverUploadIntent(d.snapshot, request);
  },
  assertPreSave(input: StoredMetadataSnapshot, intent: NativeShortCoverUploadIntent) {
    const d = decodedMetadata(input);
    return d.mode === 'legacy'
      ? historicalCoverMath.assertPreSave(d.snapshot, intent, metadataDeps)
      : assertNativeShortCoverPreSave(d.snapshot, intent);
  },
  planSave(
    input: StoredMetadataSnapshot,
    intent: NativeShortCoverUploadIntent,
    ack: { readonly picUri: string; readonly picUrl: string },
  ) {
    const d = decodedMetadata(input);
    return d.mode === 'legacy'
      ? historicalCoverMath.planSave(d.snapshot, intent, ack, metadataDeps)
      : planNativeShortCoverSave(d.snapshot, intent, ack);
  },
  compareReadback(expected: NativeShortCoverExpectation, input: StoredMetadataSnapshot) {
    const d = decodedMetadata(input);
    return d.mode === 'legacy'
      ? historicalCoverMath.compareReadback(expected, d.snapshot, metadataDeps)
      : compareNativeShortCoverReadback(expected, d.snapshot);
  },
});
