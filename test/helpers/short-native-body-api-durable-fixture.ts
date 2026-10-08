import { type Faults, WORK, edit, SET, ACCOUNT } from './short-native-body-api-edit.js';

import { fixture, CommitReadFailureStore } from './short-native-body-api-fixture.js';

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';

import path from 'node:path';

import os from 'node:os';

import { type APIRequest, type APIRequestContext, type APIResponse } from 'playwright';

import { nativeShortMetadataFixedReadUrl } from '../../src/platform/short-native-metadata-api.js';

import { DatabaseSync } from 'node:sqlite';

import assert from 'node:assert/strict';

import {
  validateNativeShortBodyBusinessInput,
  NATIVE_SHORT_BODY_SCOPE,
  nativeShortBodyBusinessInputHash,
} from '../../src/platform/short-native-body.js';

import {
  NATIVE_SHORT_BODY_OPERATION,
  nativeShortBodyScope,
} from '../../src/platform/short-native-body-proof.js';

import {
  type NativeShortBodyApiOptions,
  prepareNativeShortBodyProductionStart,
  createOwnedNativeShortBodyRun,
  type NativeShortBodyDurableApiResult,
} from '../../src/platform/short-native-body-api.js';

export function durableFixture(faults: Faults = {}, failAfterCommit = false) {
  const f = fixture(faults),
    directory = mkdtempSync(path.join(os.tmpdir(), 'native-body-api-synthetic-'));
  let reconcile = false,
    callbackCount = 0,
    beforePostValidated = false;
  const factory: Pick<APIRequest, 'newContext'> = {
    async newContext(options) {
      const client = await f.factory.newContext(options);
      return {
        async get(url: string, options?: Parameters<APIRequestContext['get']>[1]) {
          const response = await client.get(url, options);
          if (!reconcile || url !== nativeShortMetadataFixedReadUrl(WORK, 'edit')) return response;
          return {
            url: () => response.url(),
            status: () => response.status(),
            headers: () => response.headers(),
            async body() {
              return Buffer.from(
                JSON.stringify({
                  code: 0,
                  data: {
                    ...edit(faults.desired ?? SET),
                    latest_version: 8,
                    modify_time: '1789450001',
                  },
                }),
              );
            },
            dispose: () => response.dispose(),
          } as unknown as APIResponse;
        },
        async post(url: string, options?: Parameters<APIRequestContext['post']>[1]) {
          // The transport observes committed SQL and actual files before receiving the bytes.
          const db = new DatabaseSync(store.databasePath, { readOnly: true });
          try {
            const rows = db
              .prepare(
                'SELECT ordinal,evidence_id,event_at FROM native_short_body_attempts WHERE job_id=? AND account_id=?',
              )
              .all(job.id, 'owner');
            const write = db
              .prepare('SELECT write_started_at FROM jobs WHERE id=? AND account_id=?')
              .get(job.id, 'owner');
            assert.equal(rows.length, 1);
            assert.equal(rows[0]?.ordinal, 1);
            assert.equal(rows[0]?.event_at, write?.write_started_at);
            const refs = store.listEvidence(job.id);
            assert.deepEqual(
              refs.map((ref) => ref.dataset),
              [
                'short_native_body_baseline',
                'short_native_body_pre_save',
                'write-intent',
                'short_native_body_attempt',
              ],
            );
            const attempt = refs.at(-1);
            assert.ok(attempt);
            assert.equal(attempt.id, rows[0]?.evidence_id);
            assert.ok(readFileSync(path.join(store.evidenceDirectory, attempt.path)).length > 0);
            beforePostValidated = true;
          } finally {
            db.close();
          }
          return client.post(url, options);
        },
        dispose: () => client.dispose(),
      } as unknown as APIRequestContext;
    },
  };
  const store = new CommitReadFailureStore(
    {
      databasePath: path.join(directory, 'operations.sqlite'),
      evidenceDirectory: path.join(directory, 'evidence'),
      evidenceMode: 'fixture',
      nativeShortBodyWriteEnabled: true,
      nativeShortBodyFixtureFactory: factory,
    },
    failAfterCommit,
  );
  const businessInput = validateNativeShortBodyBusinessInput({
    ...f.options.businessRequest,
    target: { kind: 'short', workId: WORK },
    snapshotScope: NATIVE_SHORT_BODY_SCOPE,
  });
  const created = store.createJob({
    accountId: 'owner',
    kind: 'write',
    operation: NATIVE_SHORT_BODY_OPERATION,
    scope: nativeShortBodyScope(WORK),
    datasets: [],
    idempotencyKey: 'synthetic-api-write',
    inputHash: nativeShortBodyBusinessInputHash('owner', businessInput),
    timeoutMs: 30_000,
  });
  const job = store.startJob(created.job.id);
  const authority = store.issueNativeShortBodyWriteAuthority(
    job.id,
    'owner',
    businessInput,
    ACCOUNT,
  );
  const { onStage: _fixtureObserver, ...base } = f.options;
  const options: NativeShortBodyApiOptions = {
    ...base,
    deadline: performance.now() + 30_000,
    assertLease: () => store.assertLeaseOwnership(),
    onBeforePlatformRead() {
      callbackCount++;
      store.markPlatformReadStarted(job.id);
    },
  };
  const decision = prepareNativeShortBodyProductionStart({
    accountId: 'owner',
    workId: WORK,
    businessRequest: options.businessRequest,
    authority,
  });
  assert.ok(decision.allowed);
  const run = createOwnedNativeShortBodyRun(decision.start, f.borrowed, WORK, options);
  return {
    f,
    directory,
    store,
    job,
    authority,
    options,
    start: decision.start,
    run,
    businessInput,
    get callbackCount() {
      return callbackCount;
    },
    get beforePostValidated() {
      return beforePostValidated;
    },
    enableReconcile() {
      reconcile = true;
    },
    close() {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export function durable(
  result: Awaited<ReturnType<ReturnType<typeof durableFixture>['run']['run']>>,
): NativeShortBodyDurableApiResult {
  assert.ok(result.schema === 'native-short-body-durable-api-result/v1');
  return result;
}

export function completeContext(f: ReturnType<typeof durableFixture>) {
  const job = f.store.getJob(f.job.id, 'owner');
  assert.ok(job);
  const refs = f.store.listEvidence(job.id);
  return {
    accountId: 'owner',
    job,
    manifest: null,
    refs,
    documents: refs.map((ref) => f.store.readEvidence(ref)),
    attempts: f.store.listNativeShortBodyAttempts(job.id, 'owner'),
  };
}
