import { createBodyAuthorityReconciliationRecorder } from '../body-authority/record-reconciliation.js';
import { createBodyAuthorityAttemptIssuer } from '../body-authority/begin-attempt.js';
import { createBodyAuthorityLifecycleCheck } from '../body-authority/check-lifecycle.js';
import { type EvidenceRef } from '../runtime-error.js';
import {
  type NativeShortBodyAuthorityBinding,
  canonicalJson,
  bodyUnavailable,
  sameNativeValue,
  timestamp,
  bodyDigest,
  bodyLink,
  bodyObject,
  bodyNative,
} from '../native-closure-signal.js';
import * as bodyProof from '../../../platform/short-native-body-proof.js';
import { PublicReadCoordinator } from '../../public-read.js';
import { type APIRequest, request } from 'playwright';
import {
  type NativeShortBodyBusinessInput,
  type NativeShortBodyExpectation,
  nativeShortBodyBusinessInputHash,
  type NativeShortBodyPlan,
  planNativeShortBodyUpdate,
  nativeShortBodyWriteRequest,
  assertNativeShortBodyPreSave,
} from '../../../platform/short-native-body.js';
import {
  type Store,
  type NativeShortBodyStoreAuthority,
  type NativeShortBodyAttemptPermit,
} from '../authority.js';
import {
  type NativeShortBodyIssuerOperation,
  type NativeShortBodyRecoveryFreshReadOperation,
  type NativeShortBodyReconciliationRowsOperation,
  type NativeShortBodyContextOperation,
  type NativeShortBodyStageOperation,
} from '../contracts/native-body-native-short-body-signal.js';

import {
  type RawJobOperation,
  type ListNativeShortBodyAttemptsOperation,
  type GetNativeShortBodyOriginalAuditOperation,
  type PersistNativeShortBodyStageOperation,
  type CreateNativeShortBodyAuthorityOperation,
} from '../contracts/jobs-api-with-public-projection-read.js';
import {
  type ListEvidenceOperation,
  type ReadEvidenceOperation,
  type InsertPhysicalEvidenceOperation,
} from '../contracts/evidence-public-evidence-file-size.js';

import {
  type PrepareOperation,
  type TransactionOperation,
  type PreparePhysicalEvidenceOperation,
} from '../contracts/runtime-ownership-run-lease-loss-cleanup.js';

export interface CreateNativeShortBodyAuthorityDependencies {
  publicReads: PublicReadCoordinator;
  nativeShortBodySource: bodyProof.NativeShortBodySource;
  nativeShortBodyIssuer: NativeShortBodyIssuerOperation;
  ownerId: `${string}-${string}-${string}-${string}-${string}`;
  nativeShortBodyRecoveryFreshRead: NativeShortBodyRecoveryFreshReadOperation;
  rawJob: RawJobOperation;
  listEvidence: ListEvidenceOperation;
  listNativeShortBodyAttempts: ListNativeShortBodyAttemptsOperation;
  prepare: PrepareOperation;
  transaction: TransactionOperation;
  nativeShortBodyReconciliationRows: NativeShortBodyReconciliationRowsOperation;
  getNativeShortBodyOriginalAudit: GetNativeShortBodyOriginalAuditOperation;
  readEvidence: ReadEvidenceOperation;
  nativeShortBodyContext: NativeShortBodyContextOperation;
  nativeShortBodyFactory: Pick<APIRequest, 'newContext'>;
  persistNativeShortBodyStage: PersistNativeShortBodyStageOperation;
  nativeShortBodyStage: NativeShortBodyStageOperation;
  preparePhysicalEvidence: PreparePhysicalEvidenceOperation;
  insertPhysicalEvidence: InsertPhysicalEvidenceOperation;
  nativeShortBodyPermits: WeakMap<
    object,
    { store: Store; jobId: string; ref: bodyProof.NativeShortBodyRefLink; consumed: boolean }
  >;
  owner: Store;
  nativeShortBodyAuthorities: WeakMap<object, NativeShortBodyAuthorityBinding>;
}

