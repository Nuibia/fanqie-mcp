import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createApplication } from '../src/application.js';
import { loadConfig } from '../src/config.js';
import { BrowserSession, type LoginState } from '../src/platform/browser.js';
import { RuntimeError, Store, type Job } from '../src/runtime/store.js';
import { createHttpServer } from '../src/transport/http.js';

const healthy = { status: 'ok', service: 'fanqie-mcp', version: '0.1.0' };
const unavailable = {
  status: 'unavailable',
  service: 'fanqie-mcp',
  version: '0.1.0',
  code: 'runtime_unavailable',
};

class ReadinessBrowser extends BrowserSession {
  checks = 0;
  override async checkLogin(): Promise<LoginState> {
    this.checks += 1;
    return {
      status: 'unknown',
      identity: null,
      sourceUrl: 'https://fixture.invalid/login',
      checkedAt: new Date().toISOString(),
    };
  }
  override async withPage<T>(): Promise<T> {
    throw new Error('Readiness fixtures forbid browser access');
  }
}

function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-runtime-readiness-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'runtime-readiness-fixture-only-token',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  const databasePath = path.join(config.dataDir, 'operations.sqlite');
  return {
    directory,
    config,
    databasePath,
    create() {
      const browser = new ReadinessBrowser({ profileDir: config.profileDir, headless: true });
      const application = createApplication(config, { browser });
      return { application, browser, config, transport: createHttpServer(config, application) };
    },
  };
}

/** Run the actual HTTP request listener without opening any socket or making a request. */
async function request(
  transport: ReturnType<typeof createHttpServer>,
  pathname = '/health',
  token?: string,
) {
  let status = 0;
  let body = '';
  const request = {
    method: 'GET',
    url: pathname,
    headers: { host: 'localhost', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  } as IncomingMessage;
  const response = {
    headersSent: false,
    writeHead(value: number) {
      status = value;
    },
    end(value: string) {
      body = value;
    },
  } as unknown as ServerResponse;
  const handler = transport.server.listeners('request')[0];
  assert(handler);
  await Reflect.apply(handler, transport.server, [request, response]);
  return { status, body: JSON.parse(body) as unknown };
}

const health = (transport: ReturnType<typeof createHttpServer>) => request(transport);
async function serviceStatus(
  current: ReturnType<ReturnType<typeof fixture>['create']>,
  expected: 'ready' | 'unavailable',
) {
  const rest = await request(current.transport, '/api/v1/status', current.config.token);
  const tool = current.application.tools.find((item) => item.name === 'fanqie_get_service_status');
  assert(tool);
  const mcp = (await tool.run({})) as { status: string };
  assert.equal(rest.status, 200);
  assert.deepEqual(rest.body, mcp);
  assert.equal(mcp.status, expected);
  assert.deepEqual(Object.keys(mcp).sort(), [
    'jobCounts',
    'loginFallback',
    'platform',
    'service',
    'status',
    'version',
    'writesEnabled',
  ]);
}

const jobCount = async (application: ReturnType<typeof createApplication>) =>
  (
    (await application.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined)) as {
      jobs: Job[];
    }
  ).jobs.length;
const checkLogin = (application: ReturnType<typeof createApplication>) => {
  const tool = application.tools.find((item) => item.name === 'fanqie_check_login_status');
  assert(tool);
  return tool.run({}) as Promise<{ job: Job }>;
};

test('expired runtime fails health and admission while saved evidence remains readable without renewal', async () => {
  const f = fixture();
  const seed = new Store({
    databasePath: f.databasePath,
    evidenceDirectory: path.join(f.config.dataDir, 'evidence'),
  });
  const job = seed.createJob({
    accountId: f.config.accountId,
    kind: 'read',
    operation: 'fixture_saved',
    datasets: ['works'],
  }).job;
  seed.startJob(job.id);
  seed.markPlatformReadStarted(job.id);
  seed.completeReadJob(job.id, [seed.saveEvidence(job.id, 'works', { complete: true, works: [] })]);
  seed.close();
  const current = f.create();
  const database = new DatabaseSync(f.databasePath);
  try {
    const before = await current.application.dispatch(
      'GET',
      '/api/v1/snapshot',
      new URLSearchParams(),
      undefined,
    );
    const count = await jobCount(current.application);
    const expiresAt = Date.now() - 60_000;
    database.prepare('UPDATE service_lease SET expires_at = ? WHERE id = 1').run(expiresAt);
    await serviceStatus(current, 'unavailable');
    assert.deepEqual(await health(current.transport), { status: 503, body: unavailable });
    await assert.rejects(
      checkLogin(current.application),
      (error: unknown) => error instanceof RuntimeError && error.code === 'service_lease_lost',
    );
    assert.equal(await jobCount(current.application), count);
    assert.equal(current.browser.checks, 0);
    assert.deepEqual(
      await current.application.dispatch(
        'GET',
        '/api/v1/snapshot',
        new URLSearchParams(),
        undefined,
      ),
      before,
    );
    assert.equal(
      database.prepare('SELECT expires_at FROM service_lease WHERE id = 1').get()!.expires_at,
      expiresAt,
    );
    assert.deepEqual(await health(current.transport), { status: 503, body: unavailable });
  } finally {
    database.close();
    await current.transport.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test('another lease owner fails health and admission without reclaiming or revealing its identity', async () => {
  const f = fixture();
  const current = f.create();
  const database = new DatabaseSync(f.databasePath);
  try {
    database
      .prepare('UPDATE service_lease SET owner_id = ?, expires_at = ? WHERE id = 1')
      .run('PRIVATE_SYNTHETIC_OTHER_OWNER', Date.now() + 60_000);
    const lease = database
      .prepare('SELECT owner_id, expires_at FROM service_lease WHERE id = 1')
      .get();
    await serviceStatus(current, 'unavailable');
    assert.deepEqual(await health(current.transport), { status: 503, body: unavailable });
    await assert.rejects(
      checkLogin(current.application),
      (error: unknown) => error instanceof RuntimeError && error.code === 'service_lease_lost',
    );
    assert.equal(await jobCount(current.application), 0);
    assert.equal(current.browser.checks, 0);
    assert.deepEqual(
      database.prepare('SELECT owner_id, expires_at FROM service_lease WHERE id = 1').get(),
      lease,
    );
  } finally {
    database.close();
    await current.transport.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test('a closed runtime fails health and normal idle reopen restores admission with the original healthy payload', async () => {
  const f = fixture();
  const first = f.create();
  try {
    assert.deepEqual(await health(first.transport), { status: 200, body: healthy });
    await serviceStatus(first, 'ready');
    await first.application.close();
    assert.deepEqual(await health(first.transport), { status: 503, body: unavailable });
    assert.throws(
      () => first.application.assertReadiness!(),
      (error: unknown) => error instanceof RuntimeError && error.code === 'store_closed',
    );
    await assert.rejects(
      checkLogin(first.application),
      (error: unknown) => error instanceof RuntimeError && error.code === 'service_stopping',
    );
    await first.transport.close();
    const resumed = f.create();
    try {
      assert.deepEqual(await health(resumed.transport), { status: 200, body: healthy });
      await serviceStatus(resumed, 'ready');
      assert.equal(await jobCount(resumed.application), 0);
      assert.equal((await checkLogin(resumed.application)).job.status, 'succeeded');
      assert.equal(await jobCount(resumed.application), 1);
      assert.equal(resumed.browser.checks, 1);
      assert.deepEqual(await health(resumed.transport), { status: 200, body: healthy });
      await serviceStatus(resumed, 'ready');
    } finally {
      await resumed.transport.close();
    }
  } finally {
    await first.transport.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
