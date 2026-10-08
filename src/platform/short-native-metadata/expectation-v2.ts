import {
  type NativeShortMetadataExpectationV2,
  record,
  jsonCopy,
  keys,
  NATIVE_SHORT_METADATA_SCOPE,
  canonical,
  NATIVE_SHORT_WRITE_HASH_BASES_V2,
  NATIVE_SHORT_SERVER_REVISION_POLICY_V2,
  reject,
  type MathSnapshot,
  type SnapshotChecker,
  type NativeShortMetadataComparisonV2,
  type NativeShortServerRevision,
  NativeShortMetadataError,
  freeze,
  type NativeShortMetadataWriteExpectation,
  type NativeShortMetadataWriteComparison,
  has,
  type NativeShortMetadataExpectation,
  NATIVE_SHORT_HASH_BASES,
  type NativeShortMetadataSnapshot,
  type NativeShortMetadataRequest,
  type NativeShortMetadataPlan,
  type NativeShortMetadataPlanV2,
  type NativeShortMetadataComparison,
  type LegacyNativeShortMetadataSnapshot,
} from './reject.js';

import {
  bind,
  preservationHash,
  hash,
  checkedSnapshot,
  createHistoricalSnapshotCore,
  checkedHistoricalSnapshot,
} from './hash.js';

import {
  serverRevision,
  snapshotRevision,
  preservationHashV2,
  compareReadbackCore,
  planUpdateCore,
  planUpdateV2Core,
} from './plan-update-core.js';

function expectationV2(input: NativeShortMetadataExpectationV2): NativeShortMetadataExpectationV2 {
  const value = record(jsonCopy(input), 'expectation_shape');
  const names = [
    'version',
    'scope',
    'hashBases',
    'binding',
    'expectedState',
    'requested',
    'sourceVersionHash',
    'catalogHash',
    'documentHash',
    'savedFieldsHash',
    'preservationHash',
    'categorySelectionHash',
    'serverRevisionPolicy',
    'serverRevisionBefore',
  ];
  keys(value, names, 'expectation_shape');
  if (
    Object.keys(value).length !== names.length ||
    value.version !== 2 ||
    value.scope !== NATIVE_SHORT_METADATA_SCOPE ||
    canonical(value.hashBases) !== canonical(NATIVE_SHORT_WRITE_HASH_BASES_V2) ||
    value.expectedState !== 'draft' ||
    value.serverRevisionPolicy !== NATIVE_SHORT_SERVER_REVISION_POLICY_V2
  )
    reject('expectation_scope');
  bind(value.binding!);
  const requested = record(value.requested!, 'expectation_shape');
  keys(requested, ['title', 'categories'], 'expectation_shape');
  if (
    Object.keys(requested).length !== 2 ||
    typeof requested.title !== 'boolean' ||
    typeof requested.categories !== 'boolean' ||
    (!requested.title && !requested.categories)
  )
    reject('expectation_shape');
  for (const name of [
    'sourceVersionHash',
    'catalogHash',
    'documentHash',
    'savedFieldsHash',
    'preservationHash',
    'categorySelectionHash',
  ])
    if (typeof value[name] !== 'string' || !/^[a-f0-9]{64}$/.test(value[name] as string))
      reject('expectation_hash');
  serverRevision(record(value.serverRevisionBefore!, 'server_revision_shape'), true);
  return value as unknown as NativeShortMetadataExpectationV2;
}

/** Server deltas are checked independently of every hash and can never authorize another write. */
function compareReadbackV2Core(
  input: NativeShortMetadataExpectationV2,
  snapshot: MathSnapshot,
  check: SnapshotChecker,
): NativeShortMetadataComparisonV2 {
  const expected = expectationV2(input),
    after = check(snapshot);
  let revision: NativeShortServerRevision | null = null;
  try {
    revision = snapshotRevision(after, false);
  } catch (error) {
    if (!(error instanceof NativeShortMetadataError)) throw error;
  }
  const revisionMatches =
    revision !== null &&
    revision.latestVersion === expected.serverRevisionBefore.latestVersion + 1 &&
    BigInt(revision.modifyTime) >= BigInt(expected.serverRevisionBefore.modifyTime);
  const actual = {
    snapshotVersionHash: after.snapshotVersionHash,
    catalogHash: after.catalogHash,
    documentHash: after.documentHash,
    savedFieldsHash: after.savedFieldsHash,
    // Illegal server values are never masked even for a nonmatching comparison.
    preservationHash: revisionMatches
      ? preservationHashV2(after, expected.requested)
      : preservationHash(after, expected.requested),
    categorySelectionHash: after.categorySelectionHash,
    serverRevisionPolicy: NATIVE_SHORT_SERVER_REVISION_POLICY_V2,
    serverRevisionBefore: expected.serverRevisionBefore,
    serverRevisionAfter: revision,
  };
  const reason: NativeShortMetadataComparisonV2['reason'] =
    canonical(expected.binding) !== canonical(after.binding)
      ? 'binding_changed'
      : after.state !== 'draft'
        ? 'state_not_draft'
        : !revisionMatches
          ? 'server_revision_not_proven'
          : expected.catalogHash !== actual.catalogHash
            ? 'catalog_changed'
            : expected.documentHash !== actual.documentHash
              ? 'document_changed'
              : expected.savedFieldsHash !== actual.savedFieldsHash
                ? 'saved_fields_changed'
                : expected.categorySelectionHash !== actual.categorySelectionHash
                  ? 'category_selection_changed'
                  : expected.preservationHash !== actual.preservationHash
                    ? 'preservation_not_proven'
                    : 'match';
  return freeze({
    version: 2,
    matches: reason === 'match',
    reason,
    scope: NATIVE_SHORT_METADATA_SCOPE,
    hashBases: NATIVE_SHORT_WRITE_HASH_BASES_V2,
    actual,
  });
}

