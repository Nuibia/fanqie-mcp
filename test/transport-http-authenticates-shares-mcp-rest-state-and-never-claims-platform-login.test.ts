import test from 'node:test';

import { mkdtempSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { loadConfig } from '../src/config.js';

import { createHttpServer } from '../src/transport/http.js';

import * as z from 'zod/v4';

import assert from 'node:assert/strict';

import { PNG } from './helpers/transport-png.js';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

test('HTTP authenticates, shares MCP/REST state, and never claims platform login', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-transport-'));
  const token = 'test-credential-for-contract-only';
  const config = loadConfig({
    FANQIE_PORT: '0',
    FANQIE_TOKEN: token,
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  const state = { platform: { status: 'unknown', checkedAt: null } };
  const app = createHttpServer(config, {
    tools: [
      {
        name: 'fanqie_get_service_status',
        description: 'Service state',
        schema: z.object({}).strict(),
        readOnly: true,
        run: async () => state,
      },
    ],
    dispatch: async () => state,
    close: async () => {},
  });
  try {
    const address = await app.listen();
    assert(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(`${base}/api/v1/status`)).status, 401);
    assert.equal(
      (
        await fetch(`${base}/api/v1/status`, {
          headers: { authorization: `Bearer ${token}`, origin: 'https://unapproved.invalid' },
        })
      ).status,
      403,
    );
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    assert.deepEqual(await (await fetch(`${base}/api/v1/status`, { headers })).json(), state);
    const initialize = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'integration-test', version: '1.0' },
        },
      }),
    });
    assert.equal(initialize.status, 200);
    const text = await initialize.text();
    assert.match(text, /fanqie-mcp/);
    const result = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'fanqie_get_service_status', arguments: {} },
      }),
    });
    assert.equal(result.status, 200);
    assert.match(await result.text(), /unknown/);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('only declared QR tools emit native image; text and structured results omit image bytes', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-media-'));
  const token = 'test-qr-contract-only-long-token';
  const config = loadConfig({
    FANQIE_PORT: '0',
    FANQIE_TOKEN: token,
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  const result = { status: 'ready', image: { mimeType: 'image/png', data: PNG } };
  const app = createHttpServer(config, {
    tools: [
      {
        name: 'fanqie_qr',
        description: 'QR',
        schema: z.object({}).strict(),
        readOnly: true,
        imageResultKey: 'image',
        run: async () => result,
      },
      {
        name: 'fanqie_plain',
        description: 'Ordinary data',
        schema: z.object({}).strict(),
        readOnly: true,
        run: async () => result,
      },
      {
        name: 'fanqie_invalid_qr',
        description: 'Invalid media',
        schema: z.object({}).strict(),
        readOnly: true,
        imageResultKey: 'image',
        run: async () => ({
          image: { mimeType: 'image/png', data: 'sensitive-invalid-qr-marker' },
        }),
      },
      {
        name: 'fanqie_cancelled_qr',
        description: 'Cancelled media',
        schema: z.object({}).strict(),
        readOnly: true,
        imageResultKey: 'image',
        run: async () => ({ ...result, job: { status: 'cancelled' } }),
      },
    ],
    dispatch: async () => result,
    close: async () => {},
  });
  const client = new Client({ name: 'fanqie-media-test', version: '1.0.0' });
  try {
    const address = await app.listen();
    assert(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    const qr = await client.callTool({ name: 'fanqie_qr', arguments: {} });
    assert.equal(qr.isError, undefined);
    assert.deepEqual(
      qr.content.find((item) => item.type === 'image'),
      { type: 'image', mimeType: 'image/png', data: PNG },
    );
    assert.deepEqual(qr.structuredContent, { result: { status: 'ready' } });
    assert.equal(
      JSON.stringify(qr.content.filter((item) => item.type === 'text')).includes(PNG),
      false,
    );
    const ordinary = await client.callTool({ name: 'fanqie_plain', arguments: {} });
    assert.equal(
      ordinary.content.some((item) => item.type === 'image'),
      false,
    );
    assert.deepEqual(ordinary.structuredContent, { result });
    const invalid = await client.callTool({ name: 'fanqie_invalid_qr', arguments: {} });
    assert.equal(invalid.isError, true);
    assert.equal(JSON.stringify(invalid).includes('sensitive-invalid-qr-marker'), false);
    const cancelled = await client.callTool({ name: 'fanqie_cancelled_qr', arguments: {} });
    assert.equal(cancelled.isError, true);
    assert.equal(JSON.stringify(cancelled).includes(PNG), false);
    assert.equal(
      cancelled.content.some((item) => item.type === 'image'),
      false,
    );
    const rest = await fetch(`${base}/api/v1/login/qrcode`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.deepEqual(await rest.json(), result);
  } finally {
    await client.close();
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('real SDK clients discover/call through legacy and modern transports and receive business failures', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-sdk-'));
  const token = 'test-credential-for-sdk-contract-only';
  const config = loadConfig({
    FANQIE_PORT: '0',
    FANQIE_TOKEN: token,
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  let calls = 0;
  const app = createHttpServer(config, {
    tools: [
      {
        name: 'fanqie_probe',
        description: 'Exercise shared application',
        schema: z.object({}).strict(),
        readOnly: true,
        run: async () => ({ calls: ++calls }),
      },
      {
        name: 'fanqie_failure',
        description: 'Exercise durable failure',
        schema: z.object({}).strict(),
        readOnly: true,
        run: async () => ({ job: { status: 'partial', error: { code: 'invalid_evidence' } } }),
      },
    ],
    dispatch: async () => ({ calls }),
    close: async () => {},
  });
  try {
    const address = await app.listen();
    assert(address && typeof address === 'object');
    const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
    for (const mode of ['legacy', 'auto'] as const) {
      const client = new Client(
        { name: 'fanqie-host-contract', version: '1.0.0' },
        { versionNegotiation: { mode } },
      );
      try {
        await client.connect(
          new StreamableHTTPClientTransport(url, {
            requestInit: { headers: { authorization: `Bearer ${token}` } },
          }),
        );
        assert.equal((await client.listTools()).tools.length, 2);
        const result = await client.callTool({ name: 'fanqie_probe', arguments: {} });
        assert.equal(result.isError, undefined);
        assert.equal(
          (result.structuredContent as { result: { calls: number } }).result.calls,
          calls,
        );
        const failure = await client.callTool({ name: 'fanqie_failure', arguments: {} });
        assert.equal(failure.isError, true);
        assert.match(JSON.stringify(failure), /invalid_evidence/);
      } finally {
        await client.close();
      }
    }
    assert.equal(calls, 2);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
