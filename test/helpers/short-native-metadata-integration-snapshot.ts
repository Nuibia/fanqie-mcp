import {
  nativeShortReadScope,
  NATIVE_SHORT_READ_OPERATION,
  NATIVE_SHORT_READ_DATASET,
  nativeShortInputHash,
  createNativeShortReadEvidence,
  type NativeShortEvidenceContext,
} from '../../src/platform/short-native-metadata-proof.js';

import { createNativeShortMetadataSnapshot } from '../../src/platform/short-native-metadata.js';

import {
  type NativeShortMetadataApiResult,
  unavailableNativeShortMetadataApi,
} from '../../src/platform/short-native-metadata-api.js';

import assert from 'node:assert/strict';

import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { loadConfig } from '../../src/config.js';

import { BrowserSession } from '../../src/platform/browser.js';

import { createApplication } from '../../src/application.js';

import { Store, canonicalJson } from '../../src/runtime/store.js';

import { JobQueue } from '../../src/runtime/jobs.js';

import { DatabaseSync } from 'node:sqlite';

import { createHash } from 'node:crypto';

export const WORK = '7000000001',
  ACCOUNT = '001001',
  SCOPE = nativeShortReadScope(WORK);

export const PRIVATE = [
  'PRIVATE_HTML',
  'PRIVATE_CATEGORY_RAW',
  'PRIVATE_CATALOG',
  'PRIVATE_TAIL',
  'PRIVATE_URI_ONE',
  'PRIVATE_URI_TWO',
  'PRIVATE_UNKNOWN_KEY',
  'PRIVATE_UNKNOWN_VALUE',
  'PRIVATE_SIGNED_QUERY',
  'PRIVATE_COOKIE',
  'PRIVATE_HEADER',
  'PRIVATE_FORM',
  '/private/PRIVATE_ABSOLUTE_PATH',
  ACCOUNT,
];

export function snapshot(max: unknown = 4, absent = false) {
  const editData: Record<string, unknown> = {
    item_id: WORK,
    publish_status: 0,
    multi_title: ['Authorized title', 'PRIVATE_TAIL'],
    content: '<p>PRIVATE_HTML &amp; text</p>',
    thumb_uri: 'PRIVATE_URI_ONE',
    book_thumb_uri: 'PRIVATE_URI_TWO',
    category: [
      { category_id: 10, label: '主类', name: '主甲', unknown: 'PRIVATE_CATEGORY_RAW' },
      { category_id: 'r1', label: '角色', name: '角色甲' },
    ],
    category_max_count: max,
    sign_type: 1,
    origin_activity_flag: 0,
    PRIVATE_UNKNOWN_KEY: 'PRIVATE_UNKNOWN_VALUE',
    thumb_url_list: [{ main_url: 'https://example.invalid/cover?PRIVATE_SIGNED_QUERY' }],
    credentials: [
      'PRIVATE_COOKIE',
      'PRIVATE_HEADER',
      'PRIVATE_FORM',
      '/private/PRIVATE_ABSOLUTE_PATH',
    ],
  };
  if (absent) delete editData.category_max_count;
  return createNativeShortMetadataSnapshot({
    binding: { account: { kind: 'account_id', id: ACCOUNT }, work: { kind: 'short', id: WORK } },
    editData,
    categoryData: {
      category_list: [
        { category_id: 10, label: '主类', name: '主甲', opaque: 'PRIVATE_CATALOG' },
        { category_id: 11, label: '主类', name: '主乙' },
        { category_id: 'r1', label: '角色', name: '角色甲' },
      ],
      unknown_catalog: 'PRIVATE_UNKNOWN_VALUE',
    },
  });
}

export function result(
  time = new Date().toISOString(),
  max: unknown = 4,
  absent = false,
): NativeShortMetadataApiResult {
  return {
    schema: 'native-short-metadata-api-read/v1',
    status: 'success',
    reason: null,
    snapshot: snapshot(max, absent),
    proof: {
      platformStarted: true,
      ownerBefore: true,
      ownerAfter: true,
      ownerCallback: true,
      fixedSourceVerified: true,
      targetUnique: true,
      paginationComplete: true,
      atomicRevision: false,
      readStartedAt: time,
      readFinishedAt: time,
      proofCapturedAt: time,
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
      checkedAt: time,
    },
  };
}

export const fixtureProvenance = {
  executor: 'dependency-injected-browser/v1',
  mode: 'fixture',
} as const;

export function noPrivate(value: unknown) {
  const text = JSON.stringify(value);
  for (const marker of PRIVATE) assert.equal(text.includes(marker), false, `leaked ${marker}`);
}

