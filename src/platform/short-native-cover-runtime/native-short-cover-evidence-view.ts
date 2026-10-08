import {
  Store,
  type Job,
  type Manifest,
  type EvidenceRef,
  type EvidenceDocument,
  canonicalJson,
  RuntimeError,
} from '../../runtime/store.js';

import { unavailable, object, reconciliationContext, context } from './unavailable.js';

import * as proof from '../short-native-cover-proof.js';

import {
  type NativeShortProvenance,
  isCanonicalNativeTime,
  validateNativeShortApiResult,
} from '../short-native-metadata-proof.js';

import { JobQueue } from '../../runtime/jobs.js';

import { BrowserSession } from '../browser.js';

import { createHash } from 'node:crypto';

/** All cover namespace outputs are projections, including malformed history. */
export function nativeShortCoverEvidenceView(
  store: Store,
  accountId: string,
  job: Job | null,
  manifest: Manifest | null,
  refs: EvidenceRef[],
  documents: EvidenceDocument[],
  readFailure?: unknown,
) {
  try {
    if (!job || readFailure || refs.length !== documents.length) unavailable();
    let projection: ReturnType<typeof proof.projectNativeShortCoverEvidenceContext>;
    const result = object(job.result);
    if (job.kind === 'write' && result.schema === 'native-short-cover-closure/v1') {
      const readJob =
        typeof result.reconciliationJobId === 'string'
          ? store.getJob(result.reconciliationJobId)
          : null;
      if (!readJob || readJob.accountId !== accountId || job.endedAt === null) unavailable();
      const linked = reconciliationContext(store, accountId, job, readJob);
      proof.validateNativeShortCoverClosureContext(linked, job.result, job.endedAt);
      projection = proof.projectNativeShortCoverReconciliationContext(linked);
    } else if (job.kind === 'read') {
      if (refs.length !== 1 || documents.length !== 1) unavailable();
      const audit = object(object(documents[0]!.payload).originalAudit);
      const original =
        typeof audit.originalJobId === 'string' ? store.getJob(audit.originalJobId) : null;
      if (!original || original.accountId !== accountId) unavailable();
      projection = proof.projectNativeShortCoverReconciliationContext(
        reconciliationContext(store, accountId, original, job, manifest),
      );
    } else {
      projection = proof.projectNativeShortCoverEvidenceContext({
        accountId,
        job,
        manifest,
        refs,
        documents,
        attempts: store.listNativeShortCoverAttempts(job.id),
      });
    }
    return {
      native: true,
      valid: projection.validated,
      evidence: projection.evidence,
      data: projection.data,
      manifest:
        job.kind === 'read' && manifest !== null && projection.validated
          ? proof.safeNativeShortCoverManifest(manifest)
          : null,
      collectionMode: projection.collectionMode,
      safeJob: proof.safeNativeShortCoverJob(job, projection),
    };
  } catch {
    return {
      native: true,
      valid: false,
      evidence: [],
      data: [
        {
          schema: 'fanqie-short-native-cover-business/v1',
          status: 'capability_unavailable',
          reason: 'response_unverified',
          state: 'unknown',
          statusFacts: null,
          statusSource: null,
        },
      ],
      manifest: null,
      collectionMode: null,
      safeJob: job ? proof.safeNativeShortCoverJob(job, null) : null,
    };
  }
}

interface CoverReconciliationOptions {
  timeoutMs: number;
  provenance: NativeShortProvenance;
  currentPlatformAccount(): string | null;
  onVerifiedAccount(accountId: string, checkedAt: string): void;
  completed(job: Job, retrievalMode?: 'saved' | 'live'): unknown;
}

