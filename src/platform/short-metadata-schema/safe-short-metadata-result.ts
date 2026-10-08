import {
  type ShortMetadataResult,
  object,
  type ShortMetadataReason,
  type SchemaType,
  SHORT_METADATA_FIELDS,
  CHILD_FIELDS,
} from './object.js';

import { unavailableShortMetadata } from './classify-short-metadata-request.js';

/** Application distrusts even internal results: copy only fixed DTO slots. */
export function safeShortMetadataResult(value: unknown): ShortMetadataResult {
  const raw = object(value),
    proof = object(raw?.proof),
    own = object(raw?.own),
    blocked = object(raw?.blocked),
    cleanup = object(raw?.cleanup);
  const reasons: Array<ShortMetadataReason | null> = [
    null,
    'context_unavailable',
    'identity_unverified',
    'owner_changed',
    'source_changed',
    'request_blocked',
    'redirect_blocked',
    'protocol_failed',
    'response_unverified',
    'response_unavailable',
    'cancelled',
    'timeout',
    'cleanup_failed',
    'lease_unavailable',
    'callback_failed',
  ];
  const types: SchemaType[] = ['absent', 'null', 'string', 'number', 'boolean', 'array', 'object'];
  const bool = (x: unknown): boolean => {
    if (typeof x !== 'boolean') throw new Error('Invalid safe metadata result');
    return x;
  };
  const count = (x: unknown): number => {
    if (!Number.isInteger(x) || typeof x !== 'number' || x < 0 || x > 100)
      throw new Error('Invalid safe metadata result');
    return x;
  };
  const time = (x: unknown): string => {
    if (typeof x !== 'string' || !Number.isFinite(Date.parse(x)) || new Date(x).toISOString() !== x)
      throw new Error('Invalid safe metadata result');
    return x;
  };
  const type = (x: unknown): SchemaType => {
    if (!types.includes(x as SchemaType)) throw new Error('Invalid safe metadata result');
    return x as SchemaType;
  };
  if (
    !raw ||
    raw.schema !== 'short-metadata-schema/v1' ||
    !['success', 'capability_unavailable'].includes(raw.status as string) ||
    !reasons.includes(raw.reason as ShortMetadataReason | null) ||
    !proof ||
    !own ||
    !blocked ||
    !cleanup ||
    proof.atomicRevision !== false
  )
    throw new Error('Invalid safe metadata result');
  const result = unavailableShortMetadata(
    (raw.reason as ShortMetadataReason) ?? 'response_unavailable',
  );
  result.status = raw.status as ShortMetadataResult['status'];
  result.reason = raw.reason as ShortMetadataReason | null;
  for (const key of [
    'platformStarted',
    'ownerBefore',
    'ownerAfter',
    'ownerCallback',
    'rootCommitted',
    'uniqueNaturalResponse',
    'connectedBarrier',
  ] as const)
    result.proof[key] = bool(proof[key]);
  result.proof.proofCapturedAt =
    proof.proofCapturedAt === null ? null : time(proof.proofCapturedAt);
  result.own = { attempts: count(own.attempts), disposed: count(own.disposed) };
  for (const key of Object.keys(result.blocked) as Array<keyof ShortMetadataResult['blocked']>)
    result.blocked[key] = count(blocked[key]);
  result.cleanup = {
    contextCreated: bool(cleanup.contextCreated),
    contextClosed: bool(cleanup.contextClosed),
    apiDisposed: bool(cleanup.apiDisposed),
    pendingAtEnd: count(cleanup.pendingAtEnd),
    checkedAt: time(cleanup.checkedAt),
  };
  if (result.status === 'success') {
    if (
      result.reason !== null ||
      !result.proof.proofCapturedAt ||
      Object.entries(result.proof).some(
        ([key, val]) => !['atomicRevision', 'proofCapturedAt'].includes(key) && val !== true,
      ) ||
      result.own.attempts !== 2 ||
      result.own.disposed !== 2 ||
      Object.values(result.blocked).some((val) => val !== 0) ||
      !result.cleanup.contextCreated ||
      !result.cleanup.contextClosed ||
      !result.cleanup.apiDisposed ||
      result.cleanup.pendingAtEnd !== 0 ||
      !Array.isArray(raw.fields) ||
      raw.fields.length !== SHORT_METADATA_FIELDS.length
    )
      throw new Error('Invalid safe metadata success');
    result.fields = raw.fields.map((item: unknown, index: number) => {
      const field = object(item);
      if (
        !field ||
        field.field !== SHORT_METADATA_FIELDS[index] ||
        !Array.isArray(field.categorySamples) ||
        field.categorySamples.length > 16 ||
        (index !== 0 && field.categorySamples.length)
      )
        throw new Error('Invalid safe metadata field');
      return {
        field: SHORT_METADATA_FIELDS[index]!,
        present: bool(field.present),
        type: type(field.type),
        arrayCount: field.arrayCount === null ? null : count(field.arrayCount),
        truncated: bool(field.truncated),
        categorySamples: field.categorySamples.map((sample: unknown) => {
          const child = object(sample);
          if (
            !child ||
            !Array.isArray(child.fields) ||
            child.fields.length !== (child.type === 'object' ? 3 : 0)
          )
            throw new Error('Invalid safe metadata sample');
          return {
            type: type(child.type),
            fields: child.fields.map((slot: unknown, i: number) => {
              const obj = object(slot);
              if (!obj || obj.field !== CHILD_FIELDS[i])
                throw new Error('Invalid safe metadata child');
              return { field: CHILD_FIELDS[i]!, type: type(obj.type) };
            }),
          };
        }),
      };
    });
    result.unknownKeyCount = count(raw.unknownKeyCount);
    result.unknownKeysTruncated = bool(raw.unknownKeysTruncated);
  } else if (!result.reason) throw new Error('Invalid safe metadata failure');
  return result;
}
