import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { request, type APIRequestContext, type APIResponse, type BrowserContext } from 'playwright';
import { Store, canonicalJson } from '../src/runtime/store.js';
import { JobQueue } from '../src/runtime/jobs.js';
import { BrowserSession } from '../src/platform/browser.js';
import * as runtime from '../src/platform/short-native-submission-runtime.js';
import {
  validateNativeShortSubmissionEvidenceContext,
  type NativeShortSubmissionContext,
} from '../src/platform/short-native-submission-proof.js';
import { OwnedNativeShortSubmissionRun } from '../src/platform/short-native-submission-api.js';
import {
  NATIVE_SHORT_SUBMISSION_SOURCE_PINS,
  NATIVE_SHORT_SUBMISSION_SCOPE,
} from '../src/platform/short-native-submission.js';
import { nativeShortMetadataFixedReadUrl } from '../src/platform/short-native-metadata-api.js';
import {
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
} from '../src/platform/short-native-metadata.js';

const WORK = '7000000001',
  ACCOUNT = '1001',
  SERVICE = 'synthetic-submission-ack-contract';
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const fixtureUrl = new URL(
  './fixtures/short-native-submission-public-sources-20261007.json.gz',
  import.meta.url,
);
const fixtureManifest = JSON.parse(
  readFileSync(
    new URL(
      './fixtures/short-native-submission-public-sources-20261007.manifest.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const compressed = readFileSync(fixtureUrl),
  decompressed = gunzipSync(compressed);
assert.equal(sha(compressed), fixtureManifest.compressed.sha256);
assert.equal(compressed.length, fixtureManifest.compressed.bytes);
assert.equal(decompressed.length, fixtureManifest.decompressedBytes);
const fixture = JSON.parse(decompressed.toString('utf8')) as {
  schema: string;
  files: Record<string, { text: string; bytes: number; sha256: string }>;
};
assert.equal(fixture.schema, 'submission-test-public-source-bytes/v1');
const sources = new Map<string, Buffer>();
for (const [key, value] of Object.entries(fixture.files)) {
  const pin =
    NATIVE_SHORT_SUBMISSION_SOURCE_PINS[key as keyof typeof NATIVE_SHORT_SUBMISSION_SOURCE_PINS];
  const bytes = Buffer.from(value.text, 'utf8');
  assert.equal(bytes.length, value.bytes);
  assert.equal(sha(bytes), value.sha256);
  assert.deepEqual(fixtureManifest.sources[key], {
    url: pin.url,
    sha256: value.sha256,
    bytes: bytes.length,
  });
  if ('sha256' in pin) assert.equal(value.sha256, pin.sha256);
  sources.set(pin.url, bytes);
}

for (const scenario of ['lost-ack', 'missing-ai', 'recovered-ai'] as const) {
  test(`durable submission ACK contract: ${scenario}; production-shaped offline transport`, async () => {
    // These fixed public bytes are parsed for the production source contract.
    // Every request is intercepted below: no network, Browser or real account.
    const marker =
      '<div data-percentage="0.3333333333333333" data-fanqie-type="pay_tag" data-min-text="200" data-min-paragraphs="3" data-min-radio="0.3" data-para-nums="3" class=""></div>';
    const paragraph = `<p>${'SYNTHETIC_TEXT'.repeat(30)}</p>`;
    let current: Record<string, unknown> = {
      item_id: WORK,
      publish_status: 0,
      display_status: 0,
      content: paragraph + marker + paragraph + paragraph,
      multi_title: ['合成原创短故事'],
      thumb_uri: '',
      book_thumb_uri: 'synthetic-cover',
      category: [{ category_id: 10, label: '主类', name: '主甲' }],
      sign_type: 1,
      origin_activity_flag: 0,
      story_origin_divided_chapters: 0,
      authorize_type: 0,
      use_ai: 2,
    };
    const catalog = { category_list: [{ category_id: 10, label: '主类', name: '主甲' }] };
    const snapshot = createNativeShortMetadataSnapshot({
      binding: { account: { kind: 'account_id', id: ACCOUNT }, work: { kind: 'short', id: WORK } },
      editData: current,
      categoryData: catalog,
    });
    let posts = 0,
      lists = 0,
      sourceReads = 0;
    const response = (url: string, bytes: Buffer, mime: string) =>
      ({
        url: () => url,
        status: () => 200,
        headers: () => ({ 'content-type': mime }),
        async body() {
          return bytes;
        },
        async dispose() {},
      }) as unknown as APIResponse;
    const client = {
      async get(url: string) {
        const source = sources.get(url);
        if (source) {
          sourceReads++;
          return response(
            url,
            source,
            url === NATIVE_SHORT_SUBMISSION_SOURCE_PINS.writer.url
              ? 'text/html'
              : 'application/javascript',
          );
        }
        let data: unknown;
        if (url === nativeShortMetadataFixedReadUrl(WORK, 'own')) data = { id: ACCOUNT };
        else if (url === nativeShortMetadataFixedReadUrl(WORK, 'catalog')) data = catalog;
        else if (url === nativeShortMetadataFixedReadUrl(WORK, 'edit')) data = current;
        else if (url === nativeShortMetadataFixedReadUrl(WORK, 'list', 0)) {
          lists++;
          data = { total_count: 1, item_list: [{ item_id: WORK }] };
        } else throw Error('Unexpected offline URL; network is forbidden');
        return response(url, Buffer.from(JSON.stringify({ code: 0, data })), 'application/json');
      },
      async post(url: string, options: { data: unknown }) {
        assert.equal(
          url,
          'https://fanqienovel.com/api/author/short_article/publish/v0/?aid=2503&app_name=muye_novel',
        );
        assert.equal(new URLSearchParams(String(options.data)).get('use_ai'), '1');
        posts++;
        current = { ...current, publish_status: 1, display_status: 1, use_ai: 1 };
        if (scenario === 'lost-ack') throw Error('Synthetic transport lost the acknowledgement');
        delete current.use_ai;
        return response(
          url,
          Buffer.from(
            JSON.stringify({ code: 0, message: 'synthetic accepted', data: { item_id: WORK } }),
          ),
          'application/json',
        );
      },
      async dispose() {},
    } as unknown as APIRequestContext;
    const originalFactory = request.newContext;
    request.newContext = async () => client;
    const directory = mkdtempSync(path.join(tmpdir(), 'submission-durable-ack-synthetic-'));
    const storeOptions = {
      databasePath: path.join(directory, 'operations.sqlite'),
      evidenceDirectory: path.join(directory, 'evidence'),
      evidenceMode: 'live' as const,
      nativeShortSubmissionEvidenceMode: 'live' as const,
      // Match App's lease grace for this fixture's 120-second job budget.
      leaseDurationMs: 150_000,
    };
    let store = new Store(storeOptions),
      queue = new JobQueue(store, { timeoutMs: 120_000 });
    class OfflineBrowser extends BrowserSession {
      override async runNativeShortSubmission(
        workId: string,
        raw: Parameters<BrowserSession['runNativeShortSubmission']>[1],
      ) {
        const { timeoutMs = 120_000, ...options } = raw;
        return new OwnedNativeShortSubmissionRun(
          {
            async cookies() {
              return [];
            },
            browser() {
              return {};
            },
          } as unknown as BrowserContext,
          workId,
          {
            ...options,
            deadline: performance.now() + timeoutMs,
            assertBorrowedActive() {},
            onQuarantine() {},
          },
        ).run();
      }
    }
    const browser = new OfflineBrowser({
      profileDir: path.join(directory, 'never-opened-profile'),
      headless: true,
    });
    const options = {
      timeoutMs: 120_000,
      expectedPlatformAccount: ACCOUNT,
      provenance: { mode: 'live' as const, executor: 'application-default-browser/v1' as const },
      currentPlatformAccount: () => ACCOUNT,
      onVerifiedAccount() {},
    };
    try {
      const input = {
        target: { kind: 'short' as const, workId: WORK },
        snapshotScope: NATIVE_SHORT_SUBMISSION_SCOPE,
        hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
        expectedSnapshotVersionHash: snapshot.snapshotVersionHash,
        expectedState: 'draft' as const,
        useAi: 1 as const,
      };
      const preparation = await queue.enqueueRead({
        accountId: SERVICE,
        operation: runtime.NATIVE_SHORT_SUBMISSION_READ_OPERATION,
        scope: runtime.nativeShortSubmissionScope(WORK),
        datasets: [runtime.NATIVE_SHORT_SUBMISSION_READ_DATASET],
        inputHash: runtime.nativeShortSubmissionPreparationInputHash(input),
        run: (ctx) => runtime.runNativeShortSubmissionReadJob(store, browser, ctx, input, options),
      }).completion;
      assert.equal(preparation.status, 'succeeded');
      const business = {
        ...input,
        preparationJobId: preparation.id,
        acceptPublicationTerms: true as const,
      };
      const original = await queue.enqueueWrite({
        accountId: SERVICE,
        operation: runtime.NATIVE_SHORT_SUBMISSION_OPERATION,
        scope: runtime.nativeShortSubmissionScope(WORK),
        idempotencyKey: `synthetic-durable-ack-${scenario}`,
        inputHash: runtime.nativeShortSubmissionBusinessInputHash(business),
        run: (ctx) => runtime.runNativeShortSubmissionJob(store, browser, ctx, business, options),
      }).completion;
      assert.equal(original.status, 'uncertain');
      assert.equal(posts, 1);
      const originalRefs = store.listEvidence(original.id),
        afterRef = originalRefs.find((ref) => ref.dataset === 'short_native_submission_after')!;
      const after = store.readEvidence(afterRef).payload as any;
      assert.equal(after.result.publish.post.attempts, 1);
      assert.equal(
        after.result.publish.observation?.accepted ?? null,
        scenario === 'lost-ack' ? null : true,
      );
      assert.equal(after.result.snapshot.editData.use_ai, scenario === 'lost-ack' ? 1 : undefined);
      if (scenario === 'missing-ai') {
        // Revalidate a crash prefix ending at durable ACK, without relying on
        // the full after-result validator to reject a malformed acknowledgement.
        const acknowledgementIndex = originalRefs.findIndex(
          (ref) => ref.dataset === 'short_native_submission_acknowledgement',
        );
        const prefixRefs = originalRefs.slice(0, acknowledgementIndex + 1);
        const prefix: NativeShortSubmissionContext = {
          accountId: SERVICE,
          job: { ...original, result: { evidence: prefixRefs } },
          manifest: null,
          refs: prefixRefs,
          documents: prefixRefs.map((ref) => store.readEvidence(ref)),
          attempts: store.listNativeShortSubmissionAttempts(original.id),
          preparation: store.getNativeShortSubmissionPreparation(preparation.id, SERVICE),
        };
        assert.equal(validateNativeShortSubmissionEvidenceContext(prefix).validated, true);
        for (const change of [{ extra: 'not in the ACK contract' }, { itemId: '7000000002' }]) {
          const corrupt = structuredClone(prefix);
          Object.assign(
            (corrupt.documents[acknowledgementIndex]!.payload as any).observation,
            change,
          );
          corrupt.refs[acknowledgementIndex]!.sha256 = sha(
            Buffer.from(`${canonicalJson(corrupt.documents[acknowledgementIndex])}\n`),
          );
          corrupt.job.result = { evidence: corrupt.refs };
          assert.throws(() => validateNativeShortSubmissionEvidenceContext(corrupt));
        }
      }
      if (scenario === 'recovered-ai') current = { ...current, use_ai: 1 };
      const beforeLists = lists,
        beforeSourceReads = sourceReads;
      await runtime.reconcileNativeShortSubmissionWrite(store, queue, browser, SERVICE, original, {
        ...options,
        completed: (job) => ({ id: job.id, status: job.status }),
      });
      const settled = store.getJob(original.id, SERVICE)!;
      const result = (settled.result as any).result;
      assert.equal(settled.status, scenario === 'recovered-ai' ? 'succeeded' : 'uncertain');
      assert.equal(result.originalSaveDurableAcknowledged, scenario !== 'lost-ack');
      assert.equal(result.acknowledgement?.accepted ?? null, scenario === 'lost-ack' ? null : true);
      assert.equal(result.useAi.observed, scenario === 'missing-ai' ? null : 1);
      assert.equal(result.publication.status, 'published');
      assert.equal(posts, 1);
      assert.equal(lists, beforeLists);
      assert.equal(sourceReads, beforeSourceReads);
      assert.deepEqual(store.listEvidence(original.id), originalRefs);
      assert.deepEqual(store.readEvidence(afterRef).payload, after);
      const projected = runtime.nativeShortSubmissionEvidenceView(
        store,
        SERVICE,
        settled,
        null,
        originalRefs,
        originalRefs.map((ref) => store.readEvidence(ref)),
      );
      assert.equal(projected.valid, true);
      const publicBusiness = projected.data[0] as Record<string, any>;
      assert.equal(publicBusiness.statusSource.phase, 'later_read');
      assert.equal(publicBusiness.useAi.acknowledged, scenario === 'lost-ack' ? null : 1);
      await queue.drainAndStop();
      store.close();
      store = new Store(storeOptions);
      queue = new JobQueue(store, { timeoutMs: 120_000 });
      assert.equal(store.getJob(original.id, SERVICE)!.status, settled.status);
      assert.equal(posts, 1);
    } finally {
      await queue.drainAndStop();
      store.close();
      request.newContext = originalFactory;
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
