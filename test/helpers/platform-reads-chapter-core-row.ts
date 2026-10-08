import {
  type ChapterFixtureSource,
  CHAPTER_ENTRY_FIXTURE_WORK,
  CHAPTER_ENTRY_FIXTURE_TITLE,
} from './platform-reads-chapter-entry-fixture-work.js';

import {
  type ChapterApiEvidencePlan,
  parseCandidateChapterVolumes,
  collectChapters,
} from '../../src/platform/reads.js';

import { metricsPage } from './platform-reads-metrics-page.js';

import assert from 'node:assert/strict';

import { runInNewContext } from 'node:vm';

import { type Page } from 'playwright';

export const CHAPTER_SCHEMA_FIXTURE_SOURCES: ChapterFixtureSource[] = [
  {
    url: `https://fanqienovel.com/api/author/volume/volume_list/v1?book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&nonce=PRIVATE_VOLUME_NONCE`,
    json: {
      code: 0,
      data: {
        volume_list: [
          { volume_id: '7600000000000000101', volume_name: 'PRIVATE_VOLUME_NAME', item_count: 1 },
        ],
      },
    },
  },
  {
    url: `https://fanqienovel.com/api/author/chapter/chapter_list/v1?book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&volume_id=7600000000000000101&page_index=0&page_count=20&nonce=PRIVATE_CHAPTER_NONCE`,
    json: {
      code: 0,
      data: {
        total_count: 1,
        item_list: [
          {
            item_id: '7600000000000000201',
            article_id: '7600000000000000202',
            book_id: CHAPTER_ENTRY_FIXTURE_WORK,
            volume_id: '7600000000000000101',
            item_name: 'PRIVATE_CHAPTER_NAME',
            article_status: 2,
            display_status: 1,
            timer_time: 0,
            create_time: 1234567890,
            word_number: 100,
            body: { item_id: 'PRIVATE_BODY_ID' },
            content: { chapter_id: 'PRIVATE_CONTENT_ID' },
            token: 'PRIVATE_TOKEN',
            PRIVATE_DYNAMIC_KEY: 'PRIVATE_DYNAMIC_VALUE',
            '7600000000000000301': { title: 'PRIVATE_MAPPED_TITLE' },
          },
        ],
      },
    },
  },
  {
    url: `https://fanqienovel.com/api/author/book/book_detail/v0/?book_id=${CHAPTER_ENTRY_FIXTURE_WORK}`,
    json: {
      code: 0,
      data: {
        book_id: CHAPTER_ENTRY_FIXTURE_WORK,
        book_name: CHAPTER_ENTRY_FIXTURE_TITLE,
        chapter_number: 1,
        status: 1,
        content: 'PRIVATE_BOOK_CONTENT',
      },
    },
  },
];

export const CHAPTER_CORE_WORK = '7600000000000000100';

export const CHAPTER_CORE_VOLUME_A = '7600000000000000201';

export const CHAPTER_CORE_VOLUME_B = '7600000000000000202';

export function chapterCoreRow(
  id: string,
  volume = CHAPTER_CORE_VOLUME_A,
  overrides: Record<string, unknown> = {},
) {
  return {
    item_id: id,
    volume_id: volume,
    index: 0,
    title: 'SYNTHETIC_CHAPTER_TITLE',
    display_status: 917,
    article_status: -8,
    create_time: 'PRIVATE_RAW_CREATE_TIME',
    timer_time: '',
    word_number: 0,
    body: 'PRIVATE_BODY_MUST_NOT_RETURN',
    ...overrides,
  };
}

export function chapterCoreEnvelope(rows: unknown[], total: unknown) {
  return { code: 0, data: { total_count: total, item_list: rows } };
}

export const CHAPTER_CORE_PLAN: ChapterApiEvidencePlan = {
  verifiedAt: '2026-10-03',
  evidence: 'Synthetic fixture; not current platform verification',
  allStatesEvidence: 'Synthetic explicit complete-state fixture proof',
  parentQueryKeys: { volumes: 'book_id', chapters: 'book_id', book: 'book_id' },
  volumeQueryKey: 'volume_id',
  pageIndexQueryKey: 'page_index',
  firstPageIndex: 0,
  parseVolumes: parseCandidateChapterVolumes,
};

