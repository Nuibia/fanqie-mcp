import { type ChapterGetQuerySchema, type ChapterRouteQuerySchema } from './chapter-diagnostics.js';

import { isChapterReadSchemaSource, type ChapterVolumeRefreshEvent } from '../reads.js';

import { BrowserSessionError } from './errors.js';

import { DIAGNOSTIC_BASE_ROUTES } from './read-diagnostics.js';

export function diagnosticRouteTemplate(raw: string): string {
  const url = new URL(raw, 'https://fanqienovel.com');
  let pathname: string;
  const writer = url.pathname.match(/^\/main\/writer\/([^/]+)(?:\/(.*))?$/);
  if (/^\/main\/writer\/chapter-manage\/[1-9]\d{9,29}&/.test(url.pathname)) {
    // The real directory route contains a book title. Never serialize it,
    // including malformed, raw-Unicode or multiply encoded title suffixes.
    pathname = '/main/writer/chapter-manage/{workId}&{title}';
  } else if (writer) {
    const base = /^[a-z][a-z-]{0,63}$/.test(writer[1]!) ? writer[1]! : '{route}';
    let index = 0;
    const parts = writer[2]?.split('/').map((part) => {
      if (!part) return '';
      if (!/^\d{1,30}$/.test(part)) return '{opaque}';
      index += 1;
      return base === 'preview-chapter'
        ? '{chapterId}'
        : /^(?:preview-short|preview-book|chapter-manage|chapter-data|book-manage|book-data)$/.test(
              base,
            )
          ? index === 1
            ? '{workId}'
            : '{chapterId}'
          : '{id}';
    });
    pathname = `/main/writer/${base}${parts ? `/${parts.join('/')}` : ''}`;
  } else {
    pathname = url.pathname
      .split('/')
      .map((part) => {
        if (!part || /^v\d{1,3}$/.test(part)) return part;
        if (/^\d{1,30}$/.test(part)) return '{id}';
        if (/\d{5,}|^[a-f\d]{24,}$/i.test(part) || !/^[a-z][a-z0-9_-]{0,63}$/.test(part))
          return '{opaque}';
        return part;
      })
      .join('/');
  }
  const query: string[] = [];
  for (const [key, value] of url.searchParams) {
    if (
      ['book_id', 'work_id', 'chapter_id', 'bookId', 'workId', 'chapterId'].includes(key) &&
      /^\d{1,30}$/.test(value)
    )
      query.push(
        `${key}=${key === 'chapter_id' || key === 'chapterId' ? '{chapterId}' : '{workId}'}`,
      );
    else if (['tab', 'page', 'page_index', 'page_count'].includes(key) && /^\d{1,4}$/.test(value))
      query.push(`${key}=${value}`);
    else if (key === 'type' && isChapterDirectoryRoute(url.pathname) && /^\d{1,30}$/.test(value))
      query.push('type={numeric}');
  }
  return `${url.origin}${pathname}${query.length ? `?${query.join('&')}` : ''}`;
}

type EncodedChapterRoute =
  | { status: 'unshaped' }
  | { status: 'malformed'; workId: string }
  | { status: 'decoded'; workId: string; title: string; canonical: boolean };

/** Decode once for private binding checks; this never serializes the title or relaxes route acceptance. */
export function inspectEncodedChapterRoute(pathname: string): EncodedChapterRoute {
  const match = /^\/main\/writer\/chapter-manage\/([1-9]\d{9,29})&([^/]+)$/.exec(pathname);
  if (!match) return { status: 'unshaped' };
  try {
    const title = decodeURIComponent(match[2]!);
    const normalizeHex = (value: string) =>
      value.replace(/%[a-f\d]{2}/gi, (escape) => escape.toUpperCase());
    return {
      status: 'decoded',
      workId: match[1]!,
      title,
      canonical:
        Boolean(title) && normalizeHex(encodeURIComponent(title)) === normalizeHex(match[2]!),
    };
  } catch {
    return { status: 'malformed', workId: match[1]! };
  }
}

/** Keep the existing strict canonical-encoding rule until an actual diagnostic proves otherwise. */
export function encodedChapterRoute(pathname: string): { workId: string; title: string } | null {
  const route = inspectEncodedChapterRoute(pathname);
  return route.status === 'decoded' && route.canonical
    ? { workId: route.workId, title: route.title }
    : null;
}

export function isChapterDirectoryRoute(pathname: string): boolean {
  return (
    /^\/main\/writer\/chapter-manage\/[1-9]\d{9,29}\/?$/.test(pathname) ||
    encodedChapterRoute(pathname) !== null
  );
}

export function chapterDirectoryWorkId(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.origin !== 'https://fanqienovel.com' || url.username || url.password) return null;
    return (
      encodedChapterRoute(url.pathname)?.workId ??
      /^\/main\/writer\/chapter-manage\/([1-9]\d{9,29})\/?$/.exec(url.pathname)?.[1] ??
      null
    );
  } catch {
    return null;
  }
}

