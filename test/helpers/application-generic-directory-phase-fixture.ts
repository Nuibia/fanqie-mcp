import { makeDataset, type ChapterRecord } from '../../src/platform/reads.js';

import path from 'node:path';

import { writeFileSync } from 'node:fs';

import { loadConfig } from '../../src/config.js';

import assert from 'node:assert/strict';

import { type Page } from 'playwright';

import { BrowserSession } from '../../src/platform/browser.js';

import { ownAccountState } from './application-binding-fixture.js';

import { createApplication } from '../../src/application.js';

export function genericDirectoryPhaseFixture(workId: string, entryId = '7800000000000000001') {
  const source = 'https://fanqienovel.com/main/writer/chapter-manage/{workId}&{title}';
  const management = makeDataset<ChapterRecord>('chapters', source, [
    {
      workId,
      chapterId: entryId,
      volumeId: '7700000000000000001',
      title: 'Synthetic management directory entry',
      index: 1,
      wordCount: 20,
      articleStatusCode: 99,
      displayStatusCode: 98,
      createdAtRaw: 'RAW_CREATED',
      scheduledAtRaw: '',
    },
  ]);
  management.status = 'partial';
  management.coverage = {
    complete: false,
    paginationComplete: false,
    pagesFetched: 1,
    pagesDiscovered: null,
    recordsFetched: 1,
    totalRecords: null,
    fields: Object.keys(management.records[0]!),
  };
  management.managementCoverage = {
    scope: 'management_all_statuses',
    status: 'complete',
    draftsCovered: false,
    inventoryVolumes: 1,
    matchedVolumes: 1,
    completedVolumes: 1,
    pagesFetched: 1,
    recordsFetched: 1,
    allStatusObserved: true,
    inventoryReconciled: true,
    reasons: [],
  };
  management.errors = [{ code: 'chapter_scope_coverage_unverified', scope: 'chapters' }];
  const drafts = makeDataset<import('../../src/platform/reads.js').ChapterDraftRecord>(
    'chapter_drafts',
    source,
    [
      {
        workId,
        draftId: entryId,
        title: 'Synthetic draft directory entry',
        wordCount: 10,
        modifiedAtRaw: 'RAW_MODIFIED',
        sourceScope: 'draft_list',
      },
    ],
  );
  drafts.status = 'success';
  drafts.coverage = {
    complete: true,
    paginationComplete: true,
    pagesFetched: 1,
    pagesDiscovered: 1,
    recordsFetched: 1,
    totalRecords: 1,
    fields: ['workId', 'draftId', 'title', 'wordCount', 'modifiedAtRaw', 'sourceScope'],
  };
  return { management, drafts };
}

