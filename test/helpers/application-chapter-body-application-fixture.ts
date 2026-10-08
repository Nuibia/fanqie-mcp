import { loadConfig } from '../../src/config.js';

import path from 'node:path';

import { type LoginState, BrowserSession } from '../../src/platform/browser.js';

import { type Page } from 'playwright';

import assert from 'node:assert/strict';

import { makeDataset, type ChapterRecord } from '../../src/platform/reads.js';

import { createHash } from 'node:crypto';

import { createApplication } from '../../src/application.js';

import { writeFileSync } from 'node:fs';

import { type Job } from '../../src/runtime/store.js';

export function chapterBodyApplicationFixture(directory: string) {
  const config = loadConfig({
    FANQIE_TOKEN: 'synthetic-chapter-body-token',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  let mode: 'complete' | 'failure' | 'unproved' | 'mismatch' | 'outside_error' = 'complete',
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
  const page = {} as Page,
    rawContent = '<p>Synthetic raw chapter body\r\n</p>  ';
  class ChapterBodyBrowser extends BrowserSession {
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
      throw Error('Body reads cannot use a public directory or editable-profile fallback');
    }
    override async collectCurrentChapterBody(
      current: Page,
      workId: string,
      chapterId: string,
      options: Parameters<BrowserSession['collectCurrentChapterBody']>[3],
    ) {
      assert.equal(active, true);
      assert.equal(current, page);
      assert.deepEqual(options.expectedOwner, { kind: 'account', id: '1001' });
      collections++;
      if (mode === 'outside_error')
        throw Object.assign(Error('PRIVATE_BODY_EXTERNAL_PROOF'), {
          verified: true,
          identity: { accountId: '1001' },
          body: rawContent,
        });
      if (mode !== 'unproved')
        options.onVerifiedOwner(state(mode === 'mismatch' ? '1002' : '1001'));
      const result = makeDataset<any>(
          'chapter_body',
          'https://fanqienovel.com/api/author/edit_article/v0/',
        ),
        complete = mode !== 'failure';
      result.status = complete ? 'success' : 'capability_unavailable';
      result.records = complete
        ? [
            {
              sourceBoundary: 'public_contract_api',
              representation: 'author_edit_current',
              publishedVersionVerified: false,
              requestedTarget: { workId, chapterId, volumeId: '7700000000000000001' },
              title: 'Synthetic edit title',
              rawContent,
              rawContentSha256: createHash('sha256').update(rawContent).digest('hex'),
              rawContentBytes: Buffer.byteLength(rawContent),
              rawPublishStatus: 2,
              rawCreationStatus: 0,
              rawLatestVersion: 7,
            },
          ]
        : [];
      result.coverage = {
        complete,
        paginationComplete: complete,
        pagesFetched: complete ? 1 : 0,
        pagesDiscovered: complete ? 1 : null,
        recordsFetched: result.records.length,
        totalRecords: complete ? 1 : null,
        fields: complete
          ? [
              'sourceBoundary',
              'representation',
              'publishedVersionVerified',
              'requestedTarget',
              'title',
              'rawContent',
              'rawContentSha256',
              'rawContentBytes',
              'rawPublishStatus',
              'rawCreationStatus',
              'rawLatestVersion',
            ]
          : [],
      };
      if (!complete)
        result.errors.push({ code: 'chapter_body_read_unverified', scope: 'chapter_body' });
      return result;
    }
  }
  const application = createApplication(config, {
    browser: new ChapterBodyBrowser({ profileDir: config.profileDir, headless: true }),
  });
  const scope = 'chapter_body.7600000000000000001.7800000000000000001';
  return {
    application,
    scope,
    rawContent,
    setMode(value: typeof mode) {
      mode = value;
    },
    get collections() {
      return collections;
    },
    call: () =>
      application.dispatch('POST', '/api/v1/tools/fanqie_get_chapter', new URLSearchParams(), {
        workId: '7600000000000000001',
        chapterId: '7800000000000000001',
      }) as Promise<Record<string, any>>,
    snapshot: () =>
      application.dispatch(
        'GET',
        '/api/v1/snapshot',
        new URLSearchParams({ scope }),
        undefined,
      ) as Promise<Record<string, any>>,
  };
}

export async function editorDefaultGateApplicationFixture(
  directory: string,
  enabled = false,
  configuredProfile = false,
) {
  const { Store, RuntimeError } = await import('../../src/runtime/store.js');
  const { JobQueue } = await import('../../src/runtime/jobs.js');
  const workId = '7600000000000000001',
    chapterId = '7800000000000000001',
    profilePath = path.join(directory, 'synthetic-editor-profile.json');
  const config = loadConfig({
    FANQIE_TOKEN: 'synthetic-editor-default-gate-token',
    FANQIE_ACCOUNT_ID: 'editor-gate-fixture',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
    FANQIE_ENABLE_WRITES: enabled ? 'true' : 'false',
    ...(configuredProfile ? { FANQIE_WRITE_PROFILE: profilePath } : {}),
  });
  if (configuredProfile) {
    const common = {
      evidenceRef: 'fixture://synthetic-editor-profile',
      verifiedAt: '2026-10-03T00:00:00.000Z',
      identity: { selector: { css: '#synthetic-identity' } },
      state: { selector: { css: '#synthetic-state' } },
      states: { draft: 'draft' },
      editableStates: ['draft'],
      title: { css: '#synthetic-title' },
      body: { css: '#synthetic-body' },
      save: { css: '#synthetic-save' },
    };
    writeFileSync(
      profilePath,
      JSON.stringify({
        short: {
          ...common,
          id: 'synthetic-short-editor',
          kind: 'short',
          editorRoute: '/main/writer/publish-short/{workId}',
          targetPattern: '^/main/writer/publish-short/(?<workId>\\d+)$',
        },
        chapter: {
          ...common,
          id: 'synthetic-chapter-editor',
          kind: 'chapter',
          editorRoute: '/main/writer/fixture-book/{workId}/fixture-chapter/{chapterId}',
          targetPattern:
            '^/main/writer/fixture-book/(?<workId>\\d+)/fixture-chapter/(?<chapterId>\\d+)$',
        },
      }),
      { mode: 0o600 },
    );
  }
  const scopes = [
    'account',
    `chapters.${workId}`,
    `chapter_drafts.${workId}`,
    `chapter_body.${workId}.${chapterId}`,
  ];
  const seedStore = new Store({
      databasePath: path.join(config.dataDir, 'operations.sqlite'),
      evidenceDirectory: path.join(config.dataDir, 'evidence'),
      evidenceMode: 'fixture',
    }),
    seedQueue = new JobQueue(seedStore);
  let original: Job;
  try {
    for (const scope of scopes) {
      const seeded = await seedQueue.enqueueRead({
        accountId: config.accountId,
        operation: 'fixture_sentinel',
        scope,
        datasets: ['fixture_sentinel'],
        run: async (ctx) => {
          ctx.beforePlatformRead();
          return [ctx.saveEvidence('fixture_sentinel', { complete: true, sentinel: scope })];
        },
      }).completion;
      assert.equal(seeded.status, 'succeeded');
    }
    original = await seedQueue.enqueueWrite({
      accountId: config.accountId,
      operation: 'fixture_uncertain_write',
      scope: 'fixture_write',
      idempotencyKey: 'fixture-editor-uncertain-write',
      inputHash: '0'.repeat(64),
      run: async (ctx) => {
        ctx.beforePlatformRead();
        ctx.recordTarget({ kind: 'short-story', id: workId });
        ctx.saveEvidence('write-intent', {
          desiredContentHash: '1'.repeat(64),
          expectedStates: ['draft_saved'],
        });
        ctx.beforePlatformWrite();
        throw new RuntimeError(
          'outcome_unknown',
          'Synthetic uncertain state only; no platform side effect',
        );
      },
    }).completion;
    assert.equal(original.status, 'uncertain');
  } finally {
    await seedQueue.drainAndStop();
    seedStore.close();
  }
  let loginCalls = 0,
    pageCalls = 0,
    editorNavigations = 0;
  const page = {
    async goto() {
      editorNavigations++;
      throw Error('Synthetic editor navigation stopped before any page load');
    },
  } as unknown as Page;
  class EditorGateSpyBrowser extends BrowserSession {
    override async checkLogin(): Promise<LoginState> {
      loginCalls++;
      return {
        status: 'authenticated',
        identity: {
          accountId: '1001',
          authorId: null,
          displayName: null,
          evidenceSource: 'https://fanqienovel.com/api/user/info/v2',
        },
        sourceUrl: 'https://fanqienovel.com/api/user/info/v2',
        checkedAt: new Date().toISOString(),
      };
    }
    override async withPage<T>(read: (page: Page) => Promise<T>): Promise<T> {
      pageCalls++;
      return read(page);
    }
  }
  const application = createApplication(config, {
    browser: new EditorGateSpyBrowser({ profileDir: config.profileDir, headless: true }),
  });
  const chapterTarget = { kind: 'chapter', workId, chapterId };
  const calls = [
    {
      name: 'fanqie_diagnose_editor',
      args: {
        target: chapterTarget,
        editorUrl: `https://fanqienovel.com/main/writer/fixture-book/${workId}/fixture-chapter/${chapterId}`,
        routeEvidenceRef: 'fixture://caller-editor-evidence',
      },
    },
    { name: 'fanqie_get_editable_snapshot', args: { target: chapterTarget } },
    {
      name: 'fanqie_prepare_submission',
      args: { target: chapterTarget, expectedContentHash: '1'.repeat(64), expectedState: 'draft' },
    },
    { name: 'fanqie_reconcile_write', args: { jobId: original.id } },
  ];
  return {
    application,
    scopes,
    calls,
    config,
    original,
    workId,
    snapshot: (scope: string) =>
      application.dispatch('GET', '/api/v1/snapshot', new URLSearchParams({ scope }), undefined),
    jobs: () =>
      application.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined) as Promise<{
        jobs: Job[];
      }>,
    counts: () => ({ loginCalls, pageCalls, editorNavigations }),
  };
}
