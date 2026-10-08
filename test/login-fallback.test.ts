import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readLoginFallback } from '../src/runtime/login-fallback.js';
import { loadConfig } from '../src/config.js';
import { createApplication } from '../src/application.js';
import {
  BrowserSession,
  type LoginState,
  type LoginQrcodeResult,
} from '../src/platform/browser.js';

const privateSentinel = 'PRIVATE_SENTINEL_NOT_FOR_RESPONSE';
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fanqie-fallback-state-test-'));
  const stateFile = path.join(root, 'state.json');
  const instanceId = randomUUID();
  const value = (
    status = 'available',
    code = 'verified',
    checkedAt = new Date().toISOString(),
    instance = instanceId,
  ) => ({ schemaVersion: 1, instanceId: instance, status, code, checkedAt });
  const write = (state: unknown) => {
    writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
    chmodSync(stateFile, 0o600);
  };
  return {
    root,
    stateFile,
    instanceId,
    value,
    write,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
test('fresh fixed-schema fallback availability is separate from login and hides the generation', () => {
  const f = fixture();
  try {
    f.write(f.value());
    const result = readLoginFallback(f);
    assert.equal(result.status, 'available');
    assert.equal(result.code, 'verified');
    assert.equal(JSON.stringify(result).includes(f.instanceId), false);
    f.write(f.value('starting', 'checking'));
    assert.equal(readLoginFallback(f).status, 'starting');
    f.write(f.value('unavailable', 'probe_failed'));
    assert.equal(readLoginFallback(f).status, 'unavailable');
  } finally {
    f.cleanup();
  }
});
test('missing, stale, future and prior-boot fallback state cannot claim available', () => {
  const f = fixture();
  try {
    assert.equal(readLoginFallback(f).status, 'unknown');
    for (const state of [
      f.value('available', 'verified', new Date(Date.now() - 15_001).toISOString()),
      f.value('available', 'verified', new Date(Date.now() + 2_000).toISOString()),
      f.value('available', 'verified', new Date().toISOString(), randomUUID()),
      null,
    ]) {
      f.write(state);
      assert.equal(readLoginFallback(f).status, 'unknown');
    }
  } finally {
    f.cleanup();
  }
});
test('extra/private fields, unsupported codes, public files, symlinks and oversized state are refused', () => {
  const f = fixture();
  try {
    for (const state of [
      { ...f.value(), raw: privateSentinel },
      f.value('available', privateSentinel),
      { ...f.value(), checkedAt: 'not-a-time' },
      { ...f.value(), schemaVersion: 2 },
    ]) {
      f.write(state);
      const result = readLoginFallback(f);
      assert.equal(result.status, 'unknown');
      assert.ok(!JSON.stringify(result).includes(privateSentinel));
    }
    f.write(f.value());
    chmodSync(f.stateFile, 0o644);
    assert.equal(readLoginFallback(f).status, 'unknown');
    rmSync(f.stateFile);
    const target = path.join(f.root, 'target.json');
    writeFileSync(target, JSON.stringify(f.value()), { mode: 0o600 });
    symlinkSync(target, f.stateFile);
    assert.equal(readLoginFallback(f).status, 'unknown');
    rmSync(f.stateFile);
    writeFileSync(f.stateFile, privateSentinel.repeat(200), { mode: 0o600 });
    assert.equal(readLoginFallback(f).status, 'unknown');
  } finally {
    f.cleanup();
  }
});
test('configuration binds only a valid boot generation to the fixed private path', () => {
  const f = fixture();
  try {
    const env = {
      FANQIE_TOKEN: 'synthetic-test-token-at-least-24',
      FANQIE_DATA_DIR: path.join(f.root, 'data'),
      FANQIE_PROFILE_DIR: path.join(f.root, 'profile'),
      FANQIE_RUNTIME_DIR: path.join(f.root, 'runtime'),
      FANQIE_LOGIN_FALLBACK_INSTANCE: f.instanceId,
    };
    assert.deepEqual(loadConfig(env).loginFallback, {
      stateFile: '/run/fanqie/login-fallback.json',
      instanceId: f.instanceId,
    });
    assert.equal(
      loadConfig({ ...env, FANQIE_LOGIN_FALLBACK_INSTANCE: privateSentinel }).loginFallback,
      undefined,
    );
  } finally {
    f.cleanup();
  }
});
test('status, QR and manual-login responses reread availability and omit URLs after failure or expiry', async () => {
  const f = fixture();
  const login: LoginState = {
    status: 'unknown',
    identity: null,
    sourceUrl: 'https://fanqienovel.com/main/writer',
    checkedAt: new Date().toISOString(),
    reason: 'Fixture only',
  };
  class FixtureBrowser extends BrowserSession {
    override async getLoginQrcode(): Promise<LoginQrcodeResult> {
      return {
        status: 'unsupported',
        login,
        checkedAt: login.checkedAt,
        sourceUrl: login.sourceUrl,
        platform: 'fanqie',
        appInstructions: 'Fixture platform prompt',
        expiry: { status: 'unknown' },
        reason: 'Fixture only',
      };
    }
    override async startLogin() {
      return { ...login, interactionMode: 'visible_browser' as const, pageUrl: login.sourceUrl };
    }
  }
  const config = {
    ...loadConfig({
      FANQIE_TOKEN: 'synthetic-test-token-at-least-24',
      FANQIE_DATA_DIR: path.join(f.root, 'data'),
      FANQIE_PROFILE_DIR: path.join(f.root, 'profile'),
      FANQIE_RUNTIME_DIR: path.join(f.root, 'runtime'),
    }),
    loginFallback: { stateFile: f.stateFile, instanceId: f.instanceId },
  };
  const app = createApplication(config, {
    browser: new FixtureBrowser({ profileDir: config.profileDir, headless: true }),
  });
  try {
    for (const state of [
      f.value(),
      f.value('unavailable', 'probe_failed'),
      f.value('starting', 'checking'),
      f.value('available', 'verified', new Date(Date.now() - 16_000).toISOString()),
      f.value('available', 'verified', new Date().toISOString(), randomUUID()),
      null,
    ]) {
      if (state === null) rmSync(f.stateFile);
      else f.write(state);
      const available = readLoginFallback(f).status === 'available';
      const status = (await app.dispatch(
        'GET',
        '/api/v1/status',
        new URLSearchParams(),
        undefined,
      )) as Record<string, unknown>;
      assert.equal(
        (status.loginFallback as Record<string, unknown>).status === 'available',
        available,
      );
      for (const [toolName, urlKey] of [
        ['fanqie_get_login_qrcode', 'fallbackManagementUrl'],
        ['fanqie_start_login', 'managementUrl'],
      ]) {
        const tool = app.tools.find((item) => item.name === toolName)!;
        const response = (await tool.run({})) as Record<string, unknown>;
        assert.equal(urlKey! in response, available);
        assert.equal(
          (response.loginFallback as Record<string, unknown>).status === 'available',
          available,
        );
        assert.ok(!JSON.stringify(response).includes(f.instanceId));
      }
    }
  } finally {
    await app.close();
    f.cleanup();
  }
});
