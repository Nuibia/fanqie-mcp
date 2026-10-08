import {
  isCanonicalNativeTime,
  nativeShortReadScope,
  createNativeShortBaselineEvidence,
  createNativeShortWriteIntent,
  createNativeShortCleanAfterEvidence,
  createNativeShortWriteResultEvidence,
  validateNativeShortBaselineEvidence,
  validateNativeShortWriteIntent,
  validateNativeShortDurableReceipt,
  validateNativeShortWriteBusinessInput,
  nativeShortWriteInputHash,
  nativeShortWriteRequest,
  NATIVE_SHORT_BASELINE_DATASET,
  NATIVE_SHORT_AFTER_DATASET,
  projectNativeShortWriteEvidence,
  type NativeShortWriteBusinessInput,
  type NativeShortBaselineEvidence,
  type NativeShortProvenance,
} from '../platform/short-native-metadata-proof.js';
import { type NativeShortMetadataDurableReceipt } from '../platform/short-native-metadata-api.js';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import * as z from 'zod/v4';
import {
  Store,
  RuntimeError,
  canonicalJson,
  type GenericShortTrustedContext,
  type EvidenceRef,
} from '../runtime/store.js';
import { type JobContext } from '../runtime/jobs.js';
import { BrowserSession } from '../platform/browser.js';

export const datasets = [
  'short_works',
  'short_metrics',
  'long_works',
  'long_metrics',
  'activities',
  'writer_classes',
] as const;

export const accountDatasets = [
  'short_works',
  'short_metrics',
  'long_works',
  'long_metrics',
] as const;

export type Dataset = (typeof datasets)[number];

export type PlatformIdType = 'account' | 'author';

export interface AccountBinding {
  accountId: string;
  platformId: string;
  platformIdType?: PlatformIdType;
}

export const empty = z.object({}).strict();

export const targetSchema = z
  .object({
    kind: z.enum(['short', 'chapter']),
    workId: z.string().regex(/^\d{10,22}$/),
    chapterId: z
      .string()
      .regex(/^\d{10,22}$/)
      .optional(),
  })
  .strict();

export const longBookTargetSchema = z
  .object({ kind: z.literal('long-book'), workId: z.string().regex(/^\d{10,22}$/) })
  .strict();

export const metadataTargetSchema = z.union([targetSchema, longBookTargetSchema]);

