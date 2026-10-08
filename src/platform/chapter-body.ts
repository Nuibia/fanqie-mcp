import { createHash } from 'node:crypto';

const ORIGIN = 'https://fanqienovel.com';
const READ_PATH = '/api/author/edit_article/v0/';
const ID = /^[1-9]\d{9,29}$/;
const MAX_CONTEXT_LENGTH = 16_384;
export const MAX_CHAPTER_BODY_BYTES = 3_000_000;
const MAX_TITLE_BYTES = 4_096;
const WORK_KEYS = new Set(['book_id', 'bookId', 'work_id', 'workId']);
const CHAPTER_KEYS = new Set(['item_id', 'itemId', 'chapter_id', 'chapterId']);
const VOLUME_KEYS = new Set(['volume_id', 'volumeId']);
const IDENTITY_KEY = /^(?:(?:account|author|writer|user|owner|target)(?:id|uid)?|uid|id)$/i;

export type ChapterBodyErrorCode =
  | 'invalid_target'
  | 'invalid_context'
  | 'ambiguous_context'
  | 'identity_filter'
  | 'parent_mismatch'
  | 'invalid_response'
  | 'invalid_content'
  | 'content_extent'
  | 'invalid_version';
export class ChapterBodyCandidateError extends Error {
  constructor(readonly code: ChapterBodyErrorCode) {
    super(code);
    this.name = 'ChapterBodyCandidateError';
  }
}
function fail(code: ChapterBodyErrorCode): never {
  throw new ChapterBodyCandidateError(code);
}

export interface ChapterBodyTarget {
  workId: string;
  chapterId: string;
  volumeId?: string;
}
export interface ChapterBodyReadCandidate {
  sourceBoundary: 'public_contract_api';
  url: string;
}
export interface ChapterBodyRecord {
  sourceBoundary: 'public_contract_api';
  representation: 'author_edit_current';
  publishedVersionVerified: false;
  /** Caller expectation, not an observed identity or ownership proof. */
  requestedTarget: ChapterBodyTarget;
  title: string;
  rawContent: string;
  rawContentSha256: string;
  rawContentBytes: number;
  rawPublishStatus: number;
  rawCreationStatus: number;
  rawLatestVersion: number;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_response');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail('invalid_response');
  return value as Record<string, unknown>;
}
/** Known properties must be JSON data properties. Unknown fields are never read. */
function field(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!('value' in descriptor)) fail('invalid_response');
  return descriptor.value;
}
function target(value: ChapterBodyTarget): ChapterBodyTarget {
  try {
    const row = object(value);
    if (Object.keys(row).some((key) => !['workId', 'chapterId', 'volumeId'].includes(key)))
      fail('invalid_target');
    const workId = field(row, 'workId'),
      chapterId = field(row, 'chapterId'),
      volumeId = field(row, 'volumeId');
    if (
      typeof workId !== 'string' ||
      !ID.test(workId) ||
      typeof chapterId !== 'string' ||
      !ID.test(chapterId) ||
      (volumeId !== undefined && (typeof volumeId !== 'string' || !ID.test(volumeId)))
    )
      fail('invalid_target');
    return {
      workId,
      chapterId,
      ...(volumeId === undefined ? {} : { volumeId: volumeId as string }),
    };
  } catch {
    return fail('invalid_target');
  }
}
function canonicalWork(pathname: string): string | null {
  const plain = /^\/main\/writer\/chapter-manage\/([1-9]\d{9,29})\/?$/.exec(pathname);
  if (plain) return plain[1]!;
  const encoded = /^\/main\/writer\/chapter-manage\/([1-9]\d{9,29})&([^/]+)$/.exec(pathname);
  if (!encoded) return null;
  const title = decodeURIComponent(encoded[2]!);
  const upper = (value: string) => value.replace(/%[a-f\d]{2}/gi, (escape) => escape.toUpperCase());
  return title && upper(encodeURIComponent(title)) === upper(encoded[2]!) ? encoded[1]! : null;
}
function checkBinding(key: string, value: unknown, expected: ChapterBodyTarget): void {
  const wanted = WORK_KEYS.has(key)
    ? expected.workId
    : CHAPTER_KEYS.has(key)
      ? expected.chapterId
      : VOLUME_KEYS.has(key)
        ? expected.volumeId
        : undefined;
  if (typeof value !== 'string' || !ID.test(value) || wanted === undefined || value !== wanted)
    fail('parent_mismatch');
}
function contextFromSource(raw: string, expected: ChapterBodyTarget): 0 | 1 | 2 {
  if (typeof raw !== 'string' || raw.length > MAX_CONTEXT_LENGTH) fail('invalid_context');
  const url = new URL(raw),
    decoded = decodeURIComponent(raw);
  if (
    url.origin !== ORIGIN ||
    url.username ||
    url.password ||
    url.hash ||
    canonicalWork(url.pathname) !== expected.workId
  )
    fail('invalid_context');
  const keys = new Set<string>(),
    work: string[] = [],
    chapter: string[] = [],
    volume: string[] = [];
  for (const [key, value] of url.searchParams) {
    if (keys.has(key)) fail('ambiguous_context');
    keys.add(key);
    if (IDENTITY_KEY.test(key.replace(/_/g, ''))) fail('identity_filter');
    if (WORK_KEYS.has(key)) work.push(key);
    else if (CHAPTER_KEYS.has(key)) chapter.push(key);
    else if (VOLUME_KEYS.has(key)) volume.push(key);
    else if (/^(?:book|work|item|chapter|volume)id$/i.test(key.replace(/_/g, '')))
      fail('ambiguous_context');
    if (WORK_KEYS.has(key) || CHAPTER_KEYS.has(key) || VOLUME_KEYS.has(key))
      checkBinding(key, value, expected);
  }
  if (work.length > 1 || chapter.length > 1 || volume.length > 1) fail('ambiguous_context');
  // The public helper decodes the entire URL, so encoded delimiters/path titles
  // must not masquerade as query parameters. Its value is not a storage read.
  const matches = [...decoded.matchAll(/(?:\?|&|#)([A-Za-z_][A-Za-z_\d]*)=([^#&]*)(?=[#&]|$)/g)];
  const securityKey = (key: string) =>
    key === 'bookProblemMarkInfoType' ||
    WORK_KEYS.has(key) ||
    CHAPTER_KEYS.has(key) ||
    VOLUME_KEYS.has(key) ||
    IDENTITY_KEY.test(key.replace(/_/g, ''));
  for (const match of matches)
    if (
      securityKey(match[1]!) &&
      (url.searchParams.getAll(match[1]!).length !== 1 ||
        url.searchParams.get(match[1]!) !== match[2])
    )
      fail('ambiguous_context');
  const sourceMatches = matches.filter((match) => match[1] === 'bookProblemMarkInfoType');
  if (
    sourceMatches.length > 1 ||
    url.searchParams.has('bookProblemMarkInfoType') !== (sourceMatches.length === 1)
  )
    fail('ambiguous_context');
  const value = sourceMatches[0]?.[2];
  return value === '1' ? 1 : value === '2' ? 2 : 0;
}

/** Pure URL candidate only: this grants no execution, own-account or source permission. */
export function buildChapterBodyReadCandidate(
  canonicalManagementUrl: string,
  requestedTarget: ChapterBodyTarget,
): ChapterBodyReadCandidate {
  const expected = target(requestedTarget);
  try {
    const fromSource = contextFromSource(canonicalManagementUrl, expected),
      url = new URL(READ_PATH, ORIGIN);
    // Public 1667.P -> 90165 -> 37706 constants; no hidden query or signer.
    for (const [key, value] of [
      ['aid', '2503'],
      ['app_name', 'muye_novel'],
      ['book_id', expected.workId],
      ['item_id', expected.chapterId],
      ['from_source', String(fromSource)],
    ] as const)
      url.searchParams.set(key, value);
    return { sourceBoundary: 'public_contract_api', url: url.toString() };
  } catch (error) {
    if (error instanceof ChapterBodyCandidateError) throw error;
    return fail('invalid_context');
  }
}

function rawString(value: unknown, limit: number): string {
  if (
    typeof value !== 'string' ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
  )
    fail('invalid_content');
  if (Buffer.byteLength(value, 'utf8') > limit) fail('content_extent');
  return value;
}
function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    fail('invalid_version');
  return value;
}
function responseBinding(
  row: Record<string, unknown>,
  expected: ChapterBodyTarget,
  keys: Iterable<string>,
): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(row)) {
    if (allowed.has(key)) checkBinding(key, field(row, key), expected);
    else if (/^(?:book|work|item|chapter|volume)id$/i.test(key.replace(/_/g, '')))
      fail('invalid_response');
  }
}

