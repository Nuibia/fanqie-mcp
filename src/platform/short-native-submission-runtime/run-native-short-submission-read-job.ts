import {
  Store,
  type EvidenceRef,
  canonicalJson,
  type Job,
  type Manifest,
  type EvidenceDocument,
} from '../../runtime/store.js';

import { BrowserSession } from '../browser.js';

import { type JobContext } from '../../runtime/jobs.js';

import { type NativeShortSubmissionBusinessInput as ModelBusiness } from '../short-native-submission.js';

import { type NativeShortSubmissionRunOptions, unavailable, context } from './unavailable.js';

import * as proof from '../short-native-submission-proof.js';

import {
  isCanonicalNativeTime,
  type NativeShortProvenance,
} from '../short-native-metadata-proof.js';

import { validateNativeShortSubmissionApiResult } from '../short-native-submission-api.js';

export async function runNativeShortSubmissionReadJob(
  store: Store,
  browser: BrowserSession,
  ctx: JobContext,
  business: ModelBusiness,
  options: NativeShortSubmissionRunOptions,
): Promise<EvidenceRef[]> {
  let reads = 0,
    owners = 0,
    markedAt: string | null = null,
    ownerAt: string | null = null;
  const workId = business.target.workId;
  const assertCurrent = () => {
    store.assertLeaseOwnership();
    const j = store.getJob(ctx.jobId, ctx.accountId);
    if (
      !j ||
      j.kind !== 'read' ||
      j.status !== 'running' ||
      j.operation !== proof.NATIVE_SHORT_SUBMISSION_READ_OPERATION ||
      j.scope !== proof.nativeShortSubmissionScope(workId) ||
      j.inputHash !== proof.nativeShortSubmissionPreparationInputHash(business) ||
      canonicalJson(j.datasets) !== canonicalJson([proof.NATIVE_SHORT_SUBMISSION_READ_DATASET]) ||
      j.platformWriteStartedAt !== null ||
      j.cancellationRequestedAt !== null ||
      ctx.signal.aborted ||
      browser.hasUnsafeApiCleanup === true ||
      options.currentPlatformAccount() !== options.expectedPlatformAccount
    )
      unavailable();
  };
  try {
    assertCurrent();
    const raw = await browser.runNativeShortSubmission(workId, {
      mode: 'prepare',
      businessRequest: proof.nativeShortSubmissionWriteRequest(business),
      expectedOwner: { kind: 'account', id: options.expectedPlatformAccount },
      timeoutMs: options.timeoutMs,
      signal: ctx.signal,
      assertLease: assertCurrent,
      onBeforePlatformRead: () => {
        assertCurrent();
        if (++reads !== 1) unavailable();
        markedAt = ctx.beforePlatformRead();
        assertCurrent();
      },
      onVerifiedAccount: (id, at) => {
        assertCurrent();
        if (
          ++owners !== 1 ||
          id !== options.expectedPlatformAccount ||
          !isCanonicalNativeTime(at) ||
          at > new Date().toISOString()
        )
          unavailable();
        options.onVerifiedAccount(id, at);
        ownerAt = at;
        assertCurrent();
      },
    });
    const result = validateNativeShortSubmissionApiResult(raw, {
      accountId: options.expectedPlatformAccount,
      workId,
    });
    assertCurrent();
    if (
      result.status !== 'success' ||
      reads !== 1 ||
      owners !== 1 ||
      ownerAt !== result.proof.proofCapturedAt ||
      markedAt === null ||
      (markedAt as string) > result.phases.before.proof.readStartedAt!
    )
      unavailable();
    const evidence = proof.createNativeShortSubmissionReadEvidence(
      result,
      business,
      options.provenance,
    );
    ctx.recordTarget({ kind: 'short-story', id: workId });
    const ref = ctx.saveEvidence(proof.NATIVE_SHORT_SUBMISSION_READ_DATASET, evidence);
    if (canonicalJson(store.readEvidence(ref).payload) !== canonicalJson(evidence)) unavailable();
    assertCurrent();
    return [ref];
  } catch (error) {
    unavailable();
  }
}

