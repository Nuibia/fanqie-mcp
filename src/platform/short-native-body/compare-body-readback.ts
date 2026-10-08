import {
  type BodyNativeSource,
  type NativeShortBodyExpectation,
  type BodySource,
  type BodyMathDependencies,
  type NativeShortBodyComparison,
  type NativeShortBodyReason,
  NATIVE_SHORT_BODY_SCOPE,
  nativeShortBodyHashBasesForRequest,
  type NativeShortBodyPlan,
  type HistoricalBodyDependencies,
  type NativeShortBodySnapshot,
  type NativeShortBodyWriteRequest,
  type LegacyNativeShortBodySnapshot,
} from './native-short-body-hash-bases-for-request.js';

import {
  checkedExpectation,
  validateNativeShortBodyPlan,
  assertBodyPreSave,
} from './checked-expectation.js';

import {
  validateBodySnapshot,
  snapshotRevision,
  planBodyUpdate,
  createBodySnapshot,
} from './create-body-snapshot.js';

import {
  type NativeShortServerRevision,
  NATIVE_SHORT_SERVER_REVISION_POLICY_V2,
  type NativeShortMetadataSnapshot,
  createNativeShortMetadataSnapshot,
  type NativeShortBinding,
  type LegacyNativeShortMetadataSnapshot,
} from '../short-native-metadata.js';

import {
  NativeShortBodyError,
  canonical,
  freeze,
  dataObject,
  sameDerived,
  reject,
} from './reject.js';

import {
  NATIVE_SHORT_BODY_WORD_NUMBER_BASIS_V2,
  NATIVE_SHORT_BODY_COMPARISON_POLICY_V2,
  nativeShortBodyWordNumberExpectationV2,
  nativeShortBodyObservedWordNumberV2,
  type NativeShortBodyWordNumberExpectationV2,
} from '../short-native-body-word-number.js';

import { preservationHash, observedWordNumber } from './binding.js';

import { createNativeShortTrialSnapshot } from '../short-native-trial.js';

function compareBodyReadback<N extends BodyNativeSource>(
  input: NativeShortBodyExpectation,
  inputSnapshot: BodySource<N>,
  deps: BodyMathDependencies<N>,
): NativeShortBodyComparison {
  const expected = checkedExpectation(input),
    after = validateBodySnapshot(inputSnapshot, deps);
  let serverRevisionAfter: NativeShortServerRevision | null = null;
  try {
    serverRevisionAfter = snapshotRevision(after, false);
  } catch (error) {
    if (!(error instanceof NativeShortBodyError) || error.code !== 'server_revision_shape')
      throw error;
  }
  const revisionMatches =
    serverRevisionAfter !== null &&
    serverRevisionAfter.latestVersion === expected.serverRevisionBefore.latestVersion + 1 &&
    BigInt(serverRevisionAfter.modifyTime) >= BigInt(expected.serverRevisionBefore.modifyTime);
  const v2 = expected.writeRequest.comparisonPolicy !== undefined;
  let actualWordNumber: number | null = null;
  if (v2) {
    try {
      actualWordNumber = deps.observedWordNumber(after.native);
    } catch {}
  }
  const countMatches =
    !v2 || (actualWordNumber !== null && actualWordNumber === expected.derivedWordNumber!.desired);
  const actual = {
    ...(v2
      ? {
          derivedWordNumber: {
            policy: NATIVE_SHORT_BODY_WORD_NUMBER_BASIS_V2,
            expected: expected.derivedWordNumber!.desired,
            actual: actualWordNumber,
          },
        }
      : {}),
    snapshotVersionHash: after.snapshotVersionHash,
    catalogHash: after.catalogHash,
    documentHash: after.documentHash,
    savedFieldsHash: after.savedFieldsHash,
    categorySelectionHash: after.categorySelectionHash,
    preservationHash: preservationHash(
      after.native,
      deps.observedWordNumber,
      revisionMatches && countMatches,
      expected.writeRequest.comparisonPolicy,
    ),
    coversHash: after.coversHash,
    bodyHash: after.bodyHash,
    paragraphsHash: after.paragraphsHash,
    markerHash: after.markerHash,
    observedWireVectorHash: after.observedWireVectorHash,
    serverRevisionPolicy: NATIVE_SHORT_SERVER_REVISION_POLICY_V2,
    serverRevisionBefore: expected.serverRevisionBefore,
    serverRevisionAfter,
  };
  const reason: NativeShortBodyReason =
    canonical(expected.binding) !== canonical(after.binding)
      ? 'binding_changed'
      : !deps.editable(after.native)
        ? 'state_not_draft'
        : !revisionMatches
          ? 'server_revision_not_proven'
          : !countMatches
            ? 'derived_word_number_not_proven'
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
                            : expected.markerHash !== actual.markerHash
                              ? 'marker_changed'
                              : expected.effectiveWireVectorHash !== actual.observedWireVectorHash
                                ? 'wire_vector_changed'
                                : 'match';
  return freeze({
    matches: reason === 'match',
    reason,
    scope: NATIVE_SHORT_BODY_SCOPE,
    hashBases: nativeShortBodyHashBasesForRequest(expected.writeRequest),
    actual,
  });
}

function upgradeBodyExpectationForGetV2<N extends BodyNativeSource>(
  beforeInput: BodySource<N>,
  planInput: NativeShortBodyPlan,
  deps: BodyMathDependencies<N>,
): NativeShortBodyExpectation {
  const before = validateBodySnapshot(beforeInput, deps),
    plan = validateNativeShortBodyPlan(planInput);
  assertBodyPreSave(before, plan, deps);
  return planBodyUpdate(
    before,
    { ...plan.expectation.writeRequest, comparisonPolicy: NATIVE_SHORT_BODY_COMPARISON_POLICY_V2 },
    deps,
  ).expectation;
}

