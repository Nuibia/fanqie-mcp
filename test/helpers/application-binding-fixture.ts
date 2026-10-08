import { type LoginState, BrowserSession } from '../../src/platform/browser.js';

import { loadConfig } from '../../src/config.js';

import path from 'node:path';

import assert from 'node:assert/strict';

import { createApplication } from '../../src/application.js';

import { type Job } from '../../src/runtime/store.js';

import {
  type CollectionEvidenceProfile,
  makeDataset,
  type ChapterRecord,
} from '../../src/platform/reads.js';

import { writeFileSync } from 'node:fs';

import { type Page } from 'playwright';

import { genericDirectoryPhaseFixture } from './application-generic-directory-phase-fixture.js';

export function bindingFixture(
  directory: string,
  identities: Array<Pick<NonNullable<LoginState['identity']>, 'accountId' | 'authorId'>>,
) {
  const config = loadConfig({
    FANQIE_TOKEN: 'binding-regression-fixture-long-token',
    FANQIE_ACCOUNT_ID: 'binding-fixture-author',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  class BoundBrowser extends BrowserSession {
    override async checkLogin(): Promise<LoginState> {
      const identity = identities.shift();
      assert(identity, 'Fixture must provide each actual identity check');
      return {
        status: 'authenticated',
        identity: {
          ...identity,
          displayName: null,
          evidenceSource: 'https://fanqienovel.com/api/user/info/v2',
        },
        sourceUrl: 'https://fanqienovel.com/main/writer/short-manage',
        checkedAt: new Date().toISOString(),
      };
    }
    override async withPage<T>(): Promise<T> {
      throw Error('Binding fixture forbids real browser navigation');
    }
  }
  const application = createApplication(config, {
    browser: new BoundBrowser({ profileDir: config.profileDir, headless: true }),
  });
  const tool = application.tools.find((item) => item.name === 'fanqie_check_login_status');
  assert(tool);
  return {
    application,
    bindingFile: path.join(config.dataDir, 'account-binding.json'),
    check: () => tool.run({}) as Promise<{ job: Job }>,
  };
}

export function ownAccountState(
  accountId: string | null,
  authorId: string | null = null,
): LoginState {
  return {
    status: 'authenticated',
    identity: {
      accountId,
      authorId,
      displayName: null,
      evidenceSource: 'https://fanqienovel.com/api/user/info/v2',
    },
    sourceUrl: 'https://fanqienovel.com/main/writer/short-manage',
    checkedAt: new Date().toISOString(),
  };
}

export function collectedAccountFixture(
  directory: string,
  postStates: LoginState[],
  options: { partial?: boolean; chapters?: boolean } = {},
) {
  const readProfilePath = options.chapters
    ? path.join(directory, 'fixture-read-profile.json')
    : undefined;
  if (readProfilePath) {
    // This synthetic profile describes only the bounded Page fixture below.
    // It is not evidence for a real platform selector or long-page capability.
    const chapters: CollectionEvidenceProfile = {
      sourceUrl: 'https://fanqienovel.com/main/writer/fixture-chapters/{workId}',
      verifiedAt: new Date().toISOString(),
      evidence: 'Synthetic fixture only; no real platform navigation',
      readOnly: true,
      rowSelector: '.fixture-row',
      idField: 'chapterId',
      fields: {
        chapterId: { selector: '.fixture-id', type: 'identifier' },
        title: { selector: '.fixture-title' },
      },
      pagination: { nextSelector: '.fixture-next', disabledSelector: '.fixture-disabled' },
    };
    writeFileSync(readProfilePath, JSON.stringify({ chapters }), { mode: 0o600 });
  }
  const config = loadConfig({
    FANQIE_TOKEN: 'post-collection-identity-fixture-token',
    FANQIE_ACCOUNT_ID: 'post-collection-fixture',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
    ...(readProfilePath ? { FANQIE_READ_PROFILE: readProfilePath } : {}),
  });
  let activeCallbacks = 0;
  let pageUrl = 'about:blank';
  let partial = Boolean(options.partial);
  let evaluations: unknown[] = [];
  const calls = { pageCallbacks: 0, navigations: 0, postVerifications: 0 };
  const page = {
    // This bounded fixture has no loaded API GETs; the real reader may observe Page events.
    on() {
      return this;
    },
    off() {
      return this;
    },
    async goto(url: string) {
      calls.navigations++;
      pageUrl = url;
      const view = url.includes('/fixture-chapters/')
        ? {
            rows: [{ chapterId: '12345678901234', title: 'Synthetic chapter' }],
            empty: false,
            hasNext: true,
            nextDisabled: true,
          }
        : {
            cards: [
              {
                workId: '12345678901234',
                title: 'Synthetic work',
                managementUrl: 'https://fanqienovel.com/main/writer/preview-short/12345678901234',
                statusTags: ['已发布'],
                readCountRaw: '12阅读',
                wordCountRaw: '1000字',
                updatedAtRaw: 'Fixture platform text',
              },
            ],
            pageNumbers: partial ? [] : [1],
            activePage: 1,
            emptyVisible: false,
          };
      evaluations = [
        { loginRequired: false, text: 'Synthetic authenticated management view' },
        view,
      ];
    },
    async waitForLoadState() {},
    async evaluate() {
      assert(
        evaluations.length > 0,
        'The real collector must stay within the bounded fixture evaluations',
      );
      return evaluations.shift();
    },
    url() {
      return pageUrl;
    },
  } as unknown as Page;
  class CollectionBrowser extends BrowserSession {
    override async checkLogin(): Promise<LoginState> {
      return ownAccountState('1001', '2001');
    }
    override async withPage<T>(read: (page: Page) => Promise<T>): Promise<T> {
      assert.equal(activeCallbacks, 0, 'An account read must not nest Browser FIFO callbacks');
      activeCallbacks++;
      calls.pageCallbacks++;
      try {
        return await read(page);
      } finally {
        activeCallbacks--;
      }
    }
    override async collectCurrentChapterDirectory(
      current: Page,
      workId: string,
      readOptions: Parameters<BrowserSession['collectCurrentChapterDirectory']>[2],
    ): Promise<ReturnType<typeof makeDataset<ChapterRecord>>> {
      if (options.chapters) {
        // Mechanism migration only: this old profile fixture now models both builtin
        // phase callbacks, preserving its original owner-switch and one-slot assertions.
        assert.equal(current, page);
        assert.equal(activeCallbacks, 1);
        await page.goto(`https://fanqienovel.com/main/writer/fixture-chapters/${workId}`);
        await page.evaluate(() => null);
        await page.evaluate(() => null);
        const observed = await this.verifyCurrentAccount(page);
        if (observed.identity?.accountId !== readOptions.expectedOwner.id) {
          const { RuntimeError } = await import('../../src/runtime/store.js');
          throw new RuntimeError(
            'account_mismatch',
            'Synthetic builtin phase observed another account',
          );
        }
        readOptions.onVerifiedOwner(observed);
        return genericDirectoryPhaseFixture(workId, workId).management;
      }
      // This older no-source application fixture has no service-owned Page/context.
      // Model its unavailable source explicitly; new builtin coverage has separate fixtures.
      return makeDataset<ChapterRecord>('chapters', null);
    }
    override async collectCurrentChapterDraftDirectory(
      current: Page,
      workId: string,
      readOptions: Parameters<BrowserSession['collectCurrentChapterDraftDirectory']>[2],
    ) {
      assert.equal(options.chapters, true);
      assert.equal(current, page);
      assert.equal(activeCallbacks, 1);
      readOptions.onVerifiedOwner(ownAccountState('1001'));
      const draft = genericDirectoryPhaseFixture(workId, workId).drafts;
      draft.records = [];
      draft.coverage.recordsFetched = draft.coverage.totalRecords = 0;
      return draft;
    }
    override async verifyCurrentAccount(checkedPage: Page): Promise<LoginState> {
      assert.equal(
        activeCallbacks,
        1,
        'Post-collection identity must be checked before releasing the same browser FIFO slot',
      );
      assert.equal(checkedPage, page);
      assert.equal(
        evaluations.length,
        0,
        'The actual dataset collector must finish before post-verification',
      );
      calls.postVerifications++;
      const next = postStates.shift();
      assert(next, 'Each actual collected page needs its own fresh post-verification');
      return { ...next, checkedAt: new Date().toISOString(), sourceUrl: pageUrl };
    }
  }
  const application = createApplication(config, {
    browser: new CollectionBrowser({ profileDir: config.profileDir, headless: true }),
  });
  return {
    application,
    calls,
    setPartial(value: boolean) {
      partial = value;
    },
    call: (name: string, args: unknown = {}) =>
      application.dispatch(
        'POST',
        `/api/v1/tools/fanqie_${name}`,
        new URLSearchParams(),
        args,
      ) as Promise<Record<string, any>>,
    snapshot: (scope: string) =>
      application.dispatch(
        'GET',
        '/api/v1/snapshot',
        new URLSearchParams({ scope }),
        undefined,
      ) as Promise<Record<string, any>>,
  };
}
