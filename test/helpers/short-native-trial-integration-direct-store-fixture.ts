import { fixture } from './short-native-trial-integration-fixture.js';

import path from 'node:path';

import { Store, type Job } from '../../src/runtime/store.js';

import { JobQueue } from '../../src/runtime/jobs.js';

import { randomUUID } from 'node:crypto';

import {
  validateNativeShortTrialBusinessInput,
  NATIVE_SHORT_TRIAL_OPERATION,
  nativeShortTrialScope,
  nativeShortTrialBusinessInputHash,
} from '../../src/platform/short-native-trial-proof.js';

import {
  nativeShortTrialEvidenceView,
  reconcileNativeShortTrialWrite,
  runNativeShortTrialJob,
} from '../../src/platform/short-native-trial-runtime.js';

import assert from 'node:assert/strict';

import { ACCOUNT, WORK, noPrivate } from './short-native-trial-integration-edit.js';

export async function directStoreFixture() {
  // This one explicit live-labelled fixture exercises real SQLite settlement
  // structures only. It cannot enter the App's producer-provenance decision.
  const f = fixture(true, 'ack-lost');
  await f.app.close();
  const storeOptions = {
    databasePath: path.join(f.config.dataDir, 'operations.sqlite'),
    evidenceDirectory: path.join(f.config.dataDir, 'evidence'),
    evidenceMode: 'live' as const,
    // A direct Store must use the same operation budget and lease grace as App.
    leaseDurationMs: Math.max(30_000, f.config.timeoutMs + 30_000),
  };
  let store = new Store(storeOptions),
    queue = new JobQueue(store, { timeoutMs: f.config.timeoutMs });
  const { idempotencyKey, ...input } = f.request(randomUUID());
  const business = validateNativeShortTrialBusinessInput(input);
  const provenance = { mode: 'live' as const, executor: 'application-default-browser/v1' as const };
  const completed = (job: Job, _retrievalMode: 'saved' | 'live' = 'saved') => {
    const manifest = store.getManifestForJob(f.config.accountId, job.id),
      refs = store.listEvidence(job.id);
    const view = nativeShortTrialEvidenceView(
      store,
      f.config.accountId,
      job,
      manifest,
      refs,
      refs.map((ref) => store.readEvidence(ref)),
    );
    assert.equal(view.valid, true);
    return { job: view.safeJob, data: view.data, evidence: view.evidence } as any;
  };
  const reconcile = (jobId: string) =>
    reconcileNativeShortTrialWrite(
      store,
      queue,
      f.browser,
      f.config.accountId,
      store.getJob(jobId)!,
      {
        timeoutMs: f.config.timeoutMs,
        provenance,
        currentPlatformAccount: () => ACCOUNT,
        onVerifiedAccount() {},
        completed,
      },
    ) as Promise<any>;
  const handle = queue.enqueueWrite({
    accountId: f.config.accountId,
    operation: NATIVE_SHORT_TRIAL_OPERATION,
    scope: nativeShortTrialScope(WORK),
    idempotencyKey,
    inputHash: nativeShortTrialBusinessInputHash(business),
    run: (ctx) =>
      runNativeShortTrialJob(store, f.browser, ctx, business, {
        timeoutMs: f.config.timeoutMs,
        expectedPlatformAccount: ACCOUNT,
        provenance,
        currentPlatformAccount: () => ACCOUNT,
        onVerifiedAccount() {},
      }),
  });
  const original = await handle.completion;
  assert.equal(original.status, 'uncertain', f.diagnose(original.id));
  assert.equal(f.writes, 1);
  noPrivate(completed(original));
  return {
    f,
    storeOptions,
    original,
    completed,
    reconcile,
    get store() {
      return store;
    },
    get queue() {
      return queue;
    },
    async restart() {
      await queue.drainAndStop();
      store.close();
      store = new Store(storeOptions);
      queue = new JobQueue(store, { timeoutMs: f.config.timeoutMs });
    },
    async close() {
      await queue.drainAndStop();
      store.close();
      await f.close();
    },
  };
}