export function fixture(
  binding: unknown = { accountId: 'owner', platformId: ACCOUNT, platformIdType: 'account' },
) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'native-metadata-c2-synthetic-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'native-metadata-synthetic-contract-token',
    FANQIE_PORT: '0',
    FANQIE_ENABLE_WRITES: 'false',
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  if (binding !== null)
    writeFileSync(path.join(config.dataDir, 'account-binding.json'), JSON.stringify(binding));
  let quarantine = false;
  let calls = 0,
    max: unknown = 4,
    absent = false,
    mutate: ((raw: any) => void) | null = null,
    mode = 'success',
    release: (() => void) | null = null;
  class FixtureBrowser extends BrowserSession {
    override get hasUnsafeApiCleanup() {
      return quarantine;
    }
    override async checkLogin(): Promise<never> {
      throw Error('Forbidden login navigation');
    }
    override async withPage<T>(): Promise<T> {
      throw Error('Forbidden Page');
    }
    override async runNativeShortMetadata(
      workId: string,
      options: Parameters<BrowserSession['runNativeShortMetadata']>[1],
    ) {
      calls++;
      assert.equal(workId, WORK);
      assert.equal(options.mode, 'read');
      assert.deepEqual(options.expectedOwner, { kind: 'account', id: ACCOUNT });
      assert.ok(options.signal instanceof AbortSignal);
      options.assertLease();
      if (mode === 'throw') throw Error('PRIVATE_HTML PRIVATE_URI_ONE');
      if (mode === 'unavailable') return unavailableNativeShortMetadataApi('context_unavailable');
      options.onBeforePlatformRead();
      if (mode === 'hold')
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      const raw = JSON.parse(JSON.stringify(result(new Date().toISOString(), max, absent)));
      if (mode !== 'missing-owner') options.onVerifiedAccount(ACCOUNT, raw.proof.proofCapturedAt);
      if (mode === 'repeated-owner') options.onVerifiedAccount(ACCOUNT, raw.proof.proofCapturedAt);
      if (mode === 'repeated-before') options.onBeforePlatformRead();
      mutate?.(raw);
      return raw;
    }
  }
  const browser = new FixtureBrowser({ profileDir: config.profileDir, headless: true });
  const app = createApplication(config, { browser });
  const call = (input: unknown = { workId: WORK }) =>
    app.dispatch(
      'POST',
      '/api/v1/tools/fanqie_get_short_metadata_snapshot',
      new URLSearchParams(),
      input,
    ) as Promise<any>;
  return {
    directory,
    config,
    app,
    browser,
    call,
    quarantine() {
      quarantine = true;
    },
    get calls() {
      return calls;
    },
    setMax(value: unknown, missing = false) {
      max = value;
      absent = missing;
    },
    mutate(value: typeof mutate) {
      mutate = value;
    },
    mode(value: string) {
      mode = value;
    },
    get held() {
      return release !== null;
    },
    release() {
      release?.();
    },
    async close() {
      await app.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export async function context() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'native-metadata-proof-context-'));
  const store = new Store({
    databasePath: path.join(directory, 'operations.sqlite'),
    evidenceDirectory: path.join(directory, 'evidence'),
    evidenceMode: 'fixture',
  });
  const queue = new JobQueue(store);
  const handle = queue.enqueueRead({
    accountId: 'owner',
    operation: NATIVE_SHORT_READ_OPERATION,
    scope: SCOPE,
    datasets: [NATIVE_SHORT_READ_DATASET],
    inputHash: nativeShortInputHash(WORK),
    run: async (ctx) => {
      ctx.beforePlatformRead();
      const raw = result();
      ctx.recordTarget({ kind: 'short-story', id: WORK });
      return [
        ctx.saveEvidence(
          NATIVE_SHORT_READ_DATASET,
          createNativeShortReadEvidence(raw, fixtureProvenance),
        ),
      ];
    },
  });
  const job = await handle.completion,
    manifest = store.history('owner')[0]!,
    ref = store.listEvidence(job.id)[0]!,
    document = store.readEvidence(ref);
  const ctx: NativeShortEvidenceContext = { accountId: 'owner', job, manifest, ref, document };
  return {
    ctx,
    payload: document.payload,
    async close() {
      await queue.drainAndStop();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export function rewriteSyntheticNativeRecord(
  f: ReturnType<typeof fixture>,
  id: string,
  mutate: (envelope: any) => void,
) {
  // This isolated synthetic fixture rewrites a fully healthy durable context.
  // Every modified observation is rehashed and rebound to its own manifest;
  // failures therefore cannot be explained by a pre-existing missing context.
  const db = new DatabaseSync(path.join(f.config.dataDir, 'operations.sqlite'));
  try {
    const row = db.prepare('SELECT * FROM jobs WHERE id=?').get(id)!;
    const jobResult = JSON.parse(String(row.result_json)),
      manifest = jobResult.manifest;
    const ref = manifest.evidence[0],
      file = path.join(f.config.dataDir, 'evidence', ref.path);
    const document = JSON.parse(readFileSync(file, 'utf8'));
    const envelope = {
      result: jobResult,
      manifest,
      ref,
      document,
      metadata: JSON.parse(String(row.metadata_json)),
      error: row.error_json === null ? null : JSON.parse(String(row.error_json)),
      cancellationReason:
        row.cancellation_reason_json === null
          ? null
          : JSON.parse(String(row.cancellation_reason_json)),
    };
    mutate(envelope);
    const bytes = Buffer.from(canonicalJson(document) + '\n');
    const digest = createHash('sha256').update(bytes).digest('hex');
    ref.sha256 = digest;
    writeFileSync(file, bytes);
    db.prepare('UPDATE evidence SET sha256=? WHERE id=?').run(digest, ref.id);
    db.prepare('UPDATE manifests SET manifest_json=? WHERE id=?').run(
      canonicalJson(manifest),
      manifest.id,
    );
    db.prepare(
      'UPDATE jobs SET result_json=?,metadata_json=?,error_json=?,cancellation_reason_json=? WHERE id=?',
    ).run(
      canonicalJson(envelope.result),
      canonicalJson(envelope.metadata),
      envelope.error === null ? null : canonicalJson(envelope.error),
      envelope.cancellationReason === null ? null : canonicalJson(envelope.cancellationReason),
      id,
    );
  } finally {
    db.close();
  }
}
