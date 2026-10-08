import {
  type Job,
  type Manifest,
  type EvidenceRef,
  type EvidenceDocument,
  type JobStatus,
} from '../../runtime/store.js';

import { request } from 'playwright';

export const SHORT_DRAFT_DIRECTORY_OPERATION = 'list_short_drafts' as const;

export const SHORT_DRAFT_DIRECTORY_DATASET = 'short_drafts' as const;

export const SHORT_DRAFT_DIRECTORY_SCOPE = 'native_short_draft_directory.v1' as const;

export const SHORT_DRAFT_DIRECTORY_INPUT_HASH =
  '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';

export const SHORT_DRAFT_DIRECTORY_OWN_URL = 'https://fanqienovel.com/api/user/info/v2';

export const SHORT_DRAFT_DIRECTORY_PATH = '/api/author/short_article/draft_list/v0/';

export const SHORT_DRAFT_DIRECTORY_REASONS = [
  'context_unavailable',
  'identity_unverified',
  'owner_changed',
  'source_changed',
  'redirect_blocked',
  'response_unverified',
  'response_unavailable',
  'bounded_unavailable',
  'pagination_inconsistent',
  'unsupported_schema',
  'cancelled',
  'timeout',
  'cleanup_failed',
  'lease_unavailable',
  'callback_failed',
] as const;

export type ShortDraftDirectoryReason = (typeof SHORT_DRAFT_DIRECTORY_REASONS)[number];

export const ORIGIN = 'https://fanqienovel.com',
  LIMIT = 3 * 1024 * 1024;

export const ACCOUNT = /^[0-9]{1,30}$/,
  ITEM = /^[1-9][0-9]{9,21}$/,
  HASH = /^[a-f0-9]{64}$/;

export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export const JOB_SCHEMA = 'short-draft-directory-job/v1';

export const ANCHOR_KEYS = [
  'shortDraftDirectorySchema',
  'shortDraftDirectoryOwnerKind',
  'shortDraftDirectoryOwnerId',
  'shortDraftDirectorySource',
] as const;

export interface ShortDraftDirectoryRecord {
  id: { namespace: 'native_short_item'; value: string };
  title: null;
  publicationStatus: 'unknown';
  signingStatus: 'unknown';
  listingScope: 'own_draft_list';
}

export interface ShortDraftDirectoryCoverage {
  pageSize: 10;
  firstPageIndex: 0;
  pagesRead: number;
  rowsRead: number;
  declaredTotal: number | null;
  complete: boolean;
  atomicRevision: false;
  readStartedAt: string | null;
  readFinishedAt: string | null;
  proofCapturedAt: string | null;
}

export interface ShortDraftDirectoryProof {
  platformStarted: boolean;
  ownerBefore: boolean;
  ownerAfter: boolean;
  ownerCallback: boolean;
  fixedSourceVerified: boolean;
  paginationComplete: boolean;
  ownerCheckedAt: string | null;
}

export interface ShortDraftDirectoryCleanup {
  sessionCreated: boolean;
  sessionDisposed: boolean;
  pendingAtEnd: number;
  disposalFailures: number;
  quarantined: boolean;
  checkedAt: string;
}

export interface Counters {
  attempts: number;
  disposed: number;
}

export interface Common {
  status: 'success' | 'capability_unavailable';
  reason: ShortDraftDirectoryReason | null;
  records: ShortDraftDirectoryRecord[];
  owner: { kind: 'account'; id: string } | null;
  coverage: ShortDraftDirectoryCoverage;
  proof: ShortDraftDirectoryProof;
  requests: { own: Counters; list: Counters };
  transport: { redirects: number; responseFailures: number; oversizeResponses: number };
  cleanup: ShortDraftDirectoryCleanup;
}

export interface ShortDraftDirectoryResult extends Common {
  schema: 'short-draft-directory-api/v1';
  provenance: { transport: 'default-request' | 'fixture-request' };
}

export interface ShortDraftDirectoryEvidence extends Common {
  schema: 'short-draft-directory-evidence/v1';
  bodyIncluded: false;
  source: {
    mode: 'live' | 'fixture';
    transport: 'default-request' | 'fixture-request';
    application: 'default' | 'injected';
    origin: typeof ORIGIN;
    path: typeof SHORT_DRAFT_DIRECTORY_PATH;
  };
}

