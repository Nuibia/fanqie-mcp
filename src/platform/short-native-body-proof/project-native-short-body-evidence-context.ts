import {
  type NativeShortBodyRecoveryContextV2,
  type NativeShortBodyReconciliationContext,
  type NativeShortBodyProjection,
  type NativeShortBodyClosure,
  type NativeShortBodySafeJob,
  BODY_UUID,
  type NativeShortBodyStatusObservation,
} from './native-short-body-attempt-row.js';

import { inspectBody } from './inspect-body.js';

import {
  originalStatusObservation,
  checkedReconciliation,
  validateNativeShortBodyClosureContext,
  statusObservation,
  safeBodyRef,
} from './checked-reconciliation.js';

import {
  isBodyClosure,
  closureShape,
  originalForAudit,
} from './validate-native-short-body-evidence-context.js';

import { same, fail, storedNative, type Data, freeze } from './fail.js';

import { checkedRecovery } from './original-audit.js';

import {
  NATIVE_SHORT_BODY_COMPARISON_POLICY_V2,
  type NativeShortBodySnapshot,
} from '../short-native-body.js';

import { nativeShortBodyHashBasesHash, type Cleanup } from './same-mode.js';

import { type Job } from '../../runtime/store.js';

import { durableTime } from './native-short-body-scope.js';

import { NATIVE_SHORT_BODY_OPERATION, NATIVE_SHORT_BODY_RECONCILE_OPERATION } from './inspect.js';

import { type ShortResolvedState, type ShortStatusFactsV1 } from '../short-status.js';

export function projectNativeShortBodyEvidenceContext(
  input: unknown,
  recoveryContext?: NativeShortBodyRecoveryContextV2,
  laterContext?: NativeShortBodyReconciliationContext,
): NativeShortBodyProjection {
  try {
    const s = inspectBody(input, 'prefix'),
      r = s.result,
      j = s.context.job;
    let status: NativeShortBodyProjection['status'] =
      r?.outcome === 'matched'
        ? 'matched'
        : r?.reason === 'no_change'
          ? 'no_change'
          : s.context.attempts.length
            ? 'unknown'
            : 'capability_unavailable';
    let observation = originalStatusObservation(s);
    let desiredMatched = s.comparison?.matches ?? false;
    let validatedRecovery: NativeShortBodyRecoveryContextV2 | undefined;
    let reason: NativeShortBodyProjection['reason'] = r?.reason ?? 'durability_unverified',
      verifiedLive = (status === 'matched' || status === 'no_change') && s.source?.mode === 'live',
      durable = r !== null;
    if (j.result && typeof j.result === 'object' && isBodyClosure(j.result)) {
      const c = closureShape(j.result);
      if (
        c.schema === 'native-short-body-closure/v2' &&
        c.recovery !== null &&
        (!recoveryContext || !same(c.recovery, recoveryContext.recovery))
      )
        fail('source_mismatch');
      const originalState = originalForAudit(
        s.context,
        c.originalAudit,
        c.schema === 'native-short-body-closure/v2' ? recoveryContext : undefined,
      );
      if (c.schema === 'native-short-body-closure/v2' && c.recovery !== null)
        validatedRecovery = checkedRecovery(originalState, c.originalAudit, recoveryContext!);
      if (
        c.status !== j.status ||
        c.settledAt !== j.endedAt ||
        c.accountId !== j.accountId ||
        c.originalJobId !== j.id
      )
        fail('source_mismatch');
      if (laterContext) {
        const checked = checkedReconciliation(laterContext);
        if (!same(checked.context.original, s.context)) fail('source_mismatch');
        validateNativeShortBodyClosureContext(checked.context, c, c.settledAt);
        if (checked.evidence.native !== null)
          observation = statusObservation(
            storedNative(checked.evidence.native),
            'later_read',
            checked.context.ref,
          );
      }
      status =
        c.status === 'succeeded'
          ? 'matched'
          : c.status === 'uncertain'
            ? 'unknown'
            : 'capability_unavailable';
      reason = c.reason;
      verifiedLive = c.result.verifiedLive;
      desiredMatched = c.result.desiredMatched;
      durable = true;
    }
    if (laterContext && !isBodyClosure(j.result)) {
      const checked = checkedReconciliation(laterContext);
      if (!same(checked.context.original, s.context)) fail('source_mismatch');
      if (checked.evidence.native !== null)
        observation = statusObservation(
          storedNative(checked.evidence.native),
          'later_read',
          checked.context.ref,
        );
    }
    const closedV2 =
        isBodyClosure(j.result) && (j.result as Data).schema === 'native-short-body-closure/v2',
      policy = closedV2 ? NATIVE_SHORT_BODY_COMPARISON_POLICY_V2 : s.business?.comparisonPolicy;
    const summary = {
      ...observation,
      schema:
        policy === undefined ? 'native-short-body-summary/v1' : 'native-short-body-summary/v2',
      ...(policy === undefined
        ? {}
        : {
            comparisonPolicy: policy,
            originalHashBasesHash: nativeShortBodyHashBasesHash(s.business ?? undefined),
            recoveryVerified: closedV2 && (j.result as NativeShortBodyClosure).recovery != null,
            recovery:
              closedV2 && validatedRecovery
                ? {
                    schema: validatedRecovery.recovery.schema,
                    freshReadJobId: validatedRecovery.recovery.freshReadJobId,
                    freshReadJobHash: validatedRecovery.recovery.freshReadJobHash,
                    freshReadManifestId: validatedRecovery.recovery.freshReadManifestId,
                    freshReadManifestHash: validatedRecovery.recovery.freshReadManifestHash,
                    freshReadEvidence: validatedRecovery.recovery.freshReadEvidence,
                    cleanup: {
                      ...(
                        validatedRecovery.freshRead.document.payload as {
                          result: { cleanup: Cleanup };
                        }
                      ).result.cleanup,
                    },
                  }
                : null,
          }),
      status,
      reason,
      source: s.source,
      atomicRevision: false,
      hashBasesHash: nativeShortBodyHashBasesHash(
        policy === undefined ? undefined : { comparisonPolicy: policy },
      ),
      desiredContentHash: s.plan?.desiredContentHash ?? null,
      verifiedLive,
      durable,
      bodyIncluded: false,
      summaries: {
        stageCount: s.stages.length,
        attemptOrdinal: s.context.attempts.length ? 1 : null,
        baselineObserved: s.baseline !== null,
        preSaveVerified: s.stages.some((v) => v.kind === 'preSave'),
        postAttempted: (r?.post.attempts ?? 0) === 1,
        acknowledged: s.stages.some((v) => v.kind === 'acknowledgement'),
        afterObserved: s.after !== null,
        desiredMatched,
        pendingAtEnd: r?.cleanup.pendingAtEnd ?? 0,
        disposalFailures: r?.cleanup.disposalFailures ?? 0,
        quarantined: r?.cleanup.quarantined ?? false,
      },
    };
    return freeze<NativeShortBodyProjection>({
      validated: s.baseline !== null,
      verifiedLive,
      durable,
      bodyIncluded: false,
      collectionMode: s.source?.mode ?? null,
      status,
      reason,
      evidence: s.context.refs.map(safeBodyRef),
      data: s.baseline ? [summary] : [],
    });
  } catch {
    return freeze<NativeShortBodyProjection>({
      validated: false,
      verifiedLive: false,
      durable: false,
      bodyIncluded: false,
      collectionMode: null,
      status: 'capability_unavailable',
      reason: 'durability_unverified',
      evidence: [],
      data: [],
    });
  }
}

