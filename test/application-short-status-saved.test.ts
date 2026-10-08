import test from 'node:test';

import { makeDataset } from '../src/platform/reads.js';

import { f03SavedFixture } from './helpers/application-a6-unclosed.js';

import { createHttpServer as createDirectoryHttpServer } from '../src/transport/http.js';

import {
  Client as DirectoryMcpClient,
  StreamableHTTPClientTransport as DirectoryMcpTransport,
} from '@modelcontextprotocol/client';

import assert from 'node:assert/strict';

import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { loadConfig } from '../src/config.js';

import { createApplication } from '../src/application.js';

import { type Job } from '../src/runtime/store.js';

import { createHash } from 'node:crypto';

import { type Page } from 'playwright';

import { BrowserSession, type LoginState } from '../src/platform/browser.js';

import { bindingFixture } from './helpers/application-binding-fixture.js';

test('short management immutable saved App/HTTP/MCP exports correct labels with zero platform access', async () => {
  const payload = {
    ...makeDataset('short_works', null),
    records: [
      {
        workId: '1234567890123',
        title: 'Synthetic status',
        statusTags: ['已签约', '审核不通过', '审核不通过'],
        publicationStatus: 'published',
        signingStatus: 'signed',
        readCount: 0,
      },
      { workId: '1234567890124', title: 'Synthetic unknown', publicationStatus: 'published' },
    ],
  };
  const f = await f03SavedFixture(payload, 'short_works'),
    http = createDirectoryHttpServer({ ...f.config, host: '127.0.0.1', port: 0 }, f.application),
    client = new DirectoryMcpClient({ name: 'short-status-synthetic', version: '1.0.0' });
  try {
    const saved = (await f.application.dispatch(
      'GET',
      '/api/v1/snapshot',
      new URLSearchParams({ scope: f.scope }),
      undefined,
    )) as any;
    const history = (await f.application.dispatch(
      'GET',
      '/api/v1/history',
      new URLSearchParams({ scope: f.scope }),
      undefined,
    )) as any;
    const job = (await f.application.dispatch(
      'GET',
      '/api/v1/jobs/' + f.job.id,
      new URLSearchParams(),
      undefined,
    )) as any;
    for (const data of [saved.data[0], history.manifests[0].data[0], job.data[0]]) {
      assert.equal(data.records[0].publicationStatus, 'rejected');
      assert.equal(data.records[0].signingStatus, 'signed');
      assert.deepEqual(data.records[0].statusTags, payload.records[0]!.statusTags);
      assert.equal(data.records[1].publicationStatus, 'unknown');
      assert.equal(data.sourceRef, f.ref.id);
      assert.equal(data.evidenceHash, f.ref.sha256);
      assert.equal(data.evidenceCapturedAt, f.ref.capturedAt);
      assert.equal(data.capturedAt, payload.capturedAt);
    }
    const address = await http.listen();
    assert(address && typeof address === 'object');
    const base = 'http://127.0.0.1:' + address.port;
    await client.connect(
      new DirectoryMcpTransport(new URL(base + '/mcp'), {
        requestInit: { headers: { authorization: 'Bearer ' + f.config.token } },
      }),
    );
    for (const [name, args, expected] of [
      ['fanqie_get_saved_snapshot', { scope: f.scope }, saved],
      ['fanqie_get_job', { jobId: f.job.id }, job],
      ['fanqie_list_saved_history', { scope: f.scope }, history],
    ] as const) {
      const output = await client.callTool({ name, arguments: args }),
        text = output.content.find((item) => item.type === 'text');
      assert(text && text.type === 'text');
      assert.deepEqual(JSON.parse(text.text), (output.structuredContent as any).result);
      assert.deepEqual((output.structuredContent as any).result, expected);
    }
    const response = await fetch(base + '/api/v1/jobs/' + f.job.id, {
      headers: { authorization: 'Bearer ' + f.config.token },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), job);
    assert.equal(f.browserCalls, 0);
  } finally {
    await client.close();
    await http.close();
    await f.closeAndVerify();
  }
});

