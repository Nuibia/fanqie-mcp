import test from 'node:test';

import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { bindingFixture } from './helpers/application-binding-fixture.js';

import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.js';

import { BrowserSession } from '../src/platform/browser.js';

import { createApplication } from '../src/application.js';

test('typed account binding survives service restart and never substitutes the author field when account ID is missing', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-binding-restart-'));
  const first = bindingFixture(directory, [{ accountId: '1001', authorId: null }]);
  try {
    assert.equal((await first.check()).job.status, 'succeeded');
  } finally {
    await first.application.close();
  }
  const resumed = bindingFixture(directory, [
    { accountId: '1001', authorId: '2001' },
    { accountId: null, authorId: '1001' },
  ]);
  try {
    assert.equal((await resumed.check()).job.status, 'succeeded');
    const missing = (await resumed.check()).job;
    assert.equal(missing.status, 'failed');
    assert.equal(missing.error?.code, 'capability_unavailable');
    assert.deepEqual(JSON.parse(readFileSync(resumed.bindingFile, 'utf8')), {
      accountId: 'binding-fixture-author',
      platformId: '1001',
      platformIdType: 'account',
    });
  } finally {
    await resumed.application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy verified account binding migrates only after an exact account-ID match and remains fixed across restart', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-binding-legacy-'));
  const legacy = { accountId: 'binding-fixture-author', platformId: '1001' };
  mkdirSync(path.join(directory, 'data'), { mode: 0o700 });
  const bindingFile = path.join(directory, 'data', 'account-binding.json');
  writeFileSync(bindingFile, JSON.stringify(legacy), { mode: 0o600 });
  const fixture = bindingFixture(directory, [
    { accountId: null, authorId: '1001' },
    { accountId: '3001', authorId: '1001' },
    { accountId: '1001', authorId: '2001' },
  ]);
  try {
    assert.equal((await fixture.check()).job.error?.code, 'capability_unavailable');
    assert.deepEqual(JSON.parse(readFileSync(bindingFile, 'utf8')), legacy);
    assert.equal((await fixture.check()).job.error?.code, 'account_mismatch');
    assert.deepEqual(JSON.parse(readFileSync(bindingFile, 'utf8')), legacy);
    assert.equal((await fixture.check()).job.status, 'succeeded');
    assert.deepEqual(JSON.parse(readFileSync(bindingFile, 'utf8')), {
      ...legacy,
      platformIdType: 'account',
    });
  } finally {
    await fixture.application.close();
  }
  const resumed = bindingFixture(directory, [{ accountId: '1001', authorId: '4001' }]);
  try {
    assert.equal((await resumed.check()).job.status, 'succeeded');
    assert.deepEqual(JSON.parse(readFileSync(bindingFile, 'utf8')), {
      ...legacy,
      platformIdType: 'account',
    });
  } finally {
    await resumed.application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an initial author-only binding stays in its author namespace and requires that same typed identity', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-binding-author-'));
  const fixture = bindingFixture(directory, [
    { accountId: null, authorId: '2001' },
    { accountId: '1001', authorId: '2001' },
    { accountId: '2001', authorId: null },
    { accountId: '1001', authorId: '4001' },
  ]);
  try {
    assert.equal((await fixture.check()).job.status, 'succeeded');
    assert.equal((await fixture.check()).job.status, 'succeeded');
    assert.equal((await fixture.check()).job.error?.code, 'capability_unavailable');
    assert.equal((await fixture.check()).job.error?.code, 'account_mismatch');
    assert.deepEqual(JSON.parse(readFileSync(fixture.bindingFile, 'utf8')), {
      accountId: 'binding-fixture-author',
      platformId: '2001',
      platformIdType: 'author',
    });
  } finally {
    await fixture.application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('unknown or identity-free views cannot fetch account data or ask an already logged-in user to scan again', async () => {
  for (const state of ['unknown', 'authenticated', 'login_required'] as const) {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-identity-guard-'));
    const config = loadConfig({
      FANQIE_TOKEN: 'account-guard-fixture-long-token',
      FANQIE_DATA_DIR: path.join(directory, 'data'),
      FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
      FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
    });
    let navigations = 0;
    class GuardedBrowser extends BrowserSession {
      override async checkLogin() {
        return {
          status: state,
          identity: null,
          sourceUrl: 'https://fanqienovel.com/main/writer/',
          checkedAt: new Date().toISOString(),
        };
      }
      override async withPage<T>(): Promise<T> {
        navigations++;
        throw Error('Fixture forbids browser navigation');
      }
    }
    const application = createApplication(config, {
      browser: new GuardedBrowser({ profileDir: config.profileDir, headless: true }),
    });
    try {
      const result = (await application.dispatch(
        'POST',
        '/api/v1/tools/fanqie_list_works',
        new URLSearchParams(),
        { kind: 'short' },
      )) as Record<string, any>;
      assert.equal(
        result.job.error.code,
        state === 'login_required' ? 'requires_login' : 'capability_unavailable',
      );
      assert.equal(result.job.status, state === 'login_required' ? 'waiting_for_login' : 'failed');
      assert.equal(navigations, 0);
      assert.deepEqual(result.data, []);
      const snapshot = (await application.dispatch(
        'GET',
        '/api/v1/snapshot',
        new URLSearchParams(),
        undefined,
      )) as Record<string, any>;
      assert.equal(snapshot.manifest, null);
    } finally {
      await application.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test('service status is safe for Host connection checks without exposing account or job details', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-status-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'private-status-test-token-value',
    FANQIE_ACCOUNT_ID: 'private-account-alias',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  const application = createApplication(config);
  try {
    const statusTool = application.tools.find((tool) => tool.name === 'fanqie_get_service_status');
    assert(statusTool);
    const status = (await statusTool.run({})) as Record<string, unknown>;
    assert.deepEqual(Object.keys(status).sort(), [
      'jobCounts',
      'loginFallback',
      'platform',
      'service',
      'status',
      'version',
      'writesEnabled',
    ]);
    assert.deepEqual(status.loginFallback, {
      status: 'unknown',
      code: 'not_configured',
      checkedAt: null,
    });
    assert.deepEqual(status.platform, { status: 'unknown', checkedAt: null });
    assert.deepEqual(status.jobCounts, {});
    assert.equal(status.service, 'fanqie-mcp');
    assert.equal(status.status, 'ready');
    assert.equal(JSON.stringify(status).includes('private-account-alias'), false);
    assert.equal(JSON.stringify(status).includes(config.token), false);
    assert.deepEqual(
      await application.dispatch('GET', '/api/v1/status', new URLSearchParams(), undefined),
      status,
    );
  } finally {
    await application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