export const contentSchema = z
  .object({
    title: z.string().min(1).max(200),
    body: z.string().max(3_000_000),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const coverUploadSchema = z
  .object({
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    data: z.string().min(8).max(4_000_000),
  })
  .strict();

export const stateSchema = z.enum(['draft', 'reviewing', 'submitted', 'published', 'rejected']);

export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const writeBase = { idempotencyKey: z.string().min(8).max(128) };

export const versionBase = {
  target: targetSchema,
  expectedContentHash: hashSchema,
  expectedState: stateSchema,
};

// Native save and durable reconciliation are implemented together. Deployment
// writes and fresh account/context readiness are checked at their own boundaries.
export const NATIVE_SHORT_PUBLIC_SAVE_READY = true;

export const hash = (value: unknown) =>
  createHash('sha256')
    .update(canonicalJson(jsonValue(value)))
    .digest('hex');

export const jsonValue = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function loadJson<T>(filename?: string): T | undefined {
  return filename && existsSync(filename)
    ? (JSON.parse(readFileSync(filename, 'utf8')) as T)
    : undefined;
}

/** Internal production job runner, also exercised with synthetic Store/Queue.
 * It is not a tool or a public-entry readiness override. */
export async function runNativeShortMetadataSaveJob(
  store: Store,
  browser: BrowserSession,
  ctx: JobContext,
  businessInput: NativeShortWriteBusinessInput,
  options: {
    timeoutMs: number;
    expectedPlatformAccount: string;
    provenance: NativeShortProvenance;
    currentPlatformAccount(): string | null;
    onVerifiedAccount(accountId: string, checkedAt: string): void;
  },
) {
  store.assertPublicReadMutationAllowed();
  try {
    const business = validateNativeShortWriteBusinessInput(businessInput),
      workId = business.target.workId;
    if (!(store instanceof Store) || !/^[0-9]{1,30}$/.test(options.expectedPlatformAccount))
      throw new Error('Invalid native runtime');
    const assertCurrent = () => {
      store.assertLeaseOwnership();
      const job = store.getJob(ctx.jobId);
      if (
        !job ||
        job.kind !== 'write' ||
        job.status !== 'running' ||
        job.accountId !== ctx.accountId ||
        job.operation !== 'update_work_metadata' ||
        job.scope !== nativeShortReadScope(workId) ||
        job.datasets.length !== 0 ||
        job.inputHash !== nativeShortWriteInputHash(business) ||
        job.cancellationRequestedAt !== null ||
        ctx.signal.aborted ||
        browser.hasUnsafeApiCleanup === true ||
        options.currentPlatformAccount() !== options.expectedPlatformAccount
      )
        throw new Error('Native save fence');
      if (
        store
          .listJobs(ctx.accountId)
          .some(
            (other) =>
              other.id !== job.id && other.kind === 'write' && other.status === 'uncertain',
          )
      )
        throw new Error('Native unresolved write fence');
      return job;
    };
    let beforeCount = 0,
      durableCount = 0,
      markCount = 0,
      ownerCount = 0;
    let baseline: NativeShortBaselineEvidence | null = null,
      baselineRef: EvidenceRef | null = null,
      intentRef: EvidenceRef | null = null,
      markedAt: string | null = null,
      ownerCheckedAt: string | null = null;
    const durable = () => {
      const job = assertCurrent(),
        refs = store.listEvidence(job.id);
      if (
        !baseline ||
        !baselineRef ||
        !intentRef ||
        refs.length !== 2 ||
        canonicalJson(refs) !== canonicalJson([baselineRef, intentRef]) ||
        canonicalJson(job.target) !== canonicalJson({ kind: 'short-story', id: workId })
      )
        throw new Error('Native durability link');
      const before = validateNativeShortBaselineEvidence(store.readEvidence(baselineRef).payload);
      if (canonicalJson(before) !== canonicalJson(baseline))
        throw new Error('Native baseline changed');
      validateNativeShortWriteIntent(store.readEvidence(intentRef).payload, before, baselineRef);
      return { before, baselineRef, intentRef };
    };
    assertCurrent();
    const raw = await browser.runNativeShortMetadataUpdate(workId, {
      mode: 'write',
      businessRequest: nativeShortWriteRequest(business),
      expectedOwner: { kind: 'account', id: options.expectedPlatformAccount },
      signal: ctx.signal,
      timeoutMs: options.timeoutMs,
      assertLease: () => {
        assertCurrent();
      },
      onBeforePlatformRead: () => {
        assertCurrent();
        if (++beforeCount !== 1) throw new Error('Repeated native read boundary');
        ctx.beforePlatformRead();
        assertCurrent();
      },
      onDurableBeforeWrite: (held, confirmDurable) => {
        const job = assertCurrent();
        if (
          held.schema !== 'native-short-metadata-held-before/v2' ||
          ++durableCount !== 1 ||
          beforeCount !== 1 ||
          store.listEvidence(ctx.jobId).length !== 0 ||
          held.snapshot.binding.account.id !== options.expectedPlatformAccount
        )
          throw new Error('Native held binding');
        baseline = createNativeShortBaselineEvidence(held, business, options.provenance);
        if (
          job.platformReadStartedAt === null ||
          job.platformReadStartedAt > held.read.proof.readStartedAt! ||
          held.cleanup.checkedAt > new Date().toISOString()
        )
          throw new Error('Native held time');
        baselineRef = ctx.saveEvidence(NATIVE_SHORT_BASELINE_DATASET, baseline);
        assertCurrent();
        intentRef = ctx.saveEvidence(
          'write-intent',
          createNativeShortWriteIntent(baseline, baselineRef),
        );
        assertCurrent();
        ctx.recordTarget({ kind: 'short-story', id: workId });
        const saved = durable();
        const receipt = confirmDurable({
          accountId: ctx.accountId,
          jobId: ctx.jobId,
          baseline: {
            id: saved.baselineRef.id,
            sha256: saved.baselineRef.sha256,
            capturedAt: saved.baselineRef.capturedAt,
          },
          intent: {
            id: saved.intentRef.id,
            sha256: saved.intentRef.sha256,
            capturedAt: saved.intentRef.capturedAt,
          },
          target: { kind: 'short-story', id: workId },
          expectedSnapshotVersionHash: business.expectedSnapshotVersionHash,
          desiredContentHash: held.desiredContentHash,
        });
        validateNativeShortDurableReceipt(
          receipt,
          saved.before,
          saved.baselineRef,
          saved.intentRef,
        );
        assertCurrent();
        return receipt;
      },
      onBeforePlatformWrite: (receipt: NativeShortMetadataDurableReceipt) => {
        const saved = durable();
        if (
          ++markCount !== 1 ||
          durableCount !== 1 ||
          assertCurrent().platformWriteStartedAt !== null
        )
          throw new Error('Repeated native write boundary');
        validateNativeShortDurableReceipt(
          receipt,
          saved.before,
          saved.baselineRef,
          saved.intentRef,
        );
        markedAt = ctx.beforePlatformWrite();
        if (assertCurrent().platformWriteStartedAt !== markedAt)
          throw new Error('Native write mark was not durable');
        return markedAt;
      },
      onVerifiedAccount: (accountId, checkedAt) => {
        assertCurrent();
        if (
          ++ownerCount !== 1 ||
          markCount !== 1 ||
          accountId !== options.expectedPlatformAccount ||
          !isCanonicalNativeTime(checkedAt) ||
          checkedAt > new Date().toISOString()
        )
          throw new Error('Native final owner callback');
        options.onVerifiedAccount(accountId, checkedAt);
        ownerCheckedAt = checkedAt;
        assertCurrent();
      },
    });
    assertCurrent();
    const saved = durable();
    const after = createNativeShortCleanAfterEvidence(
      raw,
      saved.before,
      saved.baselineRef,
      saved.intentRef,
    );
    if (
      beforeCount !== 1 ||
      durableCount !== 1 ||
      markCount !== 1 ||
      ownerCount !== 1 ||
      after.result.post.markedAt !== markedAt ||
      after.result.proof.proofCapturedAt !== ownerCheckedAt ||
      after.result.proof.proofCapturedAt! > new Date().toISOString()
    )
      throw new Error('Native incomplete final proof');
    const afterRef = ctx.saveEvidence(NATIVE_SHORT_AFTER_DATASET, after);
    assertCurrent();
    const result = createNativeShortWriteResultEvidence(
      after,
      saved.baselineRef,
      saved.intentRef,
      afterRef,
    );
    const resultRef = ctx.saveEvidence('write-result', result);
    assertCurrent();
    const finalRefs = store.listEvidence(ctx.jobId);
    if (
      canonicalJson(finalRefs) !==
        canonicalJson([saved.baselineRef, saved.intentRef, afterRef, resultRef]) ||
      canonicalJson(store.readEvidence(resultRef).payload) !== canonicalJson(result)
    )
      throw new Error('Native final references were not durable');
    projectNativeShortWriteEvidence({
      accountId: ctx.accountId,
      job: store.getJob(ctx.jobId)!,
      manifest: null,
      refs: finalRefs,
      documents: finalRefs.map((ref) => store.readEvidence(ref)),
    });
    return result;
  } catch {
    throw new RuntimeError('capability_unavailable', 'Native short metadata is unavailable');
  }
}

export type GenericReadPurpose = 'current' | 'creation-event';

export type GenericShortExecution = Pick<
  GenericShortTrustedContext,
  'target' | 'creationContext' | 'requestBindings'
>;
