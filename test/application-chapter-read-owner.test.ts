import test from 'node:test';

import { mkdtempSync, rmSync, readFileSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import {
  builtinChapterApplicationFixture,
  draftDirectoryApplicationFixture,
} from './helpers/application-builtin-chapter-application-fixture.js';

import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.js';

import { createApplication } from '../src/application.js';

import { createHash } from 'node:crypto';

import { BrowserSession, type LoginState } from '../src/platform/browser.js';

test('builtin list_chapters keeps current-page partial evidence separate from complete saved references and uses only its fresh internal owner callback', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-builtin-current-chapter-'));
  const fixture = builtinChapterApplicationFixture(directory);
  try {
    const result = await fixture.call();
    assert.equal(result.job.status, 'partial');
    assert.equal(result.evidence.length, 1);
    assert.equal(result.data[0].status, 'partial');
    assert.equal(result.data[0].records.length, 1);
    assert.equal(result.data[0].coverage.complete, false);
    assert.equal(result.data[0].coverage.paginationComplete, false);
    assert.equal(fixture.oldVerifications, 0);
    const snapshot = (await fixture.application.dispatch(
      'GET',
      '/api/v1/snapshot',
      new URLSearchParams({ scope: 'chapters.7600000000000000001' }),
      undefined,
    )) as Record<string, any>;
    assert.equal(snapshot.manifest, null);
    fixture.setMode('late_failure');
    const failed = await fixture.call();
    assert.equal(failed.job.status, 'partial');
    assert.deepEqual(failed.data[0].records, []);
    assert.equal(failed.data[0].coverage.pagesFetched, 0);
    assert.equal(failed.data[0].coverage.fields.length, 0);
    assert.equal(
      (
        (await fixture.application.dispatch(
          'GET',
          '/api/v1/snapshot',
          new URLSearchParams({ scope: 'chapters.7600000000000000001' }),
          undefined,
        )) as Record<string, any>
      ).manifest,
      null,
    );
  } finally {
    await fixture.application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('builtin chapter DTOs and outside error identity properties cannot replace the actual typed owner callback', async () => {
  for (const mode of ['unproved', 'mismatch', 'outside_error'] as const) {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-builtin-owner-'));
    const fixture = builtinChapterApplicationFixture(directory);
    fixture.setMode(mode);
    try {
      const result = await fixture.call();
      assert.equal(result.job.status, 'failed');
      assert.deepEqual(result.data, []);
      assert.deepEqual(result.evidence, []);
      assert.equal(JSON.stringify(result).includes('PRIVATE_EXTERNAL_ERROR'), false);
      assert.equal(fixture.oldVerifications, 0);
      assert.equal(
        (
          (await fixture.application.dispatch(
            'GET',
            '/api/v1/snapshot',
            new URLSearchParams({ scope: 'chapters.7600000000000000001' }),
            undefined,
          )) as Record<string, any>
        ).manifest,
        null,
      );
    } finally {
      await fixture.application.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test('activities live and saved envelopes use the reference dataset while preserving exact immutable evidence hash, payload and timestamps', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-activities-envelope-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'synthetic-activities-envelope-token',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(
      `<html><script>window._ROUTER_DATA = ${JSON.stringify({ loaderData: { 'solicit-activity': { total_count: 1, activity_list: [{ title: 'Synthetic activity', link: '/writer/zone/article/7600000000000000001', introduction: ['Synthetic terms'], start_time: 'RAW_START', end_time: 'RAW_END', is_permanent: false }] } } })};</script></html>`,
    );
  }) as typeof fetch;
  const application = createApplication(config);
  try {
    const live = (await application.dispatch(
      'POST',
      '/api/v1/tools/fanqie_list_activities',
      new URLSearchParams(),
      {},
    )) as Record<string, any>;
    assert.equal(live.job.status, 'succeeded');
    assert.equal(calls, 1);
    assert.equal(live.data[0].dataset, 'activities');
    const ref = live.evidence[0];
    const bytes = readFileSync(path.join(config.dataDir, 'evidence', ref.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), ref.sha256);
    const stored = JSON.parse(bytes.toString());
    assert.equal(stored.payload.dataset, 'public_activities');
    const saved = (await application.dispatch(
      'GET',
      '/api/v1/snapshot',
      new URLSearchParams({ scope: 'activities' }),
      undefined,
    )) as Record<string, any>;
    assert.equal(calls, 1);
    assert.equal(saved.data[0].dataset, 'activities');
    assert.deepEqual(saved.data[0], live.data[0]);
    assert.equal(saved.data[0].capturedAt, stored.payload.capturedAt);
    assert.equal(saved.data[0].evidenceCapturedAt, ref.capturedAt);
    assert.equal(saved.data[0].evidenceHash, ref.sha256);
    assert.deepEqual(saved.data[0].records, stored.payload.records);
    assert.equal(saved.data[0].records[0].startTimeRaw, 'RAW_START');
    assert.equal(saved.data[0].records[0].endTimeRaw, 'RAW_END');
    assert.equal(
      saved.data[0].records[0].url,
      'https://fanqienovel.com/writer/zone/article/7600000000000000001',
    );
    const description = application.tools.find(
      (tool) => tool.name === 'fanqie_list_activities',
    )!.description;
    assert.equal(description.includes('发布日期'), false);
    assert.equal(description.includes('起止时间'), true);
  } finally {
    globalThis.fetch = originalFetch;
    await application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('volume-options diagnostic keeps strict literal input and one read-only tool while passing only the fixed internal option', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-volume-options-input-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'volume-options-fixture-only-token',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  let calls = 0,
    optionsObserved: unknown;
  class FixtureBrowser extends BrowserSession {
    override async checkLogin(): Promise<LoginState> {
      return {
        status: 'authenticated',
        identity: {
          accountId: '1001',
          authorId: null,
          displayName: null,
          evidenceSource: 'https://fanqienovel.com/api/user/info/v2',
        },
        checkedAt: new Date().toISOString(),
        sourceUrl: 'https://fanqienovel.com/main/writer/book-manage',
      };
    }
    override async diagnoseReadPage(
      _source: string,
      options: Parameters<BrowserSession['diagnoseReadPage']>[1],
    ) {
      calls++;
      optionsObserved = options;
      return {
        status: 'success' as const,
        sourceUrl: 'https://fanqienovel.com/main/writer/chapter-manage/{workId}&{title}',
        capturedAt: new Date().toISOString(),
        identityObserved: { accountId: true, authorId: false, displayName: false },
        elements: [],
        links: [],
        getResponses: [],
        truncated: { elements: false, responses: false },
        limitations: ['Fixed fixture only; no collection proof'],
      };
    }
  }
  const app = createApplication(config, {
    browser: new FixtureBrowser({ profileDir: config.profileDir, headless: true }),
  });
  const tool = app.tools.find((item) => item.name === 'fanqie_diagnose_read_page');
  assert(tool);
  try {
    assert.equal(app.tools.length, 40);
    assert.equal(tool.readOnly, true);
    const common = {
      sourceUrl: 'https://fanqienovel.com/main/writer/book-manage',
      openChaptersForWorkId: '7600000000000000001',
    };
    for (const input of [
      { ...common, chapterVolumeOptions: false },
      { ...common, chapterVolumeOptions: true, selector: '.anything' },
      { sourceUrl: common.sourceUrl, chapterVolumeOptions: true },
      { ...common, chapterVolumeOptions: true, chapterTab: 'drafts' },
      { ...common, chapterVolumeOptions: true, chapterVolumeContext: true },
    ])
      await assert.rejects(tool.run(input), { code: 'invalid_input' });
    assert.equal(calls, 0);
    const result = (await tool.run({ ...common, chapterVolumeOptions: true })) as Record<
      string,
      any
    >;
    assert.equal(result.job.status, 'succeeded');
    assert.equal(result.job.kind, 'read');
    assert.equal(calls, 1);
    assert.equal((optionsObserved as Record<string, unknown>).chapterVolumeOptions, true);
    assert.equal(
      (optionsObserved as Record<string, unknown>).openChaptersForWorkId,
      common.openChaptersForWorkId,
    );
    assert.ok((optionsObserved as Record<string, unknown>).signal instanceof AbortSignal);
    assert.equal((optionsObserved as Record<string, unknown>).chapterTab, undefined);
    assert.equal((optionsObserved as Record<string, unknown>).chapterVolumeContext, undefined);
    const saved = (await app.dispatch(
      'GET',
      '/api/v1/snapshot',
      new URLSearchParams(),
      undefined,
    )) as Record<string, any>;
    assert.equal(saved.manifest, null);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('chapter draft tool queues and completes only its own work namespace with exact immutable live/saved evidence', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-draft-namespace-'));
  const fixture = draftDirectoryApplicationFixture(directory);
  try {
    const tool = fixture.application.tools.find(
      (item) => item.name === 'fanqie_list_chapter_drafts',
    );
    assert(tool);
    assert.equal(tool.readOnly, true);
    assert.equal(fixture.application.tools.length, 40);
    const before = (await fixture.application.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(
      before.reads.find((row: any) => row.dataset === 'chapter_drafts').verificationStatus,
      'not-verified-live',
    );
    const live = await fixture.call();
    assert.equal(live.job.status, 'succeeded');
    assert.equal(live.job.operation, 'list_chapter_drafts');
    assert.equal(live.job.scope, fixture.scope);
    assert.deepEqual(live.job.datasets, ['chapter_drafts']);
    assert.equal(live.data[0].dataset, 'chapter_drafts');
    assert.equal(live.data[0].coverage.complete, true);
    const saved = await fixture.snapshot();
    assert(saved.manifest);
    assert.deepEqual(saved.data, live.data);
    assert.equal(saved.manifest.id, live.job.result.manifest.id);
    assert.equal(saved.data[0].evidenceHash, live.evidence[0].sha256);
    assert.equal(saved.data[0].evidenceCapturedAt, live.evidence[0].capturedAt);
    for (const scope of ['account', 'chapters.7600000000000000001'])
      assert.equal(
        (
          (await fixture.application.dispatch(
            'GET',
            '/api/v1/snapshot',
            new URLSearchParams({ scope }),
            undefined,
          )) as any
        ).manifest,
        null,
      );
    const capability = (await fixture.application.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(
      capability.reads.find((row: any) => row.dataset === 'chapter_drafts').verificationStatus,
      'verified-live',
    );
  } finally {
    await fixture.application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
