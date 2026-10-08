import {
  type HistoricalMetadataDependencies,
  type NativeShortCoverUploadRequest,
  type NativeShortCoverUploadIntent,
  type NativeShortCoverUploadAcknowledgementInput,
  type NativeShortCoverPlan,
  type NativeShortCoverExpectation,
  type NativeShortCoverComparison,
} from './reject.js';

import { type LegacyNativeShortMetadataSnapshot } from '../short-native-metadata.js';

import { checkedSnapshotCore } from './binding.js';

import {
  createUploadIntentCore,
  preSave,
  planSaveCore,
  compareReadbackCore,
} from './create-upload-intent-core.js';

/** @internal Legacy math reconstructs exact old carriers without authorizing upload or save. */
export const historicalCoverMath = Object.freeze({
  validateSnapshot(
    input: unknown,
    deps: HistoricalMetadataDependencies,
  ): LegacyNativeShortMetadataSnapshot {
    return checkedSnapshotCore(input, deps.rebuildMetadata, false);
  },
  createUploadIntent(
    input: LegacyNativeShortMetadataSnapshot,
    request: NativeShortCoverUploadRequest,
    deps: HistoricalMetadataDependencies,
  ): NativeShortCoverUploadIntent {
    return createUploadIntentCore(checkedSnapshotCore(input, deps.rebuildMetadata, false), request);
  },
  assertPreSave(
    input: LegacyNativeShortMetadataSnapshot,
    intent: NativeShortCoverUploadIntent,
    deps: HistoricalMetadataDependencies,
  ): void {
    preSave(checkedSnapshotCore(input, deps.rebuildMetadata, false), intent);
  },
  planSave(
    input: LegacyNativeShortMetadataSnapshot,
    intent: NativeShortCoverUploadIntent,
    ack: NativeShortCoverUploadAcknowledgementInput,
    deps: HistoricalMetadataDependencies,
  ): NativeShortCoverPlan {
    return planSaveCore(
      checkedSnapshotCore(input, deps.rebuildMetadata, false),
      intent,
      ack,
      deps.rebuildMetadata,
    );
  },
  compareReadback(
    expected: NativeShortCoverExpectation,
    input: LegacyNativeShortMetadataSnapshot,
    deps: HistoricalMetadataDependencies,
  ): NativeShortCoverComparison {
    return compareReadbackCore(expected, checkedSnapshotCore(input, deps.rebuildMetadata, false));
  },
});
