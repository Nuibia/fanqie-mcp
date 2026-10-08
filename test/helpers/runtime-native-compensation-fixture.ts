import { fixture, delay, digest } from './runtime-deferred.js';

import {
  NATIVE_COMPENSATION_ORIGINAL_GOLDEN,
  nativeStoreLater,
  nativeCompensationModernObserved,
  nativeCompensationBasis,
  nativeCompensationLink,
  nativeCompensationRef,
  nativeCompensationPlan,
  nativeCompensationExecutionInventory,
} from './runtime-native-store-original.js';

import {
  nativeCompensationOriginal,
  nativeCompensationInstalledInventory,
} from './runtime-native-compensation-original.js';

import { randomUUID } from 'node:crypto';

import { canonicalJson } from '../../src/runtime/store.js';

import { nativeStoreReadResult, nativeStoreDb } from './runtime-recovery-baseline.js';

import assert from 'node:assert/strict';

import {
  NATIVE_SHORT_HASH_BASES,
  type NativeShortMetadataSnapshot,
} from '../../src/platform/short-native-metadata.js';

import { type NativeShortMetadataHeldBefore } from '../../src/platform/short-native-metadata-api.js';

import {
  nativeShortDesiredContentHash,
  type NativeShortCompensationAuthority,
} from '../../src/platform/short-native-metadata-proof.js';

/** Synthetic local Store/Queue operator contracts model the approved public
 * binary's real wire. These fixtures are not live platform authentication. */
