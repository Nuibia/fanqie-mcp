import { Store, type Job, canonicalJson, RuntimeError } from '../../runtime/store.js';

import { JobQueue } from '../../runtime/jobs.js';

import { BrowserSession } from '../browser.js';

import {
  type NativeShortSubmissionReconciliationOptions,
  object,
  reconciliationContext,
} from './run-native-short-submission-read-job.js';

import { context, unavailable } from './unavailable.js';

import * as proof from '../short-native-submission-proof.js';

import { createHash } from 'node:crypto';

import { isCanonicalNativeTime } from '../short-native-metadata-proof.js';

import { validateNativeShortSubmissionApiResult } from '../short-native-submission-api.js';

/** Uses only the full C1 reader; never replays draft save. */
export async function reconcileNativeShortSubmissionWrite(
  store: Store,
  queue: JobQueue,
  browser: BrowserSession,
  accountId: string,
  original: Job,
  options: NativeShortSubmissionReconciliationOptions,
): Promise<unknown> {
  try {
    store.assertLeaseOwnership();
    const originalContext = context(store, accountId, original);
    const priorClosure = object(original.result);
    if (
      priorClosure.schema === 'native-short-submission-closure/v1' &&
      ['succeeded', 'failed'].includes(original.status)
    ) {
      const readJob =
        typeof priorClosure.reconciliationJobId === 'string'
          ? store.getJob(priorClosure.reconciliationJobId, accountId)
          : null;
      if (!readJob || original.endedAt === null) unavailable();
      proof.validateNativeShortSubmissionClosureContext(
        reconciliationContext(store, accountId, original, readJob),
        original.result,
        original.endedAt,
      );
      return {
        original: options.completed(original),
        settlement: { status: 'saved', replayedPlatformWrites: false },
      };
    }
    if (
      original.kind !== 'write' ||
      original.accountId !== accountId ||
      original.operation !== proof.NATIVE_SHORT_SUBMISSION_OPERATION ||
      original.status !== 'uncertain' ||
      !original.endedAt ||
      !original.target ||
      original.target.kind !== 'short-story'
    )
      unavailable();
    const expectedAccount = options.currentPlatformAccount();
    if (expectedAccount === null || browser.hasUnsafeApiCleanup === true) unavailable();
    if (priorClosure.schema !== 'native-short-submission-closure/v1')
      proof.validateNativeShortSubmissionEvidenceContext(originalContext, 'prefix');
    const audit = store.getNativeShortSubmissionOriginalAudit(original.id);
    const originalBytes = canonicalJson(original),
      originalRefs = canonicalJson(originalContext.refs),
      originalAttempts = canonicalJson(originalContext.attempts);
    if (Date.parse(original.endedAt) > Date.now()) unavailable();
    // Freshness is an actual later request boundary, never a rewritten evidence time.
    while (new Date().toISOString() <= original.endedAt)
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    const workId = original.target.id;
    const handle = queue.enqueueRead({
      accountId,
      operation: 'reconcile_write',
      scope: 'reconciliation',
      datasets: [proof.NATIVE_SHORT_SUBMISSION_DATASETS.reconciliation],
      inputHash: createHash('sha256')
        .update(canonicalJson({ jobId: original.id }))
        .digest('hex'),
      run: async (ctx) => {
        let beforeCount = 0,
          ownerCount = 0;
        const observed: { markedAt: string | null; ownerCheckedAt: string | null } = {
          markedAt: null,
          ownerCheckedAt: null,
        };
        const assertCurrent = () => {
          store.assertLeaseOwnership();
          const job = store.getJob(ctx.jobId, accountId),
            source = store.getJob(original.id, accountId);
          if (
            !job ||
            job.kind !== 'read' ||
            job.status !== 'running' ||
            job.accountId !== accountId ||
            job.operation !== 'reconcile_write' ||
            job.scope !== 'reconciliation' ||
            canonicalJson(job.datasets) !==
              canonicalJson([proof.NATIVE_SHORT_SUBMISSION_DATASETS.reconciliation]) ||
            job.platformWriteStartedAt !== null ||
            job.cancellationRequestedAt !== null ||
            ctx.signal.aborted ||
            browser.hasUnsafeApiCleanup === true ||
            options.currentPlatformAccount() !== expectedAccount ||
            !source ||
            canonicalJson(source) !== originalBytes ||
            canonicalJson(store.listEvidence(source.id)) !== originalRefs ||
            canonicalJson(store.listNativeShortSubmissionAttempts(source.id)) !== originalAttempts
          )
            unavailable();
        };
        assertCurrent();
        const raw = await browser.runNativeShortSubmission(workId, {
          mode: 'read',
          expectedOwner: { kind: 'account', id: expectedAccount },
          signal: ctx.signal,
          timeoutMs: options.timeoutMs,
          assertLease: assertCurrent,
          onBeforePlatformRead: () => {
            assertCurrent();
            if (++beforeCount !== 1) unavailable();
            observed.markedAt = ctx.beforePlatformRead();
            if (observed.markedAt <= original.endedAt!) unavailable();
            assertCurrent();
          },
          onVerifiedAccount: (owner, at) => {
            assertCurrent();
            if (
              ++ownerCount !== 1 ||
              owner !== expectedAccount ||
              !isCanonicalNativeTime(at) ||
              at > new Date().toISOString()
            )
              unavailable();
            options.onVerifiedAccount(owner, at);
            observed.ownerCheckedAt = at;
            assertCurrent();
          },
        });
        assertCurrent();
        const verified = validateNativeShortSubmissionApiResult(raw, {
          accountId: expectedAccount,
          workId,
        });
        const { markedAt, ownerCheckedAt } = observed;
        if (
          beforeCount !== 1 ||
          typeof markedAt !== 'string' ||
          !isCanonicalNativeTime(markedAt) ||
          verified.phases.after.proof.readStartedAt === null ||
          markedAt > verified.phases.after.proof.readStartedAt ||
          (verified.status === 'success' &&
            (ownerCount !== 1 ||
              verified.proof.proofCapturedAt !== ownerCheckedAt ||
              verified.proof.proofCapturedAt! > new Date().toISOString()))
        )
          unavailable();
        const evidence = proof.createNativeShortSubmissionReconciliationEvidence(
          verified,
          originalContext,
          options.provenance,
          audit,
        );
        ctx.recordTarget({ kind: 'short-story', id: workId });
        const ref = ctx.saveEvidence(
          proof.NATIVE_SHORT_SUBMISSION_DATASETS.reconciliation,
          evidence,
        );
        if (
          canonicalJson(store.readEvidence(ref).payload) !== canonicalJson(evidence) ||
          ref.capturedAt < (verified.proof.proofCapturedAt ?? verified.cleanup.checkedAt)
        )
          unavailable();
        assertCurrent();
        return [ref];
      },
    });
    const readJob = await handle.completion,
      current = store.getJob(original.id, accountId)!;
    if (readJob.status !== 'succeeded' || current.status !== 'uncertain')
      return {
        reconciliation: options.completed(readJob, 'live'),
        original: options.completed(current),
      };
    const linked = reconciliationContext(store, accountId, current, readJob);
    const verified = proof.validateNativeShortSubmissionReconciliationContext(linked);
    if (
      verified.status === 'succeeded' &&
      (verified.result.originalSaveDurableAcknowledged !== true ||
        object(verified.result.acknowledgement).accepted !== true ||
        object(verified.result.acknowledgement).code !== 0)
    )
      unavailable();
    if (object(object(verified.evidence).provenance).mode !== 'live') {
      return {
        reconciliation: options.completed(readJob, 'live'),
        original: options.completed(current),
        settlement: { status: 'capability_unavailable', reason: 'reconciliation_not_live' },
      };
    }
    const settled = store.reconcileWriteJob(current.id, readJob.id, {
      status: verified.status,
      result: verified.result,
    });
    return {
      reconciliation: options.completed(readJob, 'live'),
      original: options.completed(store.getJob(settled.id, accountId)!),
    };
  } catch {
    throw new RuntimeError(
      'capability_unavailable',
      'Native short submission reconciliation is unavailable',
    );
  }
}
