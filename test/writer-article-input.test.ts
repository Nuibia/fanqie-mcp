import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { loadConfig } from '../src/config.js';
import { createApplication } from '../src/application.js';
import { BrowserSession } from '../src/platform/browser.js';
import { createMcpServer } from '../src/transport/mcp.js';

test('writer article App and MCP reject unsupported ID bounds before jobs or collection while valid bounds preserve saved evidence', async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-article-input-fixture-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'synthetic-article-input-contract-token',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  let browserCalls = 0;
  class OfflineBrowser extends BrowserSession {
    override async checkLogin(): Promise<never> {
      browserCalls++;
      throw Error('Public article input must not open login');
    }
    override async withPage<T>(): Promise<T> {
      browserCalls++;
      throw Error('Public article input must not open a browser');
    }
  }
  const requested: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requested.push(url);
    assert.equal(init?.method, 'GET');
    assert.equal(new URL(url).origin, 'https://fanqienovel.com');
    return new Response(
      '<script>window._ROUTER_DATA = ' +
        JSON.stringify({
          loaderData: {
            article: {
              title: 'Synthetic article',
              content: '<p>Synthetic content</p>',
              create_time: '2026-10-01',
            },
          },
        }) +
        ';</script>',
    );
  });
  const app = createApplication(config, {
    browser: new OfflineBrowser({ profileDir: config.profileDir, headless: true }),
  });
  const server = createMcpServer(app.tools);
  const client = new Client(
    { name: 'article-input-synthetic', version: '1.0.0' },
    { versionNegotiation: { mode: 'legacy' } },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const query = () => new URLSearchParams();
  const jobs = () => app.dispatch('GET', '/api/v1/jobs', query(), undefined);
  const evidenceFiles = () =>
    readdirSync(path.join(config.dataDir, 'evidence'), { recursive: true }).sort();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const beforeJobs = await jobs(),
      beforeEvidence = evidenceFiles();
    const invalid: Record<string, unknown>[] = [
      ...[0, 9, 10, 14, 31].map((length) => ({ articleId: '1'.repeat(length) })),
      {},
      { articleId: 123456789012345 },
      { articleId: '1'.repeat(14) + 'x' },
      { articleId: '1'.repeat(15), sourceUrl: 'https://example.invalid' },
    ];
    for (const args of invalid) {
      await assert.rejects(
        app.dispatch('POST', '/api/v1/tools/fanqie_get_writer_article', query(), args),
        { code: 'invalid_input' },
      );
      const rejected = await client.callTool({
        name: 'fanqie_get_writer_article',
        arguments: args,
      });
      assert.equal(rejected.isError, true);
      assert.deepEqual(await jobs(), beforeJobs);
      assert.deepEqual(evidenceFiles(), beforeEvidence);
      assert.equal(requested.length, 0);
      assert.equal(browserCalls, 0);
    }
    for (const [index, length] of [15, 30].entries()) {
      const articleId = String(index + 1).repeat(length);
      let response: unknown;
      if (index === 0) {
        response = await app.dispatch('POST', '/api/v1/tools/fanqie_get_writer_article', query(), {
          articleId,
        });
      } else {
        const { structuredContent } = await client.callTool({
          name: 'fanqie_get_writer_article',
          arguments: { articleId },
        });
        assert(
          structuredContent &&
            typeof structuredContent === 'object' &&
            'result' in structuredContent,
        );
        response = structuredContent.result;
      }
      assert(response && typeof response === 'object');
      const live = response as {
        job: { id: string; status: string };
        evidence: unknown[];
        data: Array<{
          records: Array<{ articleId: string; contentText: string; publishedAtRaw: string }>;
          contentFingerprint: string;
        }>;
      };
      assert.equal(live.job.status, 'succeeded');
      assert.equal(live.evidence.length, 1);
      assert.equal(live.data[0]!.records[0]!.articleId, articleId);
      assert.equal(live.data[0]!.records[0]!.contentText, 'Synthetic content');
      assert.equal(live.data[0]!.records[0]!.publishedAtRaw, '2026-10-01');
      assert.match(live.data[0]!.contentFingerprint, /^[a-f0-9]{64}$/);
      assert.equal(requested.length, index + 1);
      assert.equal(requested[index], 'https://fanqienovel.com/writer/zone/article/' + articleId);
      const saved = (await app.dispatch(
        'GET',
        '/api/v1/snapshot',
        new URLSearchParams({ scope: 'writer_article.' + articleId }),
        undefined,
      )) as { data: unknown[] };
      assert.deepEqual(saved.data, live.data);
      assert.equal(requested.length, index + 1);
    }
    const afterJobs = (await jobs()) as { jobs: unknown[] };
    assert.equal(afterJobs.jobs.length, 2);
    assert.equal(browserCalls, 0);
  } finally {
    await client.close();
    await server.close();
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
