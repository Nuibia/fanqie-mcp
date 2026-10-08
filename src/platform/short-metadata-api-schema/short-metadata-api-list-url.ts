import { type ShortMetadataField } from '../short-metadata-schema.js';

export const ORIGIN = 'https://fanqienovel.com';

export const OWN = `${ORIGIN}/api/user/info/v2`;

export const ID = /^[1-9]\d{9,21}$/;

export const LIMIT = 3 * 1024 * 1024;

export const SHORT_METADATA_API_REASONS = [
  'context_unavailable',
  'identity_unverified',
  'owner_changed',
  'source_changed',
  'redirect_blocked',
  'response_unverified',
  'response_unavailable',
  'bounded_unavailable',
  'pagination_inconsistent',
  'target_unverified',
  'cancelled',
  'timeout',
  'cleanup_failed',
  'lease_unavailable',
  'callback_failed',
] as const;

export type ShortMetadataApiReason = (typeof SHORT_METADATA_API_REASONS)[number];

export interface ShortMetadataApiResult {
  schema: 'short-metadata-api-schema/v1';
  status: 'success' | 'capability_unavailable';
  reason: ShortMetadataApiReason | null;
  fields: ShortMetadataField[] | null;
  unknownKeyCount: number | null;
  unknownKeysTruncated: boolean;
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
  own: { attempts: number; disposed: number };
  list: {
    attempts: number;
    disposed: number;
    pagesRead: number;
    rowsRead: number;
    totalCount: number | null;
  };
  transport: { redirects: number; responseFailures: number; oversizeResponses: number };
  cleanup: {
    sessionCreated: boolean;
    sessionDisposed: boolean;
    pendingAtEnd: number;
    disposalFailures: number;
    quarantined: boolean;
    checkedAt: string;
  };
}

export interface ShortMetadataApiOptions {
  expectedAccountId: string;
  deadline: number;
  signal?: AbortSignal;
  assertLease(): void;
  assertBorrowedActive(): void;
  onBeforePlatformRead(): void;
  onVerifiedAccount(accountId: string, checkedAt: string): void;
  onQuarantine(): void;
}

export const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function shortMetadataApiListUrl(pageIndex: number): string {
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex > 9)
    throw new Error('Invalid fixed list page');
  const query = new URLSearchParams({
    aid: '2503',
    app_name: 'muye_novel',
    page_count: '10',
    page_index: String(pageIndex),
    time_sort: '0',
    image_fmt_list: '450x800',
    book_image_fmt_list: '190x250',
    pack_type: '1',
  });
  return `${ORIGIN}/api/author/short_article/draft_list/v0/?${query}`;
}

export function unavailableShortMetadataApi(
  reason: ShortMetadataApiReason,
): ShortMetadataApiResult {
  return {
    schema: 'short-metadata-api-schema/v1',
    status: 'capability_unavailable',
    reason,
    fields: null,
    unknownKeyCount: null,
    unknownKeysTruncated: false,
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
    own: { attempts: 0, disposed: 0 },
    list: { attempts: 0, disposed: 0, pagesRead: 0, rowsRead: 0, totalCount: null },
    transport: { redirects: 0, responseFailures: 0, oversizeResponses: 0 },
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