test('short management physical ref routes projection; malformed existing facts reject instead of unknown', async () => {
  const spoof = {
    ...makeDataset('long_works', null),
    dataset: 'short_works',
    records: [
      { workId: '1234567890123', statusTags: ['审核不通过'], publicationStatus: 'published' },
    ],
  };
  const foreign = await f03SavedFixture(spoof, 'long_works');
  try {
    const saved = (await foreign.application.dispatch(
      'GET',
      '/api/v1/snapshot',
      new URLSearchParams({ scope: foreign.scope }),
      undefined,
    )) as any;
    assert.equal(saved.data[0].records[0].publicationStatus, 'published');
    assert.equal(Object.hasOwn(saved.data[0].records[0], 'statusFacts'), false);
    assert.equal(foreign.browserCalls, 0);
  } finally {
    await foreign.closeAndVerify();
  }
  const { resolveShortManagementLabels } = await import('../src/platform/short-status.js');
  const invalid = {
    ...makeDataset('short_works', null),
    records: [
      {
        statusTags: ['已发布'],
        publicationStatus: 'published',
        statusFacts: { ...resolveShortManagementLabels(['已发布']), extra: true },
      },
    ],
  };
  const broken = await f03SavedFixture(invalid, 'short_works');
  try {
    await assert.rejects(
      broken.application.dispatch(
        'GET',
        '/api/v1/snapshot',
        new URLSearchParams({ scope: broken.scope }),
        undefined,
      ),
      { code: 'capability_unavailable' },
    );
    assert.equal(broken.browserCalls, 0);
  } finally {
    await broken.closeAndVerify();
  }
});