function safeScalar(input: unknown, key: string): unknown {
  try {
    if (!input || typeof input !== 'object') return null;
    const d = Object.getOwnPropertyDescriptor(input, key);
    return d && Object.hasOwn(d, 'value') ? d.value : null;
  } catch {
    return null;
  }
}

export function safeNativeShortBodyJob(
  job: Job,
  projection: NativeShortBodyProjection | null,
): NativeShortBodySafeJob {
  const id = safeScalar(job, 'id'),
    status = safeScalar(job, 'status'),
    operation = safeScalar(job, 'operation'),
    requestedAt = safeScalar(job, 'requestedAt'),
    endedAt = safeScalar(job, 'endedAt');
  const safeTime = (v: unknown): string | null => {
    try {
      return durableTime(v);
    } catch {
      return null;
    }
  };
  return freeze<NativeShortBodySafeJob>({
    id: typeof id === 'string' && BODY_UUID.test(id) ? id : null,
    status:
      projection?.validated &&
      typeof status === 'string' &&
      [
        'queued',
        'running',
        'waiting_for_login',
        'succeeded',
        'partial',
        'failed',
        'uncertain',
        'cancelled',
      ].includes(status)
        ? status
        : null,
    operation:
      operation === NATIVE_SHORT_BODY_OPERATION ||
      operation === NATIVE_SHORT_BODY_RECONCILE_OPERATION
        ? operation
        : null,
    requestedAt: safeTime(requestedAt),
    endedAt: endedAt === null ? null : safeTime(endedAt),
  });
}

/** This DTO is emitted only by the explicit authenticated body-read tool. */
export interface NativeShortBodyReadProjection {
  readonly schema: 'fanqie-short-native-body-snapshot/v1';
  readonly status: 'success';
  readonly snapshotScope: NativeShortBodySnapshot['scope'];
  readonly representation: NativeShortBodySnapshot['representation'];
  readonly hashBasis: NativeShortBodySnapshot['hashBases']['snapshot'];
  readonly hashBases: NativeShortBodySnapshot['hashBases'];
  readonly state: ShortResolvedState;
  readonly statusFacts: ShortStatusFactsV1;
  readonly statusSource: NonNullable<NativeShortBodyStatusObservation['statusSource']>;
  readonly expectedState: 'draft';
  readonly versionScope: 'author-edit-current';
  readonly publishedVersionVerified: false;
  readonly snapshotVersionHash: string;
  readonly catalogHash: string;
  readonly documentHash: string;
  readonly savedFieldsHash: string;
  readonly categorySelectionHash: string;
  readonly sourceVectorHash: string;
  readonly observedWireVectorHash: string;
  readonly bodyHash: string;
  readonly paragraphsHash: string;
  readonly markerHash: string;
  readonly coversHash: string;
  readonly paragraphs: readonly {
    readonly sourceIndex: number;
    readonly lines: readonly string[];
  }[];
  readonly marker: {
    readonly boundary: number | null;
    readonly markerCount: 0 | 1;
    readonly paragraphCount: number;
    readonly eligibleParagraphCount: number;
    readonly characterCount: number;
    readonly prefixCharacterCount: number;
    readonly displayPercent: number | null;
  };
  readonly sourceRef: string;
  readonly evidenceHash: string;
  readonly capturedAt: string;
  readonly readStartedAt: string;
  readonly readFinishedAt: string;
  readonly proofCapturedAt: string;
  readonly verifiedLive: boolean;
  readonly bodyIncluded: true;
}
