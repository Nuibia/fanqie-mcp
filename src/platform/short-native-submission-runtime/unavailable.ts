import {
  type NativeShortProvenance,
  isCanonicalNativeTime,
} from '../short-native-metadata-proof.js';

import {
  RuntimeError,
  Store,
  type Job,
  type Manifest,
  canonicalJson,
  type EvidenceRef,
} from '../../runtime/store.js';

import * as proof from '../short-native-submission-proof.js';

import {
  type NativeShortSubmissionReceipt,
  type NativeShortSubmissionReceiptFields,
  type NativeShortSubmissionReceiptStage,
} from '../short-native-submission-api.js';

import { BrowserSession } from '../browser.js';

import { type JobContext } from '../../runtime/jobs.js';

export interface NativeShortSubmissionRunOptions {
  timeoutMs: number;
  expectedPlatformAccount: string;
  provenance: NativeShortProvenance;
  currentPlatformAccount(): string | null;
  onVerifiedAccount(accountId: string, checkedAt: string): void;
}

export function unavailable(): never {
  throw new RuntimeError('capability_unavailable', 'Native short submission is unavailable');
}

export function context(
  store: Store,
  accountId: string,
  job: Job,
  manifest: Manifest | null = null,
): proof.NativeShortSubmissionContext {
  if (job.accountId !== accountId) unavailable();
  const refs = store.listEvidence(job.id),
    documents = refs.map((ref) => store.readEvidence(ref)),
    pid = (documents[0]?.payload as any)?.businessInput?.preparationJobId;
  return {
    accountId,
    job,
    manifest,
    refs,
    documents,
    attempts: store.listNativeShortSubmissionAttempts(job.id),
    preparation:
      typeof pid === 'string' ? store.getNativeShortSubmissionPreparation(pid, accountId) : null,
  };
}

function receiptMatches(
  receipt: NativeShortSubmissionReceipt,
  fields: NativeShortSubmissionReceiptFields,
): boolean {
  if (!receipt || typeof receipt !== 'object') return false;
  const { schema, ...actual } = receipt;
  return (
    schema === `native-short-submission-${fields.stage}-receipt/v1` &&
    canonicalJson(actual) === canonicalJson(fields)
  );
}

