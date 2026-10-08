import {
  type NativeShortApiReason,
  type RequestKind,
} from './native-short-metadata-fixed-read-url.js';

import { type NativeShortMetadataSnapshot } from '../short-native-metadata.js';

/** Private service result. The snapshot contains full author content, never a public diagnostic DTO. */
export interface NativeShortMetadataApiResult {
  schema: 'native-short-metadata-api-read/v1';
  status: 'success' | 'capability_unavailable';
  reason: NativeShortApiReason | null;
  snapshot: NativeShortMetadataSnapshot | null;
  proof: {
    platformStarted: boolean;
    ownerBefore: boolean;
    ownerAfter: boolean;
    ownerCallback: boolean;
    fixedSourceVerified: boolean;
    targetUnique: boolean;
    paginationComplete: boolean;
    atomicRevision: false;
    readStartedAt: string | null;
    readFinishedAt: string | null;
    proofCapturedAt: string | null;
  };
  requests: Record<RequestKind, { attempts: number; disposed: number }>;
  list: { pagesRead: number; rowsRead: number; totalCount: number | null };
  cleanup: {
    sessionCreated: boolean;
    sessionDisposed: boolean;
    pendingAtEnd: number;
    disposalFailures: number;
    quarantined: boolean;
    checkedAt: string;
  };
}

export function unavailableNativeShortMetadataApi(
  reason: NativeShortApiReason,
): NativeShortMetadataApiResult {
  return {
    schema: 'native-short-metadata-api-read/v1',
    status: 'capability_unavailable',
    reason,
    snapshot: null,
    proof: {
      platformStarted: false,
      ownerBefore: false,
      ownerAfter: false,
      ownerCallback: false,
      fixedSourceVerified: false,
      targetUnique: false,
      paginationComplete: false,
      atomicRevision: false,
      readStartedAt: null,
      readFinishedAt: null,
      proofCapturedAt: null,
    },
    requests: {
      own: { attempts: 0, disposed: 0 },
      list: { attempts: 0, disposed: 0 },
      edit: { attempts: 0, disposed: 0 },
      catalog: { attempts: 0, disposed: 0 },
    },
    list: { pagesRead: 0, rowsRead: 0, totalCount: null },
    cleanup: {
      sessionCreated: false,
      sessionDisposed: false,
      pendingAtEnd: 0,
      disposalFailures: 0,
      quarantined: false,
      checkedAt: new Date().toISOString(),
    },
  };
}

export const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