/** Persisted carrier validators must establish version coherence before this narrow dispatch. */
function compareReadbackVersionedCore(
  expected: NativeShortMetadataWriteExpectation,
  snapshot: MathSnapshot,
  check: SnapshotChecker,
): NativeShortMetadataWriteComparison {
  const value = record(jsonCopy(expected), 'expectation_shape');
  if (has(value, 'version')) {
    if (value.version !== 2) reject('expectation_scope');
    return compareReadbackV2Core(
      value as unknown as NativeShortMetadataExpectationV2,
      snapshot,
      check,
    );
  }
  return compareReadbackCore(value as unknown as NativeShortMetadataExpectation, snapshot, check);
}

/** Shared API/proof preimage. Legacy v1 field names and canonical bytes remain identical. */
export function nativeShortMetadataDesiredContentHash(
  expectation: NativeShortMetadataWriteExpectation,
): string {
  const value = record(jsonCopy(expectation), 'expectation_shape'),
    v2 = has(value, 'version');
  if (
    (v2 && value.version !== 2) ||
    canonical(value.hashBases) !==
      canonical(v2 ? NATIVE_SHORT_WRITE_HASH_BASES_V2 : NATIVE_SHORT_HASH_BASES)
  )
    reject('expectation_scope');
  const expected = value as unknown as NativeShortMetadataWriteExpectation;
  const composite = {
    basis: v2
      ? 'native-short-metadata-desired-and-preservation/v2'
      : 'native-short-metadata-desired-and-preservation/v1',
    scope: expected.scope,
    hashBases: expected.hashBases,
    binding: expected.binding,
    expectedState: expected.expectedState,
    requested: expected.requested,
    catalogHash: expected.catalogHash,
    documentHash: expected.documentHash,
    savedFieldsHash: expected.savedFieldsHash,
    categorySelectionHash: expected.categorySelectionHash,
    preservationHash: expected.preservationHash,
  };
  if (!v2) return hash(jsonCopy(composite));
  if (value.serverRevisionPolicy !== NATIVE_SHORT_SERVER_REVISION_POLICY_V2)
    reject('expectation_scope');
  const before = serverRevision(record(value.serverRevisionBefore!, 'server_revision_shape'), true);
  return hash(
    jsonCopy({
      ...composite,
      version: 2,
      serverRevisionPolicy: NATIVE_SHORT_SERVER_REVISION_POLICY_V2,
      serverRevisionBefore: before,
    }),
  );
}

/** Default pure surfaces require the modern persistent marker before any plan can be used. */
export function planNativeShortMetadataUpdate(
  snapshot: NativeShortMetadataSnapshot,
  input: NativeShortMetadataRequest,
): NativeShortMetadataPlan {
  return planUpdateCore(snapshot, input, checkedSnapshot);
}

export function planNativeShortMetadataUpdateV2(
  snapshot: NativeShortMetadataSnapshot,
  input: NativeShortMetadataRequest,
): NativeShortMetadataPlanV2 {
  return planUpdateV2Core(snapshot, input, checkedSnapshot);
}

export function compareNativeShortMetadataReadback(
  expected: NativeShortMetadataExpectation,
  snapshot: NativeShortMetadataSnapshot,
): NativeShortMetadataComparison {
  return compareReadbackCore(expected, snapshot, checkedSnapshot);
}

export function compareNativeShortMetadataReadbackV2(
  expected: NativeShortMetadataExpectationV2,
  snapshot: NativeShortMetadataSnapshot,
): NativeShortMetadataComparisonV2 {
  return compareReadbackV2Core(expected, snapshot, checkedSnapshot);
}

export function compareNativeShortMetadataReadbackVersioned(
  expected: NativeShortMetadataWriteExpectation,
  snapshot: NativeShortMetadataSnapshot,
): NativeShortMetadataWriteComparison {
  return compareReadbackVersionedCore(expected, snapshot, checkedSnapshot);
}

/** @internal Only short-native-legacy-codec may consume this fixed, pure historical reconstruction. */
export const historicalMetadataMath = Object.freeze({
  createSnapshot: createHistoricalSnapshotCore,
  validateSnapshot: checkedHistoricalSnapshot,
  planUpdate: (snapshot: LegacyNativeShortMetadataSnapshot, request: NativeShortMetadataRequest) =>
    planUpdateCore(snapshot, request, checkedHistoricalSnapshot),
  planUpdateV2: (
    snapshot: LegacyNativeShortMetadataSnapshot,
    request: NativeShortMetadataRequest,
  ) => planUpdateV2Core(snapshot, request, checkedHistoricalSnapshot),
  compareReadback: (
    expected: NativeShortMetadataExpectation,
    snapshot: LegacyNativeShortMetadataSnapshot,
  ) => compareReadbackCore(expected, snapshot, checkedHistoricalSnapshot),
  compareReadbackV2: (
    expected: NativeShortMetadataExpectationV2,
    snapshot: LegacyNativeShortMetadataSnapshot,
  ) => compareReadbackV2Core(expected, snapshot, checkedHistoricalSnapshot),
  compareReadbackVersioned: (
    expected: NativeShortMetadataWriteExpectation,
    snapshot: LegacyNativeShortMetadataSnapshot,
  ) => compareReadbackVersionedCore(expected, snapshot, checkedHistoricalSnapshot),
});
