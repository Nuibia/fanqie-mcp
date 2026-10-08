import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

const base = process.env.FANQIE_TEST_URL ?? 'http://127.0.0.1:18062';
const token = readFileSync(
  process.env.FANQIE_TEST_TOKEN_FILE ?? '.secrets/api-token',
  'utf8',
).trim();
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const mode = process.argv[2] ?? 'smoke';
const contractPath = '.runtime/docker-acceptance.json';
mkdirSync('.runtime', { recursive: true, mode: 0o700 });
chmodSync('.runtime', 0o700);
async function rest(path, body) {
  const response = await fetch(`${base}${path}`, {
    headers,
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(135_000),
  });
  assert(response.ok, `HTTP ${response.status} for ${path}`);
  return response.json();
}
const client = new Client(
  { name: 'fanqie-local-docker-acceptance-host', version: '1.0.0' },
  { versionNegotiation: { mode: 'auto' } },
);
await client.connect(
  new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }),
);
async function call(name, args = {}) {
  const response = await client.callTool({ name, arguments: args }, { timeout: 135_000 });
  const result =
    response.structuredContent?.result ??
    JSON.parse(response.content.find((item) => item.type === 'text')?.text ?? '{}');
  return { result, isError: response.isError === true };
}
const brief = (result) => ({
  jobId: result.job.id,
  status: result.job.status,
  requestedAt: result.job.requestedAt,
  platformReadStartedAt: result.job.platformReadStartedAt,
  endedAt: result.job.endedAt,
  evidence: result.evidence.map(({ id, dataset, sha256 }) => ({ id, dataset, sha256 })),
  datasets: result.data.map((data) => ({
    dataset: data.dataset,
    count: data.records?.length ?? 0,
    complete: data.coverage?.complete ?? null,
  })),
});
try {
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/v1/status`)).status, 401);
  assert.equal(
    (
      await fetch(`${base}/api/v1/status`, {
        headers: { ...headers, origin: 'https://unapproved.invalid' },
      })
    ).status,
    403,
  );
  const listed = await client.listTools();
  assert(listed.tools.some((tool) => tool.name === 'fanqie_list_activities'));
  if (mode === 'recheck') {
    const saved = JSON.parse(readFileSync(contractPath, 'utf8'));
    for (const previous of saved.jobs) {
      const current = await rest(`/api/v1/jobs/${previous.jobId}`);
      assert.deepEqual(brief(current), previous);
    }
    const snapshot = await rest('/api/v1/snapshot?scope=activities');
    assert.equal(snapshot.sourceMode, 'saved');
    assert.equal(snapshot.manifest.id, saved.activitiesManifestId);
    console.log(
      JSON.stringify({
        stage: 'volume-rebuild',
        result: 'passed',
        jobsPreserved: saved.jobs.length,
        evidencePreserved: saved.jobs.reduce((n, job) => n + job.evidence.length, 0),
      }),
    );
  } else if (mode === 'qrcode') {
    rmSync('.runtime/login-qrcode.png', { force: true });
    const response = await client.callTool(
      { name: 'fanqie_get_login_qrcode', arguments: {} },
      { timeout: 135_000 },
    );
    const result =
      response.structuredContent?.result ??
      JSON.parse(response.content.find((item) => item.type === 'text')?.text ?? '{}');
    assert(!response.isError && result.job.status === 'succeeded', 'QR login request failed');
    assert(
      ['ready', 'authenticated', 'challenge', 'expired', 'unsupported'].includes(
        result.qrcode?.status,
      ),
    );
    let imagePath = null;
    if (result.qrcode.status === 'ready') {
      const image = response.content.find((item) => item.type === 'image');
      assert(image && image.mimeType === 'image/png', 'MCP did not return native PNG');
      const bytes = Buffer.from(image.data, 'base64');
      assert.equal(result.qrcode.imageSha256, createHash('sha256').update(bytes).digest('hex'));
      assert.equal(result.qrcode.imageSize, bytes.length);
      const png = PNG.sync.read(bytes);
      assert(
        jsQR(new Uint8ClampedArray(png.data), png.width, png.height),
        'Returned image did not decode as QR',
      );
      imagePath = '.runtime/login-qrcode.png';
      writeFileSync(imagePath, bytes, { mode: 0o600 });
      chmodSync(imagePath, 0o600);
      const saved = await rest(`/api/v1/jobs/${result.job.id}`);
      assert(!JSON.stringify(saved).includes(image.data), 'Durable job replayed QR bytes');
    }
    const receipt = {
      stage: 'qrcode',
      jobId: result.job.id,
      status: result.qrcode.status,
      checkedAt: result.qrcode.checkedAt,
      sourceUrl: result.qrcode.sourceUrl,
      appInstructions: result.qrcode.appInstructions,
      expiry: result.qrcode.expiry,
      imagePath,
      qrVerified: result.qrcode.qrVerified ?? false,
    };
    writeFileSync('.runtime/docker-qrcode.json', JSON.stringify(receipt, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(receipt));
  } else if (mode === 'login-check') {
    const { result, isError } = await call('fanqie_check_login_status');
    assert(!isError && result.job.status === 'succeeded', 'Login inspection failed');
    const state = result.data[0];
    assert(['login_required', 'authenticated', 'unknown'].includes(state?.status));
    if (state.status === 'authenticated') rmSync('.runtime/login-qrcode.png', { force: true });
    console.log(
      JSON.stringify({
        stage: 'login-check',
        jobId: result.job.id,
        status: state.status,
        checkedAt: state.checkedAt,
        sourceUrl: state.sourceUrl,
      }),
    );
  } else if (mode === 'login') {
    const state = await rest('/api/v1/login/start', {});
    assert.equal(
      state.job.status,
      'succeeded',
      `Browser login task failed: ${state.job.error?.code ?? state.job.status}`,
    );
    assert(
      ['login_required', 'authenticated'].includes(state.login?.status),
      'Platform login state has not been verified',
    );
    const screenshot = await rest('/api/v1/login/screenshot');
    writeFileSync('.runtime/login.png', Buffer.from(screenshot.data, 'base64'), { mode: 0o600 });
    const receipt = {
      stage: 'login',
      jobId: state.job.id,
      status: state.login.status,
      sourceUrl: state.login.sourceUrl,
      checkedAt: state.login.checkedAt,
      managementUrl: state.managementUrl,
      screenshotPath: '.runtime/login.png',
    };
    writeFileSync('.runtime/docker-login.json', JSON.stringify(receipt, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(receipt));
  } else {
    const jobs = [];
    for (const [name, args] of [
      ['fanqie_list_activities', {}],
      ['fanqie_get_writer_class_catalog', { category: '3' }],
      ['fanqie_list_activities', {}],
    ]) {
      const { result, isError } = await call(name, args);
      assert(!isError, `${name} did not produce complete live evidence`);
      assert.equal(result.job.status, 'succeeded');
      assert.equal(result.sourceMode, 'live');
      assert(result.job.platformReadStartedAt >= result.job.requestedAt);
      assert(result.job.endedAt >= result.job.platformReadStartedAt);
      assert(result.evidence.length > 0);
      jobs.push(brief(result));
      console.log(JSON.stringify({ stage: 'live-public-read', name, ...brief(result) }));
    }
    assert.notEqual(jobs[0].jobId, jobs[2].jobId);
    assert(jobs[2].platformReadStartedAt > jobs[0].endedAt);
    const snapshot = await rest('/api/v1/snapshot?scope=activities');
    assert.equal(snapshot.sourceMode, 'saved');
    assert.equal(snapshot.manifest.jobId, jobs[2].jobId);
    const mcpStatus = (await call('fanqie_get_service_status')).result;
    const restStatus = await rest('/api/v1/status');
    assert.deepEqual(mcpStatus, restStatus);
    writeFileSync(
      contractPath,
      JSON.stringify(
        { verifiedAt: new Date().toISOString(), jobs, activitiesManifestId: snapshot.manifest.id },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        stage: 'docker-smoke',
        result: 'passed',
        toolCount: listed.tools.length,
        platformLogin: restStatus.platform.status,
      }),
    );
  }
} finally {
  await client.close();
}
