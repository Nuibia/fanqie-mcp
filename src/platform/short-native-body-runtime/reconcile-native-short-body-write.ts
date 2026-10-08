import {
  Store,
  type Job,
  type NativeShortBodyAuthorityBinding,
  canonicalJson,
  resolveNativeShortBodyStoreAuthority,
  type Manifest,
} from '../../runtime/store.js';

import { JobQueue } from '../../runtime/jobs.js';

import { BrowserSession } from '../browser.js';

import {
  type NativeShortBodyReconciliationOptions,
  type NativeShortBodyReconciliationResponse,
  optionsChecked,
  unavailable,
  object,
  reconciliationContext,
  context,
} from './unavailable.js';

import * as proof from '../short-native-body-proof.js';

import {
  validateNativeShortBodyBusinessInput,
  nativeShortBodyBusinessInputHash,
  nativeShortBodyWriteRequest,
} from '../short-native-body.js';

/** This path always creates a GET-only read job; terminal checkpoints reopen saved. */
export async function reconcileNativeShortBodyWrite(
  store: Store,
  queue: JobQueue,
  browser: BrowserSession,
  accountId: string,
  originalInput: Job,
  options: NativeShortBodyReconciliationOptions,
): Promise<NativeShortBodyReconciliationResponse> {
  optionsChecked(options);
  try {
    store.assertLeaseOwnership();
    const original = store.getJob(originalInput.id, accountId);
    if (
      !original ||
      original.accountId !== accountId ||
      original.kind !== 'write' ||
      original.operation !== proof.NATIVE_SHORT_BODY_OPERATION
    )
      unavailable();
    const prior = object(original.result);
    if (
      ['native-short-body-closure/v1', 'native-short-body-closure/v2'].includes(
        String(prior.schema),
      ) &&
      ['succeeded', 'failed'].includes(original.status)
    ) {
      const closure = original.result as proof.NativeShortBodyClosure,
        readJob = store.getJob(closure.reconciliationJobId, accountId);
      if (!readJob || original.endedAt === null) unavailable();
      const settlement = proof.validateNativeShortBodyClosureContext(
        reconciliationContext(store, accountId, original, readJob),
        closure,
        original.endedAt,
      );
      return {
        originalJobId: original.id,
        reconciliationJobId: readJob.id,
        settlement,
        retrievalMode: 'saved',
      };
    }
    if (
      original.status !== 'uncertain' ||
      original.endedAt === null ||
      !original.target ||
      original.target.kind !== 'short-story' ||
      browser.hasUnsafeApiCleanup === true
    )
      unavailable();
    const expected = options.currentPlatformAccount();
    if (expected === null || !/^[0-9]{1,30}$/.test(expected)) unavailable();
    const { audit, recoveryContext, comparisonPolicy } = store.prepareNativeShortBodyReconciliation(
        original.id,
        accountId,
      ),
      sourceContext = context(store, accountId, original);
    const baseline = sourceContext.documents.find(
      (document) => document.dataset === proof.NATIVE_SHORT_BODY_DATASETS.baseline,
    );
    if (!baseline) unavailable();
    const business = validateNativeShortBodyBusinessInput(
        object(object(baseline.payload).payload).businessInput,
      ),
      deadline = Date.now() + options.timeoutMs;
    while (new Date().toISOString() <= audit.priorEndedAt) {
      if (Date.now() >= deadline) unavailable();
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    }
    const inputHash = proof.nativeShortBodyReconciliationInputHash(
        accountId,
        audit,
        recoveryContext?.recovery,
        comparisonPolicy,
      ),
      workId = original.target.id;
    const handle = queue.enqueueRead({
      accountId,
      operation: proof.NATIVE_SHORT_BODY_RECONCILE_OPERATION,
      scope: proof.nativeShortBodyReconciliationScope(original.id),
      datasets: [proof.NATIVE_SHORT_BODY_DATASETS.reconciliation],
      inputHash,
      timeoutMs: Math.max(1, deadline - Date.now()),
      run: async (ctx) => {
        let beforeCount = 0,
          ownerCount = 0;
        let authorityBinding: NativeShortBodyAuthorityBinding | null = null;
        const check = () => {
          store.assertLeaseOwnership();
          const job = store.getJob(ctx.jobId, accountId);
          if (
            !job ||
            job.kind !== 'read' ||
            job.status !== 'running' ||
            job.operation !== proof.NATIVE_SHORT_BODY_RECONCILE_OPERATION ||
            job.inputHash !== inputHash ||
            job.platformWriteStartedAt !== null ||
            job.cancellationRequestedAt !== null ||
            ctx.signal.aborted ||
            browser.hasUnsafeApiCleanup === true ||
            options.currentPlatformAccount() !== expected
          )
            unavailable();
          if (authorityBinding) authorityBinding.check();
          else if (
            canonicalJson(
              store.getNativeShortBodyOriginalAudit(original.id, accountId, recoveryContext),
            ) !== canonicalJson(audit)
          )
            unavailable();
        };
        check();
        const authority = store.issueNativeShortBodyReconciliationAuthority(
          ctx.jobId,
          accountId,
          original.id,
          audit,
          expected,
          recoveryContext,
          comparisonPolicy,
        );
        authorityBinding = resolveNativeShortBodyStoreAuthority(authority, {
          accountId,
          workId,
          inputHash: nativeShortBodyBusinessInputHash(accountId, business),
        });
        if (
          !authorityBinding ||
          authorityBinding.mode !== 'reconcile' ||
          authorityBinding.jobId !== ctx.jobId
        )
          unavailable();
        const raw = await browser.runNativeShortBodyUpdate(workId, {
          accountId,
          businessRequest: nativeShortBodyWriteRequest(business),
          authority,
          expectedOwner: { kind: 'account', id: expected },
          signal: ctx.signal,
          timeoutMs: Math.max(1, deadline - Date.now()),
          assertLease: check,
          onBeforePlatformRead: () => {
            check();
            if (++beforeCount === 1) ctx.beforePlatformRead();
          },
          onVerifiedAccount: (owner, at) => {
            check();
            if (
              ++ownerCount !== 1 ||
              owner !== expected ||
              new Date(at).toISOString() !== at ||
              at > new Date().toISOString()
            )
              unavailable();
            options.onVerifiedAccount(owner, at);
          },
        });
        check();
        const refs = store.listEvidence(ctx.jobId);
        if (
          raw.schema !== 'native-short-body-durable-api-result/v1' ||
          raw.mode !== 'reconcile' ||
          !raw.durable ||
          beforeCount < 1 ||
          refs.length !== 1 ||
          refs[0]!.dataset !== proof.NATIVE_SHORT_BODY_DATASETS.reconciliation ||
          raw.save.post.attempts !== 0
        )
          unavailable();
        // Partial read is a durable negative observation and still completes this read job.
        store.readEvidence(refs[0]!);
        return refs;
      },
    });
    const readJob = await handle.completion,
      current = store.getJob(original.id, accountId);
    if (!current) unavailable();
    if (readJob.status !== 'succeeded')
      return {
        originalJobId: current.id,
        reconciliationJobId: readJob.id,
        settlement: null,
        retrievalMode: 'live',
      };
    const settlement = proof.validateNativeShortBodyReconciliationContext(
      reconciliationContext(store, accountId, current, readJob),
    );
    store.reconcileWriteJob(current.id, readJob.id, {
      status: settlement.status,
      result: settlement.result,
    });
    return {
      originalJobId: current.id,
      reconciliationJobId: readJob.id,
      settlement,
      retrievalMode: 'live',
    };
  } catch {
    unavailable();
  }
}

export const publicSummary = (value: proof.NativeShortBodyProjection['data'][number]) => ({
  ...value,
  source: value.source === null ? null : { mode: object(value.source).mode },
});

export const safeManifest = (
  manifest: Manifest,
  evidence: proof.NativeShortBodyProjection['evidence'],
) => ({
  id: manifest.id,
  operation: manifest.operation,
  committedAt: manifest.committedAt,
  evidence,
});
