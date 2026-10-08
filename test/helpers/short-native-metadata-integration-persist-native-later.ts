import {
  nativeSaveFixture,
  nativeWriteSnapshot,
} from './short-native-metadata-integration-native-write-snapshot.js';

import { Store, canonicalJson } from '../../src/runtime/store.js';

import { JobQueue } from '../../src/runtime/jobs.js';

import { fixtureProvenance, WORK, ACCOUNT } from './short-native-metadata-integration-snapshot.js';

import {
  createNativeShortOriginalAudit,
  createNativeShortReconciliationEvidence,
  type NativeShortReconciliationContext,
  validateNativeShortReconciliationContext,
  NATIVE_SHORT_BASELINE_DATASET,
} from '../../src/platform/short-native-metadata-proof.js';

import { createHash } from 'node:crypto';

import assert from 'node:assert/strict';

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { loadConfig } from '../../src/config.js';

import {
  createNativeShortMetadataSnapshot,
  nativeShortMetadataEndpoints,
} from '../../src/platform/short-native-metadata.js';

import {
  type APIResponse,
  type APIRequestContext,
  type BrowserContext,
  type APIRequest,
} from 'playwright';

import { DatabaseSync } from 'node:sqlite';

import { BrowserSession } from '../../src/platform/browser.js';

import {
  OwnedNativeShortMetadataRun,
  OwnedNativeShortMetadataWriteRun,
} from '../../src/platform/short-native-metadata-api.js';

import { createApplication } from '../../src/application.js';

export async function persistNativeLater(
  f: Awaited<ReturnType<typeof nativeSaveFixture>>,
  store: Store,
  queue: JobQueue,
  provenance:
    typeof fixtureProvenance | { executor: 'application-default-browser/v1'; mode: 'live' },
) {
  const original = store.getJob(f.job.id)!,
    refs = store.listEvidence(original.id),
    before = {
      accountId: 'owner',
      job: original,
      manifest: null,
      refs,
      documents: refs.map((ref) => store.readEvidence(ref)),
    };
  const closed = original.result as any;
  const audit =
    closed?.schema === 'native-short-metadata-closure/v2'
      ? createNativeShortOriginalAudit(
          original,
          refs,
          {
            firstAudit: (
              store.readEvidence(store.listEvidence(closed.originalAttemptEvidence.readJobId)[0]!)
                .payload as any
            ).originalAudit,
            previousClosure: closed,
          },
          2,
        )
      : createNativeShortOriginalAudit(original, refs, undefined, 2);
  while (new Date().toISOString() <= audit.priorEndedAt)
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  const browser = f.createBrowser();
  try {
    const handle = queue.enqueueRead({
      accountId: 'owner',
      operation: 'reconcile_write',
      scope: 'reconciliation',
      datasets: ['reconciliation'],
      inputHash: createHash('sha256')
        .update(canonicalJson({ jobId: original.id }))
        .digest('hex'),
      run: async (ctx) => {
        const raw = await browser.runNativeShortMetadata(WORK, {
          mode: 'read',
          expectedOwner: { kind: 'account', id: ACCOUNT },
          timeoutMs: 5000,
          signal: ctx.signal,
          assertLease: () => store.assertLeaseOwnership(),
          onBeforePlatformRead: () => {
            assert(ctx.beforePlatformRead() > audit.priorEndedAt);
          },
          onVerifiedAccount: (id, at) => {
            assert.equal(id, ACCOUNT);
            assert(Number.isFinite(Date.parse(at)));
          },
        });
        const evidence = createNativeShortReconciliationEvidence(raw, audit, before, provenance);
        ctx.recordTarget({ kind: 'short-story', id: WORK });
        return [ctx.saveEvidence('reconciliation', evidence)];
      },
    });
    const readJob = await handle.completion,
      manifest = store.history('owner').find((manifest) => manifest.jobId === readJob.id)!,
      ref = store.listEvidence(readJob.id)[0]!,
      document = store.readEvidence(ref);
    assert.equal(readJob.status, 'succeeded', JSON.stringify(readJob.error));
    const context: NativeShortReconciliationContext = {
      accountId: 'owner',
      originalJob: store.getJob(original.id)!,
      originalRefs: refs,
      originalDocuments: before.documents,
      readJob,
      manifest,
      ref,
      document,
    };
    return { context, verified: validateNativeShortReconciliationContext(context) };
  } finally {
    await browser.close();
  }
}

