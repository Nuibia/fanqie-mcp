import { createHash } from 'node:crypto';
import { type Page } from 'playwright';
import { FANQIE_ORIGIN, makeDataset, type DatasetResult, PlatformReadError } from './reads.js';

export const ACTIVITIES_URL = `${FANQIE_ORIGIN}/writer/zone/solicit-activity`;
export const CLASSES_URL = `${FANQIE_ORIGIN}/writer/zone/tutorial`;
export const CLASS_TABS = {
  1: '新手专区',
  2: '大神专访',
  3: '写作技巧',
  4: '品类指南',
  5: '平台宝典',
} as const;
export type PublicFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface PublicReadOptions {
  fetchImpl?: PublicFetch;
  signal?: AbortSignal;
  /** Deadline for the whole collection, not each page. */ timeoutMs?: number;
  maxPages?: number;
  tab?: number;
}

function publicDeadline(options: PublicReadOptions): PublicReadOptions {
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1)
    throw new PlatformReadError('invalid_timeout', 'Public collection timeout must be positive');
  const deadline = AbortSignal.timeout(timeoutMs);
  return {
    ...options,
    signal: options.signal ? AbortSignal.any([options.signal, deadline]) : deadline,
  };
}
function publicFailure(error: unknown, signal?: AbortSignal): string {
  if (signal?.aborted)
    return signal.reason instanceof Error && signal.reason.name === 'TimeoutError'
      ? 'timeout'
      : 'cancelled';
  return error instanceof PlatformReadError ? error.code : 'public_read_failed';
}

