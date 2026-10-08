import {
  createNativeShortBodySnapshot,
  validateNativeShortBodyBusinessInput,
  NATIVE_SHORT_BODY_SCOPE,
  NATIVE_SHORT_BODY_REPRESENTATION,
  nativeShortBodyBusinessInputHash,
  planNativeShortBodyUpdate,
  nativeShortBodyWriteRequest,
  compareNativeShortBodyReadback,
} from '../../src/platform/short-native-body.js';

import {
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
} from '../../src/platform/short-native-metadata.js';

import { type APIRequest } from 'playwright';

import { mkdtempSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { Store, resolveNativeShortBodyStoreAuthority } from '../../src/runtime/store.js';

import {
  NATIVE_SHORT_BODY_OPERATION,
  nativeShortBodyScope,
  type NativeShortBodyRefLink,
  type NativeShortBodyWriteResultEvidence,
} from '../../src/platform/short-native-body-proof.js';

import assert from 'node:assert/strict';

export const ACCOUNT = 'synthetic-owner',
  PLATFORM = '9001',
  WORK = '7000000001';

const SOURCE = '<p>甲甲甲</p><p>乙乙乙</p><p></p>',
  DESIRED = '<p>新正文</p><p>乙乙乙</p><p></p>';

const edit = (content = SOURCE) => ({
  item_id: WORK,
  publish_status: 0,
  content,
  multi_title: ['Synthetic title', 'Synthetic tail'],
  thumb_uri: 'synthetic-head-uri',
  book_thumb_uri: 'synthetic-cover-uri',
  category: [],
  sign_type: 1,
  origin_activity_flag: 0,
  latest_version: 7,
  modify_time: '1789450000',
  opaque: { keep: [null, true, 'original'] },
});

const catalog = () => ({
  category_list: [
    { category_id: 'fixture-category-1', label: 'Synthetic', name: 'Fixture catalog' },
  ],
  opaque_catalog: 'synthetic-catalog-original',
});

export const native = (value = edit()) => ({
  binding: {
    account: { kind: 'account_id' as const, id: PLATFORM },
    work: { kind: 'short' as const, id: WORK },
  },
  editData: value,
  categoryData: catalog(),
});

// Explicit modern source fixture; the raw3 factory input above remains unchanged.
export const modernTuple4 = (value: ReturnType<typeof native>) => {
  const snapshot = createNativeShortBodySnapshot(createNativeShortMetadataSnapshot(value));
  return { ...value, statusFacts: structuredClone(snapshot.native.statusFacts) };
};

function business(noChange = false) {
  const before = createNativeShortMetadataSnapshot(native());
  return validateNativeShortBodyBusinessInput({
    target: { kind: 'short', workId: WORK },
    snapshotScope: NATIVE_SHORT_BODY_SCOPE,
    expectedSnapshotVersionHash: before.snapshotVersionHash,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedState: 'draft',
    representation: NATIVE_SHORT_BODY_REPRESENTATION,
    paragraphs: [
      { sourceIndex: noChange ? 0 : null, lines: [noChange ? '甲甲甲' : '新正文'] },
      { sourceIndex: 1, lines: ['乙乙乙'] },
    ],
    trial: { action: 'clear' },
  });
}

export function phase() {
  const at = new Date().toISOString();
  return {
    proof: {
      platformStarted: true,
      ownerBefore: true,
      ownerAfter: true,
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
  };
}

export const factory: Pick<APIRequest, 'newContext'> = {
  async newContext() {
    throw Error('Store unit never contacts a platform');
  },
};

export function fixture(
  options: { enabled?: boolean; factory?: Pick<APIRequest, 'newContext'> } = {},
) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'body-store-real-')),
    databasePath = path.join(dir, 'operations.sqlite'),
    evidenceDirectory = path.join(dir, 'evidence');
  const store = new Store({
    databasePath,
    evidenceDirectory,
    evidenceMode: 'fixture',
    nativeShortBodyWriteEnabled: options.enabled ?? true,
    nativeShortBodyFixtureFactory: options.factory ?? factory,
  });
  const input = business(),
    job = store.createJob({
      accountId: ACCOUNT,
      kind: 'write',
      operation: NATIVE_SHORT_BODY_OPERATION,
      scope: nativeShortBodyScope(WORK),
      idempotencyKey: 'body-store-unique-key',
      inputHash: nativeShortBodyBusinessInputHash(ACCOUNT, input),
    }).job;
  store.startJob(job.id);
  const issue = () => store.issueNativeShortBodyWriteAuthority(job.id, ACCOUNT, input, PLATFORM);
  const binding = () => {
    const authority = issue(),
      held = resolveNativeShortBodyStoreAuthority(authority, {
        accountId: ACCOUNT,
        workId: WORK,
        inputHash: nativeShortBodyBusinessInputHash(ACCOUNT, input),
      });
    assert(held);
    return held;
  };
  return {
    dir,
    databasePath,
    evidenceDirectory,
    store,
    job,
    input,
    issue,
    binding,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function prefix(f: ReturnType<typeof fixture>) {
  const b = f.binding();
  b.beforeGet();
  const baseline = b.recordBaseline(modernTuple4(native()), phase()),
    preSave = b.recordPreSave(modernTuple4(native()), phase()),
    intent = b.recordIntent();
  const plan = planNativeShortBodyUpdate(
    createNativeShortBodySnapshot(createNativeShortMetadataSnapshot(native())),
    nativeShortBodyWriteRequest(f.input),
  );
  const transport = {
    method: 'POST' as const,
    url: plan.request.url,
    contentType: plan.request.contentType,
    maxRedirects: 0 as const,
    maxRetries: 0 as const,
    maxAttempts: 1 as const,
  };
  return { b, baseline, preSave, intent, plan, transport };
}

export function finish(
  f: ReturnType<typeof fixture>,
  p: ReturnType<typeof prefix>,
  unknown = false,
) {
  const permit = p.b.beginAttempt(p.transport),
    attempt = p.b.consumeAttempt(permit),
    startedAt = new Date().toISOString();
  let acknowledgement: NativeShortBodyRefLink | null = null,
    acknowledgedAt: string | null = null;
  if (!unknown) {
    acknowledgedAt = new Date().toISOString();
    acknowledgement = p.b.recordAcknowledgement({
      schema: 'native-short-body-acknowledgement/v1',
      binding: native().binding,
      scope: NATIVE_SHORT_BODY_SCOPE,
      sourceVersionHash: p.plan.expectation.sourceVersionHash,
      desiredContentHash: p.plan.desiredContentHash,
      acknowledgedAt,
    });
  }
  const afterNative = native({ ...edit(DESIRED), latest_version: 8, modify_time: '1789450001' }),
    comparison = compareNativeShortBodyReadback(
      p.plan.expectation,
      createNativeShortBodySnapshot(createNativeShortMetadataSnapshot(afterNative)),
    );
  assert.equal(comparison.matches, true);
  const after = p.b.recordAfter(modernTuple4(afterNative), phase(), comparison),
    ownerCheckedAt = new Date().toISOString(),
    checkedAt = new Date().toISOString();
  const result: NativeShortBodyWriteResultEvidence = {
    schema: 'native-short-body-write-result/v1',
    outcome: unknown ? 'unknown' : 'matched',
    reason: unknown ? 'acknowledgement_unverified' : 'fixture_not_live',
    source: { mode: 'fixture', executor: 'sqlite-owned-body-fixture/v1' },
    desiredContentHash: p.plan.desiredContentHash,
    preservationHash: 'bd921826b26dad792826dce5ce230fc85af52bddace3896f23fc4ca8f27abc7b',
    hashBasesHash: 'fcb2726382d9f0fbdb7c065588e3b2ef253b1ea64cd0cb7cd42fec5ed7f4084a',
    evidence: {
      baseline: p.baseline,
      preSave: p.preSave,
      intent: p.intent,
      attempt,
      acknowledgement,
      after,
    },
    post: { attempts: 1, disposed: 1, startedAt, acknowledgedAt, acknowledged: !unknown },
    ownerCheckedAt,
    cleanup: {
      sessionCreated: true,
      sessionDisposed: true,
      disposalFailures: 0,
      pendingAtEnd: 0,
      quarantined: false,
      checkedAt,
    },
    atomicRevision: false,
  };
  const resultLink = p.b.recordResult(result);
  return { permit, result, resultLink };
}
