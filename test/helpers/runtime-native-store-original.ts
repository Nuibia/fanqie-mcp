import { fixture, delay, digest } from './runtime-deferred.js';

import {
  type NativeShortProvenance,
  type NativeShortWriteBusinessInput,
  nativeShortReadScope,
  nativeShortWriteInputHash,
  nativeShortWriteRequest,
  nativeShortDesiredContentHash,
  createNativeShortBaselineEvidence,
  createNativeShortWriteIntent,
  type NativeShortOriginalAudit,
  createNativeShortOriginalAudit,
  type NativeShortClosure,
  createNativeShortReconciliationEvidence,
  validateNativeShortReconciliationContext,
} from '../../src/platform/short-native-metadata-proof.js';

import {
  nativeStoreProvenance,
  nativeStoreSnapshot,
  NATIVE_STORE_WORK,
  nativeStoreReadResult,
  nativeStoreDb,
  nativeStoreRowCount,
} from './runtime-recovery-baseline.js';

import {
  type NativeShortMetadataSnapshot,
  NATIVE_SHORT_METADATA_SCOPE,
  NATIVE_SHORT_HASH_BASES,
  planNativeShortMetadataUpdate,
  planNativeShortMetadataUpdateV2,
  createNativeShortMetadataSnapshot,
} from '../../src/platform/short-native-metadata.js';

import { type Job, canonicalJson, Store, type EvidenceRef } from '../../src/runtime/store.js';

import { type NativeShortMetadataHeldBefore } from '../../src/platform/short-native-metadata-api.js';

import assert from 'node:assert/strict';

import { writeFileSync } from 'node:fs';

import path from 'node:path';

import { storedMetadataMath } from '../../src/platform/short-native-legacy-codec.js';

export async function nativeStoreOriginal(
  f: ReturnType<typeof fixture>,
  provenance: NativeShortProvenance = nativeStoreProvenance,
  version: 1 | 2 = 1,
  overrideBefore?: NativeShortMetadataSnapshot,
  overrideTitle?: string,
): Promise<Job> {
  const before =
    overrideBefore ??
    (version === 1
      ? nativeStoreSnapshot()
      : nativeStoreSnapshot('Before', (edit) => {
          edit.latest_version = 10;
          edit.modify_time = '1000000000';
        }));
  const business: NativeShortWriteBusinessInput = {
    target: { kind: 'short', workId: NATIVE_STORE_WORK },
    snapshotScope: NATIVE_SHORT_METADATA_SCOPE,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedSnapshotVersionHash: before.snapshotVersionHash,
    expectedState: 'draft',
    title: overrideTitle ?? 'After',
  };
  const job = f.store.createJob({
    accountId: 'author',
    kind: 'write',
    operation: 'update_work_metadata',
    scope: nativeShortReadScope(NATIVE_STORE_WORK),
    idempotencyKey: 'native-store-key',
    inputHash: nativeShortWriteInputHash(business),
  }).job;
  f.store.startJob(job.id);
  const at = f.store.markPlatformReadStarted(job.id),
    raw = nativeStoreReadResult(before, at);
  const { ownerCallback: _unused, ...proof } = raw.proof;
  const request = nativeShortWriteRequest(business);
  const plan =
    version === 1
      ? planNativeShortMetadataUpdate(before, request)
      : planNativeShortMetadataUpdateV2(before, request);
  const held = {
    schema:
      version === 1
        ? 'native-short-metadata-held-before/v1'
        : 'native-short-metadata-held-before/v2',
    phase: 'held-for-write',
    snapshot: before,
    businessRequest: request,
    expectation: plan.expectation,
    desiredContentHash: nativeShortDesiredContentHash(plan.expectation),
    read: { proof, requests: raw.requests, list: raw.list },
    cleanup: { ...raw.cleanup, sessionDisposed: false },
  } as NativeShortMetadataHeldBefore;
  const baseline = createNativeShortBaselineEvidence(held, business, provenance);
  const baselineRef = f.store.saveEvidence(job.id, 'short_native_metadata_baseline', baseline);
  f.store.saveEvidence(job.id, 'write-intent', createNativeShortWriteIntent(baseline, baselineRef));
  f.store.recordTarget(job.id, { kind: 'short-story', id: NATIVE_STORE_WORK });
  f.store.markPlatformWriteStarted(job.id);
  await delay(2);
  return f.store.failJob(job.id, {
    code: 'response_lost',
    message: 'Synthetic ACK lost after one saved effect.',
  });
}