/** Uses only the full C1 reader; never replays image upload or draft save. */
export async function reconcileNativeShortCoverWrite(
  store: Store,
  queue: JobQueue,
  browser: BrowserSession,
  accountId: string,
  original: Job,
  options: CoverReconciliationOptions,
): Promise<unknown> {
  try {
    store.assertLeaseOwnership();
    const originalContext = context(store, accountId, original);
    const priorClosure = object(original.result);
    if (
      priorClosure.schema === 'native-short-cover-closure/v1' &&
      ['succeeded', 'failed'].includes(original.status)
    ) {
      const readJob =
        typeof priorClosure.reconciliationJobId === 'string'
          ? store.getJob(priorClosure.reconciliationJobId)
          : null;
      if (!readJob || original.endedAt === null) unavailable();
      proof.validateNativeShortCoverClosureContext(
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
      original.operation !== proof.NATIVE_SHORT_COVER_OPERATION ||
      original.status !== 'uncertain' ||
      !original.endedAt ||
      !original.target ||
      original.target.kind !== 'short-story'
    )
      unavailable();
    const expectedAccount = options.currentPlatformAccount();
    if (expectedAccount === null || browser.hasUnsafeApiCleanup === true) unavailable();
    if (priorClosure.schema !== 'native-short-cover-closure/v1')
      proof.validateNativeShortCoverEvidenceContext(originalContext, 'prefix');
    const audit = store.getNativeShortCoverOriginalAudit(original.id);
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
      datasets: [proof.NATIVE_SHORT_COVER_DATASETS.reconciliation],
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
          const job = store.getJob(ctx.jobId),
            source = store.getJob(original.id);
          if (
            !job ||
            job.kind !== 'read' ||
            job.status !== 'running' ||
            job.accountId !== accountId ||
            job.operation !== 'reconcile_write' ||
            job.scope !== 'reconciliation' ||
            canonicalJson(job.datasets) !==
              canonicalJson([proof.NATIVE_SHORT_COVER_DATASETS.reconciliation]) ||
            job.platformWriteStartedAt !== null ||
            job.cancellationRequestedAt !== null ||
            ctx.signal.aborted ||
            browser.hasUnsafeApiCleanup === true ||
            options.currentPlatformAccount() !== expectedAccount ||
            !source ||
            canonicalJson(source) !== originalBytes ||
            canonicalJson(store.listEvidence(source.id)) !== originalRefs ||
            canonicalJson(store.listNativeShortCoverAttempts(source.id)) !== originalAttempts
          )
            unavailable();
        };
        assertCurrent();
        const raw = await browser.runNativeShortMetadata(workId, {
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
        const verified = validateNativeShortApiResult(raw, { accountId: expectedAccount, workId });
        const { markedAt, ownerCheckedAt } = observed;
        if (
          verified.status !== 'success' ||
          beforeCount !== 1 ||
          ownerCount !== 1 ||
          typeof markedAt !== 'string' ||
          !isCanonicalNativeTime(markedAt) ||
          markedAt > verified.proof.readStartedAt! ||
          verified.proof.proofCapturedAt !== ownerCheckedAt ||
          verified.proof.proofCapturedAt! > new Date().toISOString()
        )
          unavailable();
        const evidence = proof.createNativeShortCoverReconciliationEvidence(
          verified,
          originalContext,
          options.provenance,
          audit,
        );
        ctx.recordTarget({ kind: 'short-story', id: workId });
        const ref = ctx.saveEvidence(proof.NATIVE_SHORT_COVER_DATASETS.reconciliation, evidence);
        if (
          canonicalJson(store.readEvidence(ref).payload) !== canonicalJson(evidence) ||
          ref.capturedAt < verified.proof.proofCapturedAt!
        )
          unavailable();
        assertCurrent();
        return [ref];
      },
    });
    const readJob = await handle.completion,
      current = store.getJob(original.id)!;
    if (readJob.status !== 'succeeded' || current.status !== 'uncertain')
      return {
        reconciliation: options.completed(readJob, 'live'),
        original: options.completed(current),
      };
    const linked = reconciliationContext(store, accountId, current, readJob);
    const verified = proof.validateNativeShortCoverReconciliationContext(linked);
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
      original: options.completed(store.getJob(settled.id)!),
    };
  } catch {
    throw new RuntimeError(
      'capability_unavailable',
      'Native short cover reconciliation is unavailable',
    );
  }
}