function canonicalPublicContent(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, (item as Record<string, unknown>)[key]]),
        )
      : item,
  );
}
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
/** A digest of returned normalized records only; it does not extend coverage or read embedded media. */
function finishPublicResult<T>(
  result: DatasetResult<T>,
  compare?: (left: T, right: T) => number,
): DatasetResult<T> {
  const records = compare ? [...result.records].sort(compare) : result.records;
  result.contentFingerprint =
    result.status === 'success' &&
    result.coverage.complete &&
    result.coverage.paginationComplete &&
    result.errors.length === 0
      ? createHash('sha256').update(canonicalPublicContent(records)).digest('hex')
      : null;
  return result;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function officialLink(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value, FANQIE_ORIGIN);
    return url.origin === FANQIE_ORIGIN && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseRouterPage(html: string, route: string): Record<string, unknown> | null {
  const match = html.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  if (!match) return null;
  try {
    const root = object(JSON.parse(match[1]!));
    const loader = object(root?.loaderData);
    if (!loader) return null;
    const routeKey = Object.keys(loader).find((key) => key.includes(route));
    return routeKey ? object(loader[routeKey]) : null;
  } catch {
    return null;
  }
}

async function readPublic(url: string, options: PublicReadOptions): Promise<Response> {
  options.signal?.throwIfAborted();
  const source = new URL(url);
  if (source.origin !== FANQIE_ORIGIN || source.username || source.password)
    throw new PlatformReadError('invalid_public_url', 'Public source must be on fanqienovel.com');
  const response = await (options.fetchImpl ?? fetch)(url, {
    method: 'GET',
    redirect: 'error',
    signal: options.signal
      ? AbortSignal.any([
          options.signal,
          AbortSignal.timeout(Math.min(options.timeoutMs ?? 20_000, 20_000)),
        ])
      : AbortSignal.timeout(Math.min(options.timeoutMs ?? 20_000, 20_000)),
    headers: { Accept: 'text/html,application/json', 'User-Agent': 'fanqie-mcp/0.1 public-reader' },
  });
  if (!response.ok)
    throw new PlatformReadError(
      'public_http_error',
      `Public source returned HTTP ${response.status}`,
    );
  if (response.url && new URL(response.url).origin !== FANQIE_ORIGIN)
    throw new PlatformReadError('public_origin_changed', 'Public source origin changed');
  return response;
}

export interface PublicActivity {
  title: string;
  url: string;
  introduction: string[];
  publishedAtRaw: string | number | null;
  publicationDateUnavailableReason: 'activity_card_publication_date_unverified' | null;
  startTimeRaw: string | number | null;
  endTimeRaw: string | number | null;
  isPermanent: boolean | null;
}

export function parseActivitiesPage(
  html: string,
): { total: number; records: PublicActivity[]; invalidRecords: number } | null {
  const page = parseRouterPage(html, 'solicit-activity');
  if (
    !page ||
    !Array.isArray(page.activity_list) ||
    typeof page.total_count !== 'number' ||
    !Number.isSafeInteger(page.total_count) ||
    page.total_count < 0
  )
    return null;
  const records: PublicActivity[] = [];
  let invalidRecords = 0;
  for (const raw of page.activity_list) {
    const row = object(raw);
    const title = string(row?.title);
    const url = officialLink(row?.link);
    if (!row || !title || !url) {
      invalidRecords += 1;
      continue;
    }
    const rawTime = (value: unknown) =>
      typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
        ? value
        : null;
    records.push({
      title,
      url,
      publishedAtRaw: null,
      publicationDateUnavailableReason: 'activity_card_publication_date_unverified',
      introduction: Array.isArray(row.introduction)
        ? row.introduction.filter((line): line is string => typeof line === 'string')
        : [],
      startTimeRaw: rawTime(row.start_time),
      endTimeRaw: rawTime(row.end_time),
      isPermanent: typeof row.is_permanent === 'boolean' ? row.is_permanent : null,
    });
  }
  return { total: page.total_count, records, invalidRecords };
}

/** Public requests deliberately do not use the authenticated browser's cookies. */
export async function collectPublicActivities(
  _page?: Page,
  options: PublicReadOptions = {},
): Promise<DatasetResult<PublicActivity>> {
  const result = makeDataset<PublicActivity>('public_activities', ACTIVITIES_URL);
  result.contentFingerprint = null;
  try {
    options = publicDeadline(options);
    options.signal?.throwIfAborted();
    const parsed = parseActivitiesPage(await (await readPublic(ACTIVITIES_URL, options)).text());
    if (!parsed) {
      result.errors.push({ code: 'activities_ssr_unrecognized', scope: 'activities' });
      return result;
    }
    result.records = parsed.records;
    result.coverage = {
      complete: parsed.records.length === parsed.total && parsed.invalidRecords === 0,
      paginationComplete: parsed.records.length === parsed.total && parsed.invalidRecords === 0,
      pagesFetched: 1,
      pagesDiscovered: null,
      recordsFetched: parsed.records.length,
      totalRecords: parsed.total,
      fields: [
        'title',
        'url',
        'introduction',
        'publishedAtRaw',
        'publicationDateUnavailableReason',
        'startTimeRaw',
        'endTimeRaw',
        'isPermanent',
      ],
    };
    result.status = result.coverage.complete ? 'success' : 'partial';
    if (!result.coverage.complete)
      result.errors.push({ code: 'activity_count_mismatch', scope: 'activities' });
    result.limitations.push(
      'Only activities present in the official current list are returned; card metadata does not establish all entry conditions or rewards.',
      'Raw platform dates are preserved; permanent activity status is not inferred from an end date.',
      'Activity card publication dates have not been verified. publishedAtRaw remains null with an explicit reason; start/end times and capturedAt do not establish publication dates.',
    );
  } catch (error) {
    result.errors.push({ code: publicFailure(error, options.signal), scope: 'activities' });
    if (options.signal?.aborted) result.status = 'partial';
  }
  return finishPublicResult(
    result,
    (left, right) =>
      compareText(left.url, right.url) ||
      compareText(canonicalPublicContent(left), canonicalPublicContent(right)),
  );
}

export interface WriterClass {
  articleId: string;
  title: string;
  url: string;
  tab: number;
  tabName: string;
  publishedAtRaw: string | number | null;
  isVideo: boolean | number | null;
}

export function parseClassRecord(value: unknown, tab: number): WriterClass | null {
  const row = object(value);
  const title = string(row?.title);
  const url = officialLink(row?.link);
  const articleId = url?.match(/\/writer\/zone\/article\/(\d{15,30})(?:[/?#]|$)/)?.[1];
  if (!row || !title || !url || !articleId || !(tab in CLASS_TABS)) return null;
  const time = row.create_time ?? row.time;
  return {
    articleId,
    title,
    url,
    tab,
    tabName: CLASS_TABS[tab as keyof typeof CLASS_TABS],
    publishedAtRaw:
      typeof time === 'string' || (typeof time === 'number' && Number.isFinite(time)) ? time : null,
    isVideo:
      typeof row.is_video === 'boolean' || typeof row.is_video === 'number' ? row.is_video : null,
  };
}

export function parseTutorialPage(html: string): { total: number; list: unknown[] } | null {
  const page = parseRouterPage(html, 'tutorial');
  if (
    !page ||
    !Array.isArray(page.tutorial_list) ||
    typeof page.total_count !== 'number' ||
    !Number.isSafeInteger(page.total_count) ||
    page.total_count < 0
  )
    return null;
  return { total: page.total_count, list: page.tutorial_list };
}

export async function collectWriterClasses(
  _page?: Page,
  options: PublicReadOptions = {},
): Promise<DatasetResult<WriterClass>> {
  const result = makeDataset<WriterClass>(
    'writer_classes',
    options.tab ? `${CLASSES_URL}?tab=${options.tab}` : CLASSES_URL,
  );
  result.contentFingerprint = null;
  try {
    options = publicDeadline(options);
  } catch (error) {
    result.errors.push({ code: publicFailure(error), scope: 'classes' });
    return result;
  }
  const tabs = options.tab === undefined ? [1, 2, 3, 4, 5] : [options.tab];
  if (tabs.some((tab) => !(tab in CLASS_TABS))) {
    result.errors.push({ code: 'invalid_class_tab', scope: 'classes' });
    return result;
  }
  let total = 0;
  let allComplete = true;
  let allTotalsKnown = true;
  const fields = ['articleId', 'title', 'url', 'tab', 'tabName', 'publishedAtRaw', 'isVideo'];
  for (const tab of tabs) {
    if (options.signal?.aborted) {
      allComplete = false;
      allTotalsKnown = false;
      result.errors.push({ code: 'cancelled', scope: 'classes' });
      break;
    }
    const merged = new Map<string, WriterClass>();
    let declaredTotal: number | null = null;
    try {
      const parsed = parseTutorialPage(
        await (await readPublic(`${CLASSES_URL}?tab=${tab}`, options)).text(),
      );
      if (!parsed)
        throw new PlatformReadError('classes_ssr_unrecognized', 'Class SSR structure changed');
      total += parsed.total;
      declaredTotal = parsed.total;
      result.coverage.pagesFetched += 1;
      let invalid = false;
      for (const raw of parsed.list) {
        const item = parseClassRecord(raw, tab);
        if (item) merged.set(item.articleId, item);
        else invalid = true;
      }
      const pageCount = 15;
      const expectedPages = Math.ceil(parsed.total / pageCount) + 1;
      const maxPages = Math.max(1, Math.min(100, options.maxPages ?? expectedPages));
      let ended = parsed.total === 0;
      for (let index = 1; !ended && index <= Math.min(maxPages, expectedPages); index += 1) {
        options.signal?.throwIfAborted();
        const url = `${FANQIE_ORIGIN}/api/node/tutorial/list?type=${tab}&page_index=${index}&page_count=${pageCount}`;
        const payload = object(await (await readPublic(url, options)).json());
        const data = object(payload?.data);
        if (
          !Array.isArray(data?.tutorial_list) ||
          (payload?.code !== undefined && payload.code !== 0)
        )
          throw new PlatformReadError(
            'classes_api_unrecognized',
            'Class list API structure changed',
          );
        result.coverage.pagesFetched += 1;
        for (const raw of data.tutorial_list) {
          const item = parseClassRecord(raw, tab);
          if (item) merged.set(item.articleId, item);
          else invalid = true;
        }
        ended = data.tutorial_list.length < pageCount;
      }
      if (!ended || merged.size !== parsed.total || invalid) {
        allComplete = false;
        result.errors.push({
          code: 'class_count_or_pagination_mismatch',
          scope: `classes-tab-${tab}`,
        });
      }
    } catch (error) {
      allComplete = false;
      if (declaredTotal === null) allTotalsKnown = false;
      result.errors.push({
        code: publicFailure(error, options.signal),
        scope: `classes-tab-${tab}`,
      });
    } finally {
      result.records.push(...merged.values());
    }
  }
  result.coverage.complete = result.coverage.paginationComplete = allComplete;
  result.coverage.recordsFetched = result.records.length;
  result.coverage.totalRecords = allTotalsKnown ? total : null;
  result.coverage.fields = fields;
  result.status = allComplete
    ? 'success'
    : result.records.length || options.signal?.aborted
      ? 'partial'
      : 'capability_unavailable';
  result.limitations.push(
    'Publication timestamps are preserved in their original representation; capture time does not refresh an old article.',
    'SSR pinned cards are merged by article ID with the public paginated API; coverage is checked against the platform total for each tab.',
  );
  return finishPublicResult(
    result,
    (left, right) => left.tab - right.tab || compareText(left.articleId, right.articleId),
  );
}

function decodeEntities(value: string): string {
  const names: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, key: string) => {
    if (!key.startsWith('#')) return names[key.toLowerCase()] ?? whole;
    const n = key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
  });
}
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[\t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}
export interface WriterArticle {
  articleId: string;
  title: string;
  url: string;
  publishedAtRaw: string | number | null;
  contentText: string;
  imageUrls: string[];
}
export async function collectWriterArticle(
  articleId: string,
  options: PublicReadOptions = {},
): Promise<DatasetResult<WriterArticle>> {
  const result = makeDataset<WriterArticle>(
    'writer_article',
    /^\d{15,30}$/.test(articleId) ? `${FANQIE_ORIGIN}/writer/zone/article/${articleId}` : null,
  );
  result.contentFingerprint = null;
  if (!result.sourceUrl) {
    result.errors.push({ code: 'invalid_article_id', scope: 'article' });
    return result;
  }
  try {
    options = publicDeadline(options);
    options.signal?.throwIfAborted();
    const page = parseRouterPage(
      await (await readPublic(result.sourceUrl, options)).text(),
      'article',
    );
    if (!page || !string(page.title) || typeof page.content !== 'string')
      throw new PlatformReadError('article_ssr_unrecognized', 'Article SSR structure changed');
    const images = [...page.content.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)]
      .map((match) => decodeEntities(match[1]!))
      .filter((url) => /^https:\/\//i.test(url));
    const time = page.create_time ?? page.time;
    result.records = [
      {
        articleId,
        title: string(page.title)!,
        url: result.sourceUrl,
        publishedAtRaw:
          typeof time === 'string' || (typeof time === 'number' && Number.isFinite(time))
            ? time
            : null,
        contentText: htmlToText(page.content),
        imageUrls: [...new Set(images)],
      },
    ];
    result.coverage = {
      complete: true,
      paginationComplete: true,
      pagesFetched: 1,
      pagesDiscovered: 1,
      recordsFetched: 1,
      totalRecords: 1,
      fields: ['articleId', 'title', 'url', 'publishedAtRaw', 'contentText', 'imageUrls'],
    };
    result.status = 'success';
    result.limitations.push(
      'Text does not transcribe embedded images or videos. Their missing content must not be treated as collected guidance.',
    );
  } catch (error) {
    result.errors.push({ code: publicFailure(error, options.signal), scope: 'article' });
    if (options.signal?.aborted) result.status = 'partial';
  }
  return finishPublicResult(result);
}
