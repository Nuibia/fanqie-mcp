import test from 'node:test';

import { mkdtempSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { loadConfig } from '../src/config.js';

import assert from 'node:assert/strict';

import { createHttpServer } from '../src/transport/http.js';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

test('native metadata tool has strict read-only schema and identical safe MCP text/structured/REST/saved outputs', async () => {
  // Local transport uses a synthetic injected collector; no platform, profile or Page.
  const { createApplication } = await import('../src/application.js');
  const { BrowserSession } = await import('../src/platform/browser.js');
  const { createNativeShortMetadataSnapshot } =
    await import('../src/platform/short-native-metadata.js');
  const { writeFileSync } = await import('node:fs');
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-native-transport-'));
  const token = 'native-transport-synthetic-contract-token',
    workId = '7000000001',
    platformId = '001001';
  const config = loadConfig({
    FANQIE_PORT: '0',
    FANQIE_TOKEN: token,
    FANQIE_ENABLE_WRITES: 'false',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  writeFileSync(
    path.join(config.dataDir, 'account-binding.json'),
    JSON.stringify({ accountId: config.accountId, platformId, platformIdType: 'account' }),
  );
  let calls = 0;
  class Fixture extends BrowserSession {
    override async checkLogin(): Promise<never> {
      throw Error('Forbidden login navigation');
    }
    override async withPage<T>(): Promise<T> {
      throw Error('Forbidden Page');
    }
    override async runNativeShortMetadata(
      target: string,
      options: Parameters<InstanceType<typeof BrowserSession>['runNativeShortMetadata']>[1],
    ) {
      calls++;
      assert.equal(target, workId);
      options.assertLease();
      options.onBeforePlatformRead();
      const at = new Date().toISOString();
      const snapshot = createNativeShortMetadataSnapshot({
        binding: {
          account: { kind: 'account_id', id: platformId },
          work: { kind: 'short', id: workId },
        },
        editData: {
          item_id: workId,
          content: '<p>PRIVATE_NATIVE_HTML</p>',
          multi_title: ['Authorized native title', 'PRIVATE_NATIVE_TAIL'],
          thumb_uri: 'PRIVATE_NATIVE_URI_1',
          book_thumb_uri: 'PRIVATE_NATIVE_URI_2',
          category: [{ category_id: 1, label: '主类', name: '主甲' }],
          publish_status: 0,
          PRIVATE_NATIVE_UNKNOWN_KEY: 'PRIVATE_NATIVE_UNKNOWN_VALUE',
          private_url: 'https://example.invalid/?PRIVATE_NATIVE_SIGNED_QUERY',
          private_other: [
            'PRIVATE_NATIVE_COOKIE',
            'PRIVATE_NATIVE_HEADER',
            'PRIVATE_NATIVE_FORM',
            '/private/PRIVATE_NATIVE_ABSOLUTE_PATH',
          ],
        },
        categoryData: { category_list: [{ category_id: 1, label: '主类', name: '主甲' }] },
      });
      options.onVerifiedAccount(platformId, at);
      return {
        schema: 'native-short-metadata-api-read/v1' as const,
        status: 'success' as const,
        reason: null,
        snapshot,
        proof: {
          platformStarted: true,
          ownerBefore: true,
          ownerAfter: true,
          ownerCallback: true,
          fixedSourceVerified: true,
          targetUnique: true,
          paginationComplete: true,
          atomicRevision: false as const,
          readStartedAt: at,
          readFinishedAt: at,
          proofCapturedAt: at,
        },
        requests: {
          own: { attempts: 2, disposed: 2 },
          list: { attempts: 1, disposed: 1 },
          edit: { attempts: 1, disposed: 1 },
          catalog: { attempts: 1, disposed: 1 },
        },
        list: { pagesRead: 1, rowsRead: 1, totalCount: 1 },
        cleanup: {
          sessionCreated: true,
          sessionDisposed: true,
          pendingAtEnd: 0,
          disposalFailures: 0,
          quarantined: false,
          checkedAt: at,
        },
      };
    }
  }
  const api = createApplication(config, {
    browser: new Fixture({ profileDir: config.profileDir, headless: true }),
  });
  const server = createHttpServer(config, api),
    client = new Client({ name: 'native-synthetic-sdk', version: '1.0.0' });
  const noRaw = (value: unknown) => {
    assert.equal(/PRIVATE_NATIVE|001001/.test(JSON.stringify(value)), false);
  };
  try {
    const address = await server.listen();
    assert(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`,
      headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }),
    );
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 40);
    const tool = listed.tools.find((tool) => tool.name === 'fanqie_get_short_metadata_snapshot')!;
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.destructiveHint, false);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual(tool.inputSchema.required, ['workId']);
    assert.deepEqual(Object.keys(tool.inputSchema.properties!), ['workId', 'snapshotScope']);
    const scopeSchema = tool.inputSchema.properties!.snapshotScope;
    assert(scopeSchema && typeof scopeSchema === 'object');
    assert.equal(Reflect.get(scopeSchema, 'type'), 'string');
    const declaredTool = api.tools.find((item) => item.name === tool.name)!;
    assert(declaredTool);
    assert.equal(
      declaredTool.schema.safeParse({ workId, snapshotScope: 'short-native-trial/v1' }).success,
      true,
    );
    const jobsBeforeInvalid = await api.dispatch(
      'GET',
      '/api/v1/jobs',
      new URLSearchParams(),
      undefined,
    );
    noRaw(jobsBeforeInvalid);
    const invalid = await client.callTool({
      name: tool.name,
      arguments: { workId, scope: 'other' },
    });
    assert.equal(invalid.isError, true);
    assert.equal(calls, 0);
    noRaw(invalid);
    assert.deepEqual(
      await api.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined),
      jobsBeforeInvalid,
    );
    const unknownScope = await client.callTool({
      name: tool.name,
      arguments: { workId, snapshotScope: 'other' },
    });
    assert.equal(unknownScope.isError, true);
    assert.equal(calls, 0);
    noRaw(unknownScope);
    assert.deepEqual(
      await api.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined),
      jobsBeforeInvalid,
    );
    const response = await client.callTool({ name: tool.name, arguments: { workId } });
    noRaw(response);
    assert.equal(response.isError, undefined);
    const direct = (response.structuredContent as any).result;
    assert.equal(direct.sourceMode, 'fixture');
    assert.equal(direct.job.status, 'succeeded');
    assert.equal(direct.data[0].provenance.mode, 'fixture');
    assert.equal(direct.data[0].firstTitle, 'Authorized native title');
    const text = response.content.find((item) => item.type === 'text')!;
    assert.equal(text.type, 'text');
    assert.deepEqual(JSON.parse(text.text), direct);
    const scope = `short_native_metadata.${workId}`;
    for (const endpoint of [
      '/api/v1/jobs',
      '/api/v1/jobs/' + direct.job.id,
      '/api/v1/snapshot?scope=' + scope,
      '/api/v1/history?scope=' + scope,
      '/api/v1/capabilities',
    ]) {
      const value = await (await fetch(base + endpoint, { headers })).json();
      noRaw(value);
      if (endpoint.startsWith('/api/v1/snapshot'))
        assert.deepEqual((value as any).data, direct.data);
    }
    for (const [name, args] of [
      ['fanqie_get_job', { jobId: direct.job.id }],
      ['fanqie_cancel_job', { jobId: direct.job.id }],
      ['fanqie_get_saved_snapshot', { scope }],
      ['fanqie_list_saved_history', { scope }],
    ] as const)
      noRaw(await client.callTool({ name, arguments: args }));
    assert.equal(calls, 1);
    const restRead = (await (
      await fetch(base + '/api/v1/tools/' + tool.name, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workId }),
      })
    ).json()) as any;
    noRaw(restRead);
    assert.equal(restRead.data[0].firstTitle, direct.data[0].firstTitle);
    assert.equal(restRead.sourceMode, 'fixture');
    assert.equal(calls, 2);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(config.dataDir, 'operations.sqlite'));
    try {
      db.prepare('UPDATE jobs SET metadata_json=? WHERE id=?').run(
        JSON.stringify({ schema: 'native-short-metadata-reconciliation/v2' }),
        restRead.job.id,
      );
    } finally {
      db.close();
    }
    const conflict = await client.callTool({
      name: 'fanqie_get_job',
      arguments: { jobId: restRead.job.id },
    });
    noRaw(conflict);
    const safeConflict = (conflict.structuredContent as any).result;
    assert.equal(safeConflict.data[0].status, 'capability_unavailable');
    assert.equal(safeConflict.job.projectionStatus, 'capability_unavailable');
    assert.equal(safeConflict.job.result, null);
    const conflictText = conflict.content.find((item) => item.type === 'text')!;
    assert.equal(conflictText.type, 'text');
    assert.deepEqual(JSON.parse(conflictText.text), safeConflict);
    const savedConflict = await client.callTool({
      name: 'fanqie_get_saved_snapshot',
      arguments: { scope },
    });
    noRaw(savedConflict);
    assert.equal((savedConflict.structuredContent as any).result.manifest, null);
    const restConflict = (await (
      await fetch(base + '/api/v1/snapshot?scope=' + scope, { headers })
    ).json()) as any;
    noRaw(restConflict);
    assert.equal(restConflict.manifest, null);
    assert.equal(restConflict.data[0].status, 'capability_unavailable');
  } finally {
    await client.close();
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
