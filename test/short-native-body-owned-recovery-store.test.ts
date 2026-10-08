import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type APIRequest } from 'playwright';
import { Store, resolveNativeShortBodyStoreAuthority } from '../src/runtime/store.js';
import { JobQueue } from '../src/runtime/jobs.js';
import { type BrowserSession } from '../src/platform/browser.js';
import {
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
} from '../src/platform/short-native-metadata.js';
import {
  createNativeShortReadEvidence,
  nativeShortInputHash,
  nativeShortReadScope,
  NATIVE_SHORT_READ_OPERATION,
  NATIVE_SHORT_READ_DATASET,
} from '../src/platform/short-native-metadata-proof.js';
import * as body from '../src/platform/short-native-body.js';
import * as proof from '../src/platform/short-native-body-proof.js';
import {
  reconcileNativeShortBodyWrite,
  nativeShortBodyEvidenceView,
} from '../src/platform/short-native-body-runtime.js';

const ACCOUNT = 'synthetic-recovery-owner',
  PLATFORM = '9001',
  WORK = '7000000001';
const raw = (count = 26, revision = 7) => ({
  binding: {
    account: { kind: 'account_id' as const, id: PLATFORM },
    work: { kind: 'short' as const, id: WORK },
  },
  editData: {
    item_id: WORK,
    publish_status: 0,
    content: `<p>${'甲'.repeat(count)}</p><p></p>`,
    word_number: count,
    multi_title: ['Synthetic title'],
    thumb_uri: 'synthetic-head',
    book_thumb_uri: 'synthetic-cover',
    category: [],
    sign_type: 1,
    origin_activity_flag: 0,
    latest_version: revision,
    modify_time: '1789450000',
    opaque: { unchanged: true },
  },
  categoryData: {
    category_list: [{ category_id: 'c1', label: 'A', name: 'Synthetic' }],
    opaque_catalog: 'unchanged',
  },
});
// Explicit modern source fixture; the raw3 factory input above remains unchanged.
const modernTuple4 = (value: ReturnType<typeof raw>) => {
  const snapshot = body.createNativeShortBodySnapshot(createNativeShortMetadataSnapshot(value));
  return { ...value, statusFacts: structuredClone(snapshot.native.statusFacts) };
};
function phase() {
  const at = new Date().toISOString();
  return {
    proof: {
      platformStarted: true,
      ownerBefore: true,
      ownerAfter: true,
      fixedSourceVerified: true,
      targetUnique: true,
      paginationComplete: true,
      atomicRevision: false as const,
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
const clean = (at: string) => ({
  sessionCreated: true,
  sessionDisposed: true,
  pendingAtEnd: 0,
  disposalFailures: 0,
  quarantined: false,
  checkedAt: at,
});
const bytesHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('body Store and Queue old-owner dirty legacy derived count recovers from owned fixture GET and reopens saved without POST', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'body-owned-get-store-'));
  const databasePath = path.join(dir, 'operations.sqlite'),
    evidenceDirectory = path.join(dir, 'evidence');
  let requestContexts = 0,
    browserCalls = 0;
  const factory: Pick<APIRequest, 'newContext'> = {
    async newContext() {
      requestContexts++;
      throw Error('Synthetic Store graph never opens HTTP');
    },
  };
  let store = new Store({
    databasePath,
    evidenceDirectory,
    evidenceMode: 'fixture',
    nativeShortBodyWriteEnabled: true,
    nativeShortBodyFixtureFactory: factory,
  });
  let queue = new JobQueue(store, { timeoutMs: 120_000 });
  try {
    const before = body.createNativeShortBodySnapshot(createNativeShortMetadataSnapshot(raw()));
    const business = body.validateNativeShortBodyBusinessInput({
      target: { kind: 'short', workId: WORK },
      snapshotScope: body.NATIVE_SHORT_BODY_SCOPE,
      expectedSnapshotVersionHash: before.snapshotVersionHash,
      hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
      expectedState: 'draft',
      representation: body.NATIVE_SHORT_BODY_REPRESENTATION,
      paragraphs: [
        { sourceIndex: null, lines: ['甲'.repeat(27)] },
        { sourceIndex: 1, lines: [''] },
      ],
      trial: { action: 'preserve' },
    });
    const inputHash = body.nativeShortBodyBusinessInputHash(ACCOUNT, business);
    const original = store.createJob({
      accountId: ACCOUNT,
      kind: 'write',
      operation: proof.NATIVE_SHORT_BODY_OPERATION,
      scope: proof.nativeShortBodyScope(WORK),
      idempotencyKey: 'synthetic-old-derived-key',
      inputHash,
    }).job;
    store.startJob(original.id);
    const held = resolveNativeShortBodyStoreAuthority(
      store.issueNativeShortBodyWriteAuthority(original.id, ACCOUNT, business, PLATFORM),
      { accountId: ACCOUNT, workId: WORK, inputHash },
    );
    assert(held);
    held.beforeGet();
    const baseline = held.recordBaseline(modernTuple4(raw()), phase()),
      preSave = held.recordPreSave(modernTuple4(raw()), phase()),
      intent = held.recordIntent();
    const plan = body.planNativeShortBodyUpdate(before, body.nativeShortBodyWriteRequest(business));
    const permit = held.beginAttempt({
      method: 'POST',
      url: plan.request.url,
      contentType: plan.request.contentType,
      maxRedirects: 0,
      maxRetries: 0,
      maxAttempts: 1,
    });
    const attempt = held.consumeAttempt(permit),
      startedAt = new Date().toISOString(),
      acknowledgedAt = new Date().toISOString();
    const acknowledgement = held.recordAcknowledgement({
      schema: 'native-short-body-acknowledgement/v1',
      binding: raw().binding,
      scope: body.NATIVE_SHORT_BODY_SCOPE,
      sourceVersionHash: plan.expectation.sourceVersionHash,
      desiredContentHash: plan.desiredContentHash,
      acknowledgedAt,
    });
    const observed = body.createNativeShortBodySnapshot(
      createNativeShortMetadataSnapshot(raw(27, 8)),
    );
    const legacyComparison = body.compareNativeShortBodyReadback(plan.expectation, observed);
    assert.equal(legacyComparison.reason, 'preservation_not_proven');
    const after = held.recordAfter(modernTuple4(raw(27, 8)), phase(), legacyComparison),
      ownerCheckedAt = new Date().toISOString(),
      checkedAt = new Date().toISOString();
    const result: proof.NativeShortBodyWriteResultEvidence = {
      schema: 'native-short-body-write-result/v1',
      outcome: 'unknown',
      reason: 'readback_mismatch',
      source: { mode: 'fixture', executor: 'sqlite-owned-body-fixture/v1' },
      desiredContentHash: plan.desiredContentHash,
      preservationHash: plan.expectation.preservationHash,
      hashBasesHash: proof.nativeShortBodyHashBasesHash(),
      evidence: { baseline, preSave, intent, attempt, acknowledgement, after },
      post: { attempts: 1, disposed: 1, startedAt, acknowledgedAt, acknowledged: true },
      ownerCheckedAt,
      cleanup: { ...clean(checkedAt), pendingAtEnd: 1, quarantined: true },
      atomicRevision: false,
    };
    held.recordResult(result);
    const uncertain = store.failJob(original.id, {
      code: 'capability_unavailable',
      message: 'Native short body is unavailable.',
    });
    assert.equal(uncertain.status, 'uncertain');
    assert.throws(() => store.getNativeShortBodyOriginalAudit(original.id, ACCOUNT));
    const oldRefs = store.listEvidence(original.id),
      oldBytes = oldRefs.map((ref) => readFileSync(path.join(evidenceDirectory, ref.path))),
      oldAttempts = store.listNativeShortBodyAttempts(original.id, ACCOUNT);
    assert.equal(oldAttempts.length, 1);
    assert.equal(requestContexts, 0);
    await queue.drainAndStop();
    store.close();
    store = new Store({
      databasePath,
      evidenceDirectory,
      evidenceMode: 'fixture',
      nativeShortBodyWriteEnabled: false,
      nativeShortBodyFixtureFactory: factory,
    });
    queue = new JobQueue(store, { timeoutMs: 120_000 });
    // Require a genuinely later requestedAt; no future timestamp or fabricated lease.
    const laterDeadline = Date.now() + 1_000;
    while (new Date().toISOString() <= uncertain.endedAt!) {
      assert(Date.now() < laterDeadline);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    }
    const fresh = queue.enqueueRead({
      accountId: ACCOUNT,
      operation: NATIVE_SHORT_READ_OPERATION,
      scope: nativeShortReadScope(WORK),
      datasets: [NATIVE_SHORT_READ_DATASET],
      inputHash: nativeShortInputHash(WORK),
      idempotencyKey: 'explicit_body_read.synthetic-owned-recovery',
      run: async (ctx) => {
        ctx.addMetadata({ explicitBodyRead: true });
        ctx.beforePlatformRead();
        ctx.recordTarget({ kind: 'short-story', id: WORK });
        const read = phase(),
          at = read.proof.proofCapturedAt;
        const wrapper = createNativeShortReadEvidence(
          {
            schema: 'native-short-metadata-api-read/v1',
            status: 'success',
            reason: null,
            snapshot: createNativeShortMetadataSnapshot(raw(27, 8)),
            proof: { ...read.proof, ownerCallback: true },
            requests: read.requests,
            list: read.list,
            cleanup: clean(at),
          },
          { mode: 'fixture', executor: 'dependency-injected-browser/v1' },
        );
        return [ctx.saveEvidence(NATIVE_SHORT_READ_DATASET, wrapper)];
      },
    });
    const freshJob = await fresh.completion;
    assert.equal(freshJob.status, 'succeeded');
    assert.notEqual(freshJob.ownerId, original.ownerId);
    const prepared = store.prepareNativeShortBodyReconciliation(original.id, ACCOUNT),
      recoveryContext = prepared.recoveryContext;
    assert(recoveryContext);
    assert.equal(prepared.comparisonPolicy, body.NATIVE_SHORT_BODY_COMPARISON_POLICY_V2);
    assert.equal(recoveryContext.recovery.leaseOwnerId, freshJob.ownerId);
    assert.equal(recoveryContext.recovery.originalOwnerId, original.ownerId);
    const reconciliationHash = proof.nativeShortBodyReconciliationInputHash(
      ACCOUNT,
      prepared.audit,
      recoveryContext.recovery,
      prepared.comparisonPolicy,
    );
    const reconcile = queue.enqueueRead({
      accountId: ACCOUNT,
      operation: proof.NATIVE_SHORT_BODY_RECONCILE_OPERATION,
      scope: proof.nativeShortBodyReconciliationScope(original.id),
      datasets: [proof.NATIVE_SHORT_BODY_DATASETS.reconciliation],
      inputHash: reconciliationHash,
      run: async (ctx) => {
        const binding = resolveNativeShortBodyStoreAuthority(
          store.issueNativeShortBodyReconciliationAuthority(
            ctx.jobId,
            ACCOUNT,
            original.id,
            prepared.audit,
            PLATFORM,
            recoveryContext,
            prepared.comparisonPolicy,
          ),
          { accountId: ACCOUNT, workId: WORK, inputHash },
        );
        assert(binding);
        binding.beforeGet();
        assert(binding.reconciliationExpectation);
        const read = phase(),
          at = read.proof.proofCapturedAt;
        const comparison = body.compareNativeShortBodyReadback(
          binding.reconciliationExpectation,
          observed,
        );
        assert.equal(comparison.matches, true);
        binding.recordReconciliation({
          native: modernTuple4(raw(27, 8)),
          read,
          ownerCheckedAt: at,
          cleanup: clean(at),
          comparison,
          reason: 'match',
        });
        return store.listEvidence(ctx.jobId);
      },
    });
    const readJob = await reconcile.completion;
    assert.equal(readJob.status, 'succeeded');
    assert.equal(readJob.platformWriteStartedAt, null);
    assert.equal(store.listNativeShortBodyAttempts(readJob.id, ACCOUNT).length, 0);
    const readRefs = store.listEvidence(readJob.id),
      manifest = store.getManifestForJob(ACCOUNT, readJob.id);
    assert(manifest);
    assert.equal(readRefs.length, 1);
    const unsettled = store.getJob(original.id, ACCOUNT);
    assert(unsettled);
    const originalRefs = store.listEvidence(original.id);
    const settlement = proof.validateNativeShortBodyReconciliationContext({
      original: {
        accountId: ACCOUNT,
        job: unsettled,
        manifest: null,
        refs: originalRefs,
        documents: originalRefs.map((ref) => store.readEvidence(ref)),
        attempts: store.listNativeShortBodyAttempts(original.id, ACCOUNT),
      },
      readJob,
      manifest,
      ref: readRefs[0]!,
      document: store.readEvidence(readRefs[0]!),
      recoveryContext,
    });
    assert.equal(settlement.status, 'succeeded');
    assert.equal(settlement.result.verifiedLive, false);
    store.reconcileWriteJob(original.id, readJob.id, {
      status: settlement.status,
      result: settlement.result,
    });
    const settled = store.getJob(original.id, ACCOUNT);
    assert(settled);
    assert.equal(settled.status, 'succeeded');
    const closure = settled.result as proof.NativeShortBodyClosure;
    assert.equal(closure.schema, 'native-short-body-closure/v2');
    assert.deepEqual(closure.recovery, recoveryContext.recovery);
    const view = nativeShortBodyEvidenceView(
      store,
      ACCOUNT,
      settled,
      null,
      originalRefs,
      originalRefs.map((ref) => store.readEvidence(ref)),
    );
    assert.equal(view.valid, true);
    assert.equal(view.verifiedLive, false);
    const summary = view.data[0] as unknown as {
      summaries: { pendingAtEnd: number; quarantined: boolean };
      recovery: { cleanup: { pendingAtEnd: number; quarantined: boolean } };
    };
    assert.equal(summary.summaries.pendingAtEnd, 1);
    assert.equal(summary.summaries.quarantined, true);
    assert.equal(summary.recovery.cleanup.pendingAtEnd, 0);
    assert.equal(summary.recovery.cleanup.quarantined, false);
    assert.deepEqual(store.listNativeShortBodyAttempts(original.id, ACCOUNT), oldAttempts);
    assert.deepEqual(store.listEvidence(original.id), oldRefs);
    for (let index = 0; index < oldRefs.length; index++)
      assert.equal(
        bytesHash(readFileSync(path.join(evidenceDirectory, oldRefs[index]!.path))),
        bytesHash(oldBytes[index]!),
      );
    const historicalRecovery = store.getNativeShortBodyRecoveryContext(original.id, ACCOUNT);
    assert(historicalRecovery);
    await queue.drainAndStop();
    store.close();
    store = new Store({
      databasePath,
      evidenceDirectory,
      evidenceMode: 'fixture',
      nativeShortBodyWriteEnabled: false,
      nativeShortBodyFixtureFactory: factory,
    });
    queue = new JobQueue(store, { timeoutMs: 120_000 });
    assert.deepEqual(
      store.getNativeShortBodyRecoveryContext(original.id, ACCOUNT),
      historicalRecovery,
    );
    const reopened = store.getJob(original.id, ACCOUNT);
    assert(reopened);
    assert.equal(reopened.status, 'succeeded');
    const jobsBefore = store.listJobs(ACCOUNT).length;
    const forbiddenBrowser = {
      runNativeShortBodyUpdate: async () => {
        browserCalls++;
        throw Error('Terminal saved must never create a context or POST');
      },
    } as unknown as BrowserSession;
    const saved = await reconcileNativeShortBodyWrite(
      store,
      queue,
      forbiddenBrowser,
      ACCOUNT,
      reopened,
      {
        timeoutMs: 120_000,
        currentPlatformAccount: () => PLATFORM,
        onVerifiedAccount: () => {
          throw Error('Terminal saved must not observe platform owner');
        },
      },
    );
    assert.equal(saved.retrievalMode, 'saved');
    assert.equal(saved.reconciliationJobId, readJob.id);
    assert.deepEqual(saved.settlement, settlement);
    assert.equal(store.listJobs(ACCOUNT).length, jobsBefore);
    assert.equal(requestContexts, 0);
    assert.equal(browserCalls, 0);
    assert.deepEqual(store.listEvidence(original.id), oldRefs);
    assert.deepEqual(store.listNativeShortBodyAttempts(original.id, ACCOUNT), oldAttempts);
    assert.equal(store.getJob(original.id, 'foreign'), null);
  } finally {
    await queue.drainAndStop();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
