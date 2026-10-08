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

import * as proof from '../short-native-cover-proof.js';

import {
  type NativeShortCoverReceipt,
  type NativeShortCoverReceiptFields,
  type NativeShortCoverPhase,
  type NativeShortCoverReceiptStage,
} from '../short-native-cover-api.js';

import { BrowserSession } from '../browser.js';

import { type JobContext } from '../../runtime/jobs.js';

interface CoverRunOptions {
  uploadDir: string;
  timeoutMs: number;
  expectedPlatformAccount: string;
  provenance: NativeShortProvenance;
  currentPlatformAccount(): string | null;
  onVerifiedAccount(accountId: string, checkedAt: string): void;
}

export function unavailable(): never {
  throw new RuntimeError('capability_unavailable', 'Native short cover is unavailable');
}

export function context(
  store: Store,
  accountId: string,
  job: Job,
  manifest: Manifest | null = null,
): proof.NativeShortCoverEvidenceContext {
  const refs = store.listEvidence(job.id);
  return {
    accountId,
    job,
    manifest,
    refs,
    documents: refs.map((ref) => store.readEvidence(ref)),
    attempts: store.listNativeShortCoverAttempts(job.id),
  };
}

function receiptMatches(
  receipt: NativeShortCoverReceipt,
  fields: NativeShortCoverReceiptFields,
): boolean {
  if (!receipt || typeof receipt !== 'object') return false;
  const { schema, ...actual } = receipt;
  return (
    schema === `native-short-cover-${fields.phase}-${fields.stage}-receipt/v1` &&
    canonicalJson(actual) === canonicalJson(fields)
  );
}