test('short creation durably stores a content-bound entry intent before an ID can be allocated', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-short-entry-intent-'));
  const profileFile = path.join(directory, 'profile.json');
  writeFileSync(
    profileFile,
    JSON.stringify({
      short: {
        id: 'entry-intent-fixture',
        evidenceRef: 'fixture://short-entry-intent',
        verifiedAt: '2026-10-03T00:00:00Z',
        kind: 'short',
        editorRoute: '/main/writer/publish-short/{workId}',
        newRoute: '/main/writer/new-short',
        targetPattern: '^/main/writer/publish-short/(?<workId>\\d+)$',
        identity: { selector: { css: '#account' } },
        state: { selector: { css: '#state' } },
        states: { 草稿: 'draft' },
        editableStates: ['draft'],
        title: { css: '#title' },
        body: { css: '#body' },
        save: { role: 'button', name: '存草稿' },
      },
    }),
  );
  const config = loadConfig({
    FANQIE_TOKEN: 'entry-intent-fixture-long-token',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'browser'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
    FANQIE_ENABLE_WRITES: 'true',
    FANQIE_WRITE_PROFILE: profileFile,
  });
  let application: ReturnType<typeof createApplication>,
    navigationCount = 0;
  const input = {
    idempotencyKey: 'fixture-short-entry-intent',
    clientReference: 'fixture-reference-private',
    content: {
      title: 'Synthetic entry title',
      body: 'Synthetic content that must never enter durable intent evidence.',
    },
  };
  const page = {
    url: () => 'https://fanqienovel.com/main/writer/short-manage',
    locator: () => ({
      count: async () => 1,
      isVisible: async () => true,
      innerText: async () => '1001',
    }),
    async goto() {
      navigationCount++;
      const jobs = (await application.dispatch(
        'GET',
        '/api/v1/jobs',
        new URLSearchParams(),
        undefined,
      )) as { jobs: Job[] };
      const job = jobs.jobs.find((j) => j.kind === 'write' && j.status === 'running');
      assert(job);
      assert.notEqual(job.platformWriteStartedAt, null);
      const saved = (await application.dispatch(
        'GET',
        '/api/v1/jobs/' + job.id,
        new URLSearchParams(),
        undefined,
      )) as { job: Job; evidence: Array<{ dataset: string }> };
      assert(saved.evidence.some((ref) => ref.dataset === 'write-intent'));
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(p);
          else if (p.endsWith('.json')) files.push(p);
        }
      };
      walk(path.join(config.dataDir, 'evidence'));
      const document = files
        .map((p) => JSON.parse(readFileSync(p, 'utf8')))
        .find((d) => d.dataset === 'write-intent');
      assert(document);
      assert.equal(document.payload.phase, 'creation-entry');
      assert.equal(
        document.payload.requestedContentHash,
        createHash('sha256')
          .update(
            JSON.stringify({ body: input.content.body, metadata: {}, title: input.content.title }),
          )
          .digest('hex'),
      );
      assert.equal(document.payload.desiredContentHash, undefined);
      const expectedReferenceHash = createHash('sha256')
        .update(JSON.stringify({ clientReference: input.clientReference, kind: 'short' }))
        .digest('hex');
      assert.equal(document.payload.clientReferenceHash, expectedReferenceHash);
      const serialized = JSON.stringify(document);
      assert.equal(serialized.includes(input.content.body), false);
      assert.equal(serialized.includes(input.clientReference), false);
      throw Error('Synthetic navigation stops before any target can be created');
    },
  } as unknown as Page;
  class EntryBrowser extends BrowserSession {
    override async checkLogin(): Promise<LoginState> {
      return {
        status: 'authenticated',
        identity: {
          accountId: '1001',
          authorId: null,
          displayName: null,
          evidenceSource: 'https://fanqienovel.com/api/user/info/v2',
        },
        sourceUrl: 'https://fanqienovel.com/main/writer/short-manage',
        checkedAt: new Date().toISOString(),
      };
    }
    override async verifyCurrentAccount(current: Page): Promise<LoginState> {
      assert.equal(current, page);
      return this.checkLogin();
    }
    override async withPage<T>(reader: (page: Page) => Promise<T>): Promise<T> {
      return reader(page);
    }
  }
  application = createApplication(config, {
    browser: new EntryBrowser({ profileDir: config.profileDir, headless: true }),
  });
  try {
    const result = (await application.dispatch(
      'POST',
      '/api/v1/tools/fanqie_create_draft',
      new URLSearchParams(),
      input,
    )) as { job: Job };
    assert.equal(
      result.job.status,
      'uncertain',
      JSON.stringify({ error: result.job.error, navigationCount }),
    );
    assert.equal(result.job.target, null);
    assert.equal(navigationCount, 1);
    const duplicate = (await application.dispatch(
      'POST',
      '/api/v1/tools/fanqie_create_draft',
      new URLSearchParams(),
      input,
    )) as { job: Job };
    assert.equal(duplicate.job.id, result.job.id);
    assert.equal(navigationCount, 1);
  } finally {
    await application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('account binding keeps its account namespace when author identity appears and refuses another account', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-binding-account-'));
  const fixture = bindingFixture(directory, [
    { accountId: '1001', authorId: null },
    { accountId: '1001', authorId: '2001' },
    { accountId: '3001', authorId: '2001' },
  ]);
  try {
    assert.equal((await fixture.check()).job.status, 'succeeded');
    assert.equal((await fixture.check()).job.status, 'succeeded');
    const mismatch = (await fixture.check()).job;
    assert.equal(mismatch.status, 'failed');
    assert.equal(mismatch.error?.code, 'account_mismatch');
    assert.deepEqual(JSON.parse(readFileSync(fixture.bindingFile, 'utf8')), {
      accountId: 'binding-fixture-author',
      platformId: '1001',
      platformIdType: 'account',
    });
    assert.equal(statSync(fixture.bindingFile).mode & 0o777, 0o600);
    const status = (await fixture.application.dispatch(
      'GET',
      '/api/v1/status',
      new URLSearchParams(),
      undefined,
    )) as { platform: { status: string } };
    assert.equal(status.platform.status, 'unknown');
  } finally {
    await fixture.application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
