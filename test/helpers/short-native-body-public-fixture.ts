import {
  type FixtureOptions,
  OWNER,
  TOKEN,
  SOURCE,
  DESIRED,
  edit,
  ACCOUNT,
  native,
  WORK,
  catalog,
  type BrowserInternals,
} from './short-native-body-public-account.js';

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { loadConfig } from '../../src/config.js';

import { DatabaseSync } from 'node:sqlite';

import assert from 'node:assert/strict';

import {
  type APIResponse,
  type APIRequestContext,
  type APIRequest,
  type BrowserContext,
} from 'playwright';

import {
  nativeShortMetadataFixedReadUrl,
  unavailableNativeShortMetadataApi,
  type NativeShortMetadataApiResult,
} from '../../src/platform/short-native-metadata-api.js';

import {
  nativeShortMetadataEndpoints,
  NATIVE_SHORT_HASH_BASES,
} from '../../src/platform/short-native-metadata.js';

import { BrowserSession } from '../../src/platform/browser.js';

import { createApplication } from '../../src/application.js';

import {
  type NativeShortBodyBusinessInput,
  NATIVE_SHORT_BODY_SCOPE,
  NATIVE_SHORT_BODY_REPRESENTATION,
} from '../../src/platform/short-native-body.js';

export function fixture(options: FixtureOptions = {}) {
  const dir = options.dir ?? mkdtempSync(path.join(os.tmpdir(), 'body-public-system-'));
  const serviceOwner = options.owner ?? OWNER;
  // Normal persistence uses the production default; crash fixtures supply an explicit budget.
  const configFor = (writes: boolean, owner = serviceOwner) =>
    loadConfig({
      FANQIE_TOKEN: TOKEN,
      FANQIE_PORT: '0',
      ...(options.timeoutMs === undefined ? {} : { FANQIE_TIMEOUT_MS: String(options.timeoutMs) }),
      FANQIE_ENABLE_WRITES: String(writes),
      FANQIE_ACCOUNT_ID: owner,
      FANQIE_DATA_DIR: dir,
      FANQIE_PROFILE_DIR: path.join(dir, 'unused-profile'),
      FANQIE_RUNTIME_DIR: path.join(dir, 'runtime'),
    });
  let config = configFor(options.writes ?? true),
    gets = 0,
    posts = 0,
    contexts = 0,
    disposals = 0,
    readCalls = 0,
    forbidden = 0,
    editReads = 0,
    active = 0,
    peak = 0;
  const mode = options.mode ?? 'success',
    source = options.source ?? SOURCE,
    expectedHtml = options.expectedHtml ?? DESIRED;
  let current: Record<string, unknown> = {
      ...edit(source),
      ...(options.derivedCount ? { word_number: 26 } : {}),
    },
    boundOwner = ACCOUNT,
    nextPartial = false,
    readMutate: ((raw: any) => void) | null = null;
  const baseline = native(current);
  const databasePath = path.join(dir, 'operations.sqlite'),
    evidenceDirectory = path.join(dir, 'evidence');
  const dbRead = <T>(fn: (db: DatabaseSync) => T): T => {
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      return fn(db);
    } finally {
      db.close();
    }
  };
  const dbMutate = (fn: (db: DatabaseSync) => void) => {
    const db = new DatabaseSync(databasePath);
    try {
      fn(db);
    } finally {
      db.close();
    }
  };
  const checkpoint = async (phase: string): Promise<never> => {
    assert(process.send);
    process.send!({ phase, gets, posts, contexts });
    return new Promise<never>(() => {});
  };
  const response = (url: string, data?: unknown) =>
    ({
      url: () => url,
      status: () => 200,
      headers: () => ({ 'content-type': 'application/json' }),
      async body() {
        return Buffer.from(JSON.stringify({ code: 0, ...(data === undefined ? {} : { data }) }));
      },
      async dispose() {},
    }) as unknown as APIResponse;
  const client = {
    async get(url: string) {
      gets++;
      if (nextPartial) {
        nextPartial = false;
        throw Error('PRIVATE_BODY partial synthetic GET');
      }
      if (url === nativeShortMetadataFixedReadUrl(WORK, 'own'))
        return response(url, { id: boundOwner });
      if (url === nativeShortMetadataFixedReadUrl(WORK, 'list', 0))
        return response(url, { total_count: 1, item_list: [{ item_id: WORK }] });
      if (url === nativeShortMetadataFixedReadUrl(WORK, 'catalog')) return response(url, catalog());
      if (url === nativeShortMetadataFixedReadUrl(WORK, 'edit')) {
        editReads++;
        if (mode === 'death-ack' && posts === 1) return checkpoint('post-ack-before-completion');
        if (editReads === 2) {
          if (mode === 'pre-save-drift')
            return response(url, { ...current, opaque: { changed: true } });
          if (mode === 'version-drift') return response(url, { ...current, latest_version: 9 });
          if (mode === 'owner-drift') boundOwner = '9002';
          if (mode === 'lease-drift')
            dbMutate((db) => {
              db.prepare('UPDATE service_lease SET owner_id=? WHERE id=1').run(
                'synthetic-foreign-lease',
              );
            });
          if (mode === 'cancel')
            dbMutate((db) => {
              db.prepare(
                "UPDATE jobs SET cancellation_requested_at=?,cancellation_reason_json=? WHERE status='running'",
              ).run(
                new Date().toISOString(),
                JSON.stringify({ code: 'cancelled', message: 'Cancelled' }),
              );
            });
        }
        return response(url, current);
      }
      throw Error('Forbidden synthetic GET resource');
    },
    async post(url: string, input: { data: string; maxRedirects: number; maxRetries: number }) {
      // The SQL transaction and physical attempt file must already exist when
      // the inherited owned transport first reaches this method.
      const attempts = dbRead((db) =>
        db.prepare('SELECT ordinal,evidence_id,event_at FROM native_short_body_attempts').all(),
      );
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0]!.ordinal, 1);
      if (mode === 'death-attempt') return checkpoint('committed-attempt-before-post');
      posts++;
      assert.equal(url, nativeShortMetadataEndpoints(WORK).save);
      assert.equal(input.maxRedirects, 0);
      assert.equal(input.maxRetries, 0);
      const form = new URLSearchParams(input.data);
      assert.equal(form.get('content'), expectedHtml);
      assert.equal(form.get('thumb_uri'), 'PRIVATE_HEAD_URI');
      assert.equal(form.get('book_thumb_uri'), 'PRIVATE_COVER_URI');
      current = {
        ...current,
        content: form.get('content'),
        latest_version: 8,
        modify_time: '1789450001',
        ...(options.derivedCount ? { word_number: 27 } : {}),
      };
      if (mode === 'ack-lost') throw Error('PRIVATE_BODY synthetic lost ACK');
      if (mode === 'ack-contradiction') return response(url, { item_id: '8000000001' });
      return response(url);
    },
    async dispose() {
      disposals++;
      active--;
    },
  } as unknown as APIRequestContext;
  const factory: Pick<APIRequest, 'newContext'> = {
    async newContext() {
      contexts++;
      active++;
      peak = Math.max(peak, active);
      return client;
    },
  };
  class PublicFixtureBrowser extends BrowserSession {
    override async withPage<T>(): Promise<T> {
      forbidden++;
      throw Error('Forbidden editor page');
    }
    override async checkLogin(): Promise<never> {
      forbidden++;
      throw Error('Forbidden login navigation');
    }
    override async runNativeShortMetadata(
      workId: string,
      opts: Parameters<BrowserSession['runNativeShortMetadata']>[1],
    ) {
      readCalls++;
      assert.equal(workId, WORK);
      assert.equal(opts.mode, 'read');
      assert.deepEqual(opts.expectedOwner, { kind: 'account', id: ACCOUNT });
      opts.assertLease();
      opts.onBeforePlatformRead();
      if (nextPartial) {
        nextPartial = false;
        return unavailableNativeShortMetadataApi('response_unverified');
      }
      const at = new Date().toISOString();
      const raw: NativeShortMetadataApiResult = {
        schema: 'native-short-metadata-api-read/v1',
        status: 'success',
        reason: null,
        snapshot: native(current),
        proof: {
          platformStarted: true,
          ownerBefore: true,
          ownerAfter: true,
          ownerCallback: true,
          fixedSourceVerified: true,
          targetUnique: true,
          paginationComplete: true,
          atomicRevision: false,
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
      opts.onVerifiedAccount(ACCOUNT, at);
      const captured = JSON.parse(JSON.stringify(raw)) as NativeShortMetadataApiResult;
      readMutate?.(captured);
      return captured;
    }
  }
  let browser = new PublicFixtureBrowser({
    profileDir: config.profileDir,
    headless: true,
    operationTimeoutMs: config.timeoutMs,
  });
  const borrowed = {
    browser() {
      return { isConnected: () => true };
    },
    async cookies() {
      return [];
    },
    async close() {},
    async newPage() {
      forbidden++;
      throw Error('Forbidden new page');
    },
  } as unknown as BrowserContext;
  const attach = () => {
    const internals = browser as unknown as BrowserInternals;
    internals.context = borrowed;
    internals.page = {
      isClosed: () => false,
      context: () => borrowed,
      async goto() {
        forbidden++;
        throw Error('Forbidden navigation');
      },
      async close() {},
    };
  };
  attach();
  writeFileSync(
    path.join(dir, 'account-binding.json'),
    JSON.stringify({ accountId: serviceOwner, platformId: ACCOUNT, platformIdType: 'account' }),
  );
  let app = createApplication(config, {
    browser,
    ...(options.withFactory === false ? {} : { nativeShortBodyFixtureFactory: factory }),
  });
  const call = (name: string, input: unknown) =>
    app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_' + name,
      new URLSearchParams(),
      input,
    ) as Promise<any>;
  const business = (noChange = false): NativeShortBodyBusinessInput => ({
    target: { kind: 'short', workId: WORK },
    snapshotScope: NATIVE_SHORT_BODY_SCOPE,
    expectedSnapshotVersionHash: baseline.snapshotVersionHash,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedState: 'draft',
    representation: NATIVE_SHORT_BODY_REPRESENTATION,
    paragraphs: [
      {
        sourceIndex: noChange ? 0 : null,
        lines: [noChange ? 'PRIVATE_BODY甲' : 'PRIVATE_BODY修改'],
      },
      { sourceIndex: 1, lines: ['PRIVATE_TAIL乙'] },
    ],
    trial: { action: 'clear' },
  });
  const request = (noChange = false, key = 'synthetic-public-body-key') => ({
    idempotencyKey: key,
    ...business(noChange),
  });
  return {
    dir,
    databasePath,
    evidenceDirectory,
    get browser() {
      return browser;
    },
    factory,
    dbRead,
    dbMutate,
    request,
    call,
    business,
    get app() {
      return app;
    },
    get config() {
      return config;
    },
    get current() {
      return current;
    },
    get counters() {
      return { gets, posts, contexts, disposals, readCalls, forbidden, peak };
    },
    jobs() {
      return dbRead((db) => db.prepare('SELECT * FROM jobs ORDER BY rowid').all());
    },
    refs(jobId: string) {
      return dbRead((db) =>
        db.prepare('SELECT * FROM evidence WHERE job_id=? ORDER BY rowid').all(jobId),
      );
    },
    attempts(jobId: string) {
      return dbRead((db) =>
        db
          .prepare('SELECT * FROM native_short_body_attempts WHERE job_id=? ORDER BY ordinal')
          .all(jobId),
      );
    },
    nextPartial() {
      nextPartial = true;
    },
    foreignOwner() {
      boundOwner = '9002';
    },
    setCurrent(value: Record<string, unknown>) {
      current = value;
    },
    mutateRead(value: typeof readMutate) {
      readMutate = value;
    },
    async reopen(
      writes = false,
      owner = serviceOwner,
      withFactory = options.withFactory !== false,
    ) {
      await app.close();
      config = configFor(writes, owner);
      browser = new PublicFixtureBrowser({
        profileDir: config.profileDir,
        headless: true,
        operationTimeoutMs: config.timeoutMs,
      });
      attach();
      app = createApplication(config, {
        browser,
        ...(withFactory ? { nativeShortBodyFixtureFactory: factory } : {}),
      });
    },
    async close() {
      await app.close();
      if (!options.keep) rmSync(dir, { recursive: true, force: true });
    },
  };
}