export async function nativeCompensationFixture(withHistory = true) {
  const f = fixture(30_000, 'live');
  try {
    const {
      original: originalBefore,
      temporary,
      restored,
    } = structuredClone(NATIVE_COMPENSATION_ORIGINAL_GOLDEN);
    const initial = await nativeCompensationOriginal(
      f,
      originalBefore,
      temporary.savedFields.multi_title[0]!,
    );
    let original = initial;
    if (withHistory) {
      const later = await nativeStoreLater(
        f,
        original,
        nativeCompensationModernObserved(temporary),
      );
      original = f.store.reconcileWriteJob(original.id, later.read.id, later.resolution);
    }
    await delay(3);
    const admittedAt = new Date().toISOString(),
      runId = randomUUID(),
      target = original.target!,
      baseOriginal = f.store.listEvidence(original.id)[0]!;
    const before = await f.queue.enqueueRead({
      accountId: 'author',
      operation: 'operator_short_native_title_restore_before_v1',
      scope: 'operator_title_restore_before',
      datasets: ['operator_title_restore_before'],
      inputHash: digest(canonicalJson({ runId, originalJobId: original.id, phase: 'before' })),
      run: async (ctx) => {
        ctx.addMetadata({ schema: 'native-short-metadata-operator-read/v1', runId });
        const at = ctx.beforePlatformRead();
        return [
          ctx.saveEvidence('operator_title_restore_before', {
            schema: 'native-short-metadata-operator-before/v1',
            basis: nativeCompensationBasis,
            executor: 'operator-owned-browser/v1',
            mode: 'live',
            originalBaseline: nativeCompensationLink(baseOriginal),
            result: nativeStoreReadResult(temporary, at),
          }),
        ];
      },
    }).completion;
    assert.equal(before.status, 'succeeded');
    assert.equal(
      before.target,
      null,
      'Approved operator-before read does not record a write target.',
    );
    const beforeRef = f.store.listEvidence(before.id)[0]!;
    const request = {
      expectedSnapshotVersionHash: temporary.snapshotVersionHash,
      hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
      expectedState: 'draft' as const,
      title: originalBefore.savedFields.multi_title[0]!,
    };
    const inputHash = digest(
      canonicalJson({
        runId,
        originalJobId: original.id,
        originalBaselineHash: baseOriginal.sha256,
        freshRef: nativeCompensationRef(beforeRef),
        request,
      }),
    );
    await delay(3);
    const operator = f.store.createJob({
      accountId: 'author',
      kind: 'write',
      operation: 'operator_short_native_title_restore_v1',
      scope: 'operator_title_restore',
      idempotencyKey: 'operator-title-restore-' + runId,
      inputHash,
    }).job;
    f.store.startJob(operator.id);
    f.store.addJobMetadata(operator.id, {
      schema: 'native-short-metadata-operator-job/v1',
      runId,
      originalUncertainJobId: original.id,
      verificationBasis: nativeCompensationBasis,
      nativeV1VerificationPassed: false,
    });
    f.store.markPlatformReadStarted(operator.id);
    await delay(2);
    const at = new Date().toISOString(),
      raw = nativeStoreReadResult(temporary, at),
      { ownerCallback: _unused, ...proof } = raw.proof;
    const plan = nativeCompensationPlan(temporary, request),
      held: NativeShortMetadataHeldBefore = {
        schema: 'native-short-metadata-held-before/v1',
        phase: 'held-for-write',
        snapshot: temporary,
        businessRequest: request,
        expectation: plan.expectation,
        desiredContentHash: nativeShortDesiredContentHash(plan.expectation),
        read: { proof, requests: raw.requests, list: raw.list },
        cleanup: { ...raw.cleanup, sessionDisposed: false },
      };
    const baseline = f.store.saveEvidence(operator.id, 'operator_title_restore_baseline', {
      schema: 'native-short-metadata-operator-held/v1',
      basis: nativeCompensationBasis,
      executor: 'operator-owned-browser/v1',
      mode: 'live',
      originalUncertainJobId: original.id,
      originalBaseline: nativeCompensationLink(baseOriginal),
      freshBefore: nativeCompensationRef(beforeRef),
      held,
    });
    const intent = f.store.saveEvidence(operator.id, 'write-intent', {
      schema: 'native-short-metadata-operator-intent/v1',
      basis: nativeCompensationBasis,
      originalUncertainJobId: original.id,
      originalBaseline: nativeCompensationLink(baseOriginal),
      baselineEvidence: nativeCompensationRef(baseline),
      freshBefore: nativeCompensationRef(beforeRef),
      expectedSnapshotVersionHash: request.expectedSnapshotVersionHash,
      desiredContentHash: held.desiredContentHash,
      operatorInputHash: inputHash,
      target,
      expectedStates: ['original_title_restored'],
      maximumPostAttempts: 1,
    });
    const durableAt = new Date().toISOString();
    f.store.recordTarget(operator.id, target);
    const markedAt = f.store.markPlatformWriteStarted(operator.id);
    await delay(3);
    const phaseAt = new Date().toISOString(),
      phaseRaw = nativeStoreReadResult(restored, phaseAt),
      { ownerCallback: _afterUnused, ...afterProof } = phaseRaw.proof;
    const outcome = {
      schema: 'native-short-metadata-api-write/v1',
      status: 'capability_unavailable',
      reason: 'readback_mismatch',
      held: null,
      receipt: null,
      snapshot: null,
      comparison: null,
      desiredContentHash: null,
      observedContentHash: null,
      phases: {
        before: held.read,
        after: { proof: afterProof, requests: phaseRaw.requests, list: phaseRaw.list },
      },
      post: {
        attempts: 1,
        disposed: 1,
        markedAt,
        startedAt: markedAt,
        acknowledgedAt: phaseAt,
        acknowledged: true,
      },
      proof: {
        platformStarted: true,
        writeMarked: true,
        ownerCallback: false,
        atomicRevision: false,
        proofCapturedAt: null,
      },
      cleanup: phaseRaw.cleanup,
    };
    const native = f.store.saveEvidence(operator.id, 'operator_title_restore_native', {
      schema: 'native-short-metadata-operator-v1-outcome/v1',
      basis: nativeCompensationBasis,
      result: outcome,
      nativeV1VerificationPassed: false,
    });
    await delay(3);
    const afterAt = new Date().toISOString();
    const after = f.store.saveEvidence(operator.id, 'operator_title_restore_after', {
      schema: 'native-short-metadata-operator-after/v1',
      basis: nativeCompensationBasis,
      executor: 'operator-owned-browser/v1',
      mode: 'live',
      result: nativeStoreReadResult(restored, afterAt),
      originalBaseline: nativeCompensationLink(baseOriginal),
      heldBaseline: nativeCompensationRef(baseline),
      nativeOutcome: nativeCompensationRef(native),
      originalTitleRestored: true,
      nonServerRawPreserved: true,
      revisionDeltaExactlyOne: true,
      opaqueServerTokenNondecreasing: true,
      nativeV1VerificationPassed: false,
    });
    const settled = f.store.completeWriteJob(operator.id, {
      schema: 'native-short-metadata-operator-title-restore-result/v1',
      basis: nativeCompensationBasis,
      runId,
      originalUncertainJobId: original.id,
      originalTitleRestored: true,
      nonServerRawPreserved: true,
      revisionDeltaExactlyOne: true,
      opaqueServerTokenNondecreasing: true,
      nativeV1VerificationPassed: false,
      postAttempts: 1,
      acknowledged: true,
      markedAt,
      baselineEvidence: nativeCompensationRef(baseline),
      intentEvidence: nativeCompensationRef(intent),
      nativeOutcomeEvidence: nativeCompensationRef(native),
      afterEvidence: nativeCompensationRef(after),
    });
    const firstRow = nativeStoreDb(f)
      .prepare(
        'SELECT read_job_id FROM write_reconciliations WHERE original_job_id=? ORDER BY rowid DESC LIMIT 1',
      )
      .get(original.id);
    const events = [
      {
        phase: 'saved-context-validated',
        checkedAt: admittedAt,
        originalJobId: original.id,
        baselineEvidence: nativeCompensationRef(baseOriginal),
        ...(firstRow ? { laterReadJobId: String(firstRow.read_job_id) } : {}),
      },
      { phase: 'login-warm-start', checkedAt: admittedAt },
      { phase: 'login-warm-complete', checkedAt: admittedAt },
      { phase: 'fresh-before-start', checkedAt: before.requestedAt, jobId: before.id },
      {
        phase: 'fresh-before-complete',
        checkedAt: before.endedAt,
        jobId: before.id,
        ref: nativeCompensationRef(beforeRef),
        snapshotHashes: Object.fromEntries(
          [
            'snapshotVersionHash',
            'catalogHash',
            'documentHash',
            'savedFieldsHash',
            'categorySelectionHash',
          ].map((name) => [name, temporary[name as keyof NativeShortMetadataSnapshot]]),
        ),
      },
      { phase: 'restore-job-start', checkedAt: operator.requestedAt, jobId: operator.id },
      {
        phase: 'durable-before-mark',
        checkedAt: durableAt,
        jobId: operator.id,
        baseline: nativeCompensationRef(baseline),
        intent: nativeCompensationRef(intent),
      },
      { phase: 'restore-marked', checkedAt: markedAt, jobId: operator.id, markedAt },
      {
        phase: 'native-v1-mismatch-clean',
        checkedAt: native.capturedAt,
        jobId: operator.id,
        ref: nativeCompensationRef(native),
      },
      {
        phase: 'operator-restoration-observed',
        checkedAt: after.capturedAt,
        jobId: operator.id,
        afterEvidence: nativeCompensationRef(after),
      },
      {
        phase: 'operator-job-settled',
        checkedAt: settled.endedAt,
        jobId: operator.id,
        status: 'succeeded',
      },
    ];
    const completedAt = new Date().toISOString();
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
      loginWarmCheckedAt: admittedAt,
      operatorJobId: operator.id,
      nonServerRawPreserved: true,
      revisionDeltaExactlyOne: true,
      opaqueServerTokenNondecreasing: true,
      afterEvidence: nativeCompensationRef(after),
      queueDrained: true,
      browserClosed: true,
      storeClosed: true,
      completedAt,
    };
    const actorBytes = canonicalJson(actor) + '\n',
      actorHash = digest(actorBytes),
      sourceSha = '6d22f3e179b4092c7efd8d1efbdb3e86614150c73b61c7d1793d302c55f6dbb6';
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
      runId,
      admittedAt,
      sameImagePriorSourceDistESMProofReusedAfterCurrentObservation: true,
      approvedInputs: { sourceManifest: { sha256: sourceSha } },
      operatorSafe: actor,
      operatorOutputSafe: { sha256: actorHash },
      operatorRestorationObserved: true,
      operatorStoppedVerified: true,
      phase: 'finally-restore-false',
      errorCode: null,
      completedAt,
    };
    const controllerBytes = canonicalJson(controller) + '\n';
    const authority: NativeShortCompensationAuthority = {
      policy: {
        basis: nativeCompensationBasis,
        sha256: 'bb6e9da2aab7977aad1edfeb270da0677f4ea87062694d95fa4a2348468f373c',
      },
      source: {
        executionManifestSha256: sourceSha,
        executionInventory: nativeCompensationExecutionInventory,
        registrationManifestSha256: 'a'.repeat(64),
        registrationInventory: nativeCompensationInstalledInventory(),
      },
      actor: { sha256: 'd58fa26059041a7913ef5bf696064dcf66c8ea97de361814db2d149351aa1f1c' },
      controller: { sha256: '76466487dfb1fe97e3acd4b01bf9546257051715532cac6490675c87364b0e93' },
      receipts: {
        actor: { sha256: actorHash, bytes: actorBytes },
        controller: { sha256: digest(controllerBytes), bytes: controllerBytes },
      },
    };
    return {
      ...f,
      initial,
      original,
      operatorBefore: before,
      operator: settled,
      restored: nativeCompensationModernObserved(restored),
      authority,
      input: {
        schema: 'native-short-metadata-compensation-registration-input/v1',
        accountId: 'author',
        originalJobId: original.id,
        operatorJobId: operator.id,
        authority,
        approvedAt: completedAt,
        effectsEndedAt: completedAt,
      },
    };
  } catch (error) {
    await f.cleanup();
    throw error;
  }
}