export function createCreateNativeShortBodyAuthority(
  deps: CreateNativeShortBodyAuthorityDependencies,
): CreateNativeShortBodyAuthorityOperation {
  function createNativeShortBodyAuthority(
    mode: 'write' | 'reconcile',
    jobId: string,
    accountId: string,
    business: NativeShortBodyBusinessInput,
    expectedPlatformAccount: string,
    audit: bodyProof.NativeShortBodyOriginalAudit | null,
    expectation: NativeShortBodyExpectation | null,
    recoveryContext?: bodyProof.NativeShortBodyRecoveryContextV2,
    comparisonPolicy?: 'native-short-body-derived-word-number/v2',
  ): NativeShortBodyStoreAuthority {
    deps.publicReads.assertMutationAllowed();
    if (!/^[0-9]{1,30}$/.test(expectedPlatformAccount)) return bodyUnavailable();
    const workId = business.target.workId,
      inputHash = nativeShortBodyBusinessInputHash(accountId, business),
      source = deps.nativeShortBodySource;
    let firstGet = true,
      attemptIssued = false,
      baselineCount = 0,
      preSaveCount = 0,
      resultCount = 0,
      reconciliationCount = 0;
    let plan: NativeShortBodyPlan | null = null;
    let reconciliationRows: { rows: string; refs: EvidenceRef[] } | null = null;
    const check = createBodyAuthorityLifecycleCheck({
      deps,
      recoveryContext,
      mode,
      comparisonPolicy,
      get reconciliationRows() {
        return reconciliationRows;
      },
      set reconciliationRows(value) {
        reconciliationRows = value;
      },
      accountId,
      jobId,
      workId,
      get firstGet() {
        return firstGet;
      },
      set firstGet(value) {
        firstGet = value;
      },
      inputHash,
      audit,
    });
    const initial = check();
    if (
      initial.platformReadStartedAt !== null ||
      initial.platformWriteStartedAt !== null ||
      deps.listEvidence(jobId).length !== 0
    )
      return bodyUnavailable();
    const beforeGet = () => {
      deps.publicReads.assertMutationAllowed();
      check(true);
      if (firstGet) {
        deps.transaction(() => {
          const job = check(true),
            now = job.platformReadStartedAt ?? timestamp();
          if (mode === 'reconcile' && audit && now <= audit.priorEndedAt) return bodyUnavailable();
          deps
            .prepare('UPDATE jobs SET read_started_at=?,target_json=?,updated_at=? WHERE id=?')
            .run(now, canonicalJson({ kind: 'short-story', id: workId }), now, job.id);
        });
        firstGet = false;
      }
      check();
    };
    const requireWrite = () => {
      const job = check();
      if (mode !== 'write' || firstGet || job.platformReadStartedAt === null)
        return bodyUnavailable();
      return job;
    };
    const links = () => {
      const context = deps.nativeShortBodyContext(requireWrite());
      const output: Record<string, bodyProof.NativeShortBodyRefLink | null> = {
        baseline: null,
        preSave: null,
        intent: null,
        attempt: null,
        acknowledgement: null,
        after: null,
      };
      for (const ref of context.refs) {
        const kind = bodyObject(deps.readEvidence(ref).payload).kind;
        if (typeof kind === 'string' && Object.hasOwn(output, kind)) output[kind] = bodyLink(ref);
      }
      return output;
    };
    const binding: NativeShortBodyAuthorityBinding = Object.freeze({
      mode,
      accountId,
      jobId,
      workId,
      inputHash,
      expectedPlatformAccount,
      source,
      deadlineAt: initial.deadlineAt!,
      requestFactory: deps.nativeShortBodyFactory,
      reconciliationExpectation: expectation,
      reconciliationPolicy: comparisonPolicy ?? null,
      recovery: recoveryContext?.recovery ?? null,
      check: () => {
        check();
      },
      beforeGet,
      recordBaseline: (native: unknown, read: unknown) => {
        deps.publicReads.assertMutationAllowed();
        requireWrite();
        if (++baselineCount !== 1) return bodyUnavailable();
        const before = bodyNative(native);
        if (
          before.snapshot.binding.account.id !== expectedPlatformAccount ||
          before.snapshot.binding.work.id !== workId
        )
          return bodyUnavailable();
        const ref = deps.persistNativeShortBodyStage(jobId, 'baseline', {
          businessInput: business,
          native: before.native,
          read,
          source,
        });
        try {
          plan = planNativeShortBodyUpdate(before.snapshot, nativeShortBodyWriteRequest(business));
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !('code' in error) ||
            (error.code !== 'no_change' && error.code !== 'source_version_mismatch')
          )
            throw error;
        }
        return ref;
      },
      recordPreSave: (native: unknown, read: unknown) => {
        deps.publicReads.assertMutationAllowed();
        requireWrite();
        if (++preSaveCount !== 1 || baselineCount !== 1 || !plan) return bodyUnavailable();
        const before = bodyNative(native);
        assertNativeShortBodyPreSave(before.snapshot, plan);
        return deps.persistNativeShortBodyStage(jobId, 'preSave', {
          native: before.native,
          read,
          sourceVersionHash: plan.expectation.sourceVersionHash,
          desiredContentHash: plan.desiredContentHash,
        });
      },
      recordIntent: () => {
        deps.publicReads.assertMutationAllowed();
        requireWrite();
        if (!plan || preSaveCount !== 1) return bodyUnavailable();
        const evidence = links();
        return deps.persistNativeShortBodyStage(jobId, 'intent', {
          hashBasesHash: bodyProof.nativeShortBodyHashBasesHash(business),
          target: { kind: 'short-story', id: workId },
          binding: plan.expectation.binding,
          inputHash,
          sourceVersionHash: plan.expectation.sourceVersionHash,
          desiredContentHash: plan.desiredContentHash,
          baselineEvidence: evidence.baseline,
          preSaveEvidence: evidence.preSave,
          expectationHash: bodyDigest(plan.expectation),
          transport: {
            method: 'POST',
            url: plan.request.url,
            contentType: plan.request.contentType,
            maxRedirects: 0,
            maxRetries: 0,
            maxAttempts: 1,
          },
        });
      },
      beginAttempt: createBodyAuthorityAttemptIssuer({
        deps,
        requireWrite,
        get attemptIssued() {
          return attemptIssued;
        },
        set attemptIssued(value) {
          attemptIssued = value;
        },
        get plan() {
          return plan;
        },
        set plan(value) {
          plan = value;
        },
        links,
        jobId,
        accountId,
      }),
      consumeAttempt: (permit: NativeShortBodyAttemptPermit) => {
        deps.publicReads.assertMutationAllowed();
        requireWrite();
        const held = deps.nativeShortBodyPermits.get(permit);
        if (!held || held.store !== deps.owner || held.jobId !== jobId || held.consumed)
          return bodyUnavailable();
        held.consumed = true;
        const actual = deps.listNativeShortBodyAttempts(jobId, accountId);
        if (actual.length !== 1 || !sameNativeValue(actual[0]!.evidence, held.ref))
          return bodyUnavailable();
        bodyProof.validateNativeShortBodyEvidenceContext(
          deps.nativeShortBodyContext(requireWrite()),
          'prefix',
        );
        return held.ref;
      },
      readCommittedAttempt: () => {
        deps.publicReads.assertMutationAllowed();
        const job = requireWrite(),
          context = bodyProof.validateNativeShortBodyEvidenceContext(
            deps.nativeShortBodyContext(job),
            'prefix',
          );
        const rows = context.attempts,
          refs = context.refs.filter(
            (ref) => ref.dataset === bodyProof.NATIVE_SHORT_BODY_DATASETS.attempt,
          );
        if (!sameNativeValue(job, requireWrite())) return bodyUnavailable();
        if (rows.length === 0) {
          if (job.platformWriteStartedAt !== null || refs.length !== 0) return bodyUnavailable();
          return null;
        }
        const row = rows[0]!,
          ref = refs[0];
        if (
          rows.length !== 1 ||
          refs.length !== 1 ||
          !ref ||
          row.jobId !== jobId ||
          row.accountId !== accountId ||
          !sameNativeValue(row.evidence, bodyLink(ref)) ||
          row.eventAt !== job.platformWriteStartedAt
        )
          return bodyUnavailable();
        const baseline = context.documents.find(
          (document) => document.dataset === bodyProof.NATIVE_SHORT_BODY_DATASETS.baseline,
        );
        if (!baseline) return bodyUnavailable();
        const payload = bodyObject(bodyObject(baseline.payload).payload);
        if (
          !sameNativeValue(payload.source, source) ||
          bodyNative(payload.native).snapshot.binding.account.id !== expectedPlatformAccount ||
          !sameNativeValue(job, requireWrite())
        )
          return bodyUnavailable();
        // This returns committed facts only; it neither issues nor consumes any POST permit.
        return Object.freeze(bodyLink(ref));
      },
      recordAcknowledgement: (observation: unknown) => {
        deps.publicReads.assertMutationAllowed();
        requireWrite();
        const evidence = links(),
          data = bodyObject(observation);
        return deps.persistNativeShortBodyStage(
          jobId,
          'acknowledgement',
          { observation: data, attemptEvidence: evidence.attempt },
          data.acknowledgedAt as string,
        );
      },
      recordAfter: (native: unknown | null, read: unknown, comparison: unknown | null) => {
        deps.publicReads.assertMutationAllowed();
        requireWrite();
        return deps.persistNativeShortBodyStage(jobId, 'after', {
          native: native === null ? null : bodyNative(native).native,
          read,
          comparison,
        });
      },
      recordResult: (result: unknown) => {
        deps.publicReads.assertMutationAllowed();
        requireWrite();
        if (baselineCount !== 1 || ++resultCount !== 1) return bodyUnavailable();
        const ref = deps.persistNativeShortBodyStage(jobId, 'result', result);
        const current = deps.rawJob(jobId);
        if (!current) return bodyUnavailable();
        bodyProof.validateNativeShortBodyEvidenceContext(
          deps.nativeShortBodyContext(current),
          'prefix',
        );
        return ref;
      },
      recordReconciliation: createBodyAuthorityReconciliationRecorder({
        deps,
        check,
        mode,
        audit,
        get firstGet() {
          return firstGet;
        },
        set firstGet(value) {
          firstGet = value;
        },
        get reconciliationCount() {
          return reconciliationCount;
        },
        set reconciliationCount(value) {
          reconciliationCount = value;
        },
        accountId,
        recoveryContext,
        comparisonPolicy,
        source,
        expectation,
        jobId,
      }),
    });
    const authority = Object.freeze(Object.create(null)) as NativeShortBodyStoreAuthority;
    deps.nativeShortBodyAuthorities.set(authority, binding);
    return authority;
  }
  return createNativeShortBodyAuthority;
}
