import { loadConfig } from '../../src/config.js';

import path from 'node:path';

import { type LoginState, BrowserSession } from '../../src/platform/browser.js';

import { type Page } from 'playwright';

import assert from 'node:assert/strict';

import { createApplication } from '../../src/application.js';

import { makeDataset, type ChapterRecord } from '../../src/platform/reads.js';

export function builtinChapterApplicationFixture(directory: string) {
  const config = loadConfig({
    FANQIE_TOKEN: 'synthetic-builtin-chapter-contract-token',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  let mode: 'partial' | 'unproved' | 'mismatch' | 'late_failure' | 'outside_error' = 'partial';
  let active = false,
    oldVerifications = 0,
    collectorCalls = 0;
  const state = (id = '1001'): LoginState => ({
    status: 'authenticated',
    identity: {
      accountId: id,
      authorId: null,
      displayName: null,
      evidenceSource: 'https://fanqienovel.com/api/user/info/v2',
    },
    sourceUrl: 'https://fanqienovel.com/api/user/info/v2',
    checkedAt: new Date().toISOString(),
  });
  const page = {} as Page;
  class CurrentDirectoryBrowser extends BrowserSession {
    override async checkLogin() {
      return state();
    }
    override async withPage<T>(read: (page: Page) => Promise<T>): Promise<T> {
      assert.equal(active, false);
      active = true;
      try {
        return await read(page);
      } finally {
        active = false;
      }
    }
    override async verifyCurrentAccount(): Promise<LoginState> {
      oldVerifications++;
      throw Error(
        'The builtin must not verify after its canonical bracket through the old page fetch',
      );
    }
    override async enterCurrentChapterDirectory(): Promise<{ sourceUrl: string }> {
      throw Error('The builtin must not run the old entry or fallback');
    }
    override async collectCurrentChapterDirectory(
      current: Page,
      workId: string,
      options: Parameters<BrowserSession['collectCurrentChapterDirectory']>[2],
    ) {
      assert.equal(active, true);
      assert.equal(current, page);
      assert.match(options.jobId, /^[a-f0-9-]{36}$/);
      assert.deepEqual(options.expectedOwner, { kind: 'account', id: '1001' });
      collectorCalls++;
      if (mode === 'outside_error')
        throw Object.assign(Error('PRIVATE_EXTERNAL_ERROR'), {
          identity: { accountId: '1001' },
          verified: true,
          proof: { owner: true },
        });
      if (mode !== 'unproved')
        options.onVerifiedOwner(state(mode === 'mismatch' ? '2001' : '1001'));
      const failed = mode === 'late_failure';
      return {
        status: failed ? ('capability_unavailable' as const) : ('partial' as const),
        dataset: 'chapters',
        records: failed
          ? []
          : [
              {
                workId,
                chapterId: '7800000000000000001',
                volumeId: '7700000000000000001',
                title: 'Synthetic partial chapter',
                index: 1,
                wordCount: 1,
                articleStatusCode: 99,
                displayStatusCode: 98,
                createdAtRaw: 'unknown',
                scheduledAtRaw: '',
              },
            ],
        coverage: {
          complete: false,
          paginationComplete: false,
          pagesFetched: failed ? 0 : 1,
          pagesDiscovered: null,
          recordsFetched: failed ? 0 : 1,
          totalRecords: null,
          fields: failed ? [] : ['chapterId'],
        },
        sourceUrl: 'https://fanqienovel.com/main/writer/chapter-manage/{workId}&{title}',
        capturedAt: new Date().toISOString(),
        statisticsThrough: null,
        statisticsThroughBasis: null,
        statisticsCutoffRaw: null,
        platformUpdateSchedule: null,
        limitations: ['Synthetic current-page fixture only'],
        errors: [
          {
            code: failed ? 'read_document_changed' : 'chapter_scope_coverage_unverified',
            scope: 'chapters',
          },
        ],
      };
    }
  }
  const application = createApplication(config, {
    browser: new CurrentDirectoryBrowser({ profileDir: config.profileDir, headless: true }),
  });
  return {
    application,
    config,
    setMode(value: typeof mode) {
      mode = value;
    },
    get collectorCalls() {
      return collectorCalls;
    },
    get oldVerifications() {
      return oldVerifications;
    },
    call: () =>
      application.dispatch('POST', '/api/v1/tools/fanqie_list_chapters', new URLSearchParams(), {
        workId: '7600000000000000001',
      }) as Promise<Record<string, any>>,
  };
}

export function draftDirectoryApplicationFixture(directory: string) {
  const config = loadConfig({
    FANQIE_TOKEN: 'synthetic-chapter-draft-directory-token',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  let mode:
      | 'complete'
      | 'empty'
      | 'partial'
      | 'late_failure'
      | 'unproved'
      | 'mismatch'
      | 'outside_error' = 'complete',
    active = false,
    collections = 0;
  const state = (id = '1001'): LoginState => ({
    status: 'authenticated',
    identity: {
      accountId: id,
      authorId: null,
      displayName: null,
      evidenceSource: 'https://fanqienovel.com/api/user/info/v2',
    },
    sourceUrl: 'https://fanqienovel.com/api/user/info/v2',
    checkedAt: new Date().toISOString(),
  });
  const page = {} as Page;
  class DraftDirectoryBrowser extends BrowserSession {
    override async checkLogin() {
      return state();
    }
    override async withPage<T>(read: (page: Page) => Promise<T>): Promise<T> {
      assert.equal(active, false);
      active = true;
      try {
        return await read(page);
      } finally {
        active = false;
      }
    }
    override async collectCurrentChapterDirectory(): Promise<
      ReturnType<typeof makeDataset<ChapterRecord>>
    > {
      throw Error('The draft tool cannot call management or profile fallback');
    }
    override async collectCurrentChapterDraftDirectory(
      current: Page,
      workId: string,
      options: Parameters<BrowserSession['collectCurrentChapterDraftDirectory']>[2],
    ) {
      assert.equal(active, true);
      assert.equal(current, page);
      assert.deepEqual(options.expectedOwner, { kind: 'account', id: '1001' });
      assert.match(options.jobId, /^[a-f0-9-]{36}$/);
      collections++;
      if (mode === 'outside_error')
        throw Object.assign(Error('PRIVATE_DRAFT_EXTERNAL_ERROR'), {
          verified: true,
          identity: { accountId: '1001' },
          proof: { owner: true },
        });
      if (mode !== 'unproved')
        options.onVerifiedOwner(state(mode === 'mismatch' ? '1002' : '1001'));
      const result = makeDataset<{
        workId: string;
        draftId: string;
        title: string;
        wordCount: number;
        modifiedAtRaw: string;
        sourceScope: 'draft_list';
      }>('chapter_drafts', 'https://fanqienovel.com/main/writer/chapter-manage/{workId}&{title}');
      const failure = mode === 'late_failure',
        complete = mode === 'complete' || mode === 'empty';
      result.status = failure ? 'capability_unavailable' : complete ? 'success' : 'partial';
      result.records =
        failure || mode === 'empty'
          ? []
          : [
              {
                workId,
                draftId: '7900000000000000001',
                title: 'Synthetic draft directory',
                wordCount: 10,
                modifiedAtRaw: 'UNKNOWN_RAW_MODIFIED',
                sourceScope: 'draft_list',
              },
            ];
      result.coverage = {
        complete,
        paginationComplete: complete,
        pagesFetched: failure ? 0 : 1,
        pagesDiscovered: complete ? 1 : null,
        recordsFetched: result.records.length,
        totalRecords: failure ? null : mode === 'empty' ? 0 : mode === 'partial' ? 2 : 1,
        fields: failure
          ? []
          : ['workId', 'draftId', 'title', 'wordCount', 'modifiedAtRaw', 'sourceScope'],
      };
      if (!complete)
        result.errors.push({
          code: failure ? 'read_document_changed' : 'chapter_draft_next_unavailable',
          scope: 'chapter_drafts',
        });
      return result;
    }
  }
  const application = createApplication(config, {
    browser: new DraftDirectoryBrowser({ profileDir: config.profileDir, headless: true }),
  });
  const scope = 'chapter_drafts.7600000000000000001';
  return {
    application,
    config,
    scope,
    setMode(value: typeof mode) {
      mode = value;
    },
    get collections() {
      return collections;
    },
    call: () =>
      application.dispatch(
        'POST',
        '/api/v1/tools/fanqie_list_chapter_drafts',
        new URLSearchParams(),
        { workId: '7600000000000000001' },
      ) as Promise<Record<string, any>>,
    snapshot: () =>
      application.dispatch(
        'GET',
        '/api/v1/snapshot',
        new URLSearchParams({ scope }),
        undefined,
      ) as Promise<Record<string, any>>,
  };
}
