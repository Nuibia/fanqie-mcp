import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type APIRequest } from 'playwright';
import {
  Store,
  RuntimeError,
  resolveNativeShortBodyStoreAuthority,
  type EvidenceRef,
} from '../src/runtime/store.js';
import { JobQueue } from '../src/runtime/jobs.js';
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

const ACCOUNT = 'synthetic-fence-owner',
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
interface FenceFixture {
  store: Store;
  databasePath: string;
  evidenceDirectory: string;
  originalJobId: string;
  freshReadJobId: string;
  reconcileJobId: string;
  originalRef: EvidenceRef;
  freshRef: EvidenceRef;
}
interface Scenario {
  name: string;
  code: 'capability_unavailable' | 'evidence_hash_invalid';
  mutate(fixture: FenceFixture): (() => void) | Promise<() => void>;
}

// Every scenario owns new temporary SQL, files, real service leases and Queue jobs.
async function runScenario(scenario: Scenario): Promise<void> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'body-reconciliation-fence-'));
  const databasePath = path.join(dir, 'operations.sqlite'),
    evidenceDirectory = path.join(dir, 'evidence');
  let requestContexts = 0,
    probeCompleted = false;
  const factory: Pick<APIRequest, 'newContext'> = {
    async newContext() {
      requestContexts++;
      throw Error('Synthetic fence graph must never open HTTP');
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
      idempotencyKey: 'synthetic-old-fence-key',
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
    const comparison = body.compareNativeShortBodyReadback(plan.expectation, observed);
    assert.equal(comparison.reason, 'preservation_not_proven');
    const after = held.recordAfter(modernTuple4(raw(27, 8)), phase(), comparison),
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
    const oldRefs = store.listEvidence(original.id),
      oldAttempts = store.listNativeShortBodyAttempts(original.id, ACCOUNT);
    const oldBytes = oldRefs.map((ref) => readFileSync(path.join(evidenceDirectory, ref.path)));
    assert.equal(oldAttempts.length, 1);
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
      idempotencyKey: 'explicit_body_read.synthetic-fence',
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
    assert.equal(recoveryContext.freshRead.document.collectionMode, 'fixture');
    const freshRef = store.listEvidence(freshJob.id)[0]!;
    const freshBytes = readFileSync(path.join(evidenceDirectory, freshRef.path));
    const reconcile = queue.enqueueRead({
      accountId: ACCOUNT,
      operation: proof.NATIVE_SHORT_BODY_RECONCILE_OPERATION,
      scope: proof.nativeShortBodyReconciliationScope(original.id),
      datasets: [proof.NATIVE_SHORT_BODY_DATASETS.reconciliation],
      inputHash: proof.nativeShortBodyReconciliationInputHash(
        ACCOUNT,
        prepared.audit,
        recoveryContext.recovery,
        prepared.comparisonPolicy,
      ),
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
        assert.doesNotThrow(() => binding.beforeGet());
        const undo = await scenario.mutate({
          store,
          databasePath,
          evidenceDirectory,
          originalJobId: original.id,
          freshReadJobId: freshJob.id,
          reconcileJobId: ctx.jobId,
          originalRef: oldRefs[0]!,
          freshRef,
        });
        try {
          assert.throws(() => binding.beforeGet(), { code: scenario.code }, scenario.name);
        } finally {
          undo();
        }
        assert.doesNotThrow(
          () => binding.beforeGet(),
          scenario.name + ': restored test copy must remain admitted',
        );
        probeCompleted = true;
        // There was no platform IO or reconciliation evidence; do not promote this probe to success.
        throw new RuntimeError(
          'capability_unavailable',
          'Synthetic fence probe stopped without platform IO.',
        );
      },
    });
    const readJob = await reconcile.completion;
    assert.equal(probeCompleted, true, scenario.name);
    assert.equal(readJob.status, 'failed');
    assert.equal(readJob.error?.code, 'capability_unavailable');
    assert.equal(readJob.platformWriteStartedAt, null);
    assert.equal(store.listEvidence(readJob.id).length, 0);
    assert.equal(store.listNativeShortBodyAttempts(readJob.id, ACCOUNT).length, 0);
    assert.equal(requestContexts, 0);
    assert.equal(store.getJob(original.id, ACCOUNT)!.status, 'uncertain');
    assert.deepEqual(store.listEvidence(original.id), oldRefs);
    assert.deepEqual(store.listNativeShortBodyAttempts(original.id, ACCOUNT), oldAttempts);
    for (let index = 0; index < oldRefs.length; index++)
      assert.equal(
        bytesHash(readFileSync(path.join(evidenceDirectory, oldRefs[index]!.path))),
        bytesHash(oldBytes[index]!),
      );
    assert.equal(
      bytesHash(readFileSync(path.join(evidenceDirectory, freshRef.path))),
      bytesHash(freshBytes),
    );
    const originalResult = proof.createNativeShortBodyStageEvidence(
      store.readEvidence(oldRefs.at(-1)!).payload,
    ).payload as unknown as proof.NativeShortBodyWriteResultEvidence;
    assert.equal(originalResult.source.mode, 'fixture');
    assert.equal(originalResult.cleanup.pendingAtEnd, 1);
    assert.equal(originalResult.cleanup.quarantined, true);
  } finally {
    try {
      await queue.drainAndStop();
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function metadataDrift(fixture: FenceFixture, jobId: string): () => void {
  const db = new DatabaseSync(fixture.databasePath);
  let original: string;
  try {
    const row = db.prepare('SELECT metadata_json FROM jobs WHERE id=?').get(jobId);
    assert(row);
    assert.equal(typeof row.metadata_json, 'string');
    original = String(row.metadata_json);
    db.prepare('UPDATE jobs SET metadata_json=? WHERE id=?').run(
      '{"syntheticFenceDrift":true}',
      jobId,
    );
  } finally {
    db.close();
  }
  return () => {
    const restore = new DatabaseSync(fixture.databasePath);
    try {
      restore.prepare('UPDATE jobs SET metadata_json=? WHERE id=?').run(original, jobId);
    } finally {
      restore.close();
    }
  };
}
function fileDrift(fixture: FenceFixture, ref: EvidenceRef): () => void {
  const file = path.join(fixture.evidenceDirectory, ref.path),
    bytes = readFileSync(file);
  // JSON remains semantically identical; only actual physical bytes change, with SQL untouched.
  writeFileSync(file, Buffer.concat([bytes, Buffer.from(' ')]));
  return () => {
    writeFileSync(file, bytes);
  };
}

test('body reconciliation GET fences original and recovery SQL and physical bytes after authority issue', async () => {
  const scenarios: Scenario[] = [
    {
      name: 'original SQL drift',
      code: 'capability_unavailable',
      mutate: (f) => metadataDrift(f, f.originalJobId),
    },
    {
      name: 'recovery read SQL drift',
      code: 'capability_unavailable',
      mutate: (f) => metadataDrift(f, f.freshReadJobId),
    },
    {
      name: 'original file only drift',
      code: 'evidence_hash_invalid',
      mutate: (f) => fileDrift(f, f.originalRef),
    },
    {
      name: 'recovery file only drift',
      code: 'evidence_hash_invalid',
      mutate: (f) => fileDrift(f, f.freshRef),
    },
  ];
  for (const scenario of scenarios) await runScenario(scenario);
});

test('body reconciliation GET fences active cancellation and an exact expired SQL deadline', async () => {
  const scenarios: Scenario[] = [
    {
      name: 'active cancellation',
      code: 'capability_unavailable',
      mutate: (f) => {
        const prior = f.store.getJob(f.reconcileJobId, ACCOUNT);
        assert(prior);
        assert.equal(prior.cancellationRequestedAt, null);
        f.store.requestCancellation(f.reconcileJobId);
        return () => {
          const db = new DatabaseSync(f.databasePath);
          try {
            db.prepare(
              'UPDATE jobs SET cancellation_requested_at=NULL,cancellation_reason_json=NULL,updated_at=? WHERE id=?',
            ).run(prior.updatedAt, f.reconcileJobId);
          } finally {
            db.close();
          }
        };
      },
    },
    {
      name: 'exact expired deadline',
      code: 'capability_unavailable',
      mutate: async (f) => {
        const prior = f.store.getJob(f.reconcileJobId, ACCOUNT);
        assert(prior);
        assert(prior.startedAt);
        assert(prior.deadlineAt);
        const deadline = new Date(Date.parse(prior.startedAt) + 1).toISOString();
        const db = new DatabaseSync(f.databasePath);
        try {
          db.prepare('UPDATE jobs SET timeout_ms=1,deadline_at=? WHERE id=?').run(
            deadline,
            f.reconcileJobId,
          );
        } finally {
          db.close();
        }
        while (Date.now() <= Date.parse(deadline))
          await new Promise<void>((resolve) => setTimeout(resolve, 1));
        return () => {
          const restore = new DatabaseSync(f.databasePath);
          try {
            restore
              .prepare('UPDATE jobs SET timeout_ms=?,deadline_at=? WHERE id=?')
              .run(prior.timeoutMs, prior.deadlineAt, f.reconcileJobId);
          } finally {
            restore.close();
          }
        };
      },
    },
  ];
  for (const scenario of scenarios) await runScenario(scenario);
});
