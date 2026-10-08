export const ORIGIN = 'https://fanqienovel.com';

export const OWN = `${ORIGIN}/api/user/info/v2`;

const EDIT = '/api/author/short_article/edit/v1/';

const ID = /^[1-9]\d{9,21}$/;

const QUERY = new Set(['aid', 'app_name', 'item_id', 'image_fmt_list', 'msToken', 'a_bogus']);

export const SHORT_METADATA_FIELDS = [
  'category',
  'thumb_uri',
  'thumb_url_list',
  'book_thumb_uri',
  'book_thumb_url_list',
] as const;

export const CHILD_FIELDS = ['category_id', 'label', 'name'] as const;

export type SchemaType = 'absent' | 'null' | 'string' | 'number' | 'boolean' | 'array' | 'object';

export type ShortMetadataReason =
  | 'context_unavailable'
  | 'identity_unverified'
  | 'owner_changed'
  | 'source_changed'
  | 'request_blocked'
  | 'redirect_blocked'
  | 'protocol_failed'
  | 'response_unverified'
  | 'response_unavailable'
  | 'cancelled'
  | 'timeout'
  | 'cleanup_failed'
  | 'lease_unavailable'
  | 'callback_failed';

export interface ShortMetadataField {
  field: (typeof SHORT_METADATA_FIELDS)[number];
  present: boolean;
  type: SchemaType;
  arrayCount: number | null;
  truncated: boolean;
  categorySamples: Array<{
    type: SchemaType;
    fields: Array<{ field: (typeof CHILD_FIELDS)[number]; type: SchemaType }>;
  }>;
}

export interface ShortMetadataResult {
  schema: 'short-metadata-schema/v1';
  status: 'success' | 'capability_unavailable';
  reason: ShortMetadataReason | null;
  fields: ShortMetadataField[] | null;
  unknownKeyCount: number | null;
  unknownKeysTruncated: boolean;
  proof: {
    platformStarted: boolean;
    ownerBefore: boolean;
    ownerAfter: boolean;
    ownerCallback: boolean;
    rootCommitted: boolean;
    uniqueNaturalResponse: boolean;
    connectedBarrier: boolean;
    proofCapturedAt: string | null;
    atomicRevision: false;
  };
  own: { attempts: number; disposed: number };
  blocked: {
    nonGet: number;
    unknownGet: number;
    foreignFrame: number;
    webSocket: number;
    serviceWorker: number;
    redirect: number;
    protocolFailure: number;
  };
  cleanup: {
    contextCreated: boolean;
    contextClosed: boolean;
    apiDisposed: boolean;
    pendingAtEnd: number;
    checkedAt: string;
  };
}

export interface ShortMetadataOptions {
  expectedAccountId: string;
  deadline: number;
  signal?: AbortSignal;
  assertLease(): void;
  assertBorrowedActive(): void;
  onBeforePlatformRead(): void;
  onVerifiedAccount(accountId: string, checkedAt: string): void;
}

export function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function fieldType(value: unknown, present = true): SchemaType {
  if (!present) return 'absent';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (['string', 'number', 'boolean'].includes(typeof value)) return typeof value as SchemaType;
  if (object(value)) return 'object';
  throw new Error('Unsupported metadata field type');
}

export const bounded = (value: number) => Math.min(100, value);

export function projectShortMetadataFields(data: Record<string, unknown>) {
  const fields = SHORT_METADATA_FIELDS.map((field) => {
    const present = Object.hasOwn(data, field),
      value = present ? data[field] : undefined;
    const array = Array.isArray(value) ? value : null;
    return {
      field,
      present,
      type: fieldType(value, present),
      arrayCount: array ? bounded(array.length) : null,
      truncated: Boolean(array && array.length > (field === 'category' ? 16 : 100)),
      categorySamples:
        field === 'category' && array
          ? array.slice(0, 16).map((item) => ({
              type: fieldType(item),
              fields: object(item)
                ? CHILD_FIELDS.map((child) => ({
                    field: child,
                    type: fieldType(item[child], Object.hasOwn(item, child)),
                  }))
                : [],
            }))
          : [],
    };
  });
  const count = Object.keys(data).filter(
    (key) => !SHORT_METADATA_FIELDS.includes(key as (typeof SHORT_METADATA_FIELDS)[number]),
  ).length;
  return { fields, unknownKeyCount: bounded(count), unknownKeysTruncated: count > 100 };
}

export function shortMetadataDocument(workId: string): string {
  if (!ID.test(workId)) throw new Error('Invalid existing short-story target');
  // Frozen actual writes.ts observed-short-editor descriptor, never a profile route.
  return `${ORIGIN}/main/writer/publish-short/${workId}`;
}

export function isShortMetadataEditUrl(raw: string, workId: string): boolean {
  try {
    const url = new URL(raw),
      keys = [...url.searchParams.keys()];
    return (
      ID.test(workId) &&
      url.origin === ORIGIN &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.pathname === EDIT &&
      keys.every((key) => QUERY.has(key)) &&
      keys.length === new Set(keys).size &&
      url.searchParams.getAll('item_id').length === 1 &&
      url.searchParams.get('item_id') === workId
    );
  } catch {
    return false;
  }
}