export function chapterCoreFixture(
  options: {
    volumes?: Array<{ volume_id: unknown; item_count: unknown }>;
    pages?: Record<string, unknown[]>;
    plan?: ChapterApiEvidencePlan;
    sources?: string[];
    sourceMethod?: string;
    oldSources?: boolean;
    book?: unknown;
    finalVolumes?: unknown;
    loginAt?: number;
    navigateAt?: number;
    bootstrapQuery?: boolean;
  } = {},
) {
  const volumeUrl = `https://fanqienovel.com/api/author/volume/volume_list/v1?book_id=${CHAPTER_CORE_WORK}&nonce=PRIVATE_SOURCE_NONCE`;
  const bookUrl = `https://fanqienovel.com/api/author/book/book_detail/v0/?book_id=${CHAPTER_CORE_WORK}`;
  const chapterUrl = `https://fanqienovel.com/api/author/chapter/chapter_list/v1?book_id=${CHAPTER_CORE_WORK}&volume_id=${CHAPTER_CORE_VOLUME_A}&page_index=0&page_count=2&opaque=PRIVATE_ACTUAL_QUERY`;
  const volumes = {
    code: 0,
    data: { volume_list: options.volumes ?? [{ volume_id: CHAPTER_CORE_VOLUME_A, item_count: 1 }] },
  };
  const sources = options.sources ?? [volumeUrl, bookUrl, chapterUrl];
  const fixture = metricsPage([]);
  const calls: string[] = [];
  let volumeReads = 0;
  fixture.page.evaluate = (async (callback: unknown, raw?: unknown) => {
    if (typeof raw !== 'string') return { loginRequired: false, text: '章节管理' };
    const url = new URL(raw);
    calls.push(raw);
    if (options.navigateAt === calls.length) {
      fixture.setUrl(`${fixture.page.url()}&changed=1`);
      fixture.emitEvent('framenavigated', null);
    }
    const response =
      options.loginAt === calls.length
        ? { status: 401, ok: false, json: {} }
        : {
            status: 200,
            ok: true,
            json: url.pathname.includes('/volume/')
              ? ++volumeReads > 1 && options.finalVolumes
                ? options.finalVolumes
                : volumes
              : url.pathname.includes('/book_detail/')
                ? (options.book ?? {
                    code: 0,
                    data: { book_id: CHAPTER_CORE_WORK, book_name: 'SYNTHETIC_WORK_TITLE' },
                  })
                : (options.pages?.[url.searchParams.get('volume_id')!]?.[
                    Number(url.searchParams.get('page_index'))
                  ] ?? chapterCoreEnvelope([chapterCoreRow('7600000000000000301')], 1)),
          };
    const source = String(callback);
    const production = new URL('../platform-reads.test.ts', import.meta.url).href.endsWith('.js');
    if (production) assert.equal(source.includes('__name'), false);
    return runInNewContext(`(${source})(sourceUrl)`, {
      sourceUrl: raw,
      fetch: async (input: string, init: Record<string, unknown>) => {
        assert.equal(input, raw);
        assert.equal(init.method, 'GET');
        assert.equal(init.redirect, 'error');
        return { status: response.status, ok: response.ok, json: async () => response.json };
      },
      ...(production ? {} : { __name: (value: unknown) => value }),
    });
  }) as Page['evaluate'];
  const enterDirectory = async (page: Page) => {
    const old = sources.map((url) => ({
      url: () => url,
      method: () => options.sourceMethod ?? 'GET',
      isNavigationRequest: () => false,
      frame: () => null,
    }));
    if (options.oldSources) for (const request of old) fixture.emitEvent('request', request);
    await page.goto(`https://fanqienovel.com/main/writer/chapter-manage/${CHAPTER_CORE_WORK}`);
    for (const [index, url] of sources.entries()) {
      if (options.oldSources)
        fixture.emitEvent('response', { url: () => url, request: () => old[index] });
      else fixture.emitResponse(url, options.sourceMethod);
    }
    if (options.bootstrapQuery) {
      fixture.setUrl(`${page.url()}?type=1`);
      fixture.emitEvent('framenavigated', null);
    }
    return { sourceUrl: 'https://fanqienovel.com/main/writer/chapter-manage/{workId}' };
  };
  return {
    ...fixture,
    calls,
    volumeUrl,
    bookUrl,
    chapterUrl,
    collect: (extra: Record<string, unknown> = {}) =>
      collectChapters(fixture.page, {
        workId: CHAPTER_CORE_WORK,
        enterDirectory,
        apiPlan: options.plan ?? CHAPTER_CORE_PLAN,
        ...extra,
      }),
  };
}
