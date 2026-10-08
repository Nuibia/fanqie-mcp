import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createApplication } from '../src/application.js';
import { loadConfig } from '../src/config.js';
import { BrowserSession, type LoginState } from '../src/platform/browser.js';
import { RuntimeError } from '../src/runtime/store.js';

class LeaseBudgetBrowser extends BrowserSession {
  checks = 0;
  override async checkLogin(): Promise<LoginState> {
    this.checks++;
    throw new Error('Lease budget fixtures forbid platform work');
  }
  override async withPage<T>(): Promise<T> {
    throw new Error('Lease budget fixtures forbid browser access');
  }
  override async close(): Promise<void> {
    /* No browser context was created. */
  }
}
const rejectsCode = (code: string) => (error: unknown) =>
  error instanceof RuntimeError && error.code === code;

test('application lease survives a synchronous operation pause but never renews or deletes a displaced owner lease', async (t) => {
  const clock = Date.parse('2026-10-05T00:00:00.000Z');
  // Advance wall time only: the real setInterval heartbeat cannot run during these synchronous checks.
  t.mock.timers.enable({ apis: ['Date'], now: clock });
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-application-lease-budget-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'synthetic-application-lease-budget-token',
    FANQIE_TIMEOUT_MS: '120000',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  const browsers: LeaseBudgetBrowser[] = [];
  const create = () => {
    const browser = new LeaseBudgetBrowser({ profileDir: config.profileDir, headless: true });
    browsers.push(browser);
    return createApplication(config, { browser });
  };
  let original: ReturnType<typeof createApplication> | undefined;
  let takeover: ReturnType<typeof createApplication> | undefined;
  let reopened: ReturnType<typeof createApplication> | undefined;
  let database: DatabaseSync | undefined;
  try {
    original = create();
    database = new DatabaseSync(path.join(config.dataDir, 'operations.sqlite'));
    const initialLease = database
      .prepare('SELECT owner_id,expires_at FROM service_lease WHERE id=1')
      .get();
    assert(initialLease);
    assert.equal(initialLease.expires_at, clock + 150_000);
    t.mock.timers.setTime(clock + 60_000);
    original.assertReadiness!();
    assert.deepEqual(
      database.prepare('SELECT owner_id,expires_at FROM service_lease WHERE id=1').get(),
      initialLease,
    );
    assert.throws(create, rejectsCode('service_already_running'));
    assert.deepEqual(
      database.prepare('SELECT owner_id,expires_at FROM service_lease WHERE id=1').get(),
      initialLease,
    );

    // Real expiry still fences the original API, and only a new Store can acquire the expired lease.
    t.mock.timers.setTime(clock + 150_001);
    assert.throws(() => original!.assertReadiness!(), rejectsCode('service_lease_lost'));
    assert.deepEqual(
      database.prepare('SELECT owner_id,expires_at FROM service_lease WHERE id=1').get(),
      initialLease,
    );
    takeover = create();
    takeover.assertReadiness!();
    const takeoverLease = database
      .prepare('SELECT owner_id,expires_at FROM service_lease WHERE id=1')
      .get();
    assert(takeoverLease);
    assert.notEqual(takeoverLease.owner_id, initialLease.owner_id);
    assert.equal(takeoverLease.expires_at, clock + 300_001);
    assert.throws(() => original!.assertReadiness!(), rejectsCode('service_lease_lost'));
    await original.close();
    original = undefined;
    assert.deepEqual(
      database.prepare('SELECT owner_id,expires_at FROM service_lease WHERE id=1').get(),
      takeoverLease,
    );
    takeover.assertReadiness!();

    // A normal close releases its own lease, so an immediate restart requires no expiry wait.
    await takeover.close();
    takeover = undefined;
    assert.equal(
      database.prepare('SELECT owner_id,expires_at FROM service_lease WHERE id=1').get(),
      undefined,
    );
    reopened = create();
    reopened.assertReadiness!();
    assert.equal(
      browsers.every((browser) => browser.checks === 0),
      true,
    );
    assert.equal(Number(database.prepare('SELECT count(*) AS n FROM jobs').get()!.n), 0);
  } finally {
    try {
      await reopened?.close();
      await takeover?.close();
      await original?.close();
    } finally {
      database?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
