import * as proof from '../short-native-body-proof.js';

import { RuntimeError, Store, type Job, type Manifest } from '../../runtime/store.js';

import { BrowserSession } from '../browser.js';

import { type JobContext } from '../../runtime/jobs.js';

import {
  type NativeShortBodyBusinessInput,
  validateNativeShortBodyBusinessInput,
  nativeShortBodyBusinessInputHash,
  nativeShortBodyWriteRequest,
} from '../short-native-body.js';

export interface NativeShortBodyRuntimeOptions {
  timeoutMs: number;
  currentPlatformAccount(): string | null;
  onVerifiedAccount(accountId: string, checkedAt: string): void;
}

export type NativeShortBodyReconciliationOptions = NativeShortBodyRuntimeOptions;

export interface NativeShortBodyReconciliationResponse {
  originalJobId: string;
  reconciliationJobId: string | null;
  settlement: proof.NativeShortBodySettlement | null;
  retrievalMode: 'saved' | 'live';
}

export interface NativeShortBodyEvidenceView {
  native: true;
  valid: boolean;
  verifiedLive: boolean;
  evidence: proof.NativeShortBodyProjection['evidence'];
  data: proof.NativeShortBodyProjection['data'];
  manifest: {
    id: string;
    operation: string;
    committedAt: string;
    evidence: proof.NativeShortBodyProjection['evidence'];
  } | null;
  collectionMode: 'live' | 'fixture' | null;
  safeJob: proof.NativeShortBodySafeJob;
}

export function unavailable(): never {
  throw new RuntimeError('capability_unavailable', 'Native short body is unavailable.');
}

export const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function optionsChecked(options: NativeShortBodyRuntimeOptions): void {
  if (
    !options ||
    typeof options !== 'object' ||
    Object.getPrototypeOf(options) !== Object.prototype ||
    Object.getOwnPropertySymbols(options).length
  )
    unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(options),
    keys = ['timeoutMs', 'currentPlatformAccount', 'onVerifiedAccount'];
  if (
    Object.keys(descriptors).length !== keys.length ||
    keys.some((key) => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key]!, 'value'))
  )
    unavailable();
  if (
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 2_147_483_647 ||
    typeof options.currentPlatformAccount !== 'function' ||
    typeof options.onVerifiedAccount !== 'function'
  )
    unavailable();
}

export function context(
  store: Store,
  accountId: string,
  job: Job,
): proof.NativeShortBodyEvidenceContext {
  if (job.accountId !== accountId || job.kind !== 'write') unavailable();
  const refs = store.listEvidence(job.id);
  return {
    accountId,
    job,
    manifest: null,
    refs,
    documents: refs.map((ref) => store.readEvidence(ref)),
    attempts: store.listNativeShortBodyAttempts(job.id, accountId),
  };
}

export function reconciliationContext(
  store: Store,
  accountId: string,
  original: Job,
  readJob: Job,
  manifest?: Manifest | null,
): proof.NativeShortBodyReconciliationContext {
  const refs = store.listEvidence(readJob.id),
    actualManifest = manifest ?? store.getManifestForJob(accountId, readJob.id);
  if (
    readJob.accountId !== accountId ||
    !actualManifest ||
    refs.length !== 1 ||
    refs[0]!.dataset !== proof.NATIVE_SHORT_BODY_DATASETS.reconciliation
  )
    unavailable();
  const recoveryContext = store.getNativeShortBodyRecoveryContext(readJob.id, accountId);
  return {
    original: context(store, accountId, original),
    readJob,
    manifest: actualManifest,
    ref: refs[0]!,
    document: store.readEvidence(refs[0]!),
    ...(recoveryContext ? { recoveryContext } : {}),
  };
}

/** The existing Browser production bridge consumes only a real Store authority. */
export async function runNativeShortBodyJob(
  store: Store,
  browser: BrowserSession,
  ctx: JobContext,
  input: NativeShortBodyBusinessInput,
  options: NativeShortBodyRuntimeOptions,
): Promise<proof.NativeShortBodyWriteResultEvidence> {
  optionsChecked(options);
  const business = validateNativeShortBodyBusinessInput(input),
    workId = business.target.workId,
    expected = options.currentPlatformAccount();
  if (expected === null || !/^[0-9]{1,30}$/.test(expected)) unavailable();
  let beforeCount = 0,
    ownerCount = 0;
  const owner: { checkedAt: string | null } = { checkedAt: null };
  const check = () => {
    store.assertLeaseOwnership();
    const job = store.getJob(ctx.jobId, ctx.accountId);
    if (
      !job ||
      job.kind !== 'write' ||
      job.status !== 'running' ||
      job.operation !== proof.NATIVE_SHORT_BODY_OPERATION ||
      job.scope !== proof.nativeShortBodyScope(workId) ||
      job.inputHash !== nativeShortBodyBusinessInputHash(ctx.accountId, business) ||
      job.cancellationRequestedAt !== null ||
      ctx.signal.aborted ||
      browser.hasUnsafeApiCleanup === true ||
      options.currentPlatformAccount() !== expected
    )
      unavailable();
    return job;
  };
  try {
    check();
    const authority = store.issueNativeShortBodyWriteAuthority(
      ctx.jobId,
      ctx.accountId,
      business,
      expected,
    );
    const raw = await browser.runNativeShortBodyUpdate(workId, {
      accountId: ctx.accountId,
      businessRequest: nativeShortBodyWriteRequest(business),
      authority,
      expectedOwner: { kind: 'account', id: expected },
      signal: ctx.signal,
      timeoutMs: options.timeoutMs,
      assertLease: () => {
        check();
      },
      onBeforePlatformRead: () => {
        check();
        if (++beforeCount === 1) ctx.beforePlatformRead();
      },
      onVerifiedAccount: (accountId, at) => {
        check();
        if (
          ++ownerCount !== 1 ||
          accountId !== expected ||
          new Date(at).toISOString() !== at ||
          at > new Date().toISOString()
        )
          unavailable();
        owner.checkedAt = at;
        options.onVerifiedAccount(accountId, at);
        check();
      },
    });
    // Terminal observation may survive a failed ACK; it never upgrades unknown.
    const job = store.getJob(ctx.jobId, ctx.accountId);
    if (!job || job.status !== 'running') unavailable();
    const refs = store.listEvidence(job.id),
      resultRef = refs.find((ref) => ref.dataset === proof.NATIVE_SHORT_BODY_DATASETS.result);
    if (
      raw.schema !== 'native-short-body-durable-api-result/v1' ||
      raw.mode !== 'write' ||
      !raw.durable ||
      !resultRef ||
      beforeCount < 1
    )
      unavailable();
    const stage = proof.createNativeShortBodyStageEvidence(store.readEvidence(resultRef).payload),
      result = stage.payload as unknown as proof.NativeShortBodyWriteResultEvidence;
    proof.validateNativeShortBodyEvidenceContext(context(store, ctx.accountId, job), 'prefix');
    if (
      result.outcome === 'unknown' ||
      (result.reason !== 'no_change' && result.outcome !== 'matched')
    )
      unavailable();
    if (
      ownerCount !== 1 ||
      owner.checkedAt === null ||
      result.ownerCheckedAt !== owner.checkedAt ||
      raw.proof.ownerCheckedAt !== owner.checkedAt
    )
      unavailable();
    return proof.validateNativeShortBodyCompletion(context(store, ctx.accountId, job), result);
  } catch {
    unavailable();
  }
}
