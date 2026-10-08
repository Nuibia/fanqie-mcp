import {
  type ShortMetadataApiResult,
  object,
  SHORT_METADATA_API_REASONS,
  type ShortMetadataApiReason,
  unavailableShortMetadataApi,
} from './short-metadata-api-list-url.js';

import { type SchemaType, SHORT_METADATA_FIELDS } from '../short-metadata-schema.js';

/** Entire response projection: no outside keys or unknown enum labels survive. */
export function safeShortMetadataApiResult(value: unknown): ShortMetadataApiResult {
  const raw = object(value),
    proof = object(raw?.proof),
    own = object(raw?.own),
    list = object(raw?.list),
    transport = object(raw?.transport),
    cleanup = object(raw?.cleanup);
  const invalid = (): never => {
    throw new Error('Invalid safe API metadata result');
  };
  const bool = (x: unknown): boolean => (typeof x === 'boolean' ? x : invalid());
  const count = (x: unknown): number =>
    typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 100 ? x : invalid();
  const time = (x: unknown): string | null =>
    x === null
      ? null
      : typeof x === 'string' && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x
        ? x
        : invalid();
  const type = (x: unknown): SchemaType =>
    ['absent', 'null', 'string', 'number', 'boolean', 'array', 'object'].includes(x as string)
      ? (x as SchemaType)
      : invalid();
  if (
    !raw ||
    raw.schema !== 'short-metadata-api-schema/v1' ||
    !['success', 'capability_unavailable'].includes(raw.status as string) ||
    (raw.reason !== null &&
      !SHORT_METADATA_API_REASONS.includes(raw.reason as ShortMetadataApiReason)) ||
    !proof ||
    !own ||
    !list ||
    !transport ||
    !cleanup ||
    proof.atomicRevision !== false
  )
    invalid();
  const result = unavailableShortMetadataApi(
    (raw!.reason as ShortMetadataApiReason) ?? 'response_unavailable',
  );
  result.status = raw!.status as ShortMetadataApiResult['status'];
  result.reason = raw!.reason as ShortMetadataApiReason | null;
  for (const key of [
    'platformStarted',
    'ownerBefore',
    'ownerAfter',
    'ownerCallback',
    'fixedSourceVerified',
    'targetUnique',
    'paginationComplete',
  ] as const)
    result.proof[key] = bool(proof![key]);
  for (const key of ['readStartedAt', 'readFinishedAt', 'proofCapturedAt'] as const)
    result.proof[key] = time(proof![key]);
  result.own = { attempts: count(own!.attempts), disposed: count(own!.disposed) };
  result.list = {
    attempts: count(list!.attempts),
    disposed: count(list!.disposed),
    pagesRead: count(list!.pagesRead),
    rowsRead: count(list!.rowsRead),
    totalCount: list!.totalCount === null ? null : count(list!.totalCount),
  };
  for (const key of ['redirects', 'responseFailures', 'oversizeResponses'] as const)
    result.transport[key] = count(transport![key]);
  result.cleanup = {
    sessionCreated: bool(cleanup!.sessionCreated),
    sessionDisposed: bool(cleanup!.sessionDisposed),
    pendingAtEnd: count(cleanup!.pendingAtEnd),
    disposalFailures: count(cleanup!.disposalFailures),
    quarantined: bool(cleanup!.quarantined),
    checkedAt: time(cleanup!.checkedAt) ?? invalid(),
  };
  if (result.status !== 'success') {
    if (!result.reason) invalid();
    return result;
  }
  if (
    result.reason !== null ||
    result.proof.atomicRevision !== false ||
    [
      'platformStarted',
      'ownerBefore',
      'ownerAfter',
      'ownerCallback',
      'fixedSourceVerified',
      'targetUnique',
      'paginationComplete',
    ].some((key) => proof![key] !== true) ||
    !result.proof.readStartedAt ||
    !result.proof.readFinishedAt ||
    !result.proof.proofCapturedAt ||
    Date.parse(result.proof.readStartedAt) > Date.parse(result.proof.readFinishedAt) ||
    Date.parse(result.proof.readFinishedAt) > Date.parse(result.cleanup.checkedAt) ||
    Date.parse(result.cleanup.checkedAt) > Date.parse(result.proof.proofCapturedAt) ||
    result.own.attempts !== 2 ||
    result.own.disposed !== 2 ||
    result.list.totalCount === null ||
    result.list.totalCount < 1 ||
    result.list.rowsRead !== result.list.totalCount ||
    result.list.pagesRead !== Math.ceil(result.list.totalCount / 10) ||
    result.list.attempts !== result.list.pagesRead ||
    result.list.disposed !== result.list.attempts ||
    Object.values(result.transport).some((x) => x !== 0) ||
    !result.cleanup.sessionCreated ||
    !result.cleanup.sessionDisposed ||
    result.cleanup.pendingAtEnd !== 0 ||
    result.cleanup.disposalFailures !== 0 ||
    result.cleanup.quarantined ||
    !Array.isArray(raw!.fields) ||
    raw!.fields.length !== 5
  )
    invalid();
  result.fields = (raw!.fields as unknown[]).map((value, index) => {
    const field = object(value);
    if (
      !field ||
      field.field !== SHORT_METADATA_FIELDS[index] ||
      !Array.isArray(field.categorySamples) ||
      field.categorySamples.length > 16 ||
      (index !== 0 && field.categorySamples.length)
    )
      invalid();
    const kind = type(field!.type),
      present = bool(field!.present),
      arrayCount = field!.arrayCount === null ? null : count(field!.arrayCount),
      truncated = bool(field!.truncated);
    if (
      (kind === 'absent') !== !present ||
      (kind === 'array') !== (arrayCount !== null) ||
      (field!.categorySamples as unknown[]).length !==
        (index === 0 && kind === 'array' ? Math.min(arrayCount!, 16) : 0) ||
      (kind !== 'array' && truncated) ||
      (kind === 'array' &&
        (index === 0 ? truncated !== arrayCount! > 16 : arrayCount! < 100 && truncated))
    )
      invalid();
    return {
      field: SHORT_METADATA_FIELDS[index]!,
      present,
      type: kind,
      arrayCount,
      truncated,
      categorySamples: (field!.categorySamples as unknown[]).map((value) => {
        const sample = object(value),
          names = ['category_id', 'label', 'name'] as const;
        if (
          !sample ||
          !Array.isArray(sample.fields) ||
          sample.fields.length !== (sample.type === 'object' ? 3 : 0)
        )
          invalid();
        return {
          type: type(sample!.type),
          fields: (sample!.fields as unknown[]).map((value, i) => {
            const slot = object(value);
            if (!slot || slot.field !== names[i]) invalid();
            return { field: names[i]!, type: type(slot!.type) };
          }),
        };
      }),
    };
  });
  result.unknownKeyCount = count(raw!.unknownKeyCount);
  result.unknownKeysTruncated = bool(raw!.unknownKeysTruncated);
  return result;
}