export const modernBodyMathDependencies: BodyMathDependencies<NativeShortMetadataSnapshot> =
  Object.freeze({
    rebuildMetadata: createNativeShortMetadataSnapshot,
    rebuildTrial: createNativeShortTrialSnapshot,
    rebuildMetadataFromSnapshot: (input: unknown) => {
      const value = dataObject(input, [
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
        'statusFacts',
      ]);
      const rebuilt = createNativeShortMetadataSnapshot({
        binding: value.binding as NativeShortBinding,
        editData: value.editData,
        categoryData: value.categoryData,
      });
      sameDerived(input, rebuilt, 'snapshot_source_invalid');
      return rebuilt;
    },
    observedWordNumber,
    wordNumberExpectation: nativeShortBodyWordNumberExpectationV2,
    editable: (native: NativeShortMetadataSnapshot) =>
      native.state === 'draft' && native.statusFacts.draftEditable,
  });

/** Protected word-number helpers consume only raw content/count. These two history-only
 * structural adaptations confer no modern snapshot or execution authority. */
function historicalObservedWordNumber(native: LegacyNativeShortMetadataSnapshot): number {
  try {
    return nativeShortBodyObservedWordNumberV2(native as NativeShortMetadataSnapshot);
  } catch {
    reject('derived_word_number_invalid');
  }
}

function historicalWordNumberExpectation(
  native: LegacyNativeShortMetadataSnapshot,
  html: string,
): NativeShortBodyWordNumberExpectationV2 {
  return nativeShortBodyWordNumberExpectationV2(native as NativeShortMetadataSnapshot, html);
}

function historicalBodyDependencies(
  deps: HistoricalBodyDependencies,
): BodyMathDependencies<LegacyNativeShortMetadataSnapshot> {
  return Object.freeze({
    ...deps,
    rebuildMetadataFromSnapshot: (input: unknown) => {
      const value = dataObject(input, [
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
      ]);
      const rebuilt = deps.rebuildMetadata({
        binding: value.binding as NativeShortBinding,
        editData: value.editData,
        categoryData: value.categoryData,
      });
      sameDerived(input, rebuilt, 'snapshot_source_invalid');
      return rebuilt;
    },
    observedWordNumber: historicalObservedWordNumber,
    wordNumberExpectation: historicalWordNumberExpectation,
    editable: (native: LegacyNativeShortMetadataSnapshot) => native.state === 'draft',
  });
}

export function planNativeShortBodyUpdate(
  input: NativeShortBodySnapshot,
  request: NativeShortBodyWriteRequest,
): NativeShortBodyPlan {
  return planBodyUpdate(input, request, modernBodyMathDependencies);
}

export function assertNativeShortBodyPreSave(
  input: NativeShortBodySnapshot,
  plan: NativeShortBodyPlan,
): void {
  assertBodyPreSave(input, plan, modernBodyMathDependencies);
}

export function compareNativeShortBodyReadback(
  expected: NativeShortBodyExpectation,
  snapshot: NativeShortBodySnapshot,
): NativeShortBodyComparison {
  return compareBodyReadback(expected, snapshot, modernBodyMathDependencies);
}

/** Explicit GET-only adapter; original v1 plan/expectation hashes and stages are never replaced. */
export function upgradeNativeShortBodyExpectationForGetV2(
  before: NativeShortBodySnapshot,
  plan: NativeShortBodyPlan,
): NativeShortBodyExpectation {
  return upgradeBodyExpectationForGetV2(before, plan, modernBodyMathDependencies);
}

/** @internal Only the stored codec supplies the fixed pure historical dependencies. */
export const historicalBodyMath = Object.freeze({
  createSnapshot: (
    native: LegacyNativeShortMetadataSnapshot,
    deps: HistoricalBodyDependencies,
  ): LegacyNativeShortBodySnapshot => createBodySnapshot(native, historicalBodyDependencies(deps)),
  validateSnapshot: (
    input: unknown,
    deps: HistoricalBodyDependencies,
  ): LegacyNativeShortBodySnapshot => validateBodySnapshot(input, historicalBodyDependencies(deps)),
  planUpdate: (
    snapshot: LegacyNativeShortBodySnapshot,
    request: NativeShortBodyWriteRequest,
    deps: HistoricalBodyDependencies,
  ): NativeShortBodyPlan => planBodyUpdate(snapshot, request, historicalBodyDependencies(deps)),
  assertPreSave: (
    snapshot: LegacyNativeShortBodySnapshot,
    plan: NativeShortBodyPlan,
    deps: HistoricalBodyDependencies,
  ): void => assertBodyPreSave(snapshot, plan, historicalBodyDependencies(deps)),
  compareReadback: (
    expected: NativeShortBodyExpectation,
    snapshot: LegacyNativeShortBodySnapshot,
    deps: HistoricalBodyDependencies,
  ): NativeShortBodyComparison =>
    compareBodyReadback(expected, snapshot, historicalBodyDependencies(deps)),
  upgradeExpectationForGetV2: (
    snapshot: LegacyNativeShortBodySnapshot,
    plan: NativeShortBodyPlan,
    deps: HistoricalBodyDependencies,
  ): NativeShortBodyExpectation =>
    upgradeBodyExpectationForGetV2(snapshot, plan, historicalBodyDependencies(deps)),
});
