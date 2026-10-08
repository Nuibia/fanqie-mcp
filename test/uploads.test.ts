import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createApplication } from '../src/application.js';
import { loadConfig } from '../src/config.js';
import { AppError } from '../src/errors.js';
import { BrowserSession } from '../src/platform/browser.js';
import { createHttpServer } from '../src/transport/http.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=',
  'base64',
);
// The existing receiver checks signatures, not image decoding or platform validity.
const pictures = [
  { mimeType: 'image/png', bytes: PNG, extension: 'png' },
  { mimeType: 'image/jpeg', bytes: Buffer.from([255, 216, 255, 217]), extension: 'jpg' },
  { mimeType: 'image/webp', bytes: Buffer.from('RIFF0000WEBP', 'ascii'), extension: 'webp' },
];
type Upload = { uploadPath: string; sha256: string; size: number };

function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-upload-contract-'));
  const config = loadConfig({
    FANQIE_PORT: '0',
    FANQIE_TOKEN: 'synthetic-cover-upload-contract-token',
    FANQIE_ENABLE_WRITES: 'false',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  const calls: string[] = [];
  const raw = new BrowserSession({ profileDir: config.profileDir, headless: true });
  const browser = new Proxy(raw, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      if (key === 'close') return value.bind(target);
      return () => {
        calls.push(String(key));
        throw Error('Upload fixture forbids browser use');
      };
    },
  });
  const app = createApplication(config, { browser });
  const tool = app.tools.find((tool) => tool.name === 'fanqie_upload_cover');
  assert(tool);
  return {
    directory,
    config,
    calls,
    app,
    tool,
    async unchanged() {
      assert.deepEqual(calls, []);
      assert.deepEqual(
        await app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined),
        { jobs: [] },
      );
      const status = (await app.dispatch(
        'GET',
        '/api/v1/status',
        new URLSearchParams(),
        undefined,
      )) as { writesEnabled: boolean; platform: { status: string; checkedAt: null } };
      assert.equal(status.writesEnabled, false);
      assert.deepEqual(status.platform, { status: 'unknown', checkedAt: null });
    },
    async close() {
      await app.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
function verifyFile(uploadDir: string, value: unknown, bytes: Buffer, extension: string): Upload {
  const upload = value as Upload;
  assert.deepEqual(Object.keys(upload).sort(), ['sha256', 'size', 'uploadPath']);
  assert.match(
    upload.uploadPath,
    new RegExp(
      '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\\.' + extension + '$',
    ),
  );
  assert.equal(path.basename(upload.uploadPath), upload.uploadPath);
  assert.equal(upload.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(upload.size, bytes.length);
  const file = path.join(uploadDir, upload.uploadPath);
  assert.deepEqual(readFileSync(file), bytes);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  return upload;
}

test('MCP and REST share actual file bytes, hashes, private modes, and the existing signature-only contract', async () => {
  const f = fixture();
  try {
    assert.equal(f.tool.readOnly, false);
    const paths: string[] = [];
    for (const picture of pictures) {
      const input = { mimeType: picture.mimeType, data: picture.bytes.toString('base64') };
      paths.push(
        verifyFile(f.config.uploadDir, await f.tool.run(input), picture.bytes, picture.extension)
          .uploadPath,
      );
      paths.push(
        verifyFile(
          f.config.uploadDir,
          await f.app.dispatch('POST', '/api/v1/uploads', new URLSearchParams(), input),
          picture.bytes,
          picture.extension,
        ).uploadPath,
      );
    }
    assert.equal(new Set(paths).size, 6);
    assert.deepEqual(readdirSync(f.config.uploadDir).sort(), [...paths].sort());
    // Preserve Buffer.from(base64)'s accepted legacy decoding, rather than silently tightening REST.
    verifyFile(
      f.config.uploadDir,
      await f.app.dispatch('POST', '/api/v1/uploads', new URLSearchParams(), {
        mimeType: 'image/png',
        data: PNG.toString('base64') + '!\n',
      }),
      PNG,
      'png',
    );
    await f.unchanged();
  } finally {
    await f.close();
  }
});

test('invalid upload schemas and declared signatures reject before files, tasks, login, or browser calls', async (t) => {
  const f = fixture(),
    valid = { mimeType: 'image/png', data: PNG.toString('base64') };
  const invalid: Array<[string, Record<string, unknown>, string]> = [
    ['path', { ...valid, uploadPath: '../outside.png' }, 'invalid_input'],
    ['URL', { ...valid, url: 'https://example.invalid/cover.png' }, 'invalid_input'],
    ['account', { ...valid, accountId: 'other' }, 'invalid_input'],
    ['supplied hash', { ...valid, sha256: 'a'.repeat(64) }, 'invalid_input'],
    ['unknown MIME', { ...valid, mimeType: 'image/svg+xml' }, 'invalid_input'],
    ['missing data', { mimeType: 'image/png' }, 'invalid_input'],
    ['non-string data', { ...valid, data: 12345678 }, 'invalid_input'],
    ['short data', { ...valid, data: '1234567' }, 'invalid_input'],
    ['oversize data', { ...valid, data: 'A'.repeat(4_000_001) }, 'invalid_input'],
    ['mismatched declared type', { ...valid, mimeType: 'image/jpeg' }, 'invalid_image'],
    [
      'unknown signature',
      { ...valid, data: Buffer.from('not an image').toString('base64') },
      'invalid_image',
    ],
  ];
  try {
    for (const [name, input, code] of invalid)
      await t.test(name, async () => {
        await assert.rejects(
          f.tool.run(input),
          (error: unknown) => error instanceof AppError && error.code === code,
        );
        await assert.rejects(
          f.app.dispatch('POST', '/api/v1/uploads', new URLSearchParams(), input),
          (error: unknown) =>
            code === 'invalid_image'
              ? error instanceof AppError && error.code === code
              : error instanceof Error && error.name === 'ZodError',
        );
        assert.deepEqual(readdirSync(f.config.uploadDir), []);
        await f.unchanged();
      });
  } finally {
    await f.close();
  }
});

test('real localhost SDK and REST expose the same bounded receipt and reject invalid or unauthenticated uploads', async () => {
  const f = fixture(),
    server = createHttpServer(f.config, f.app),
    client = new Client({ name: 'synthetic-upload-sdk', version: '1.0.0' });
  try {
    const address = await server.listen();
    assert(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`,
      headers = { authorization: `Bearer ${f.config.token}`, 'content-type': 'application/json' };
    await client.connect(
      new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
        requestInit: { headers, redirect: 'error' },
      }),
    );
    const tools = await client.listTools(),
      tool = tools.tools.find((tool) => tool.name === 'fanqie_upload_cover');
    assert(tool);
    assert.equal(tools.tools.length, 40);
    assert.equal(tool.annotations?.readOnlyHint, false);
    assert.equal(tool.annotations?.destructiveHint, true);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual(tool.inputSchema.required, ['mimeType', 'data']);
    assert.deepEqual(Object.keys(tool.inputSchema.properties!).sort(), ['data', 'mimeType']);
    const input = { mimeType: 'image/png', data: PNG.toString('base64') };
    const result = await client.callTool({ name: tool.name, arguments: input });
    assert.equal(result.isError, undefined);
    const receipt = (result.structuredContent as { result: Upload }).result;
    verifyFile(f.config.uploadDir, receipt, PNG, 'png');
    const text = result.content.find((block) => block.type === 'text');
    assert(text?.type === 'text');
    assert.deepEqual(JSON.parse(text.text), receipt);
    const rest = await fetch(base + '/api/v1/uploads', {
      method: 'POST',
      headers,
      redirect: 'error',
      body: JSON.stringify(input),
    });
    assert.equal(rest.status, 200);
    const restReceipt = verifyFile(f.config.uploadDir, await rest.json(), PNG, 'png');
    assert.notEqual(restReceipt.uploadPath, receipt.uploadPath);
    assert.deepEqual({ ...restReceipt, uploadPath: receipt.uploadPath }, receipt);
    const bad = await client.callTool({
      name: tool.name,
      arguments: { ...input, mimeType: 'image/jpeg' },
    });
    assert.equal(bad.isError, true);
    assert.match(JSON.stringify(bad), /invalid_image/);
    const extra = await client.callTool({
      name: tool.name,
      arguments: { ...input, uploadPath: '../escape.png' },
    });
    assert.equal(extra.isError, true);
    assert.equal(
      (
        await fetch(base + '/api/v1/uploads', {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...input, mimeType: 'image/jpeg' }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + '/api/v1/uploads', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(base + '/mcp', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(base + '/api/v1/uploads', {
          method: 'POST',
          headers: { ...headers, origin: 'https://example.invalid' },
          body: JSON.stringify(input),
        })
      ).status,
      403,
    );
    assert.equal(readdirSync(f.config.uploadDir).length, 2);
    await f.unchanged();
  } finally {
    await client.close();
    await server.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
