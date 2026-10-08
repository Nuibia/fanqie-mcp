import {
  type NativeShortProvenance,
  isCanonicalNativeTime,
  validateNativeShortApiResult,
} from '../short-native-metadata-proof.js';

import {
  RuntimeError,
  Store,
  type Job,
  type Manifest,
  canonicalJson,
  type EvidenceRef,
} from '../../runtime/store.js';

import * as proof from '../short-native-trial-proof.js';

import {
  type NativeShortTrialReceipt,
  type NativeShortTrialReceiptFields,
  type NativeShortTrialReceiptStage,
} from '../short-native-trial-api.js';

import { BrowserSession } from '../browser.js';

import { type JobContext } from '../../runtime/jobs.js';

export interface NativeShortTrialRunOptions {
  timeoutMs: number;
  expectedPlatformAccount: string;
  provenance: NativeShortProvenance;
  currentPlatformAccount(): string | null;
  onVerifiedAccount(accountId: string, checkedAt: string): void;
}

export function unavailable(): never {
  throw new RuntimeError('capability_unavailable', 'Native short trial is unavailable');
}

export function context(
  store: Store,
  accountId: string,
  job: Job,
  manifest: Manifest | null = null,
): proof.NativeShortTrialContext {
  if (job.accountId !== accountId) unavailable();
  const refs = store.listEvidence(job.id);
  return {
    accountId,
    job,
    manifest,
    refs,
    documents: refs.map((ref) => store.readEvidence(ref)),
    attempts: store.listNativeShortTrialAttempts(job.id),
  };
}

function receiptMatches(
  receipt: NativeShortTrialReceipt,
  fields: NativeShortTrialReceiptFields,
): boolean {
  if (!receipt || typeof receipt !== 'object') return false;
  const { schema, ...actual } = receipt;
  return (
    schema === `native-short-trial-${fields.stage}-receipt/v1` &&
    canonicalJson(actual) === canonicalJson(fields)
  );
}