export function publicNativeFixture(writesEnabled = true, fault: 'none' | 'acklost' = 'none') {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'native-public-save-'));
  const config = loadConfig({
    FANQIE_TOKEN: 'native-public-synthetic-token',
    FANQIE_ENABLE_WRITES: String(writesEnabled),
    FANQIE_DATA_DIR: path.join(directory, 'data'),
    FANQIE_PROFILE_DIR: path.join(directory, 'profile'),
    FANQIE_RUNTIME_DIR: path.join(directory, 'runtime'),
  });
  writeFileSync(
    path.join(config.dataDir, 'account-binding.json'),
    JSON.stringify({ accountId: 'owner', platformId: ACCOUNT, platformIdType: 'account' }),
  );
  const initial = nativeWriteSnapshot();
  let current = createNativeShortMetadataSnapshot({
      binding: initial.binding,
      editData: { ...initial.editData, authorize_type: 0 },
      categoryData: initial.categoryData,
    }),
    postCount = 0,
    getCount = 0,
    disposed = 0,
    sessions = 0;
  const response = (url: string, data: unknown) =>
    ({
      status: () => 200,
      url: () => url,
      headers: () => ({ 'content-type': 'application/json' }),
      body: async () => Buffer.from(JSON.stringify({ code: 0, data })),
      dispose: async () => {
        disposed++;
      },
    }) as unknown as APIResponse;
  const api = {
    async get(url: string) {
      getCount++;
      if (url === 'https://fanqienovel.com/api/user/info/v2') return response(url, { id: ACCOUNT });
      if (url.includes('/draft_list/'))
        return response(url, { total_count: 1, item_list: [{ item_id: WORK }] });
      if (url.includes('/edit/')) return response(url, current.editData);
      if (url.includes('/get_category_list/')) return response(url, current.categoryData);
      throw Error('Unexpected fixed GET');
    },
    async post(url: string, options: Record<string, unknown>) {
      assert.equal(url, nativeShortMetadataEndpoints(WORK).save);
      postCount++;
      const db = new DatabaseSync(path.join(config.dataDir, 'operations.sqlite'));
      try {
        const job = db.prepare("SELECT * FROM jobs WHERE kind='write' AND status='running'").get()!;
        assert.notEqual(job.write_started_at, null);
        assert.deepEqual(JSON.parse(String(job.target_json)), { kind: 'short-story', id: WORK });
        const refs = db
          .prepare(
            'SELECT dataset,path,sha256 FROM evidence WHERE job_id=? ORDER BY captured_at,rowid',
          )
          .all(String(job.id));
        assert.deepEqual(
          refs.map((row) => row.dataset),
          [NATIVE_SHORT_BASELINE_DATASET, 'write-intent'],
        );
        for (const row of refs)
          assert.equal(
            createHash('sha256')
              .update(readFileSync(path.join(config.dataDir, 'evidence', String(row.path))))
              .digest('hex'),
            row.sha256,
          );
      } finally {
        db.close();
      }
      const form = new URLSearchParams(String(options.data)),
        editData = structuredClone(current.editData) as any;
      editData.multi_title = JSON.parse(form.get('multi_title')!);
      editData.latest_version += 1;
      const ids = form.get('category')!.split(',');
      // Synthetic server retains complete canonical rows, including raw fields.
      editData.category = ids.map(
        (id) =>
          (current.editData.category as any[]).find((row) => String(row.category_id) === id) ??
          (current.categoryData.category_list as any[]).find(
            (row) => String(row.category_id) === id,
          ),
      );
      current = createNativeShortMetadataSnapshot({
        binding: current.binding,
        editData,
        categoryData: current.categoryData,
      });
      if (fault === 'acklost') throw Error('Synthetic saved fields with lost ACK');
      return response(url, {});
    },
    async dispose() {},
  } as unknown as APIRequestContext;
  const borrowed = {
    cookies: async () => [],
    browser: () => ({ isConnected: () => true }),
  } as unknown as BrowserContext;
  const factory: Pick<APIRequest, 'newContext'> = {
    async newContext() {
      sessions++;
      return api;
    },
  };
  class PublicNativeBrowser extends BrowserSession {
    override async checkLogin(): Promise<never> {
      throw Error('Forbidden login');
    }
    override async withPage<T>(): Promise<T> {
      throw Error('Forbidden Page');
    }
    override async runNativeShortMetadata(
      workId: string,
      options: Parameters<BrowserSession['runNativeShortMetadata']>[1],
    ) {
      return new OwnedNativeShortMetadataRun(
        borrowed,
        workId,
        {
          ...options,
          deadline: performance.now() + 5000,
          assertBorrowedActive: () => {},
          onQuarantine: () => {},
        },
        factory,
      ).run();
    }
    override async runNativeShortMetadataUpdate(
      workId: string,
      options: Parameters<BrowserSession['runNativeShortMetadataUpdate']>[1],
    ) {
      return new OwnedNativeShortMetadataWriteRun(
        borrowed,
        workId,
        {
          ...options,
          deadline: performance.now() + 5000,
          assertBorrowedActive: () => {},
          onQuarantine: () => {},
        },
        factory,
      ).run();
    }
  }
  const app = createApplication(config, {
    browser: new PublicNativeBrowser({ profileDir: config.profileDir, headless: true }),
  });
  return {
    app,
    config,
    get current() {
      return current;
    },
    get counts() {
      return { postCount, getCount, disposed, sessions };
    },
    async close() {
      await app.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export const operatorExecutionInventory: Record<string, string> = {
  'src/application.ts': 'f905e67c2d4e927ac48e5e58e32d269c303952cb99364582edf76e6d3afaf0f7',
  'src/config.ts': '7bf8da075f4b2edc27e4b8abcf2aff4d65336a1abd0fcb3b42ce38df4f48ee21',
  'src/errors.ts': 'eb41090be95cda9315d33ea12ca8676670d59a083fb68704ab37763cf9ba9d16',
  'src/index.ts': '342fc26a9c9a694f88b8e33a8f88677d2163e1267ecab7fe9e42eb8fc8829a74',
  'src/platform/browser.ts': '1c8a0dac83f9c47a51cbb8b702649e674a833996c441231a112a99e0885bd67d',
  'src/platform/chapter-body.ts':
    '4f1c3ad3c6058634f14a302eecd522b91eff6e57bbdb1666201bd20252026cd3',
  'src/platform/chapter-directory.ts':
    'ecfd6e38e14e11d3d2e06efbedae736e8a581704a54e8f8a7456ed9b44446cab',
  'src/platform/public.ts': 'd8ec6a4a4ec47bb66b8c3171f9e5bba11cd786dd5a795db930a7d8c16a4caedb',
  'src/platform/reads.ts': '0d59827bb89267f5041662c718b3ddbfc28c51a0bc77d8e47115b1adc99c759e',
  'src/platform/short-metadata-api-schema.ts':
    '74d6dd51a8f7cbffe03930169115aa51b7eefa8f3e3052109accf0080940f4fa',
  'src/platform/short-metadata-schema.ts':
    '6bc3e272ed3d6184d6c31c2e5fbf5b815b75f4f33806bec3ceca553bd7a9b859',
  'src/platform/short-native-metadata-api.ts':
    '9e2f6f06fb6ec811ed7bff5fc01ff521bcb84328e5a1a71e81438b6110a0d085',
  'src/platform/short-native-metadata-proof.ts':
    '27a336769d11debb2bc51f11323f793aa3f51bbd9ff1d21a16af001a8f9351fa',
  'src/platform/short-native-metadata.ts':
    '7f4d7e19c97728366abae5d8ec2c388d70c56d275d9c7026a40b35c22020fb9b',
  'src/platform/writes.ts': '8c5088b8544a6e0cd0b6138afd08c845f773e2a1f553dda85396748596bedba8',
  'src/runtime/jobs.ts': 'a9c2459a1cb200b389d322c8ad5d1410b7e4df5255dfb109b07359141258ed11',
  'src/runtime/login-fallback.ts':
    'ee975de7348794bc33459d7b5d37dbb846d2f4f467e817dbbca0a299432a6eef',
  'src/runtime/store.ts': '86ec4d34e0846f29d9e98aa3381d2462cc73760247329bf1561528f90d406a15',
  'src/transport/http.ts': '5bca8c94bbe67d0fbed2f2d80dbbc34e7179cf5171e2214a6cbb564a2c55dd6a',
  'src/transport/mcp.ts': '681f7e8b0462161afac972106364948ec1d0238b399c4e8d286997aacc442033',
  'test/application.test.ts': 'bc81c94448224640d662a72833c627ef1467bc762bcad01f81cc1a806f786345',
  'test/chapter-body.test.ts': 'd280eee6de9aba1c6055b84eaf314f78367ecf3769dd096d5a334ca3d6ee73a1',
  'test/chapter-directory.test.ts':
    'bc87fb11de43a06655ff917094cb4322cfb57d236a9207fb68a91c808553b3a5',
  'test/current-chapter-tab-structure.test.ts':
    '75de8b63b932c4ff434e820a673c00d7562460466e1bc379f576f1c85eea39cf',
  'test/login-fallback.test.ts': 'cc30d5cc200b3f1deccdd6a34f8ed68c4e5a173b6f16d24ffc0fa1f6eeecf3c5',
  'test/manifest-commit-crash.test.ts':
    '3b568ead4edfe0bc4e65682f677714791ec750279693d247d22b8fcf7ab67c5c',
  'test/platform-reads.test.ts': 'b03199548044bf2a6aef6dba61930f4b85bb2ba77c5b1fe5d25fc0cc5c1569bd',
  'test/platform-writes.test.ts':
    '36eafec4fc6c2fdff140e0504c45d3c10ee89af95acd4d062a76e1f99cfd2779',
  'test/public-content-fingerprint.test.ts':
    'a79910ded14b930995994f39441b653000f02d486bf0725bff46104bb7c70534',
  'test/runtime-readiness.test.ts':
    '542a81dc6c9823028691718ecf0959676656b54159698831026577e0bb3d9b36',
  'test/runtime.test.ts': 'a3df01525753d3c45838da533c3be65cffc3d2b337fad4b18f946683fa69e2db',
  'test/short-native-metadata-api.test.ts':
    '305b1140cd454554750cdd39c8a6e4485a5b6632210a3477b86e5738288ca796',
  'test/short-native-metadata-integration.test.ts':
    '7915e4e3b2206a7b0b8d985a0590d60d13aeab12c198408563d7b264e5c119db',
  'test/short-native-metadata.test.ts':
    '70b70a7c313bb535e2944cbf2ce975d29048fcfd28d25b6f95c174fa9fb08123',
  'test/transport.test.ts': 'afb3b2967eb9248965e9eba95e5a4ee68069754780ae891cef4261babd2db468',
};
