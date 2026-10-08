import {
  createNativeShortReadEvidence,
  isCanonicalNativeTime,
  nativeShortInputHash,
  nativeShortReadScope,
  NATIVE_SHORT_READ_DATASET,
  NATIVE_SHORT_READ_OPERATION,
  validateNativeShortApiResult,
  type NativeShortProvenance,
} from '../platform/short-native-metadata-proof.js';
import { randomUUID } from 'node:crypto';
import { type Config } from '../config.js';
import { Store, RuntimeError } from '../runtime/store.js';
import { JobQueue, type JobHandle } from '../runtime/jobs.js';
import { BrowserSession, type LoginState } from '../platform/browser.js';
import { datasets } from './shared.js';
import { type EnqueueNativeShortMetadataReadOperation } from './contracts/query.js';
import { type NativeBoundAccountOperation } from './contracts/capabilities.js';
import { type BindIdentityOperation } from './contracts/identity.js';
interface Dependencies {
  queue: JobQueue;
  explicitBodyReadKey: 'explicit_body_read.';
  config: Config;
  nativeBoundAccount: NativeBoundAccountOperation;
  store: Store;
  browser: BrowserSession;
  bindIdentity: BindIdentityOperation;
  login: LoginState | null;
  nativeProvenance: NativeShortProvenance;
}

export function createEnqueueNativeShortMetadataRead(
  deps: Dependencies,
): EnqueueNativeShortMetadataReadOperation {
  function enqueueNativeShortMetadataRead(workId: string, explicitBodyRead = false): JobHandle {
    return deps.queue.enqueueRead({
      ...(explicitBodyRead ? { idempotencyKey: deps.explicitBodyReadKey + randomUUID() } : {}),
      accountId: deps.config.accountId,
      operation: NATIVE_SHORT_READ_OPERATION,
      scope: nativeShortReadScope(workId),
      datasets: [NATIVE_SHORT_READ_DATASET],
      inputHash: nativeShortInputHash(workId),
      run: async (ctx) => {
        // Every failure is fixed and safe before Queue persists its error record.
        try {
          if (explicitBodyRead) ctx.addMetadata({ explicitBodyRead: true });
          const expectedAccount = deps.nativeBoundAccount();
          if (expectedAccount === null) throw new Error('No typed native binding');
          const observation = {
            platformReadStartedAt: null as string | null,
            ownerCheckedAt: null as string | null,
            beforeCount: 0,
            ownerCount: 0,
          };
          const assertCurrent = () => {
            deps.store.assertLeaseOwnership();
            if (
              ctx.signal.aborted ||
              deps.browser.hasUnsafeApiCleanup === true ||
              deps.nativeBoundAccount() !== expectedAccount
            )
              throw new Error('Native read stopped');
          };
          assertCurrent();
          const raw = await deps.browser.runNativeShortMetadata(workId, {
            mode: 'read',
            expectedOwner: { kind: 'account', id: expectedAccount },
            timeoutMs: deps.config.timeoutMs,
            signal: ctx.signal,
            assertLease: assertCurrent,
            onBeforePlatformRead: () => {
              assertCurrent();
              if (++observation.beforeCount !== 1) throw new Error('Repeated native boundary');
              observation.platformReadStartedAt = ctx.beforePlatformRead();
              assertCurrent();
            },
            onVerifiedAccount: (accountId, checkedAt) => {
              assertCurrent();
              if (
                ++observation.ownerCount !== 1 ||
                observation.beforeCount !== 1 ||
                accountId !== expectedAccount ||
                !isCanonicalNativeTime(checkedAt)
              )
                throw new Error('Invalid native owner callback');
              const state: LoginState = {
                status: 'authenticated',
                identity: {
                  accountId,
                  authorId: null,
                  displayName: null,
                  evidenceSource: 'https://fanqienovel.com/api/user/info/v2',
                },
                sourceUrl: 'https://fanqienovel.com/api/user/info/v2',
                checkedAt,
              };
              deps.bindIdentity(state);
              deps.login = state;
              observation.ownerCheckedAt = checkedAt;
              assertCurrent();
            },
          });
          assertCurrent();
          const result = validateNativeShortApiResult(raw, { accountId: expectedAccount, workId });
          const job = deps.store.getJob(ctx.jobId, deps.config.accountId)!;
          if (
            result.status !== 'success' ||
            observation.beforeCount !== 1 ||
            observation.ownerCount !== 1 ||
            observation.platformReadStartedAt === null ||
            observation.ownerCheckedAt !== result.proof.proofCapturedAt ||
            job.requestedAt > observation.platformReadStartedAt ||
            observation.platformReadStartedAt > result.proof.readStartedAt!
          )
            throw new Error('Incomplete native observation');
          if (result.proof.proofCapturedAt! > new Date().toISOString())
            throw new Error('Native proof time is in the future');
          const evidence = createNativeShortReadEvidence(result, deps.nativeProvenance);
          assertCurrent();
          ctx.recordTarget({ kind: 'short-story', id: workId });
          const ref = ctx.saveEvidence(NATIVE_SHORT_READ_DATASET, evidence);
          if (ref.capturedAt < result.proof.proofCapturedAt!)
            throw new Error('Native evidence time precedes proof');
          return [ref];
        } catch {
          throw new RuntimeError('capability_unavailable', 'Native short metadata is unavailable');
        }
      },
    });
  }
  return enqueueNativeShortMetadataRead;
}
