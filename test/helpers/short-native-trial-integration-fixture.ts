import {
  type Mode,
  ACCOUNT,
  edit,
  WORK,
  catalog,
  readResult,
  snapshot,
} from './short-native-trial-integration-edit.js';

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { loadConfig } from '../../src/config.js';

import {
  type APIResponse,
  type APIRequestContext,
  type BrowserContext,
  type APIRequest,
} from 'playwright';

import {
  nativeShortMetadataFixedReadUrl,
  type NativeShortMetadataApiResult,
  unavailableNativeShortMetadataApi,
} from '../../src/platform/short-native-metadata-api.js';

import assert from 'node:assert/strict';

import {
  nativeShortMetadataEndpoints,
  NATIVE_SHORT_HASH_BASES,
} from '../../src/platform/short-native-metadata.js';

import { BrowserSession } from '../../src/platform/browser.js';

import {
  type NativeShortTrialApiResult,
  OwnedNativeShortTrialRun,
} from '../../src/platform/short-native-trial-api.js';

import { createApplication } from '../../src/application.js';

import { NATIVE_SHORT_TRIAL_SCOPE } from '../../src/platform/short-native-trial.js';

import { DatabaseSync } from 'node:sqlite';

export function fixture(writesEnabled = true, mode: Mode = 'success') {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'native-trial-integration-synthetic-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'synthetic-trial-integration-token',
    FANQIE_ENABLE_WRITES: String(writesEnabled),
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  writeFileSync(
    path.join(config.dataDir, 'account-binding.json'),
    JSON.stringify({ accountId: config.accountId, platformId: ACCOUNT, platformIdType: 'account' }),
  );
  let reads = 0,
    writes = 0,
    trialCalls = 0,
    contexts = 0,
    editCalls = 0,
    quarantine = false,
    incompleteNextRead = false;
  let current: Record<string, unknown> = edit(),
    posted: Record<string, unknown> | null = null;
  const posts: string[] = [],
    forms: URLSearchParams[] = [];
  const response = (url: string, data: unknown, save = false) =>
    ({
      url: () => url,
      status: () => 200,
      headers: () => ({ 'content-type': 'application/json' }),
      async body() {
        return Buffer.from(JSON.stringify({ code: 0, ...(save ? {} : { data }) }));
      },
      async dispose() {},
    }) as unknown as APIResponse;
  const client = {
    async get(url: string) {
      reads++;
      let data: unknown;
      if (url === nativeShortMetadataFixedReadUrl(WORK, 'own')) data = { id: ACCOUNT };
      else if (url === nativeShortMetadataFixedReadUrl(WORK, 'list', 0))
        data = { total_count: 1, item_list: [{ item_id: WORK }] };
      else if (url === nativeShortMetadataFixedReadUrl(WORK, 'catalog')) data = catalog();
      else if (url === nativeShortMetadataFixedReadUrl(WORK, 'edit')) {
        editCalls++;
        data =
          mode === 'pre-save-drift' && editCalls === 2
            ? { ...edit(), opaque: { changed: true } }
            : current;
      } else throw Error('Unexpected synthetic fixed GET');
      return response(url, data);
    },
    async post(url: string, input: Record<string, unknown>) {
      writes++;
      posts.push(url);
      assert.equal(url, nativeShortMetadataEndpoints(WORK).save);
      const form = new URLSearchParams(String(input.data));
      forms.push(form);
      assert.equal(form.get('multi_title'), JSON.stringify(edit().multi_title));
      assert.equal(form.get('thumb_uri'), edit().thumb_uri);
      assert.equal(form.get('book_thumb_uri'), edit().book_thumb_uri);
      assert.equal(form.get('item_version'), '-1');
      assert.equal(form.get('category'), 'c1');
      posted = {
        ...current,
        content: form.get('content'),
        latest_version: Number(current.latest_version) + 1,
        modify_time: String(Number(current.modify_time) + 1),
      };
      current = posted;
      if (mode === 'ack-lost') throw Error('PRIVATE_BODY lost synthetic ACK after save');
      return response(url, {}, true);
    },
    async dispose() {
      if (mode === 'cleanup-fails') throw Error('PRIVATE_OPAQUE cleanup failure');
    },
  } as unknown as APIRequestContext;
  class FixtureBrowser extends BrowserSession {
    override get hasUnsafeApiCleanup() {
      return quarantine;
    }
    override async checkLogin(): Promise<never> {
      throw Error('Forbidden login navigation');
    }
    override async withPage<T>(): Promise<T> {
      throw Error('Forbidden generic Page writer');
    }
    override async runNativeShortTrialUpdate(
      workId: string,
      options: Parameters<BrowserSession['runNativeShortTrialUpdate']>[1],
    ): Promise<NativeShortTrialApiResult> {
      trialCalls++;
      assert.equal(workId, WORK);
      const { timeoutMs = config.timeoutMs, ...ownedOptions } = options;
      const borrowed = {
        async cookies() {
          return [];
        },
        browser() {
          return {};
        },
      } as unknown as BrowserContext;
      const owned = new OwnedNativeShortTrialRun(
        borrowed,
        workId,
        {
          ...ownedOptions,
          deadline: performance.now() + timeoutMs,
          assertBorrowedActive() {},
          onQuarantine() {
            quarantine = true;
          },
        },
        {
          async newContext() {
            contexts++;
            return client;
          },
        } as Pick<APIRequest, 'newContext'>,
      );
      return owned.run();
    }
    override async runNativeShortMetadata(
      workId: string,
      options: Parameters<BrowserSession['runNativeShortMetadata']>[1],
    ): Promise<NativeShortMetadataApiResult> {
      assert.equal(workId, WORK);
      assert.equal(options.mode, 'read');
      reads++;
      options.assertLease();
      options.onBeforePlatformRead();
      if (incompleteNextRead) {
        incompleteNextRead = false;
        const raw = unavailableNativeShortMetadataApi('response_unavailable'),
          at = new Date().toISOString();
        raw.proof.platformStarted = true;
        raw.proof.readStartedAt = at;
        raw.proof.readFinishedAt = at;
        raw.requests.own = { attempts: 1, disposed: 1 };
        raw.cleanup = {
          sessionCreated: true,
          sessionDisposed: true,
          pendingAtEnd: 0,
          disposalFailures: 0,
          quarantined: false,
          checkedAt: at,
        };
        // A fresh fixed-source own response was unavailable. No target snapshot
        // or successful owner callback is invented for this partial observation.
        return raw;
      }
      const raw = readResult(current);
      options.onVerifiedAccount(ACCOUNT, raw.proof.proofCapturedAt!);
      return raw;
    }
  }
  const browser = new FixtureBrowser({ profileDir: config.profileDir, headless: true }),
    app = createApplication(config, { browser });
  const request = (key = 'synthetic-trial-key') => ({
    idempotencyKey: key,
    target: { kind: 'short', workId: WORK },
    expectedState: 'draft',
    snapshotScope: NATIVE_SHORT_TRIAL_SCOPE,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedSnapshotVersionHash: snapshot().snapshotVersionHash,
    metadata: { trial: { action: 'set', beforeParagraph: 4 } },
  });
  const call = (input: unknown = request()) =>
    app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_update_work_metadata',
      new URLSearchParams(),
      input,
    ) as Promise<any>;
  const view = (name: string, jobId: string) =>
    app.dispatch('POST', '/api/v1/tools/fanqie_' + name, new URLSearchParams(), {
      jobId,
    }) as Promise<any>;
  const diagnose = (jobId: string): string => {
    const db = new DatabaseSync(path.join(config.dataDir, 'operations.sqlite'));
    try {
      const row = db.prepare('SELECT error_json FROM jobs WHERE id=?').get(jobId);
      const error: unknown =
        row?.error_json === null || row?.error_json === undefined
          ? null
          : JSON.parse(String(row.error_json));
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      const safeCodes = [
        'capability_unavailable',
        'outcome_unknown',
        'invalid_write_intent',
        'timeout',
        'unresolved_write',
        'invalid_job_state',
      ];
      const datasets = db
        .prepare('SELECT dataset FROM evidence WHERE job_id=? ORDER BY rowid')
        .all(jobId);
      const safeDatasets = [
        'short_native_trial_baseline',
        'short_native_trial_pre_save',
        'write-intent',
        'short_native_trial_attempt',
        'short_native_trial_acknowledgement',
        'short_native_trial_after',
        'write-result',
      ];
      return JSON.stringify({
        errorCode:
          code === null
            ? null
            : typeof code === 'string' && safeCodes.includes(code)
              ? code
              : 'unavailable',
        evidenceDatasetOrder: datasets.map((item) =>
          safeDatasets.includes(String(item.dataset)) ? String(item.dataset) : 'unavailable',
        ),
        fixtureCounts: { reads, writes, trialCalls, contexts },
      });
    } finally {
      db.close();
    }
  };
  return {
    directory,
    config,
    browser,
    app,
    request,
    call,
    view,
    diagnose,
    posts,
    forms,
    setCurrent(value: Record<string, unknown>) {
      current = value;
    },
    nextReadIncomplete() {
      incompleteNextRead = true;
    },
    get posted() {
      assert(posted);
      return structuredClone(posted);
    },
    get reads() {
      return reads;
    },
    get writes() {
      return writes;
    },
    get trialCalls() {
      return trialCalls;
    },
    get contexts() {
      return contexts;
    },
    async close() {
      await app.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
