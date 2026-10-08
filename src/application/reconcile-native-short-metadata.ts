import {
  isCanonicalNativeTime,
  validateNativeShortApiResult,
  type NativeShortProvenance,
  createNativeShortReconciliationEvidence,
  validateNativeShortReconciliationContext,
} from '../platform/short-native-metadata-proof.js';
import { type Config } from '../config.js';
import { AppError } from '../errors.js';
import { Store, RuntimeError, canonicalJson, type Job } from '../runtime/store.js';
import { JobQueue } from '../runtime/jobs.js';
import { BrowserSession, type LoginState } from '../platform/browser.js';
import { datasets, hash, record } from './shared.js';
import {
  type ReconcileNativeShortMetadataOperation,
  type NativeAuditBeforeReadOperation,
} from './contracts/reconciliation.js';

import { type NativeBoundAccountOperation } from './contracts/capabilities.js';
import {
  type RefsForOperation,
  type NativeReconciliationContextOperation,
  type JobManifestOperation,
} from './contracts/evidence-context.js';
import { type BindIdentityOperation } from './contracts/identity.js';
import { type CompletedOperation } from './contracts/query.js';

interface Dependencies {
  nativeAuditBeforeRead: NativeAuditBeforeReadOperation;
  nativeBoundAccount: NativeBoundAccountOperation;
  browser: BrowserSession;
  queue: JobQueue;
  config: Config;
  store: Store;
  refsFor: RefsForOperation;
  bindIdentity: BindIdentityOperation;
  login: LoginState | null;
  nativeProvenance: NativeShortProvenance;
  completed: CompletedOperation;
  nativeReconciliationContext: NativeReconciliationContextOperation;
  jobManifest: JobManifestOperation;
}

export function createReconcileNativeShortMetadata(
  deps: Dependencies,
): ReconcileNativeShortMetadataOperation {
  async function reconcileNativeShortMetadata(original: Job) {
    try {
      const before = deps.nativeAuditBeforeRead(original),
        workId = before.audit.target.id;
      // nativeAuditBeforeRead has authenticated the complete stored graph in
      // its original mode. A GET binding check does not grant modern authority.
      const expectedAccount = deps.nativeBoundAccount(),
        binding = record(
          record(record(record(before.context.documents[0]!.payload).held).snapshot).binding,
        );
      if (
        expectedAccount === null ||
        record(binding.account).id !== expectedAccount ||
        deps.browser.hasUnsafeApiCleanup === true
      )
        throw new Error('Native binding unavailable');
      // A real request timestamp must follow the stored prior end; never mint a
      // later evidence timestamp or reuse a read from an earlier settlement.
      if (Date.parse(before.audit.priorEndedAt) > Date.now())
        throw new Error('Native audit is in the future');
      while (new Date().toISOString() <= before.audit.priorEndedAt)
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
      const originalBytes = canonicalJson(original),
        originalRefs = canonicalJson(before.context.refs);
      const handle = deps.queue.enqueueRead({
        accountId: deps.config.accountId,
        operation: 'reconcile_write',
        scope: 'reconciliation',
        datasets: ['reconciliation'],
        inputHash: hash({ jobId: original.id }),
        run: async (ctx) => {
          try {
            const observation = {
              beforeCount: 0,
              ownerCount: 0,
              markedAt: null as string | null,
              ownerCheckedAt: null as string | null,
            };
            const assertCurrent = () => {
              deps.store.assertLeaseOwnership();
              const job = deps.store.getJob(ctx.jobId, deps.config.accountId),
                current = deps.store.getJob(original.id, deps.config.accountId);
              if (
                !job ||
                job.kind !== 'read' ||
                job.status !== 'running' ||
                job.operation !== 'reconcile_write' ||
                job.scope !== 'reconciliation' ||
                canonicalJson(job.datasets) !== canonicalJson(['reconciliation']) ||
                job.inputHash !== hash({ jobId: original.id }) ||
                job.accountId !== deps.config.accountId ||
                job.cancellationRequestedAt !== null ||
                job.platformWriteStartedAt !== null ||
                ctx.signal.aborted ||
                deps.browser.hasUnsafeApiCleanup === true ||
                deps.nativeBoundAccount() !== expectedAccount ||
                !current ||
                canonicalJson(current) !== originalBytes ||
                canonicalJson(deps.refsFor(current)) !== originalRefs
              )
                throw new Error('Native reconciliation fence');
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
                if (++observation.beforeCount !== 1)
                  throw new Error('Repeated native later boundary');
                observation.markedAt = ctx.beforePlatformRead();
                if (observation.markedAt <= before.audit.priorEndedAt)
                  throw new Error('Stale native later boundary');
                assertCurrent();
              },
              onVerifiedAccount: (accountId, checkedAt) => {
                assertCurrent();
                if (
                  ++observation.ownerCount !== 1 ||
                  observation.beforeCount !== 1 ||
                  accountId !== expectedAccount ||
                  !isCanonicalNativeTime(checkedAt) ||
                  checkedAt > new Date().toISOString()
                )
                  throw new Error('Invalid native later owner');
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
            const result = validateNativeShortApiResult(raw, {
              accountId: expectedAccount,
              workId,
            });
            if (
              result.status !== 'success' ||
              observation.beforeCount !== 1 ||
              observation.ownerCount !== 1 ||
              observation.markedAt === null ||
              observation.markedAt > result.proof.readStartedAt! ||
              observation.ownerCheckedAt !== result.proof.proofCapturedAt ||
              result.proof.proofCapturedAt! > new Date().toISOString()
            )
              throw new Error('Incomplete native later proof');
            const evidence = createNativeShortReconciliationEvidence(
              result,
              before.audit,
              before.context,
              deps.nativeProvenance,
            );
            assertCurrent();
            ctx.recordTarget({ kind: 'short-story', id: workId });
            const ref = ctx.saveEvidence('reconciliation', evidence);
            if (ref.capturedAt < result.proof.proofCapturedAt!)
              throw new Error('Native later capture preceded proof');
            assertCurrent();
            return [ref];
          } catch {
            throw new RuntimeError(
              'capability_unavailable',
              'Native short metadata reconciliation is unavailable',
            );
          }
        },
      });
      await handle.completion;
      const readJob = deps.store.getJob(handle.jobId, deps.config.accountId)!,
        current = deps.store.getJob(original.id, deps.config.accountId)!;
      if (readJob.status !== 'succeeded' || current.status !== 'uncertain')
        return {
          reconciliation: deps.completed(readJob, 'live'),
          original: deps.completed(current),
        };
      const refs = deps.refsFor(readJob),
        verified = validateNativeShortReconciliationContext(
          deps.nativeReconciliationContext(
            current,
            readJob,
            deps.jobManifest(readJob),
            refs,
            refs.map((ref) => deps.store.readEvidence(ref)),
          ),
        );
      if (verified.evidence.provenance.mode !== 'live')
        return {
          reconciliation: deps.completed(readJob, 'live'),
          original: deps.completed(current),
          settlement: { status: 'capability_unavailable', reason: 'reconciliation_not_live' },
        };
      const settled = deps.store.reconcileWriteJob(original.id, readJob.id, {
        status: verified.status,
        result: verified.result,
      });
      return {
        reconciliation: deps.completed(readJob, 'live'),
        original: deps.completed(deps.store.getJob(settled.id, deps.config.accountId)!),
      };
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw new AppError(
        'capability_unavailable',
        'Native short metadata reconciliation is unavailable',
        409,
      );
    }
  }
  return reconcileNativeShortMetadata;
}
