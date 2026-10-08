import {
  type NativeShortMetadataWriteReason,
  type NativeShortMetadataApiWriteResultV2,
  writeReadPhase,
} from './native-short-metadata-fixed-read-url.js';

import {
  unavailableNativeShortMetadataApi,
  freeze,
} from './unavailable-native-short-metadata-api.js';

import {
  type NativeShortMetadataRequest,
  NATIVE_SHORT_HASH_BASES,
  NATIVE_SHORT_RESOURCE_LIMITS,
  type NativeShortMetadataExpectationV2,
  type NativeShortMetadataSnapshot,
  type NativeShortMetadataComparisonV2,
  nativeShortMetadataDesiredContentHash,
} from '../short-native-metadata.js';

export function unavailableNativeShortMetadataWriteApi(
  reason: NativeShortMetadataWriteReason,
): NativeShortMetadataApiWriteResultV2 {
  return {
    schema: 'native-short-metadata-api-write/v2',
    status: 'capability_unavailable',
    reason,
    held: null,
    receipt: null,
    snapshot: null,
    comparison: null,
    desiredContentHash: null,
    observedContentHash: null,
    phases: { before: writeReadPhase(), after: writeReadPhase() },
    post: {
      attempts: 0,
      disposed: 0,
      markedAt: null,
      startedAt: null,
      acknowledgedAt: null,
      acknowledged: false,
    },
    proof: {
      platformStarted: false,
      writeMarked: false,
      ownerCallback: false,
      atomicRevision: false,
      proofCapturedAt: null,
    },
    cleanup: unavailableNativeShortMetadataApi('response_unavailable').cleanup,
  };
}

export function dataFields(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    throw Error('Invalid native write data');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    Object.getOwnPropertySymbols(input).length ||
    Object.keys(descriptors).some(
      (key) =>
        !allowed.includes(key) ||
        !Object.hasOwn(descriptors[key]!, 'value') ||
        !descriptors[key]!.enumerable,
    )
  )
    throw Error('Invalid native write data');
  return Object.fromEntries(
    Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
  );
}

/** Capture the narrow business value before waiting for FIFO; never invoke getters/toJSON. */
export function captureNativeShortMetadataWriteRequest(
  input: unknown,
): NativeShortMetadataRequest | null {
  try {
    const value = dataFields(input, [
      'expectedSnapshotVersionHash',
      'hashBasis',
      'expectedState',
      'title',
      'metadata',
    ]);
    if (
      typeof value.expectedSnapshotVersionHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.expectedSnapshotVersionHash) ||
      value.hashBasis !== NATIVE_SHORT_HASH_BASES.snapshot ||
      value.expectedState !== 'draft'
    )
      return null;
    const captured: {
      expectedSnapshotVersionHash: string;
      hashBasis: typeof NATIVE_SHORT_HASH_BASES.snapshot;
      expectedState: 'draft';
      title?: string;
      metadata?: { categories?: string[] };
    } = {
      expectedSnapshotVersionHash: value.expectedSnapshotVersionHash,
      hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
      expectedState: 'draft',
    };
    if (Object.hasOwn(value, 'title')) {
      if (
        typeof value.title !== 'string' ||
        !value.title.trim() ||
        /[\r\n\u0000]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
          value.title,
        ) ||
        Buffer.byteLength(value.title) > NATIVE_SHORT_RESOURCE_LIMITS.newTitleUtf8Bytes
      )
        return null;
      captured.title = value.title;
    }
    if (Object.hasOwn(value, 'metadata')) {
      const metadata = dataFields(value.metadata, ['categories']);
      captured.metadata = {};
      if (Object.hasOwn(metadata, 'categories')) {
        if (
          !Array.isArray(metadata.categories) ||
          Object.getPrototypeOf(metadata.categories) !== Array.prototype ||
          !metadata.categories.length ||
          metadata.categories.length > NATIVE_SHORT_RESOURCE_LIMITS.categoryCount ||
          Object.getOwnPropertySymbols(metadata.categories).length
        )
          return null;
        const descriptors = Object.getOwnPropertyDescriptors(metadata.categories),
          names = Object.keys(descriptors).filter((key) => key !== 'length');
        if (
          names.length !== metadata.categories.length ||
          names.some(
            (key, index) =>
              key !== String(index) ||
              !Object.hasOwn(descriptors[key]!, 'value') ||
              !descriptors[key]!.enumerable,
          )
        )
          return null;
        const categories = names.map((key) => descriptors[key]!.value as unknown);
        if (
          categories.some(
            (category) =>
              typeof category !== 'string' ||
              !category ||
              /[,\r\n\u0000]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
                category,
              ),
          ) ||
          new Set(categories).size !== categories.length
        )
          return null;
        captured.metadata.categories = categories as string[];
      }
    }
    if (
      (!Object.hasOwn(captured, 'title') && !captured.metadata?.categories) ||
      Buffer.byteLength(JSON.stringify(captured)) > NATIVE_SHORT_RESOURCE_LIMITS.responseJsonBytes
    )
      return null;
    return freeze(captured);
  } catch {
    return null;
  }
}

export function writeComposite(
  expected: NativeShortMetadataExpectationV2,
  snapshot?: NativeShortMetadataSnapshot,
  comparison?: NativeShortMetadataComparisonV2,
): string {
  const actual = comparison?.actual ?? expected;
  return nativeShortMetadataDesiredContentHash({
    ...expected,
    binding: snapshot?.binding ?? expected.binding,
    expectedState: (snapshot?.state ?? expected.expectedState) as 'draft',
    catalogHash: actual.catalogHash,
    documentHash: actual.documentHash,
    savedFieldsHash: actual.savedFieldsHash,
    categorySelectionHash: actual.categorySelectionHash,
    preservationHash: actual.preservationHash,
  });
}

export function writeTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))
    return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}
