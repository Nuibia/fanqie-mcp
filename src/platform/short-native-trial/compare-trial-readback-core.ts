import {
  type NativeShortTrialExpectation,
  type StoredTrial,
  type NativeShortTrialComparison,
  NativeShortTrialError,
  hash,
  canonical,
  freeze,
  NATIVE_SHORT_TRIAL_SCOPE,
  NATIVE_SHORT_TRIAL_HASH_BASES,
  type HistoricalMetadataDependencies,
  reject,
  type LegacyNativeShortTrialSnapshot,
  type NativeShortTrialWriteRequest,
  type NativeShortTrialPlan,
} from './reject.js';

import {
  checkedExpectation,
  snapshotRevision,
  preservation,
  createTrialSnapshotCore,
  planTrialUpdateCore,
  assertTrialPreSaveCore,
} from './create-trial-snapshot-core.js';

import {
  type NativeShortServerRevision,
  NATIVE_SHORT_SERVER_REVISION_POLICY_V2,
  type LegacyNativeShortMetadataSnapshot,
  type NativeShortBinding,
} from '../short-native-metadata.js';

import {
  nativeDerived,
  LEGACY_NATIVE_SNAPSHOT_FIELDS,
  derivedEqual,
  trialDerived,
} from './derived-object.js';

export function compareTrialReadbackCore(
  input: NativeShortTrialExpectation,
  after: StoredTrial,
): NativeShortTrialComparison {
  const expected = checkedExpectation(input);
  let serverRevisionAfter: NativeShortServerRevision | null = null;
  try {
    serverRevisionAfter = snapshotRevision(after, false);
  } catch (error) {
    if (!(error instanceof NativeShortTrialError)) throw error;
  }
  const revisionMatches =
    serverRevisionAfter !== null &&
    serverRevisionAfter.latestVersion === expected.serverRevisionBefore.latestVersion + 1 &&
    BigInt(serverRevisionAfter.modifyTime) >= BigInt(expected.serverRevisionBefore.modifyTime);
  const actual = {
    snapshotVersionHash: after.snapshotVersionHash,
    catalogHash: after.catalogHash,
    documentHash: after.documentHash,
    savedFieldsHash: after.savedFieldsHash,
    categorySelectionHash: after.categorySelectionHash,
    preservationHash: revisionMatches
      ? preservation(after)
      : hash({
          basis: 'unmasked-invalid-server-revision/v1',
          binding: after.binding,
          editData: after.native.editData,
          categoryData: after.native.categoryData,
        }),
    coversHash: after.coversHash,
    bodyHash: after.bodyHash,
    paragraphsHash: after.paragraphsHash,
    trialDocumentHash: after.trialDocumentHash,
    serverRevisionPolicy: NATIVE_SHORT_SERVER_REVISION_POLICY_V2,
    serverRevisionBefore: expected.serverRevisionBefore,
    serverRevisionAfter,
  };
  const reason: NativeShortTrialComparison['reason'] =
    canonical(expected.binding) !== canonical(after.binding)
      ? 'binding_changed'
      : after.native.state !== 'draft'
        ? 'state_not_draft'
        : !revisionMatches
          ? 'server_revision_not_proven'
          : expected.catalogHash !== actual.catalogHash
            ? 'catalog_changed'
            : expected.expectedDocumentHash !== actual.documentHash ||
                expected.desiredHtml !== after.document.rawHtml
              ? 'document_changed'
              : expected.expectedSavedFieldsHash !== actual.savedFieldsHash
                ? 'saved_fields_changed'
                : expected.categorySelectionHash !== actual.categorySelectionHash
                  ? 'category_selection_changed'
                  : expected.preservationHash !== actual.preservationHash
                    ? 'preservation_not_proven'
                    : expected.coversHash !== actual.coversHash
                      ? 'covers_changed'
                      : expected.bodyHash !== actual.bodyHash
                        ? 'body_changed'
                        : expected.paragraphsHash !== actual.paragraphsHash
                          ? 'paragraphs_changed'
                          : expected.trialDocumentHash !== actual.trialDocumentHash
                            ? 'trial_changed'
                            : 'match';
  return freeze({
    matches: reason === 'match',
    reason,
    scope: NATIVE_SHORT_TRIAL_SCOPE,
    hashBases: NATIVE_SHORT_TRIAL_HASH_BASES,
    actual,
  });
}

function checkedHistoricalNative(
  input: unknown,
  deps: HistoricalMetadataDependencies,
): LegacyNativeShortMetadataSnapshot {
  const value = nativeDerived(input, LEGACY_NATIVE_SNAPSHOT_FIELDS);
  const rebuilt = deps.rebuildMetadata({
    binding: value.binding as NativeShortBinding,
    editData: value.editData,
    categoryData: value.categoryData,
  });
  if (!derivedEqual(input, rebuilt)) reject('snapshot_hash_mismatch');
  return rebuilt;
}

function checkedHistoricalTrial(
  input: unknown,
  deps: HistoricalMetadataDependencies,
): LegacyNativeShortTrialSnapshot {
  const value = trialDerived(input, LEGACY_NATIVE_SNAPSHOT_FIELDS),
    rebuilt = createTrialSnapshotCore(checkedHistoricalNative(value.native, deps));
  if (!derivedEqual(input, rebuilt)) reject('trial_snapshot_hash_mismatch');
  return rebuilt;
}

/** @internal Pure legacy mathematics; never imported by API, runtime or Store. */
export const historicalTrialMath = Object.freeze({
  createSnapshot(
    input: LegacyNativeShortMetadataSnapshot,
    deps: HistoricalMetadataDependencies,
  ): LegacyNativeShortTrialSnapshot {
    return createTrialSnapshotCore(checkedHistoricalNative(input, deps));
  },
  validateSnapshot(
    input: unknown,
    deps: HistoricalMetadataDependencies,
  ): LegacyNativeShortTrialSnapshot {
    return checkedHistoricalTrial(input, deps);
  },
  planUpdate(
    input: LegacyNativeShortTrialSnapshot,
    request: NativeShortTrialWriteRequest,
    deps: HistoricalMetadataDependencies,
  ): NativeShortTrialPlan {
    return planTrialUpdateCore(checkedHistoricalTrial(input, deps), request, deps.rebuildMetadata);
  },
  assertPreSave(
    input: LegacyNativeShortTrialSnapshot,
    expected: NativeShortTrialExpectation,
    deps: HistoricalMetadataDependencies,
  ): void {
    assertTrialPreSaveCore(checkedHistoricalTrial(input, deps), expected, deps.rebuildMetadata);
  },
  compareReadback(
    expected: NativeShortTrialExpectation,
    input: LegacyNativeShortTrialSnapshot,
    deps: HistoricalMetadataDependencies,
  ): NativeShortTrialComparison {
    return compareTrialReadbackCore(expected, checkedHistoricalTrial(input, deps));
  },
});