const CHAPTER_GET_SAFE_KEYS = new Set([
  'book_id',
  'bookId',
  'work_id',
  'workId',
  'chapter_id',
  'chapterId',
  'volume_id',
  'volumeId',
  'page',
  'page_index',
  'page_count',
  'page_size',
  'offset',
  'limit',
  'cursor',
  'type',
  'order',
]);

/** Fixed query names/types/shapes only. Unknown names and every actual value remain private.
 * allowedReadKey describes a projected name, never permission to construct or change a URL.
 */
export function projectChapterGetQuerySchema(
  raw: string,
  currentWorkId: string | null,
): ChapterGetQuerySchema {
  const empty: ChapterGetQuerySchema = {
    entries: [],
    truncated: false,
    workBinding: 'invalid_source',
    replayBoundToCurrentWork: false,
  };
  if (!isChapterReadSchemaSource(raw)) return empty;
  const url = new URL(raw),
    counts = new Map<string, number>();
  for (const key of url.searchParams.keys()) counts.set(key, (counts.get(key) ?? 0) + 1);
  const entries: ChapterGetQuerySchema['entries'] = [];
  for (const [key, value] of url.searchParams) {
    if (entries.length >= 16) break;
    const allowedReadKey = CHAPTER_GET_SAFE_KEYS.has(key);
    entries.push({
      key: allowedReadKey ? key : '{opaque}',
      type: 'string',
      valueShape: !value
        ? 'empty'
        : /^\d{1,30}$/.test(value)
          ? 'numeric'
          : /^\d+$/.test(value)
            ? 'numeric_out_of_range'
            : 'other',
      allowedReadKey,
      duplicate: (counts.get(key) ?? 0) > 1,
    });
  }
  const targets = [...url.searchParams].filter(([key]) =>
    ['book_id', 'bookId', 'work_id', 'workId'].includes(key),
  );
  const workBinding: ChapterGetQuerySchema['workBinding'] =
    targets.length === 0
      ? 'missing_work'
      : targets.length !== 1
        ? 'ambiguous_work'
        : !currentWorkId || !/^[1-9]\d{9,29}$/.test(targets[0]![1])
          ? 'invalid_work'
          : targets[0]![1] === currentWorkId
            ? 'current_work'
            : 'other_work';
  const otherIdentityFilter = [...url.searchParams.keys()].some((key) =>
    /^(?:author|writer|user|target|account|owner)_?id$|^(?:uid|id)$/i.test(key),
  );
  return {
    entries,
    truncated: url.searchParams.size > entries.length,
    workBinding,
    replayBoundToCurrentWork: workBinding === 'current_work' && !otherIdentityFilter,
  };
}

/** Classifies only the established own-origin/exact volume path; no URL or query value escapes. */
export function projectChapterVolumeRefreshEvent(
  request: { url(): string; method(): string; resourceType(): string; frame(): unknown },
  context: {
    event: ChapterVolumeRefreshEvent['event'];
    workId: string;
    template: string;
    mainFrame: unknown;
    requestEpoch: number | undefined;
    refreshEpoch: number;
    currentEpoch: number;
    samePage: boolean;
    activeSlot: boolean;
    pageOpen: boolean;
    sessionOpen: boolean;
    signalAborted: boolean;
    strictSourceMatch: boolean;
    status?: number;
  },
): ChapterVolumeRefreshEvent | null {
  try {
    const raw = request.url(),
      url = new URL(raw);
    if (
      url.origin !== 'https://fanqienovel.com' ||
      url.pathname !== '/api/author/volume/volume_list/v1'
    )
      return null;
    const keys = [...url.searchParams.keys()],
      counts = new Map<string, number>();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    const parents = [...url.searchParams].filter(([key]) =>
      ['book_id', 'bookId', 'work_id', 'workId'].includes(key),
    );
    const parentBinding: ChapterVolumeRefreshEvent['query']['parentBinding'] = !parents.length
      ? 'missing_work'
      : parents.length !== 1
        ? 'ambiguous_work'
        : !/^[1-9]\d{9,29}$/.test(parents[0]![1])
          ? 'invalid_work'
          : parents[0]![1] === context.workId
            ? 'current_work'
            : 'other_work';
    let frame: ChapterVolumeRefreshEvent['frame'];
    try {
      frame = request.frame() === context.mainFrame ? 'main_frame' : 'other_frame';
    } catch {
      frame = 'unavailable';
    }
    const method = request.method(),
      resource = request.resourceType();
    return {
      event: context.event,
      method: method === 'GET' || method === 'POST' ? method : 'other',
      resourceType: ['xhr', 'fetch', 'document'].includes(resource)
        ? (resource as ChapterVolumeRefreshEvent['resourceType'])
        : 'other',
      frame,
      query: {
        knownKeys: [...new Set(keys.filter((key) => CHAPTER_GET_SAFE_KEYS.has(key)))],
        opaqueKeyCount: keys.filter((key) => !CHAPTER_GET_SAFE_KEYS.has(key)).length,
        duplicateKeys: [...counts.values()].some((count) => count > 1),
        identityFilter: keys.some((key) =>
          /^(?:author|writer|user|target|account|owner)(?:_?id)?$|^(?:uid|id)$/i.test(key),
        ),
        parentBinding,
      },
      exactUrl: raw === context.template,
      requestEpoch:
        context.requestEpoch === undefined
          ? 'unobserved'
          : context.requestEpoch === context.refreshEpoch
            ? 'current_refresh'
            : 'other_generation',
      refreshEpochCurrent: context.refreshEpoch === context.currentEpoch,
      samePage: context.samePage,
      activeSlot: context.activeSlot,
      pageOpen: context.pageOpen,
      sessionOpen: context.sessionOpen,
      signalAborted: context.signalAborted,
      strictSourceMatch: context.strictSourceMatch,
      status:
        context.status !== undefined &&
        Number.isInteger(context.status) &&
        context.status >= 100 &&
        context.status <= 599
          ? context.status
          : null,
    };
  } catch {
    return null;
  }
}