export const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function reconciliationContext(
  store: Store,
  accountId: string,
  original: Job,
  readJob: Job,
  manifest?: Manifest | null,
): proof.NativeShortSubmissionReconciliationContext {
  const refs = store.listEvidence(readJob.id);
  const savedManifest = manifest ?? store.getManifestForJob(accountId, readJob.id);
  if (
    !savedManifest ||
    refs.length !== 1 ||
    refs[0]!.dataset !== proof.NATIVE_SHORT_SUBMISSION_DATASETS.reconciliation
  )
    unavailable();
  return {
    original: context(store, accountId, original),
    readJob,
    manifest: savedManifest,
    ref: refs[0]!,
    document: store.readEvidence(refs[0]!),
  };
}

/** All submission namespace outputs are projections, including malformed history. */
export function nativeShortSubmissionEvidenceView(
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
    let projection: ReturnType<typeof proof.projectNativeShortSubmissionEvidenceContext>;
    const result = object(job.result);
    if (job.kind === 'write' && result.schema === 'native-short-submission-closure/v1') {
      const readJob =
        typeof result.reconciliationJobId === 'string'
          ? store.getJob(result.reconciliationJobId, accountId)
          : null;
      if (!readJob || readJob.accountId !== accountId || job.endedAt === null) unavailable();
      const linked = reconciliationContext(store, accountId, job, readJob);
      proof.validateNativeShortSubmissionClosureContext(linked, job.result, job.endedAt);
      projection = proof.projectNativeShortSubmissionReconciliationContext(linked);
    } else if (
      job.kind === 'read' &&
      job.operation === proof.NATIVE_SHORT_SUBMISSION_READ_OPERATION
    ) {
      projection = proof.projectNativeShortSubmissionReadContext({
        accountId,
        job,
        manifest,
        refs,
        documents,
        attempts: [],
      });
    } else if (job.kind === 'read') {
      if (refs.length !== 1 || documents.length !== 1) unavailable();
      const audit = object(object(documents[0]!.payload).originalAudit);
      const original =
        typeof audit.originalJobId === 'string'
          ? store.getJob(audit.originalJobId, accountId)
          : null;
      if (!original || original.accountId !== accountId) unavailable();
      projection = proof.projectNativeShortSubmissionReconciliationContext(
        reconciliationContext(store, accountId, original, job, manifest),
      );
    } else {
      projection = proof.projectNativeShortSubmissionEvidenceContext({
        ...context(store, accountId, job, manifest),
        refs,
        documents,
      });
    }
    return {
      native: true,
      valid: projection.validated,
      evidence: projection.evidence,
      data: projection.data,
      manifest:
        job.kind === 'read' && manifest !== null && projection.validated
          ? proof.safeNativeShortSubmissionManifest(manifest)
          : null,
      collectionMode: projection.collectionMode,
      safeJob: proof.safeNativeShortSubmissionJob(job, projection),
    };
  } catch (error) {
    return {
      native: true,
      valid: false,
      evidence: [],
      data: [
        {
          schema: 'fanqie-short-native-submission-business/v1',
          status: 'capability_unavailable',
          reason: 'response_unverified',
          bodyIncluded: false,
          state: 'unknown',
          statusFacts: null,
          statusSource: null,
        },
      ],
      manifest: null,
      collectionMode: null,
      safeJob: job ? proof.safeNativeShortSubmissionJob(job, null) : null,
    };
  }
}

export interface NativeShortSubmissionReconciliationOptions {
  timeoutMs: number;
  provenance: NativeShortProvenance;
  currentPlatformAccount(): string | null;
  onVerifiedAccount(accountId: string, checkedAt: string): void;
  completed(job: Job, retrievalMode?: 'saved' | 'live'): unknown;
}