function nativeStoreAudit(f: ReturnType<typeof fixture>, original: Job): NativeShortOriginalAudit {
  const refs = f.store.listEvidence(original.id);
  const version =
    (f.store.readEvidence(refs[0]!).payload as { schema?: unknown }).schema ===
    'native-short-metadata-held-before/v2'
      ? 2
      : 1;
  if (
    !['native-short-metadata-closure/v1', 'native-short-metadata-closure/v2'].includes(
      String((original.result as { schema?: unknown })?.schema),
    )
  )
    return createNativeShortOriginalAudit(original, refs, undefined, version);
  const previous = original.result as NativeShortClosure;
  const firstRef = f.store
    .listEvidence(previous.originalAttemptEvidence.readJobId)
    .find((ref) => ref.id === previous.originalAttemptEvidence.evidenceId)!;
  const firstAudit = (
    f.store.readEvidence(firstRef).payload as { originalAudit: NativeShortOriginalAudit }
  ).originalAudit;
  return createNativeShortOriginalAudit(
    original,
    refs,
    { firstAudit, previousClosure: previous },
    version,
  );
}

export async function nativeStoreLater(
  f: ReturnType<typeof fixture>,
  original: Job,
  snapshot = nativeStoreSnapshot('After'),
  provenance: NativeShortProvenance = nativeStoreProvenance,
) {
  await delay(3);
  const originalRefs = f.store.listEvidence(original.id),
    originalDocuments = originalRefs.map((ref) => f.store.readEvidence(ref));
  const audit = nativeStoreAudit(f, original);
  const read = await f.queue.enqueueRead({
    accountId: original.accountId,
    operation: 'reconcile_write',
    scope: 'reconciliation',
    datasets: ['reconciliation'],
    inputHash: digest(canonicalJson({ jobId: original.id })),
    run: async (ctx) => {
      const at = ctx.beforePlatformRead();
      ctx.recordTarget(original.target!);
      const evidence = createNativeShortReconciliationEvidence(
        nativeStoreReadResult(snapshot, at),
        audit,
        {
          accountId: original.accountId,
          job: original,
          manifest: null,
          refs: originalRefs,
          documents: originalDocuments,
        },
        provenance,
      );
      return [ctx.saveEvidence('reconciliation', evidence)];
    },
  }).completion;
  assert.equal(
    read.status,
    'succeeded',
    'The synthetic later read must persist a real complete read manifest.',
  );
  const ref = f.store.listEvidence(read.id)[0]!,
    document = f.store.readEvidence(ref),
    manifest = f.store.history(original.accountId).find((item) => item.jobId === read.id)!;
  const context = {
    accountId: original.accountId,
    originalJob: original,
    originalRefs,
    originalDocuments,
    readJob: read,
    manifest,
    ref,
    document,
  };
  const checked = validateNativeShortReconciliationContext(context);
  return {
    read,
    ref,
    document,
    manifest,
    context,
    resolution: { status: checked.status, result: checked.result },
  };
}

/** Resign a synthetic later document and its durable manifest, so payload tests
 * reach semantic validation instead of failing only an old SHA/link mismatch. */
export function nativeStoreResignLater(
  f: ReturnType<typeof fixture>,
  later: Awaited<ReturnType<typeof nativeStoreLater>>,
  mutate: (document: any) => void,
) {
  const document = structuredClone(f.store.readEvidence(later.ref));
  mutate(document);
  const bytes = canonicalJson(document) + '\n';
  const sha = digest(bytes);
  writeFileSync(path.join(f.options.evidenceDirectory, later.ref.path), bytes);
  const db = nativeStoreDb(f);
  db.prepare('UPDATE evidence SET sha256 = ? WHERE id = ?').run(sha, later.ref.id);
  const manifest = structuredClone(later.manifest);
  manifest.evidence[0]!.sha256 = sha;
  db.prepare('UPDATE manifests SET manifest_json = ? WHERE id = ?').run(
    canonicalJson(manifest),
    manifest.id,
  );
  db.prepare('UPDATE jobs SET result_json = ? WHERE id = ?').run(
    canonicalJson({ manifest }),
    later.read.id,
  );
}

