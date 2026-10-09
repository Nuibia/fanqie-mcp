import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const base = new URL(process.env.FANQIE_TEST_URL ?? 'http://127.0.0.1:18062');
assert(
  ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname),
  'Use an isolated local service',
);
const token = readFileSync(
  process.env.FANQIE_TEST_TOKEN_FILE ?? '.secrets/api-token',
  'utf8',
).trim();
const headers = { authorization: `Bearer ${token}` };
const client = new Client(
  { name: 'fanqie-release-smoke', version: '1.0.0' },
  { versionNegotiation: { mode: 'auto' } },
);
async function request(path, extraHeaders = {}) {
  return fetch(new URL(path, base), {
    headers: extraHeaders,
    signal: AbortSignal.timeout(10_000),
  });
}
async function call(name, args = {}) {
  const response = await client.callTool({ name, arguments: args }, { timeout: 135_000 });
  assert.notEqual(response.isError, true, `${name} returned a tool error`);
  return (
    response.structuredContent?.result ??
    JSON.parse(response.content.find((item) => item.type === 'text')?.text ?? '{}')
  );
}
try {
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/api/v1/status')).status, 401);
  assert.equal(
    (await request('/api/v1/status', { ...headers, origin: 'https://unapproved.invalid' })).status,
    403,
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', base), { requestInit: { headers } }),
  );
  const { tools } = await client.listTools();
  assert.equal(tools.length, 40);
  const rest = await request('/api/v1/status', headers);
  assert.equal(rest.status, 200);
  const status = await call('fanqie_get_service_status');
  assert.deepEqual(status, await rest.json());
  assert.equal(status.writesEnabled, false);
  const capabilities = await call('fanqie_get_capabilities');
  assert.equal(capabilities.writesEnabled, false);
  if (process.argv.includes('--public')) {
    const catalog = await call('fanqie_get_writer_class_catalog', { category: '1' });
    assert.equal(catalog.job.status, 'succeeded');
    assert.equal(catalog.sourceMode, 'live');
    const dataset = catalog.data.find((item) => item.dataset === 'writer_classes');
    assert.equal(dataset?.coverage.complete, true);
    assert.equal(dataset?.coverage.paginationComplete, true);
    assert(dataset.records.length > 0);
    const saved = await call('fanqie_get_saved_snapshot', { scope: 'writer_classes.tab1' });
    assert.equal(saved.sourceMode, 'saved');
    assert.equal(saved.manifest?.jobId, catalog.job.id);
    assert.deepEqual(saved.data, catalog.data);
    console.log(JSON.stringify({ publicCatalog: 'passed', records: dataset.records.length }));
  }
  console.log(JSON.stringify({ smoke: 'passed', tools: tools.length, writesEnabled: false }));
} finally {
  await client.close();
}