const DIAGNOSTIC_NUMERIC_READ_KEYS = new Set([
  'tab',
  'page',
  'page_index',
  'page_count',
  'book_id',
  'chapter_id',
  'work_id',
  'bookId',
  'chapterId',
  'workId',
]);

export function isDiagnosticReadQueryKey(pathname: string, key: string): boolean {
  // type was observed on the real existing-work chapter directory; it is not a generic writer filter.
  return (
    DIAGNOSTIC_NUMERIC_READ_KEYS.has(key) || (key === 'type' && isChapterDirectoryRoute(pathname))
  );
}

export function projectChapterQuerySchema(
  params: URLSearchParams,
  privateValues: readonly string[],
  pathname: string,
): ChapterRouteQuerySchema {
  const counts = new Map<string, number>();
  for (const key of params.keys()) counts.set(key, (counts.get(key) ?? 0) + 1);
  const secrets = privateValues.filter(Boolean).map((value) => value.toLowerCase());
  const entries: ChapterRouteQuerySchema['entries'] = [];
  for (const [key, value] of params) {
    if (entries.length >= 16) break;
    const allowedReadKey = isDiagnosticReadQueryKey(pathname, key);
    const safeKey =
      allowedReadKey ||
      (/^[a-z][A-Za-z_-]{0,47}$/.test(key) &&
        !/(?:cookie|token|nonce|secret|authorization|header|content|body|text|password|credential|signature)/i.test(
          key,
        ) &&
        !secrets.some((secret) => key.toLowerCase().includes(secret)));
    const valueShape = !value
      ? 'empty'
      : /^\d{1,30}$/.test(value)
        ? 'numeric'
        : /^\d+$/.test(value)
          ? 'numeric_out_of_range'
          : 'other';
    entries.push({
      key: safeKey ? key : '{opaque}',
      valueShape,
      allowedReadKey,
      rejection:
        (counts.get(key) ?? 0) > 1
          ? 'duplicate_key'
          : !allowedReadKey
            ? 'unsupported_key'
            : /^\d{1,30}$/.test(value)
              ? null
              : 'value_not_numeric',
    });
  }
  return { entries, truncated: params.size > entries.length };
}

export function validateDiagnosticSource(
  raw: string,
  discoveredStableTargets: ReadonlySet<string> = new Set(),
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BrowserSessionError(
      'invalid_diagnostic_route',
      'Diagnostic source must be an official management URL or a discovered target reference',
    );
  }
  if (url.origin !== 'https://fanqienovel.com' || url.username || url.password || url.hash)
    throw new BrowserSessionError(
      'invalid_diagnostic_route',
      'Diagnostic source must use the official platform origin without credentials or fragment',
    );
  const base = url.pathname.match(/^\/main\/writer\/([a-z-]+)\/?$/)?.[1];
  const stable =
    /^\/main\/writer\/(?:preview-short|preview-book|preview-chapter|chapter-manage|chapter-data|book-manage|book-data)\/\d{10,30}(?:\/\d{10,30})?\/?$/.test(
      url.pathname,
    ) || encodedChapterRoute(url.pathname) !== null;
  if (
    !(base && DIAGNOSTIC_BASE_ROUTES.has(base)) &&
    !(stable && discoveredStableTargets.has(`${url.origin}${url.pathname}`))
  )
    throw new BrowserSessionError(
      'invalid_diagnostic_route',
      'Only management/data routes and stable existing read links discovered on those pages may be diagnosed',
    );
  const queryKeys = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (
      queryKeys.has(key) ||
      !isDiagnosticReadQueryKey(url.pathname, key) ||
      !/^\d{1,30}$/.test(value)
    )
      throw new BrowserSessionError(
        'invalid_diagnostic_route',
        'Diagnostic query parameters must be unique numeric read filters',
      );
    queryKeys.add(key);
  }
  return url;
}