/** One immutable source and one durable attempt; no POST retry or editor navigation. */
export async function runNativeShortTrialJob(
  store: Store,
  browser: BrowserSession,
  ctx: JobContext,
  input: proof.NativeShortTrialBusinessInput,
  options: NativeShortTrialRunOptions,
): Promise<unknown> {
  const business = proof.validateNativeShortTrialBusinessInput(input),
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
      job.operation !== proof.NATIVE_SHORT_TRIAL_OPERATION ||
      job.scope !== proof.nativeShortTrialScope(workId) ||
      job.accountId !== ctx.accountId ||
      job.datasets.length !== 0 ||
      job.inputHash !== proof.nativeShortTrialBusinessInputHash(business) ||
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
  const currentContext = () => context(store, ctx.accountId, assertCurrent());
  const settledContext = () => {
    store.assertLeaseOwnership();
    const job = store.getJob(ctx.jobId, ctx.accountId);
    if (
      !job ||
      job.kind !== 'write' ||
      job.status !== 'running' ||
      job.accountId !== ctx.accountId ||
      job.operation !== proof.NATIVE_SHORT_TRIAL_OPERATION ||
      job.scope !== proof.nativeShortTrialScope(workId) ||
      job.inputHash !== proof.nativeShortTrialBusinessInputHash(business) ||
      canonicalJson(job.target) !== canonicalJson({ kind: 'short-story', id: workId })
    )
      unavailable();
    return context(store, ctx.accountId, job);
  };
  const persist = (
    kind: proof.NativeShortTrialStage,
    data: unknown,
    validate = true,
    settled = false,
  ): EvidenceRef => {
    const getContext = settled ? settledContext : currentContext,
      payload = proof.createNativeShortTrialStageEvidence(kind, data, getContext()),
      ref = ctx.saveEvidence(proof.NATIVE_SHORT_TRIAL_DATASETS[kind], payload);
    if (canonicalJson(store.readEvidence(ref).payload) !== canonicalJson(payload)) unavailable();
    if (validate) proof.validateNativeShortTrialEvidenceContext(getContext(), 'prefix');
    return ref;
  };
  const confirmPersisted = (
    stage: NativeShortTrialReceiptStage,
    confirm: (fields: NativeShortTrialReceiptFields) => NativeShortTrialReceipt,
  ) => {
    const before = currentContext();
    proof.validateNativeShortTrialEvidenceContext(before, 'prefix');
    const fields = proof.nativeShortTrialReceiptFields(before, stage),
      receipt = confirm(fields);
    assertCurrent();
    const after = currentContext();
    proof.validateNativeShortTrialEvidenceContext(after, 'prefix');
    if (
      !receiptMatches(receipt, fields) ||
      canonicalJson(proof.nativeShortTrialReceiptFields(after, stage)) !== canonicalJson(fields)
    )
      unavailable();
    return receipt;
  };
  try {
    assertCurrent();
    const raw = await browser.runNativeShortTrialUpdate(workId, {
      mode: 'write',
      businessRequest: proof.nativeShortTrialWriteRequest(business),
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
        persist('preSave', { held });
        persist('intent', { held });
        return confirmPersisted('intent', confirm);
      },
      onBeforePlatformWrite: (receipt, confirm) => {
        const fields = proof.nativeShortTrialReceiptFields(currentContext(), 'intent');
        if (!receiptMatches(receipt, fields) || assertCurrent().platformWriteStartedAt !== null)
          unavailable();
        const eventAt = ctx.beforePlatformWrite();
        if (assertCurrent().platformWriteStartedAt !== eventAt) unavailable();
        const ref = persist('attempt', { eventAt }, false);
        store.recordNativeShortTrialAttempt(ctx.jobId, ref);
        proof.validateNativeShortTrialEvidenceContext(currentContext(), 'prefix');
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
    proof.validateNativeShortTrialCompletion(currentContext(), returned);
    return returned;
  } catch {
    unavailable();
  }
}

export async function runNativeShortTrialReadJob(
  store: Store,
  browser: BrowserSession,
  ctx: JobContext,
  workId: string,
  options: NativeShortTrialRunOptions,
): Promise<EvidenceRef[]> {
  let beforeCount = 0,
    ownerCount = 0;
  const observed: { ownerAt: string | null; markedAt: string | null } = {
    ownerAt: null,
    markedAt: null,
  };
  const assertCurrent = () => {
    store.assertLeaseOwnership();
    const job = store.getJob(ctx.jobId, ctx.accountId);
    if (
      !job ||
      job.kind !== 'read' ||
      job.status !== 'running' ||
      job.operation !== proof.NATIVE_SHORT_TRIAL_READ_OPERATION ||
      job.scope !== proof.nativeShortTrialScope(workId) ||
      job.inputHash !== proof.nativeShortTrialReadInputHash(workId) ||
      canonicalJson(job.datasets) !== canonicalJson([proof.NATIVE_SHORT_TRIAL_READ_DATASET]) ||
      job.platformWriteStartedAt !== null ||
      job.cancellationRequestedAt !== null ||
      ctx.signal.aborted ||
      browser.hasUnsafeApiCleanup === true ||
      options.currentPlatformAccount() !== options.expectedPlatformAccount
    )
      unavailable();
  };
  try {
    assertCurrent();
    const raw = await browser.runNativeShortMetadata(workId, {
      mode: 'read',
      expectedOwner: { kind: 'account', id: options.expectedPlatformAccount },
      signal: ctx.signal,
      timeoutMs: options.timeoutMs,
      assertLease: assertCurrent,
      onBeforePlatformRead: () => {
        assertCurrent();
        if (++beforeCount !== 1) unavailable();
        observed.markedAt = ctx.beforePlatformRead();
        assertCurrent();
      },
      onVerifiedAccount: (accountId, at) => {
        assertCurrent();
        if (
          ++ownerCount !== 1 ||
          accountId !== options.expectedPlatformAccount ||
          !isCanonicalNativeTime(at) ||
          at > new Date().toISOString()
        )
          unavailable();
        options.onVerifiedAccount(accountId, at);
        observed.ownerAt = at;
        assertCurrent();
      },
    });
    const read = validateNativeShortApiResult(raw, {
      accountId: options.expectedPlatformAccount,
      workId,
    });
    assertCurrent();
    const { ownerAt, markedAt } = observed;
    if (
      read.status !== 'success' ||
      beforeCount !== 1 ||
      ownerCount !== 1 ||
      ownerAt !== read.proof.proofCapturedAt ||
      markedAt === null ||
      markedAt > read.proof.readStartedAt!
    )
      unavailable();
    const evidence = proof.createNativeShortTrialReadEvidence(read, options.provenance);
    ctx.recordTarget({ kind: 'short-story', id: workId });
    const ref = ctx.saveEvidence(proof.NATIVE_SHORT_TRIAL_READ_DATASET, evidence);
    if (canonicalJson(store.readEvidence(ref).payload) !== canonicalJson(evidence)) unavailable();
    assertCurrent();
    return [ref];
  } catch {
    unavailable();
  }
}

export const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