/** One account-owned run; no Page, generic writer or automatic POST recovery. */
export async function runNativeShortCoverJob(
  store: Store,
  browser: BrowserSession,
  ctx: JobContext,
  input: proof.NativeShortCoverBusinessInput,
  options: CoverRunOptions,
): Promise<unknown> {
  const business = proof.validateNativeShortCoverBusinessInput(input),
    workId = business.target.workId;
  let beforeCount = 0,
    ownerCount = 0,
    ownerCheckedAt: string | null = null;
  const assertCurrent = () => {
    store.assertLeaseOwnership();
    const job = store.getJob(ctx.jobId);
    if (
      !job ||
      job.kind !== 'write' ||
      job.status !== 'running' ||
      job.operation !== proof.NATIVE_SHORT_COVER_OPERATION ||
      job.scope !== proof.nativeShortCoverScope(workId) ||
      job.accountId !== ctx.accountId ||
      job.datasets.length !== 0 ||
      job.inputHash !== proof.nativeShortCoverBusinessInputHash(business) ||
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
    // After the owned browser callback settles, cancellation/quarantine can stop
    // further I/O without discarding its private phase observations.
    store.assertLeaseOwnership();
    const job = store.getJob(ctx.jobId);
    if (
      !job ||
      job.kind !== 'write' ||
      job.status !== 'running' ||
      job.accountId !== ctx.accountId ||
      job.operation !== proof.NATIVE_SHORT_COVER_OPERATION ||
      job.scope !== proof.nativeShortCoverScope(workId) ||
      job.inputHash !== proof.nativeShortCoverBusinessInputHash(business) ||
      canonicalJson(job.target) !== canonicalJson({ kind: 'short-story', id: workId })
    )
      unavailable();
    return context(store, ctx.accountId, job);
  };
  const persist = (
    kind: Parameters<typeof proof.createNativeShortCoverStageEvidence>[0],
    data: unknown,
    validate = true,
    settled = false,
  ): EvidenceRef => {
    const getContext = settled ? settledContext : currentContext;
    const before = getContext();
    const payload = proof.createNativeShortCoverStageEvidence(kind, data, before);
    const ref = ctx.saveEvidence(proof.NATIVE_SHORT_COVER_DATASETS[kind], payload);
    const document = store.readEvidence(ref);
    if (canonicalJson(document.payload) !== canonicalJson(payload)) unavailable();
    if (validate) proof.validateNativeShortCoverEvidenceContext(getContext(), 'prefix');
    return ref;
  };
  const confirmPersisted = (
    phase: NativeShortCoverPhase,
    stage: NativeShortCoverReceiptStage,
    confirm: (fields: NativeShortCoverReceiptFields) => NativeShortCoverReceipt,
  ) => {
    const before = currentContext();
    proof.validateNativeShortCoverEvidenceContext(before, 'prefix');
    const fields = proof.nativeShortCoverReceiptFields(before, phase, stage);
    const receipt = confirm(fields);
    assertCurrent();
    const after = currentContext();
    proof.validateNativeShortCoverEvidenceContext(after, 'prefix');
    if (
      !receiptMatches(receipt, fields) ||
      canonicalJson(proof.nativeShortCoverReceiptFields(after, phase, stage)) !==
        canonicalJson(fields)
    )
      unavailable();
    return receipt;
  };
  try {
    assertCurrent();
    const raw = await browser.runNativeShortCoverUpdate(workId, {
      mode: 'write',
      uploadDir: options.uploadDir,
      businessRequest: proof.nativeShortCoverWriteRequest(business),
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
      onDurableIntent: (held, confirm) => {
        assertCurrent();
        if (held.phase === 'upload') {
          if (
            beforeCount !== 1 ||
            store.listEvidence(ctx.jobId).length !== 0 ||
            held.snapshot.binding.account.id !== options.expectedPlatformAccount
          )
            unavailable();
          ctx.recordTarget({ kind: 'short-story', id: workId });
          persist('baseline', { held, business, provenance: options.provenance });
          persist('uploadIntent', { held });
        } else {
          persist('preSave', { held });
          persist('saveIntent', { held });
        }
        return confirmPersisted(held.phase, 'intent', confirm);
      },
      onBeforePlatformWrite: (receipt, confirm) => {
        const before = currentContext();
        const fields = proof.nativeShortCoverReceiptFields(before, receipt.phase, 'intent');
        if (!receiptMatches(receipt, fields)) unavailable();
        const phase = receipt.phase;
        let eventAt: string;
        if (phase === 'upload') {
          if (assertCurrent().platformWriteStartedAt !== null) unavailable();
          eventAt = ctx.beforePlatformWrite();
          if (assertCurrent().platformWriteStartedAt !== eventAt) unavailable();
        } else {
          if (assertCurrent().platformWriteStartedAt === null) unavailable();
          eventAt = new Date().toISOString();
        }
        const ref = persist(
          phase === 'upload' ? 'uploadAttempt' : 'saveAttempt',
          { eventAt },
          false,
        );
        store.recordNativeShortCoverAttempt(ctx.jobId, phase, ref);
        proof.validateNativeShortCoverEvidenceContext(currentContext(), 'prefix');
        return confirmPersisted(phase, 'attempt', confirm);
      },
      onDurableAcknowledgement: (observation, confirm) => {
        persist(observation.phase === 'upload' ? 'uploadAck' : 'saveAck', { observation });
        return confirmPersisted(observation.phase, 'acknowledgement', confirm);
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
    // Partial observations remain private and durable before Queue settles unknown.
    persist('after', { result: raw }, true, true);
    assertCurrent();
    if (
      raw.status !== 'success' ||
      beforeCount !== 1 ||
      ownerCount !== 1 ||
      ownerCheckedAt === null ||
      raw.proof.proofCapturedAt !== ownerCheckedAt
    )
      unavailable();
    const resultRef = persist('result', {});
    const returned = store.readEvidence(resultRef).payload;
    proof.validateNativeShortCoverCompletion(currentContext(), returned);
    return returned;
  } catch {
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
): proof.NativeShortCoverReconciliationContext {
  const refs = store.listEvidence(readJob.id);
  const savedManifest = manifest ?? store.getManifestForJob(accountId, readJob.id);
  if (
    !savedManifest ||
    refs.length !== 1 ||
    refs[0]!.dataset !== proof.NATIVE_SHORT_COVER_DATASETS.reconciliation
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
