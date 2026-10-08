import { mkdtempSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { Store, canonicalJson, RuntimeError } from '../../src/runtime/store.js';

import { JobQueue } from '../../src/runtime/jobs.js';

import { createHash, randomUUID } from 'node:crypto';

import {
  ORIGINAL_COMPENSATION_GOLDEN,
  result,
  WORK,
  writeBusiness,
  SCOPE,
  operatorExecutionInventory,
} from './public-overview-snapshot.js';

import {
  createNativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
} from '../../src/platform/short-native-metadata.js';

import assert from 'node:assert/strict';

import {
  nativeShortDesiredContentHash,
  nativeShortWriteInputHash,
  nativeShortWriteRequest,
  NATIVE_SHORT_BASELINE_DATASET,
  createNativeShortOriginalAudit,
  createNativeShortReconciliationEvidence,
  validateNativeShortReconciliationContext,
  createNativeShortCompensationReconciliationEvidence,
} from '../../src/platform/short-native-metadata-proof.js';

import { createOverviewOperatorRun } from './public-overview-operator-run.js';

import {
  installedSourceInventory,
  installedSourceRegistrationHash,
} from '../../src/runtime/source-integrity.js';

import { fileURLToPath } from 'node:url';

export async function syntheticCompensationFixture(withHistory = true) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'native-compensation-contract-'));
  const storage = {
    databasePath: path.join(directory, 'operations.sqlite'),
    evidenceDirectory: path.join(directory, 'evidence'),
    evidenceMode: 'live' as const,
  };
  const store = new Store(storage),
    queue = new JobQueue(store);
  const sha = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex'),
    bytesSha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
  const tick = async () => {
    const now = new Date().toISOString();
    while (new Date().toISOString() <= now) await new Promise((resolve) => setTimeout(resolve, 1));
    return new Date().toISOString();
  };
  const named = (ref: any) => ({ id: ref.id, sha256: ref.sha256, capturedAt: ref.capturedAt });
  const {
    original: originalSnapshot,
    temporary,
    restored,
  } = structuredClone(ORIGINAL_COMPENSATION_GOLDEN);
  const modernObserved = (snap: any) =>
    createNativeShortMetadataSnapshot({
      binding: snap.binding,
      editData: snap.editData,
      categoryData: snap.categoryData,
    });
  const live = { executor: 'application-default-browser/v1', mode: 'live' } as const;
  const readResult = (snap: typeof originalSnapshot) => ({ ...result(), snapshot: snap });
  const phase = () => {
    const r = result();
    return {
      proof: {
        platformStarted: true,
        ownerBefore: true,
        ownerAfter: true,
        fixedSourceVerified: true,
        targetUnique: true,
        paginationComplete: true,
        atomicRevision: false as const,
        readStartedAt: r.proof.readStartedAt,
        readFinishedAt: r.proof.readFinishedAt,
        proofCapturedAt: r.proof.proofCapturedAt,
      },
      requests: r.requests,
      list: r.list,
    };
  };
  const held = (snap: typeof originalSnapshot, request: any) => {
    const p = phase();
    const plan = ORIGINAL_COMPENSATION_GOLDEN.plans.find(
      (plan: any) => plan.expectation.sourceVersionHash === snap.snapshotVersionHash,
    );
    assert(plan);
    assert.equal(
      plan.form.multi_title,
      JSON.stringify([request.title, ...snap.savedFields.multi_title.slice(1)]),
    );
    return {
      schema: 'native-short-metadata-held-before/v1' as const,
      phase: 'held-for-write' as const,
      snapshot: snap,
      businessRequest: request,
      expectation: plan.expectation,
      desiredContentHash: nativeShortDesiredContentHash(plan.expectation),
      read: p,
      cleanup: {
        sessionCreated: true,
        sessionDisposed: false,
        pendingAtEnd: 0,
        disposalFailures: 0,
        quarantined: false,
        checkedAt: new Date().toISOString(),
      },
    };
  };
  const target = { kind: 'short-story' as const, id: WORK };
  const business = { ...writeBusiness(), title: temporary.savedFields.multi_title[0]! };
  const originalHandle = queue.enqueueWrite({
    accountId: 'owner',
    operation: 'update_work_metadata',
    scope: SCOPE,
    idempotencyKey: 'compensation-original-synthetic',
    inputHash: nativeShortWriteInputHash(business),
    run: async (ctx) => {
      ctx.beforePlatformRead();
      const before = {
        schema: 'native-short-metadata-held-before/v1' as const,
        scope: 'short-native-metadata/v1' as const,
        held: held(originalSnapshot, nativeShortWriteRequest(business)),
        businessInput: business,
        source: { origin: 'https://fanqienovel.com' as const, mode: 'live' as const },
        provenance: live,
      };
      const ref = ctx.saveEvidence(NATIVE_SHORT_BASELINE_DATASET, before),
        e = before.held.expectation;
      ctx.saveEvidence('write-intent', {
        schema: 'native-short-metadata-intent/v1',
        scope: 'short-native-metadata/v1',
        hashBases: e.hashBases,
        binding: e.binding,
        target,
        expectedSnapshotVersionHash: e.sourceVersionHash,
        expectation: e,
        baselineEvidence: { id: ref.id, sha256: ref.sha256 },
        comparisonBasis: 'native-short-metadata-desired-and-preservation/v1',
        desiredContentHash: before.held.desiredContentHash,
        expectedStates: ['draft_saved'],
      });
      ctx.recordTarget(target);
      ctx.beforePlatformWrite();
      throw new RuntimeError('outcome_unknown', 'Synthetic original v1 unknown');
    },
  });
  await originalHandle.completion;
  const originalId = originalHandle.jobId;
  if (withHistory) {
    await tick();
    const original = store.getJob(originalId)!,
      refs = store.listEvidence(originalId),
      documents = refs.map((ref) => store.readEvidence(ref));
    const originalContext = { accountId: 'owner', job: original, manifest: null, refs, documents },
      audit = createNativeShortOriginalAudit(original, refs);
    const later = queue.enqueueRead({
      accountId: 'owner',
      operation: 'reconcile_write',
      scope: 'reconciliation',
      datasets: ['reconciliation'],
      inputHash: sha({ jobId: originalId }),
      run: async (ctx) => {
        ctx.beforePlatformRead();
        ctx.recordTarget(target);
        return [
          ctx.saveEvidence(
            'reconciliation',
            createNativeShortReconciliationEvidence(
              readResult(modernObserved(temporary)),
              audit,
              originalContext,
              live,
            ),
          ),
        ];
      },
    });
    await later.completion;
    const read = store.getJob(later.jobId)!,
      ref = store.listEvidence(read.id)[0]!,
      manifest = store.history('owner').find((m) => m.jobId === read.id)!;
    const checked = validateNativeShortReconciliationContext({
      accountId: 'owner',
      originalJob: store.getJob(originalId)!,
      originalRefs: refs,
      originalDocuments: documents,
      readJob: read,
      manifest,
      ref,
      document: store.readEvidence(ref),
    });
    store.reconcileWriteJob(originalId, read.id, {
      status: checked.status,
      result: checked.result,
    });
  }
  const original = store.getJob(originalId)!,
    originalRef = store.listEvidence(originalId)[0]!,
    runId = randomUUID(),
    events: any[] = [];
  const admittedAt = await tick();
  const event = (phase: string, values: any = {}) => {
    const value = { phase, checkedAt: new Date().toISOString(), ...values };
    events.push(value);
    return value;
  };
  event('saved-context-validated', {
    originalJobId: originalId,
    baselineEvidence: named(originalRef),
    ...(withHistory ? { laterReadJobId: (original.result as any).reconciliationJobId } : {}),
  });
  event('login-warm-start');
  const warm = event('login-warm-complete');
  await tick();
  const beforeHandle = queue.enqueueRead({
    accountId: 'owner',
    operation: 'operator_short_native_title_restore_before_v1',
    scope: 'operator_title_restore_before',
    datasets: ['operator_title_restore_before'],
    inputHash: sha({ runId, originalJobId: originalId, phase: 'before' }),
    run: async (ctx) => {
      ctx.addMetadata({ schema: 'native-short-metadata-operator-read/v1', runId });
      event('fresh-before-start', { jobId: ctx.jobId });
      ctx.beforePlatformRead();
      return [
        ctx.saveEvidence('operator_title_restore_before', {
          schema: 'native-short-metadata-operator-before/v1',
          basis: 'operator-title-restore-three-paths/v1',
          executor: 'operator-owned-browser/v1',
          mode: 'live',
          originalBaseline: { id: originalRef.id, sha256: originalRef.sha256 },
          result: readResult(temporary),
        }),
      ];
    },
  });
  await beforeHandle.completion;
  const beforeRef = store.listEvidence(beforeHandle.jobId)[0]!;
  event('fresh-before-complete', {
    jobId: beforeHandle.jobId,
    ref: named(beforeRef),
    snapshotHashes: {
      snapshotVersionHash: temporary.snapshotVersionHash,
      catalogHash: temporary.catalogHash,
      documentHash: temporary.documentHash,
      savedFieldsHash: temporary.savedFieldsHash,
      categorySelectionHash: temporary.categorySelectionHash,
    },
  });
  await tick();
  const request = {
      expectedSnapshotVersionHash: temporary.snapshotVersionHash,
      hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
      expectedState: 'draft' as const,
      title: originalSnapshot.savedFields.multi_title[0]!,
    },
    basis = 'operator-title-restore-three-paths/v1';
  const operatorInputHash = sha({
    runId,
    originalJobId: originalId,
    originalBaselineHash: originalRef.sha256,
    freshRef: named(beforeRef),
    request,
  });
  const operatorHandle = queue.enqueueWrite({
    accountId: 'owner',
    operation: 'operator_short_native_title_restore_v1',
    scope: 'operator_title_restore',
    idempotencyKey: 'operator-title-restore-' + runId,
    inputHash: operatorInputHash,
    run: createOverviewOperatorRun({
      runId,
      originalId,
      basis,
      event,
      tick,
      held,
      temporary,
      request,
      originalRef,
      named,
      beforeRef,
      operatorInputHash,
      target,
      phase,
      readResult,
      restored,
    }),
  });
  await operatorHandle.completion;
  const operator = store.getJob(operatorHandle.jobId)!,
    operatorRefs = store.listEvidence(operator.id);
  assert.equal(operator.status, 'succeeded');
  event('operator-job-settled', { jobId: operator.id, status: 'succeeded' });
  const actor = {
    schema: 'fanqie-c3-operator-title-restoration-safe/v1',
    pass: true,
    operatorExecuted: true,
    postAttempts: 1,
    acknowledged: true,
    nativeV1VerificationPassed: false,
    originalUnknownUnchanged: true,
    originalTitleRestored: true,
    serverTokenUnitTimezoneClaimed: false,
    privateValueOutput: false,
    fullF05Verified: false,
    overallGoalComplete: false,
    events,
    runId,
    loginWarmAuthenticatedOwnerMatched: true,
    loginWarmCheckedAt: warm.checkedAt,
    operatorJobId: operator.id,
    nonServerRawPreserved: true,
    revisionDeltaExactlyOne: true,
    opaqueServerTokenNondecreasing: true,
    afterEvidence: named(operatorRefs[3]),
    queueDrained: true,
    browserClosed: true,
    storeClosed: true,
    completedAt: new Date().toISOString(),
  };
  const actorBytes = JSON.stringify(actor) + '\n';
  const controller = {
    schema: 'fanqie-c3-operator-title-restoration-controller-safe/v1',
    pass: true,
    operatorExecuted: true,
    remainingMaximumPostAttempts: 1,
    productionSourceChanged: false,
    controllerPlatformToolCalls: 0,
    tokenInRAMOnly: true,
    privateValueOutput: false,
    originalUnknownUnchanged: true,
    protectedSevenUnchanged: true,
    writesDisabledAfter: true,
    oldNativeV1RunStillFailed: true,
    fullF05Verified: false,
    overallGoalComplete: false,
    checkpointEvents: events,
    admittedAt,
    approvedInputs: {
      sourceManifest: {
        sha256: '6d22f3e179b4092c7efd8d1efbdb3e86614150c73b61c7d1793d302c55f6dbb6',
      },
    },
    runId,
    sameImagePriorSourceDistESMProofReusedAfterCurrentObservation: true,
    operatorSafe: actor,
    operatorOutputSafe: { sha256: bytesSha(actorBytes) },
    operatorRestorationObserved: true,
    operatorStoppedVerified: true,
    phase: 'finally-restore-false',
    errorCode: null,
    completedAt: new Date().toISOString(),
  };
  const controllerBytes = JSON.stringify(controller) + '\n';
  const installedInventory = installedSourceInventory(
    fileURLToPath(new URL('../', new URL('../public-overview.test.ts', import.meta.url).href)),
  );
  const authority = {
    policy: { basis, sha256: 'bb6e9da2aab7977aad1edfeb270da0677f4ea87062694d95fa4a2348468f373c' },
    source: {
      executionManifestSha256: '6d22f3e179b4092c7efd8d1efbdb3e86614150c73b61c7d1793d302c55f6dbb6',
      executionInventory: operatorExecutionInventory,
      registrationManifestSha256: 'a'.repeat(64),
      registrationInventory: Object.fromEntries(
        Object.keys(operatorExecutionInventory).map((key) => [
          key,
          installedSourceRegistrationHash(key, installedInventory),
        ]),
      ),
    },
    actor: { sha256: 'd58fa26059041a7913ef5bf696064dcf66c8ea97de361814db2d149351aa1f1c' },
    controller: { sha256: '76466487dfb1fe97e3acd4b01bf9546257051715532cac6490675c87364b0e93' },
    receipts: {
      actor: { sha256: bytesSha(actorBytes), bytes: actorBytes },
      controller: { sha256: bytesSha(controllerBytes), bytes: controllerBytes },
    },
  };
  const approvedAt = await tick();
  const registration = store.registerNativeCompensationAttestation({
    schema: 'native-short-metadata-compensation-registration-input/v1',
    accountId: 'owner',
    originalJobId: originalId,
    operatorJobId: operator.id,
    authority,
    approvedAt,
    effectsEndedAt: controller.completedAt,
  });
  const source = store.getNativeCompensationContext(originalId)!;
  return {
    directory,
    storage,
    store,
    queue,
    originalId,
    restored: modernObserved(restored),
    source,
    registration,
    authority,
    async fresh() {
      await tick();
      const handle = queue.enqueueRead({
        accountId: 'owner',
        operation: 'reconcile_write',
        scope: 'reconciliation',
        datasets: ['reconciliation'],
        inputHash: sha({ jobId: originalId }),
        run: async (ctx) => {
          ctx.beforePlatformRead();
          ctx.recordTarget(target);
          return [
            ctx.saveEvidence(
              'reconciliation',
              createNativeShortCompensationReconciliationEvidence(
                store.getNativeCompensationContext(originalId)!,
                readResult(modernObserved(restored)),
              ),
            ),
          ];
        },
      });
      await handle.completion;
      const read = store.getJob(handle.jobId)!,
        ref = store.listEvidence(read.id)[0]!,
        manifest = store.history('owner').find((m) => m.jobId === read.id)!;
      assert.equal(read.status, 'succeeded', JSON.stringify(read.error));
      return {
        source: store.getNativeCompensationContext(originalId)!,
        readJob: read,
        manifest,
        ref,
        document: store.readEvidence(ref),
      };
    },
    async close() {
      await queue.drainAndStop();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
