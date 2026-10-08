import { type ReadResponseStructure, type ReadOptions, PlatformReadError } from './make-dataset.js';

import { FANQIE_ORIGIN } from './fanqie-origin.js';

import { type Page } from 'playwright';

import { type ShortStatusFactsV1 } from '../short-status.js';

/** Fixed field paths/types only, including bounded array-item shapes; no value or dynamic map key is emitted. */
export function projectReadResponseFields(
  value: unknown,
): Pick<ReadResponseStructure, 'fields' | 'truncated'> {
  const allowed = new Set([
    'code',
    'message',
    'msg',
    'data',
    'result',
    'status',
    'success',
    'total',
    'totalcount',
    'count',
    'hasmore',
    'more',
    'page',
    'pageindex',
    'pagecount',
    'pagesize',
    'nextpage',
    'nextcursor',
    'cursor',
    'list',
    'items',
    'books',
    'booklist',
    'statsbooklist',
    'articlelist',
    'shortarticlelist',
    'chapters',
    'chapterlist',
    'volumes',
    'volumelist',
    'itemlist',
    'itemcount',
    'itemid',
    'itemname',
    'itemtitle',
    'displaystatus',
    'timertime',
    'chapterorder',
    'volumeorder',
    'order',
    'index',
    'isdefault',
    'modifytime',
    'audittime',
    'verifytime',
    'id',
    'bookid',
    'workid',
    'articleid',
    'chapterid',
    'volumeid',
    'bookname',
    'workname',
    'articlename',
    'chaptername',
    'volumename',
    'name',
    'title',
    'booktype',
    'category',
    'creationstatus',
    'bookstatus',
    'articlestatus',
    'chapterstatus',
    'serialstatus',
    'signstatus',
    'contractstatus',
    'publicationstatus',
    'wordcount',
    'wordnumber',
    'wordnum',
    'chaptercount',
    'chapternumber',
    'readcount',
    'showcount',
    'clickrate',
    'commentcount',
    'diggcount',
    'shelfcount',
    'createat',
    'createdat',
    'createtime',
    'updateat',
    'updatedat',
    'updatetime',
    'publishtime',
    'lastchaptertime',
    'lastchapterid',
    'lastchaptername',
    'cover',
    'coverurl',
    'date',
    'time',
    'statdate',
    'statisticsdate',
    'statisticsthrough',
    'startdate',
    'enddate',
  ]);
  const fields: ReadResponseStructure['fields'] = [];
  const seen = new Set<string>();
  let truncated = false;
  const walk = (object: unknown, prefix: string, depth: number): void => {
    if (!object || typeof object !== 'object' || Array.isArray(object)) return;
    if (depth > 5) {
      truncated = true;
      return;
    }
    for (const key of Object.keys(object)) {
      if (
        !/^[A-Za-z_][A-Za-z_]{0,63}$/.test(key) ||
        !allowed.has(key.replace(/_/g, '').toLowerCase())
      )
        continue;
      const nested = (object as Record<string, unknown>)[key];
      const type = nested === null ? 'null' : Array.isArray(nested) ? 'array' : typeof nested;
      if (!['object', 'array', 'string', 'number', 'boolean', 'null'].includes(type)) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      const signature = `${path}:${type}`;
      if (!seen.has(signature)) {
        if (fields.length >= 160) {
          truncated = true;
          return;
        }
        seen.add(signature);
        fields.push({ path, type: type as ReadResponseStructure['fields'][number]['type'] });
      }
      if (type === 'object') walk(nested, path, depth + 1);
      if (type === 'array') {
        const items = nested as unknown[];
        if (items.length > 10) truncated = true;
        for (const item of items.slice(0, 10)) walk(item, `${path}[]`, depth + 1);
      }
    }
  };
  walk(value, '', 0);
  return { fields, truncated };
}

export function pageLimit(options: ReadOptions): number {
  return Math.max(1, Math.min(100, options.maxPages ?? 100));
}

export function allowedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw, FANQIE_ORIGIN);
  } catch {
    throw new PlatformReadError('invalid_source_url', 'Invalid platform read URL');
  }
  if (url.origin !== FANQIE_ORIGIN || url.username || url.password)
    throw new PlatformReadError('invalid_source_url', 'Read source must be on fanqienovel.com');
  return url;
}

export async function inspectPageAccess(
  page: Page,
): Promise<{ loginRequired: boolean; text: string }> {
  return page.evaluate(() => {
    const text = document.body?.innerText ?? '';
    return {
      text,
      loginRequired:
        /扫码登录|手机号登录|验证码登录|登录后(?:查看|使用)/.test(text) ||
        /\/(?:login|passport)(?:\/|$)/.test(location.pathname),
    };
  });
}

export async function navigate(page: Page, sourceUrl: string, timeoutMs = 20_000): Promise<void> {
  allowedUrl(sourceUrl);
  await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page
    .waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 4_000) })
    .catch(() => undefined);
}

export interface ShortWork {
  workId: string;
  title: string;
  managementUrl: string;
  statusTags: string[];
  signingStatus: string;
  publicationStatus: string;
  statusFacts: ShortStatusFactsV1;
  readCount: number | null;
  wordCount: number | null;
  updatedAtRaw: string | null;
}

interface ShortDomPage {
  cards: Array<{
    workId: string;
    title: string;
    managementUrl: string;
    statusTags: string[];
    readCountRaw: string;
    wordCountRaw: string;
    updatedAtRaw: string;
  }>;
  pageNumbers: number[];
  activePage: number | null;
  emptyVisible: boolean;
}

export async function shortDom(page: Page): Promise<ShortDomPage> {
  return page.evaluate(() => {
    const cards = [
      ...document.querySelectorAll<HTMLAnchorElement>('a[href*="/main/writer/preview-short/"]'),
    ].map((card) => {
      const text = (selector: string) => card.querySelector(selector)?.textContent?.trim() ?? '';
      return {
        workId: card.getAttribute('href')?.match(/preview-short\/(\d{10,30})/)?.[1] ?? '',
        title: text('.article-item-title'),
        managementUrl: card.href.split('?')[0]!,
        statusTags: [...card.querySelectorAll('.article-item-tags span')]
          .map((element) => element.textContent?.trim() ?? '')
          .filter(Boolean),
        readCountRaw: text('.article-item-read'),
        wordCountRaw: text('.article-item-number'),
        updatedAtRaw: text('.article-item-time'),
      };
    });
    const controls = [...document.querySelectorAll('li[aria-label^="第 "][aria-label$=" 页"]')];
    const pageNumbers = controls
      .map((item) => Number(item.getAttribute('aria-label')?.match(/\d+/)?.[0]))
      .filter((n) => Number.isInteger(n) && n > 0);
    const activePage = controls
      .find((item) => item.classList.contains('arco-pagination-item-active'))
      ?.getAttribute('aria-label')
      ?.match(/\d+/)?.[0];
    // Empty text alone elsewhere on the page does not certify an empty account.
    const emptyVisible = [...document.querySelectorAll('.arco-empty')].some(
      (element) =>
        /暂无|没有|空/.test(element.textContent ?? '') &&
        (element as HTMLElement).getBoundingClientRect().height > 0,
    );
    return { cards, pageNumbers, activePage: activePage ? Number(activePage) : null, emptyVisible };
  });
}
