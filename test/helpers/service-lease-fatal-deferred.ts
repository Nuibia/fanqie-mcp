import { RuntimeError, Store } from '../../src/runtime/store.js';

import { mkdtempSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { JobQueue } from '../../src/runtime/jobs.js';

import { DatabaseSync } from 'node:sqlite';

import { BrowserSession } from '../../src/platform/browser.js';

import { loadConfig } from '../../src/config.js';

import { createApplication } from '../../src/application.js';

export const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

export const lost = (error: unknown) =>
  error instanceof RuntimeError && error.code === 'service_lease_lost';

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-service-fatal-'));
  const options = {
    databasePath: path.join(directory, 'runtime.sqlite'),
    evidenceDirectory: path.join(directory, 'evidence'),
    leaseDurationMs: 30_000,
    evidenceMode: 'fixture' as const,
  };
  const store = new Store(options),
    queue = new JobQueue(store),
    db = new DatabaseSync(options.databasePath);
  return {
    directory,
    options,
    store,
    queue,
    db,
    expire() {
      db.prepare('UPDATE service_lease SET expires_at = ? WHERE id = 1').run(Date.now() - 1);
    },
  };
}

class CleanupBrowser extends BrowserSession {
  closeCalls = 0;
  release = deferred();
  reject = false;
  override async close(): Promise<void> {
    this.closeCalls++;
    if (this.reject) throw new Error('PRIVATE_SYNTHETIC_BROWSER_CLEANUP');
    await this.release.promise;
  }
  override async withPage<T>(): Promise<T> {
    throw new Error('No platform in lifecycle fixtures');
  }
}

export function applicationFixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fanqie-fatal-application-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'synthetic-lifecycle-token',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  const browser = new CleanupBrowser({ profileDir: config.profileDir, headless: true });
  const application = createApplication(config, { browser });
  let store!: Store;
  const assertLease = Store.prototype.assertLeaseOwnership;
  Store.prototype.assertLeaseOwnership = function () {
    store = this;
    return assertLease.call(this);
  };
  try {
    application.assertReadiness!();
  } finally {
    Store.prototype.assertLeaseOwnership = assertLease;
  }
  const db = new DatabaseSync(path.join(config.dataDir, 'operations.sqlite'));
  return { directory, config, browser, application, store, db };
}