export function assertNativeStoreRejected(
  f: ReturnType<typeof fixture>,
  original: Job,
  later: Awaited<ReturnType<typeof nativeStoreLater>>,
  resolution: Parameters<Store['reconcileWriteJob']>[2] = later.resolution,
) {
  const before = f.store.getJob(original.id),
    rows = nativeStoreRowCount(f);
  assert.throws(() => f.store.reconcileWriteJob(original.id, later.read.id, resolution));
  assert.deepEqual(f.store.getJob(original.id), before);
  assert.equal(nativeStoreRowCount(f), rows);
}

// Fixed approved public execution inventory: no runtime account/target/ref identifiers.
export const nativeCompensationExecutionInventory: Record<string, string> = {
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

export const nativeCompensationBasis = 'operator-title-restore-three-paths/v1';

export const nativeCompensationRef = (ref: EvidenceRef) => ({
  id: ref.id,
  sha256: ref.sha256,
  capturedAt: ref.capturedAt,
});

export const nativeCompensationLink = (ref: EvidenceRef) => ({ id: ref.id, sha256: ref.sha256 });

// Frozen original producer output, ORIGINAL-METADATA-GOLDEN.json SHA
// 74e099b3cb399e608269f03f64ca97561054ccae31b67623d5e6a10b1ec04168.
// This fixture replays the approved old operator wire. Ordinary Store helpers above remain modern.
export const NATIVE_COMPENSATION_ORIGINAL_GOLDEN: any = JSON.parse(
  String.raw`{"original":{"scope":"short-native-metadata/v1","hashBases":{"snapshot":"full-edit-catalog-and-typed-binding/v1","catalog":"full-category-data-json/v1","document":"exact-html-utf8/v1","savedFields":"cover-v0-reconstructible-fields/v1","categorySelection":"ordered-raw-category-id-label-name/v1","preservation":"full-source-except-requested-first-title-and-category/v1"},"binding":{"account":{"kind":"account_id","id":"001001"},"work":{"kind":"short","id":"7000000001"}},"editData":{"item_id":"7000000001","publish_status":0,"multi_title":["Authorized title","PRIVATE_TAIL"],"content":"<p>PRIVATE_HTML &amp; text</p>","thumb_uri":"PRIVATE_URI_ONE","book_thumb_uri":"PRIVATE_URI_TWO","category":[{"category_id":10,"label":"主类","name":"主甲","unknown":"PRIVATE_CATEGORY_RAW"},{"category_id":"r1","label":"角色","name":"角色甲"}],"category_max_count":4,"sign_type":1,"origin_activity_flag":0,"PRIVATE_UNKNOWN_KEY":"PRIVATE_UNKNOWN_VALUE","thumb_url_list":[{"main_url":"https://example.invalid/cover?PRIVATE_SIGNED_QUERY"}],"credentials":["PRIVATE_COOKIE","PRIVATE_HEADER","PRIVATE_FORM","/private/PRIVATE_ABSOLUTE_PATH"],"latest_version":100,"modify_time":"0000000123"},"categoryData":{"category_list":[{"category_id":10,"label":"主类","name":"主甲","opaque":"PRIVATE_CATALOG"},{"category_id":11,"label":"主类","name":"主乙"},{"category_id":"r1","label":"角色","name":"角色甲"}],"unknown_catalog":"PRIVATE_UNKNOWN_VALUE"},"responseBinding":"exact","state":"draft","catalog":[{"category_id":10,"label":"主类","name":"主甲"},{"category_id":11,"label":"主类","name":"主乙"},{"category_id":"r1","label":"角色","name":"角色甲"}],"savedFields":{"item_id":"7000000001","content":"<p>PRIVATE_HTML &amp; text</p>","multi_title":["Authorized title","PRIVATE_TAIL"],"thumb_uri":"PRIVATE_URI_ONE","book_thumb_uri":"PRIVATE_URI_TWO","category":[10,"r1"],"sign_type":1,"activity_flag":0},"snapshotVersionHash":"a36c097247999ab1fcfb1df8bd17e4b8e1b09761718dea898c4c27f1e8d7563d","catalogHash":"0a8a6db80e9a1893c825cd5517afa65e1434a6221321d6ed36c6dce1bd74e4e6","documentHash":"d1156b228c009176667ba4e20d292814a8784d677adcb7e37020cbb862333a60","savedFieldsHash":"5b3a00be414690694105fe033d92d2fdbe8fe157b65cf95a9caae44305ff0393","categorySelectionHash":"1ebc69d8975aed6b9120b7b5e7c9dcc4f68c84a8856975511746ec91b7d3655c"},"temporary":{"scope":"short-native-metadata/v1","hashBases":{"snapshot":"full-edit-catalog-and-typed-binding/v1","catalog":"full-category-data-json/v1","document":"exact-html-utf8/v1","savedFields":"cover-v0-reconstructible-fields/v1","categorySelection":"ordered-raw-category-id-label-name/v1","preservation":"full-source-except-requested-first-title-and-category/v1"},"binding":{"account":{"kind":"account_id","id":"001001"},"work":{"kind":"short","id":"7000000001"}},"editData":{"item_id":"7000000001","publish_status":0,"multi_title":["Authorized title [synthetic temporary]","PRIVATE_TAIL"],"content":"<p>PRIVATE_HTML &amp; text</p>","thumb_uri":"PRIVATE_URI_ONE","book_thumb_uri":"PRIVATE_URI_TWO","category":[{"category_id":10,"label":"主类","name":"主甲","unknown":"PRIVATE_CATEGORY_RAW"},{"category_id":"r1","label":"角色","name":"角色甲"}],"category_max_count":4,"sign_type":1,"origin_activity_flag":0,"PRIVATE_UNKNOWN_KEY":"PRIVATE_UNKNOWN_VALUE","thumb_url_list":[{"main_url":"https://example.invalid/cover?PRIVATE_SIGNED_QUERY"}],"credentials":["PRIVATE_COOKIE","PRIVATE_HEADER","PRIVATE_FORM","/private/PRIVATE_ABSOLUTE_PATH"],"latest_version":101,"modify_time":"0000000123"},"categoryData":{"category_list":[{"category_id":10,"label":"主类","name":"主甲","opaque":"PRIVATE_CATALOG"},{"category_id":11,"label":"主类","name":"主乙"},{"category_id":"r1","label":"角色","name":"角色甲"}],"unknown_catalog":"PRIVATE_UNKNOWN_VALUE"},"responseBinding":"exact","state":"draft","catalog":[{"category_id":10,"label":"主类","name":"主甲"},{"category_id":11,"label":"主类","name":"主乙"},{"category_id":"r1","label":"角色","name":"角色甲"}],"savedFields":{"item_id":"7000000001","content":"<p>PRIVATE_HTML &amp; text</p>","multi_title":["Authorized title [synthetic temporary]","PRIVATE_TAIL"],"thumb_uri":"PRIVATE_URI_ONE","book_thumb_uri":"PRIVATE_URI_TWO","category":[10,"r1"],"sign_type":1,"activity_flag":0},"snapshotVersionHash":"0862465015dfb44f50092314405ef06c3bd37304836bb222fc9f8d689da9dc3d","catalogHash":"0a8a6db80e9a1893c825cd5517afa65e1434a6221321d6ed36c6dce1bd74e4e6","documentHash":"d1156b228c009176667ba4e20d292814a8784d677adcb7e37020cbb862333a60","savedFieldsHash":"f410df8aafc779aa3a0ea8d6accf5ec579ffa36b63da474aab6387e4d80add3d","categorySelectionHash":"1ebc69d8975aed6b9120b7b5e7c9dcc4f68c84a8856975511746ec91b7d3655c"},"restored":{"scope":"short-native-metadata/v1","hashBases":{"snapshot":"full-edit-catalog-and-typed-binding/v1","catalog":"full-category-data-json/v1","document":"exact-html-utf8/v1","savedFields":"cover-v0-reconstructible-fields/v1","categorySelection":"ordered-raw-category-id-label-name/v1","preservation":"full-source-except-requested-first-title-and-category/v1"},"binding":{"account":{"kind":"account_id","id":"001001"},"work":{"kind":"short","id":"7000000001"}},"editData":{"item_id":"7000000001","publish_status":0,"multi_title":["Authorized title","PRIVATE_TAIL"],"content":"<p>PRIVATE_HTML &amp; text</p>","thumb_uri":"PRIVATE_URI_ONE","book_thumb_uri":"PRIVATE_URI_TWO","category":[{"category_id":10,"label":"主类","name":"主甲","unknown":"PRIVATE_CATEGORY_RAW"},{"category_id":"r1","label":"角色","name":"角色甲"}],"category_max_count":4,"sign_type":1,"origin_activity_flag":0,"PRIVATE_UNKNOWN_KEY":"PRIVATE_UNKNOWN_VALUE","thumb_url_list":[{"main_url":"https://example.invalid/cover?PRIVATE_SIGNED_QUERY"}],"credentials":["PRIVATE_COOKIE","PRIVATE_HEADER","PRIVATE_FORM","/private/PRIVATE_ABSOLUTE_PATH"],"latest_version":102,"modify_time":"0000000123"},"categoryData":{"category_list":[{"category_id":10,"label":"主类","name":"主甲","opaque":"PRIVATE_CATALOG"},{"category_id":11,"label":"主类","name":"主乙"},{"category_id":"r1","label":"角色","name":"角色甲"}],"unknown_catalog":"PRIVATE_UNKNOWN_VALUE"},"responseBinding":"exact","state":"draft","catalog":[{"category_id":10,"label":"主类","name":"主甲"},{"category_id":11,"label":"主类","name":"主乙"},{"category_id":"r1","label":"角色","name":"角色甲"}],"savedFields":{"item_id":"7000000001","content":"<p>PRIVATE_HTML &amp; text</p>","multi_title":["Authorized title","PRIVATE_TAIL"],"thumb_uri":"PRIVATE_URI_ONE","book_thumb_uri":"PRIVATE_URI_TWO","category":[10,"r1"],"sign_type":1,"activity_flag":0},"snapshotVersionHash":"45fbd0c2fdfca98fcb4a1c6c0f771abd2ce9518bd26c219305d56e37b5b088c2","catalogHash":"0a8a6db80e9a1893c825cd5517afa65e1434a6221321d6ed36c6dce1bd74e4e6","documentHash":"d1156b228c009176667ba4e20d292814a8784d677adcb7e37020cbb862333a60","savedFieldsHash":"5b3a00be414690694105fe033d92d2fdbe8fe157b65cf95a9caae44305ff0393","categorySelectionHash":"1ebc69d8975aed6b9120b7b5e7c9dcc4f68c84a8856975511746ec91b7d3655c"},"plans":[{"kind":"native_metadata_payload_plan","atomicRevision":false,"categoryMax":{"value":4,"basis":"source"},"form":{"item_id":"7000000001","content":"<p>PRIVATE_HTML &amp; text</p>","thumb_uri":"PRIVATE_URI_ONE","book_thumb_uri":"PRIVATE_URI_TWO","item_version":"-1","multi_title":"[\"Authorized title [synthetic temporary]\",\"PRIVATE_TAIL\"]","sign_type":"1","activity_flag":"0","category":"10,r1"},"expectation":{"scope":"short-native-metadata/v1","hashBases":{"snapshot":"full-edit-catalog-and-typed-binding/v1","catalog":"full-category-data-json/v1","document":"exact-html-utf8/v1","savedFields":"cover-v0-reconstructible-fields/v1","categorySelection":"ordered-raw-category-id-label-name/v1","preservation":"full-source-except-requested-first-title-and-category/v1"},"binding":{"account":{"kind":"account_id","id":"001001"},"work":{"kind":"short","id":"7000000001"}},"expectedState":"draft","requested":{"title":true,"categories":false},"sourceVersionHash":"a36c097247999ab1fcfb1df8bd17e4b8e1b09761718dea898c4c27f1e8d7563d","catalogHash":"0a8a6db80e9a1893c825cd5517afa65e1434a6221321d6ed36c6dce1bd74e4e6","documentHash":"d1156b228c009176667ba4e20d292814a8784d677adcb7e37020cbb862333a60","savedFieldsHash":"f410df8aafc779aa3a0ea8d6accf5ec579ffa36b63da474aab6387e4d80add3d","preservationHash":"0f7ec50c62f885be991228fdaba2434125f8ef2a21d44646c0e8ef484b208b64","categorySelectionHash":"1ebc69d8975aed6b9120b7b5e7c9dcc4f68c84a8856975511746ec91b7d3655c"},"request":{"method":"POST","url":"https://fanqienovel.com/api/author/short_article/cover/v0/?aid=2503&app_name=muye_novel","contentType":"application/x-www-form-urlencoded;charset=UTF-8","body":"item_id=7000000001&content=%3Cp%3EPRIVATE_HTML+%26amp%3B+text%3C%2Fp%3E&thumb_uri=PRIVATE_URI_ONE&book_thumb_uri=PRIVATE_URI_TWO&item_version=-1&multi_title=%5B%22Authorized+title+%5Bsynthetic+temporary%5D%22%2C%22PRIVATE_TAIL%22%5D&sign_type=1&activity_flag=0&category=10%2Cr1"}},{"kind":"native_metadata_payload_plan","atomicRevision":false,"categoryMax":{"value":4,"basis":"source"},"form":{"item_id":"7000000001","content":"<p>PRIVATE_HTML &amp; text</p>","thumb_uri":"PRIVATE_URI_ONE","book_thumb_uri":"PRIVATE_URI_TWO","item_version":"-1","multi_title":"[\"Authorized title\",\"PRIVATE_TAIL\"]","sign_type":"1","activity_flag":"0","category":"10,r1"},"expectation":{"scope":"short-native-metadata/v1","hashBases":{"snapshot":"full-edit-catalog-and-typed-binding/v1","catalog":"full-category-data-json/v1","document":"exact-html-utf8/v1","savedFields":"cover-v0-reconstructible-fields/v1","categorySelection":"ordered-raw-category-id-label-name/v1","preservation":"full-source-except-requested-first-title-and-category/v1"},"binding":{"account":{"kind":"account_id","id":"001001"},"work":{"kind":"short","id":"7000000001"}},"expectedState":"draft","requested":{"title":true,"categories":false},"sourceVersionHash":"0862465015dfb44f50092314405ef06c3bd37304836bb222fc9f8d689da9dc3d","catalogHash":"0a8a6db80e9a1893c825cd5517afa65e1434a6221321d6ed36c6dce1bd74e4e6","documentHash":"d1156b228c009176667ba4e20d292814a8784d677adcb7e37020cbb862333a60","savedFieldsHash":"5b3a00be414690694105fe033d92d2fdbe8fe157b65cf95a9caae44305ff0393","preservationHash":"65b06674856b1c64d78b66b7ea1d2907bdf7f0352d7decf154e153dde0be9217","categorySelectionHash":"1ebc69d8975aed6b9120b7b5e7c9dcc4f68c84a8856975511746ec91b7d3655c"},"request":{"method":"POST","url":"https://fanqienovel.com/api/author/short_article/cover/v0/?aid=2503&app_name=muye_novel","contentType":"application/x-www-form-urlencoded;charset=UTF-8","body":"item_id=7000000001&content=%3Cp%3EPRIVATE_HTML+%26amp%3B+text%3C%2Fp%3E&thumb_uri=PRIVATE_URI_ONE&book_thumb_uri=PRIVATE_URI_TWO&item_version=-1&multi_title=%5B%22Authorized+title%22%2C%22PRIVATE_TAIL%22%5D&sign_type=1&activity_flag=0&category=10%2Cr1"}}]}`,
);

export function nativeCompensationPlan(
  snapshot: any,
  request: Parameters<typeof planNativeShortMetadataUpdate>[1],
) {
  const decoded = storedMetadataMath.decodeSnapshot(snapshot);
  assert.equal(decoded.mode, 'legacy');
  const plan = storedMetadataMath.planUpdate(decoded, request);
  const originalPlan = NATIVE_COMPENSATION_ORIGINAL_GOLDEN.plans.find(
    (item: any) => item.expectation.sourceVersionHash === snapshot.snapshotVersionHash,
  );
  assert(originalPlan, 'The old operator fixture must use a frozen original plan.');
  assert.equal(canonicalJson(plan), canonicalJson(originalPlan));
  return plan;
}

export const nativeCompensationModernObserved = (snapshot: any) =>
  createNativeShortMetadataSnapshot({
    binding: snapshot.binding,
    editData: snapshot.editData,
    categoryData: snapshot.categoryData,
  });