export async function genericDirectoryApplicationFixture(directory: string) {
  const workId = '7600000000000000001',
    scope = `chapters.${workId}`;
  const profile = path.join(directory, 'synthetic-profile.json');
  writeFileSync(
    profile,
    JSON.stringify({
      chapters: {
        sourceUrl: 'https://fanqienovel.com/main/writer/fixture-chapters/{workId}',
        verifiedAt: new Date().toISOString(),
        evidence: 'Synthetic profile cannot bypass the builtin two-namespace path',
        readOnly: true,
        rowSelector: '.synthetic-profile-row',
        idField: 'chapterId',
        fields: { chapterId: { selector: '.synthetic-id', type: 'identifier' } },
        pagination: { nextSelector: '.synthetic-next', disabledSelector: '.synthetic-disabled' },
      },
    }),
    { mode: 0o600 },
  );
  const config = loadConfig({
    FANQIE_TOKEN: 'synthetic-generic-directory-token',
    FANQIE_READ_PROFILE: profile,
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  const { Store } = await import('../../src/runtime/store.js');
  const { JobQueue } = await import('../../src/runtime/jobs.js');
  const legacyScope = 'chapters.7600000000000000002';
  const protectedScopes = [
    'account',
    `chapter_drafts.${workId}`,
    `chapter_body.${workId}.7800000000000000001`,
    legacyScope,
  ];
  const seedStore = new Store({
    databasePath: path.join(config.dataDir, 'operations.sqlite'),
    evidenceDirectory: path.join(config.dataDir, 'evidence'),
    evidenceMode: 'live',
  });
  const seedQueue = new JobQueue(seedStore);
  for (const seedScope of protectedScopes) {
    const seeded = await seedQueue.enqueueRead({
      accountId: config.accountId,
      operation: 'synthetic_current',
      scope: seedScope,
      datasets: ['synthetic_current'],
      run: async (ctx) => {
        ctx.beforePlatformRead();
        return [
          ctx.saveEvidence('synthetic_current', { complete: true, syntheticScope: seedScope }),
        ];
      },
    }).completion;
    assert.equal(seeded.status, 'succeeded');
  }
  // Synthetic legacy profile-only success uses live document mode but lacks the
  // new two-phase marker. A dataset name alone must never verify this capability.
  const legacy = await seedQueue.enqueueRead({
    accountId: config.accountId,
    operation: 'list_chapters',
    scope: legacyScope,
    datasets: ['chapters'],
    run: async (ctx) => {
      ctx.beforePlatformRead();
      return [
        ctx.saveEvidence('chapters', {
          status: 'success',
          dataset: 'chapters',
          records: [],
          coverage: { complete: true, paginationComplete: true },
          source: { mode: 'live', origin: 'https://fanqienovel.com' },
        }),
      ];
    },
  }).completion;
  assert.equal(legacy.status, 'succeeded');
  await seedQueue.drainAndStop();
  seedStore.close();
  type Mode =
    | 'complete'
    | 'empty_drafts'
    | 'management_partial'
    | 'management_extra_error'
    | 'management_failure'
    | 'management_unproved'
    | 'draft_partial'
    | 'draft_failure'
    | 'draft_unproved'
    | 'draft_mismatch'
    | 'draft_outside_error'
    | 'blocked_draft';
  let mode: Mode = 'complete',
    active = false,
    callbacks = 0,
    managerJob: string | null = null,
    managerSignal: AbortSignal | null = null;
  const events: string[] = [];
  let enteredResolve!: () => void, releaseResolve!: () => void;
  const entered = new Promise<void>((resolve) => {
    enteredResolve = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseResolve = resolve;
  });
  const page = {
    async goto() {
      throw Error('Synthetic profile navigation is forbidden');
    },
    async evaluate() {
      throw Error('Synthetic profile parsing is forbidden');
    },
  } as unknown as Page;
  class SequentialDirectoryBrowser extends BrowserSession {
    override async checkLogin() {
      return ownAccountState('1001');
    }
    override async withPage<T>(read: (page: Page) => Promise<T>): Promise<T> {
      assert.equal(active, false);
      active = true;
      callbacks++;
      events.push('slot_enter');
      try {
        return await read(page);
      } finally {
        active = false;
        events.push('slot_leave');
      }
    }
    override async collectCurrentChapterDirectory(
      current: Page,
      parent: string,
      options: Parameters<BrowserSession['collectCurrentChapterDirectory']>[2],
    ) {
      assert.equal(active, true);
      assert.equal(current, page);
      assert.equal(parent, workId);
      assert.equal(options.signal?.aborted, false);
      assert.deepEqual(options.expectedOwner, { kind: 'account', id: '1001' });
      managerJob = options.jobId;
      managerSignal = options.signal ?? null;
      events.push('management_enter');
      if (mode !== 'management_unproved') {
        options.onVerifiedOwner(ownAccountState('1001'));
        events.push('management_owner');
      }
      const result = genericDirectoryPhaseFixture(parent).management;
      if (mode === 'management_partial') {
        result.managementCoverage!.status = 'partial';
        result.managementCoverage!.reasons.push('next_unavailable');
      }
      if (mode === 'management_extra_error')
        result.errors.push({ code: 'synthetic_extra_error', scope: 'chapters' });
      if (mode === 'management_failure') {
        result.status = 'capability_unavailable';
        result.records = [];
        result.coverage.fields = [];
        result.coverage.pagesFetched = result.coverage.recordsFetched = 0;
        delete result.managementCoverage;
      }
      events.push('management_return');
      return result;
    }
    override async collectCurrentChapterDraftDirectory(
      current: Page,
      parent: string,
      options: Parameters<BrowserSession['collectCurrentChapterDraftDirectory']>[2],
    ) {
      assert.equal(active, true);
      assert.equal(current, page);
      assert.equal(parent, workId);
      assert.equal(options.jobId, managerJob);
      assert.equal(options.signal, managerSignal);
      assert.equal(options.signal?.aborted, false);
      assert.deepEqual(options.expectedOwner, { kind: 'account', id: '1001' });
      events.push('draft_enter');
      if (mode === 'blocked_draft') {
        enteredResolve();
        await release;
        events.push('draft_cleanup_settled');
      }
      if (mode === 'draft_outside_error')
        throw Object.assign(Error('UNTRUSTED_GENERIC_ERROR_SENTINEL'), {
          ownerVerified: true,
          identity: { accountId: '1001' },
          records: ['UNTRUSTED_GENERIC_ERROR_SENTINEL'],
        });
      if (mode !== 'draft_unproved') {
        options.onVerifiedOwner(ownAccountState(mode === 'draft_mismatch' ? '1002' : '1001'));
        events.push('draft_owner');
      }
      const result = genericDirectoryPhaseFixture(parent).drafts;
      if (mode === 'empty_drafts') {
        result.records = [];
        result.coverage.recordsFetched = result.coverage.totalRecords = 0;
      }
      if (mode === 'draft_partial') {
        result.status = 'partial';
        result.coverage.complete = result.coverage.paginationComplete = false;
        result.coverage.totalRecords = 2;
        result.errors.push({ code: 'chapter_draft_next_unavailable', scope: 'chapter_drafts' });
      }
      if (mode === 'draft_failure') {
        result.status = 'capability_unavailable';
        result.records = [];
        result.coverage.complete = result.coverage.paginationComplete = false;
        result.coverage.pagesFetched = result.coverage.recordsFetched = 0;
        result.coverage.fields = [];
      }
      events.push('draft_return');
      return result;
    }
  }
  const application = createApplication(config, {
    browser: new SequentialDirectoryBrowser({ profileDir: config.profileDir, headless: true }),
  });
  return {
    application,
    config,
    workId,
    scope,
    protectedScopes,
    events,
    entered,
    release() {
      releaseResolve();
    },
    setMode(value: Mode) {
      mode = value;
    },
    get active() {
      return active;
    },
    get callbacks() {
      return callbacks;
    },
    call: () =>
      application.dispatch('POST', '/api/v1/tools/fanqie_list_chapters', new URLSearchParams(), {
        workId,
      }) as Promise<Record<string, any>>,
    snapshot: (selected = scope) =>
      application.dispatch(
        'GET',
        '/api/v1/snapshot',
        new URLSearchParams({ scope: selected }),
        undefined,
      ) as Promise<Record<string, any>>,
  };
}