/** Structural candidate parser. Transport, parent ownership, freshness and full
 * published-version extent must be proved by its caller; no such flags are made here.
 * Unknown payload fields are neither copied nor recursively interpreted as targets. */
export function parseChapterBodyResponse(
  json: unknown,
  requestedTarget: ChapterBodyTarget,
): ChapterBodyRecord {
  const expected = target(requestedTarget);
  try {
    const payload = object(json);
    if (field(payload, 'code') !== 0) fail('invalid_response');
    const data = object(field(payload, 'data'));
    const identityKeys = [...WORK_KEYS, ...CHAPTER_KEYS, ...VOLUME_KEYS];
    responseBinding(payload, expected, identityKeys);
    responseBinding(data, expected, identityKeys);
    if (Object.hasOwn(data, 'column_data'))
      responseBinding(object(field(data, 'column_data')), expected, WORK_KEYS);
    const rawContent = rawString(field(data, 'content'), MAX_CHAPTER_BODY_BYTES),
      title = rawString(field(data, 'title'), MAX_TITLE_BYTES);
    return {
      sourceBoundary: 'public_contract_api',
      representation: 'author_edit_current',
      publishedVersionVerified: false,
      requestedTarget: expected,
      title,
      rawContent,
      rawContentSha256: createHash('sha256').update(rawContent, 'utf8').digest('hex'),
      rawContentBytes: Buffer.byteLength(rawContent, 'utf8'),
      rawPublishStatus: version(field(data, 'publish_status')),
      rawCreationStatus: version(field(data, 'creation_status')),
      rawLatestVersion: version(field(data, 'latest_version')),
    };
  } catch (error) {
    if (error instanceof ChapterBodyCandidateError) throw error;
    return fail('invalid_response');
  }
}