export interface ShortDraftDirectoryOptions {
  mode: 'read';
  expectedOwner: { kind: 'account'; id: string };
  deadline: number;
  signal?: AbortSignal;
  assertLease(): void;
  assertBorrowedActive(): void;
  onBeforePlatformRead(): void;
  onVerifiedAccount(accountId: string, checkedAt: string): void;
  onQuarantine(): void;
}

export interface ShortDraftDirectoryContext {
  readonly accountId: string;
  readonly job: Job;
  readonly manifest: Manifest | null;
  readonly refs: readonly EvidenceRef[];
  readonly documents: readonly EvidenceDocument[];
  readonly evaluationAt: string;
}

export interface ShortDraftDirectorySafeRef {
  id: string;
  jobId: string;
  dataset: typeof SHORT_DRAFT_DIRECTORY_DATASET;
  capturedAt: string;
  sha256: string;
}

export interface ShortDraftDirectorySafeManifest {
  id: string;
  jobId: string;
  operation: typeof SHORT_DRAFT_DIRECTORY_OPERATION;
  scope: typeof SHORT_DRAFT_DIRECTORY_SCOPE;
  datasets: [typeof SHORT_DRAFT_DIRECTORY_DATASET];
  requestedAt: string;
  platformReadStartedAt: string;
  committedAt: string;
  evidence: ShortDraftDirectorySafeRef[];
}

export interface ShortDraftDirectoryBusiness {
  schema: 'fanqie-short-draft-directory/v1';
  dataset: typeof SHORT_DRAFT_DIRECTORY_DATASET;
  status: Common['status'];
  reason: Common['reason'];
  records: ShortDraftDirectoryRecord[];
  coverage: ShortDraftDirectoryCoverage;
  source: {
    mode: 'live' | 'fixture';
    origin: typeof ORIGIN;
    path: typeof SHORT_DRAFT_DIRECTORY_PATH;
  };
  proof: ShortDraftDirectoryProof;
  requests: Common['requests'];
  transport: Common['transport'];
  cleanup: ShortDraftDirectoryCleanup;
  verifiedLive: boolean;
  bodyIncluded: false;
}

export interface ShortDraftDirectoryProjection {
  validated: boolean;
  collectionMode: 'live' | 'fixture' | null;
  verifiedLive: boolean;
  reason: ShortDraftDirectoryReason | null;
  evidence: ShortDraftDirectorySafeRef[];
  data: ShortDraftDirectoryBusiness[];
  manifest: ShortDraftDirectorySafeManifest | null;
}

export interface ShortDraftDirectorySafeJob {
  id: string | null;
  kind: 'read';
  operation: typeof SHORT_DRAFT_DIRECTORY_OPERATION;
  scope: typeof SHORT_DRAFT_DIRECTORY_SCOPE;
  status: JobStatus | null;
  requestedAt: string | null;
  startedAt: string | null;
  platformReadStartedAt: string | null;
  endedAt: string | null;
  target: null;
  error: { code: string; message: string } | null;
}

export const defaultNewContext = request.newContext.bind(request);

export const invalid = (): never => {
  throw new Error('Short draft directory is unavailable.');
};

function unicode(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const n = value.charCodeAt(i);
    if (n >= 0xd800 && n <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (n >= 0xdc00 && n <= 0xdfff) return false;
  }
  return true;
}

export function string(value: unknown, max = 512): value is string {
  return typeof value === 'string' && value.length <= max && unicode(value);
}

export function exact(
  value: unknown,
  keys: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.getOwnPropertySymbols(value).length
  )
    return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value),
    names = Object.keys(descriptors);
  if (
    keys.some((key) => !Object.hasOwn(descriptors, key)) ||
    names.some((key) => !keys.includes(key) && !optional.includes(key)) ||
    names.some((key) => !Object.hasOwn(descriptors[key]!, 'value') || !descriptors[key]!.enumerable)
  )
    return invalid();
  return Object.fromEntries(names.map((key) => [key, descriptors[key]!.value]));
}

export function array(value: unknown, max: number): unknown[] {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length
  )
    return invalid();
  const d = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(d).length !== value.length + 1) return invalid();
  for (let i = 0; i < value.length; i++)
    if (!d[String(i)] || !Object.hasOwn(d[String(i)]!, 'value') || !d[String(i)]!.enumerable)
      return invalid();
  return value;
}

export function count(value: unknown, max: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < 0 ||
    value > max
  )
    return invalid();
  return value;
}

export function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') return invalid();
  return value;
}

export function isShortDraftDirectoryTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