/** One immutable source and one durable attempt; no POST retry or editor navigation. */
export async function runNativeShortSubmissionJob(
  store: Store,
  browser: BrowserSession,
  ctx: JobContext,
  input: proof.NativeShortSubmissionBusinessInput,
  options: NativeShortSubmissionRunOptions,
): Promise<unknown> {
  const business = proof.validateNativeShortSubmissionBusinessInput(input),
    workId = business.target.workId;
  let beforeCount = 0,
    baselineCount = 0,
    ownerCount = 0,
    ownerCheckedAt: string | null = null;
  const assertCurrent = () => {
    store.assertLeaseOwnership();
    const job = store.getJob(ctx.jobId, ctx.accountId);
    if (
      !job ||
      job.kind !== 'write' ||
      job.status !== 'running' ||
      job.operation !== proof.NATIVE_SHORT_SUBMISSION_OPERATION ||
      job.scope !== proof.nativeShortSubmissionScope(workId) ||
      job.accountId !== ctx.accountId ||
      job.datasets.length !== 0 ||
      job.inputHash !== proof.nativeShortSubmissionBusinessInputHash(business) ||
      job.cancellationRequestedAt !== null ||
      ctx.signal.aborted ||
      browser.hasUnsafeApiCleanup === true ||
      !/^[0-9]{1,30}$/.test(options.expectedPlatformAccount) ||
      options.currentPlatformAccount() !== options.expectedPlatformAccount ||
      store
        .listJobs(ctx.accountId)
        .some(
          (other) => other.id !== job.id && other.kind === 'write' && other.status === 'uncertain',
        )
    )
      unavailable();
    return job;
  };
  const preparation = store.getNativeShortSubmissionPreparation(
    business.preparationJobId,
    ctx.accountId,
  );
  const currentContext = () => ({ ...context(store, ctx.accountId, assertCurrent()), preparation });
  const settledContext = () => {
    store.assertLeaseOwnership();
    const job = store.getJob(ctx.jobId, ctx.accountId);
    if (
      !job ||
      job.kind !== 'write' ||
      job.status !== 'running' ||
      job.accountId !== ctx.accountId ||
      job.operation !== proof.NATIVE_SHORT_SUBMISSION_OPERATION ||
      job.scope !== proof.nativeShortSubmissionScope(workId) ||
      job.inputHash !== proof.nativeShortSubmissionBusinessInputHash(business) ||
      canonicalJson(job.target) !== canonicalJson({ kind: 'short-story', id: workId })
    )
      unavailable();
    return { ...context(store, ctx.accountId, job), preparation };
  };
  const persist = (
    kind: proof.NativeShortSubmissionStage,
    data: unknown,
    validate = true,
    settled = false,
  ): EvidenceRef => {
    const getContext = settled ? settledContext : currentContext,
      payload = proof.createNativeShortSubmissionStageEvidence(kind, data, getContext()),
      ref = ctx.saveEvidence(proof.NATIVE_SHORT_SUBMISSION_DATASETS[kind], payload);
    if (canonicalJson(store.readEvidence(ref).payload) !== canonicalJson(payload)) unavailable();
    if (validate) proof.validateNativeShortSubmissionEvidenceContext(getContext(), 'prefix');
    return ref;
  };
  const confirmPersisted = (
    stage: NativeShortSubmissionReceiptStage,
    confirm: (fields: NativeShortSubmissionReceiptFields) => NativeShortSubmissionReceipt,
  ) => {
    const before = currentContext();
    proof.validateNativeShortSubmissionEvidenceContext(before, 'prefix');
    const fields = proof.nativeShortSubmissionReceiptFields(before, stage),
      receipt = confirm(fields);
    assertCurrent();
    const after = currentContext();
    proof.validateNativeShortSubmissionEvidenceContext(after, 'prefix');
    if (
      !receiptMatches(receipt, fields) ||
      canonicalJson(proof.nativeShortSubmissionReceiptFields(after, stage)) !==
        canonicalJson(fields)
    )
      unavailable();
    return receipt;
  };
  try {
    assertCurrent();
    const raw = await browser.runNativeShortSubmission(workId, {
      mode: 'submit',
      servicePrepared: {
        preparationJobId: business.preparationJobId,
        preparationEvidence: {
          id: preparation.ref.id,
          sha256: preparation.ref.sha256,
          capturedAt: preparation.ref.capturedAt,
        },
        prepared: (preparation.document.payload as proof.NativeShortSubmissionReadEvidence).result
          .prepared!,
      },
      businessRequest: proof.nativeShortSubmissionWriteRequest(business),
      expectedOwner: { kind: 'account', id: options.expectedPlatformAccount },
      signal: ctx.signal,
      timeoutMs: options.timeoutMs,
      assertLease: () => {
        assertCurrent();
      },
      onBeforePlatformRead: () => {
        assertCurrent();
        if (++beforeCount !== 1) unavailable();
        ctx.beforePlatformRead();
        assertCurrent();
      },
      onBaseline: (held) => {
        assertCurrent();
        if (
          ++baselineCount !== 1 ||
          beforeCount !== 1 ||
          store.listEvidence(ctx.jobId).length !== 0 ||
          held.beforeSnapshot.binding.account.id !== options.expectedPlatformAccount
        )
          unavailable();
        ctx.recordTarget({ kind: 'short-story', id: workId });
        persist('baseline', { held, business, provenance: options.provenance });
      },
      onDurableIntent: (held, confirm) => {
        assertCurrent();
        if (baselineCount !== 1) unavailable();
        persist('preSubmit', { held });
        persist('intent', { held });
        return confirmPersisted('intent', confirm);
      },
      onBeforePlatformWrite: (receipt, confirm) => {
        const fields = proof.nativeShortSubmissionReceiptFields(currentContext(), 'intent');
        if (!receiptMatches(receipt, fields) || assertCurrent().platformWriteStartedAt !== null)
          unavailable();
        const eventAt = ctx.beforePlatformWrite();
        if (assertCurrent().platformWriteStartedAt !== eventAt) unavailable();
        const ref = persist('attempt', { eventAt }, false);
        store.recordNativeShortSubmissionAttempt(ctx.jobId, ref);
        proof.validateNativeShortSubmissionEvidenceContext(currentContext(), 'prefix');
        return confirmPersisted('attempt', confirm);
      },
      onDurableAcknowledgement: (observation, confirm) => {
        persist('acknowledgement', { observation });
        return confirmPersisted('acknowledgement', confirm);
      },
      onVerifiedAccount: (accountId, checkedAt) => {
        assertCurrent();
        if (
          ++ownerCount !== 1 ||
          accountId !== options.expectedPlatformAccount ||
          !isCanonicalNativeTime(checkedAt) ||
          checkedAt > new Date().toISOString()
        )
          unavailable();
        options.onVerifiedAccount(accountId, checkedAt);
        ownerCheckedAt = checkedAt;
        assertCurrent();
      },
    });
    if (store.listEvidence(ctx.jobId).length === 0) unavailable();
    persist('after', { result: raw }, true, true);
    assertCurrent();
    if (
      raw.status !== 'success' ||
      beforeCount !== 1 ||
      baselineCount !== 1 ||
      ownerCount !== 1 ||
      ownerCheckedAt === null ||
      raw.proof.proofCapturedAt !== ownerCheckedAt
    )
      unavailable();
    const ref = persist('result', {}),
      returned = store.readEvidence(ref).payload;
    proof.validateNativeShortSubmissionCompletion(currentContext(), returned);
    return returned;
  } catch {
    unavailable();
  }
}
