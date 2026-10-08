import {
  type DatasetResult,
  isMetricsDataset,
  metricTimeContext,
  MISSING_CUTOFF_YEAR_BASIS,
} from './is-metrics-dataset.js';

import { resolveShortManagementLabels } from '../short-status.js';

import { FANQIE_ORIGIN } from './fanqie-origin.js';

export class PlatformReadError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PlatformReadError';
  }
}

export function makeDataset<T = Record<string, unknown>>(
  dataset: string,
  sourceUrl: string | null,
  records: T[] = [],
): DatasetResult<T> {
  return {
    status: 'capability_unavailable',
    dataset,
    records,
    sourceUrl,
    capturedAt: new Date().toISOString(),
    coverage: {
      complete: false,
      paginationComplete: false,
      pagesFetched: 0,
      pagesDiscovered: null,
      recordsFetched: records.length,
      totalRecords: null,
      fields: [],
    },
    statisticsThrough: null,
    statisticsThroughBasis: null,
    statisticsCutoffRaw: null,
    platformUpdateSchedule: null,
    limitations: [],
    errors: [],
    ...(isMetricsDataset(dataset) ? metricTimeContext() : {}),
  };
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value === 'string' && !/^\s*\d+(?:\.\d+)?\s*$/.test(value)) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function identifierOrNull(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{1,30}$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  return null;
}

/** A snapshot capture time is not a platform statistics deadline. */
export function parseVisibleStatistics(
  text: string,
  capturedAt = new Date().toISOString(),
): Pick<
  DatasetResult,
  'statisticsThrough' | 'statisticsThroughBasis' | 'statisticsCutoffRaw' | 'platformUpdateSchedule'
> {
  const cutoff = text.match(
    /(?:截止至?|截至)\s*(?:(\d{4})\s*[-年/.]\s*)?(\d{1,2})\s*[-月/.]\s*(\d{1,2})日?\s*(?:24:00|23:59)?/,
  );
  const update = text.match(/每天\s*\d{1,2}:\d{2}\s*(?:更新|刷新)/)?.[0] ?? null;
  const unknown = {
    statisticsThrough: null,
    statisticsThroughBasis: null,
    statisticsCutoffRaw: cutoff?.[0] ?? null,
    platformUpdateSchedule: update,
  };
  if (!cutoff) return unknown;
  const month = Number(cutoff[2]);
  const day = Number(cutoff[3]);
  if (!cutoff[1]) {
    // February 29 is a possible month/day. No reference year is selected or returned.
    const possibleDays = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > possibleDays[month - 1]!) return unknown;
    return { ...unknown, statisticsThroughBasis: MISSING_CUTOFF_YEAR_BASIS };
  }
  if (!Number.isFinite(Date.parse(capturedAt))) return unknown;
  const captureDate = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(capturedAt));
  const year = Number(cutoff[1]);
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const valid = new Date(`${date}T00:00:00Z`);
  if (
    year < 2000 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    !Number.isFinite(valid.getTime()) ||
    valid.toISOString().slice(0, 10) !== date ||
    date > captureDate
  )
    return unknown;
  return {
    statisticsThrough: date,
    statisticsThroughBasis: 'platform-visible-cutoff',
    statisticsCutoffRaw: cutoff[0],
    platformUpdateSchedule: update,
  };
}

export function normalizeShortStatus(tags: string[]) {
  const statusFacts = resolveShortManagementLabels(tags);
  const labels = tags.map((tag) => tag.trim());
  const signingStatus = labels.includes('已签约')
    ? 'signed'
    : labels.some((label) => /^签约.*(?:审核|处理中)/.test(label))
      ? 'reviewing'
      : labels.includes('未签约')
        ? 'not_signed'
        : 'unknown';
  return { signingStatus, publicationStatus: statusFacts.resolvedState, statusFacts };
}

export interface ReadOptions {
  maxPages?: number;
  timeoutMs?: number;
  workId?: string;
}

export interface ReadResponseStructure {
  pathTemplate: string;
  status: number;
  fields: Array<{
    path: string;
    type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  }>;
  truncated: boolean;
}

/** Only these GET paths have been observed by the operator on the platform's actual read pages. */
export function isChapterReadSchemaSource(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.origin === FANQIE_ORIGIN &&
      !url.username &&
      !url.password &&
      !url.hash &&
      new Set([
        '/api/author/volume/volume_list/v1',
        '/api/author/chapter/chapter_list/v1',
        '/api/author/book/book_detail/v0/',
      ]).has(url.pathname)
    );
  } catch {
    return false;
  }
}

export function isReadSchemaSource(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.origin === FANQIE_ORIGIN &&
      !url.username &&
      !url.password &&
      (/^\/api\/author\/(?:book\/book_list|homepage\/book_list|short_article\/list|sa_stats\/(?:book_list|single_common|single_by_date))\/v0\/$/.test(
        url.pathname,
      ) ||
        isChapterReadSchemaSource(raw))
    );
  } catch {
    return false;
  }
}
