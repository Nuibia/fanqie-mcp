import {
  type NativeShortBodyRefLink,
  type NativeShortBodyStageKind,
  type NativeShortBodySource,
} from './inspect.js';

import {
  type Job,
  type Manifest,
  type EvidenceRef,
  type EvidenceDocument,
  type RuntimeFailure,
} from '../../runtime/store.js';

import {
  NATIVE_SHORT_BODY_SCOPE,
  NATIVE_SHORT_BODY_COMPARISON_POLICY_V2,
  type NativeShortBodyComparison,
} from '../short-native-body.js';

import { type Reason } from './fail.js';

import { type Cleanup } from './same-mode.js';

import { type NativeShortEvidenceContext } from '../short-native-metadata-proof.js';

import { type ShortResolvedState, type ShortStatusFactsV1 } from '../short-status.js';

export interface NativeShortBodyAttemptRow {
  readonly jobId: string;
  readonly accountId: string;
  readonly ordinal: 1;
  readonly evidence: NativeShortBodyRefLink;
  readonly eventAt: string;
}

export interface NativeShortBodyEvidenceContext {
  readonly accountId: string;
  readonly job: Job;
  readonly manifest: Manifest | null;
  readonly refs: readonly EvidenceRef[];
  readonly documents: readonly EvidenceDocument[];
  readonly attempts: readonly NativeShortBodyAttemptRow[];
}

export interface NativeShortBodyStageEvidence {
  readonly schema: 'native-short-body-stage/v1';
  readonly scope: typeof NATIVE_SHORT_BODY_SCOPE;
  readonly kind: NativeShortBodyStageKind;
  readonly sequence: number;
  readonly eventAt: string;
  readonly priorStageHash: string | null;
  readonly accountId: string;
  readonly jobId: string;
  readonly inputHash: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface NativeShortBodyTransport {
  readonly method: 'POST';
  readonly url: string;
  readonly contentType: string;
  readonly maxRedirects: 0;
  readonly maxRetries: 0;
  readonly maxAttempts: 1;
}

export interface NativeShortBodyWriteResultEvidence {
  readonly schema: 'native-short-body-write-result/v1';
  readonly outcome: 'not_attempted' | 'unknown' | 'matched';
  readonly reason: Reason | 'match';
  readonly source: NativeShortBodySource;
  readonly desiredContentHash: string | null;
  readonly preservationHash: string | null;
  readonly hashBasesHash: string;
  readonly evidence: Readonly<
    Record<
      'baseline' | 'preSave' | 'intent' | 'attempt' | 'acknowledgement' | 'after',
      NativeShortBodyRefLink | null
    >
  >;
  readonly post: {
    readonly attempts: number;
    readonly disposed: number;
    readonly startedAt: string | null;
    readonly acknowledgedAt: string | null;
    readonly acknowledged: boolean;
  };
  readonly ownerCheckedAt: string | null;
  readonly cleanup: Readonly<Cleanup>;
  readonly atomicRevision: false;
}

export interface ClosurePointer {
  readonly readJobId: string;
  readonly evidenceId: string;
  readonly evidenceHash: string;
  readonly resultHash: string;
  readonly settledAt: string;
}

export interface NativeShortBodyOriginalAudit {
  readonly schema: 'native-short-body-original-audit/v1';
  readonly accountId: string;
  readonly originalJobId: string;
  readonly target: { readonly kind: 'short-story'; readonly id: string };
  readonly inputHash: string;
  readonly originalEndedAt: string;
  readonly priorEndedAt: string;
  readonly originalResultHash: string;
  readonly originalErrorHash: string;
  readonly originalError: RuntimeFailure;
  readonly evidenceHash: string;
  readonly attemptsHash: string;
  readonly firstClosure: ClosurePointer | null;
  readonly previousClosure: ClosurePointer | null;
}

export interface NativeShortBodyHistoryFrame {
  readonly firstAudit: NativeShortBodyOriginalAudit;
  readonly previousClosure: NativeShortBodyClosure;
}

export interface BodyReadPhase {
  readonly proof: {
    readonly platformStarted: boolean;
    readonly ownerBefore: boolean;
    readonly ownerAfter: boolean;
    readonly fixedSourceVerified: boolean;
    readonly targetUnique: boolean;
    readonly paginationComplete: boolean;
    readonly atomicRevision: false;
    readonly readStartedAt: string | null;
    readonly readFinishedAt: string | null;
    readonly proofCapturedAt: string | null;
  };
  readonly requests: Readonly<
    Record<
      'own' | 'list' | 'edit' | 'catalog',
      { readonly attempts: number; readonly disposed: number }
    >
  >;
  readonly list: {
    readonly pagesRead: number;
    readonly rowsRead: number;
    readonly totalCount: number | null;
  };
}

export interface NativeShortBodyOwnedGetRecoveryV2 {
  readonly schema: 'native-short-body-owned-get-recovery/v2';
  readonly originalOwnerId: string;
  readonly leaseOwnerId: string;
  readonly freshReadJobId: string;
  readonly freshReadJobHash: string;
  readonly freshReadManifestId: string;
  readonly freshReadManifestHash: string;
  readonly freshReadEvidence: NativeShortBodyRefLink;
  readonly leaseCheckedAt: string;
  readonly leaseExpiresAt: string;
}

/** Only this transient context contains the full fresh GET graph; persisted recovery is refs only. */
export interface NativeShortBodyRecoveryContextV2 {
  readonly recovery: NativeShortBodyOwnedGetRecoveryV2;
  readonly freshRead: NativeShortEvidenceContext;
}

export interface NativeShortBodyReconciliationEvidence {
  readonly schema: 'native-short-body-reconciliation/v1' | 'native-short-body-reconciliation/v2';
  readonly comparisonPolicy?: typeof NATIVE_SHORT_BODY_COMPARISON_POLICY_V2;
  readonly recovery?: NativeShortBodyOwnedGetRecoveryV2 | null;
  readonly scope: typeof NATIVE_SHORT_BODY_SCOPE;
  readonly source: NativeShortBodySource;
  readonly originalAudit: NativeShortBodyOriginalAudit;
  readonly native: Readonly<Record<string, unknown>> | null;
  readonly read: BodyReadPhase;
  readonly ownerCheckedAt: string | null;
  readonly cleanup: Readonly<Cleanup>;
  readonly comparison: NativeShortBodyComparison | null;
  readonly reason:
    'match' | 'not_applied' | 'partial_read' | 'readback_mismatch' | 'reconciliation_not_live';
}

export interface NativeShortBodyReconciliationContext {
  readonly original: NativeShortBodyEvidenceContext;
  readonly readJob: Job;
  readonly manifest: Manifest;
  readonly ref: EvidenceRef;
  readonly document: EvidenceDocument;
  readonly recoveryContext?: NativeShortBodyRecoveryContextV2;
}

export interface NativeShortBodySettlement {
  readonly status: 'succeeded' | 'failed' | 'uncertain';
  readonly reason: NativeShortBodyReconciliationEvidence['reason'];
  readonly result: {
    readonly schema: 'native-short-body-settlement-result/v1';
    readonly source: NativeShortBodySource;
    readonly originalJobId: string;
    readonly readJobId: string;
    readonly desiredMatched: boolean;
    readonly bodyIncluded: false;
    readonly verifiedLive: boolean;
  };
}

export interface NativeShortBodyClosure {
  readonly schema: 'native-short-body-closure/v1' | 'native-short-body-closure/v2';
  readonly comparisonPolicy?: typeof NATIVE_SHORT_BODY_COMPARISON_POLICY_V2;
  readonly recovery?: NativeShortBodyOwnedGetRecoveryV2 | null;
  readonly accountId: string;
  readonly originalJobId: string;
  readonly reconciliationJobId: string;
  readonly evidence: NativeShortBodyRefLink;
  readonly status: NativeShortBodySettlement['status'];
  readonly reason: NativeShortBodySettlement['reason'];
  readonly result: NativeShortBodySettlement['result'];
  readonly originalAudit: NativeShortBodyOriginalAudit;
  readonly settledAt: string;
}

export interface SafeBodyRef {
  readonly id: string;
  readonly dataset: string;
  readonly sha256: string;
  readonly capturedAt: string;
}

export interface NativeShortBodyStatusObservation {
  readonly state: ShortResolvedState;
  readonly statusFacts: ShortStatusFactsV1 | null;
  readonly statusSource: {
    readonly phase: 'read' | 'baseline' | 'pre_save' | 'after' | 'later_read';
    readonly sourceRef: string;
    readonly evidenceHash: string;
    readonly evidenceCapturedAt: string;
  } | null;
}

export interface NativeShortBodyProjection {
  readonly validated: boolean;
  readonly verifiedLive: boolean;
  readonly durable: boolean;
  readonly bodyIncluded: false;
  readonly collectionMode: 'live' | 'fixture' | null;
  readonly status: 'matched' | 'no_change' | 'unknown' | 'capability_unavailable';
  readonly reason: Reason | NativeShortBodySettlement['reason'];
  readonly evidence: readonly SafeBodyRef[];
  readonly data: readonly Readonly<Record<string, unknown>>[];
}

export interface NativeShortBodySafeJob {
  readonly id: string | null;
  readonly status: string | null;
  readonly operation: string | null;
  readonly requestedAt: string | null;
  readonly endedAt: string | null;
}

export const BODY_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export const BODY_WORK = /^[1-9][0-9]{9,21}$/;

export const BODY_ACCOUNT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export const BODY_KINDS = [
  'baseline',
  'preSave',
  'intent',
  'attempt',
  'acknowledgement',
  'after',
  'result',
] as const;

export const BODY_STAGE_KEYS = [
  'schema',
  'scope',
  'kind',
  'sequence',
  'eventAt',
  'priorStageHash',
  'accountId',
  'jobId',
  'inputHash',
  'payload',
] as const;

export const BODY_PAYLOAD_KEYS: Record<NativeShortBodyStageKind, readonly string[]> = {
  baseline: ['businessInput', 'native', 'read', 'source'],
  preSave: ['native', 'read', 'sourceVersionHash', 'desiredContentHash'],
  intent: [
    'hashBasesHash',
    'target',
    'binding',
    'inputHash',
    'sourceVersionHash',
    'desiredContentHash',
    'baselineEvidence',
    'preSaveEvidence',
    'expectationHash',
    'transport',
  ],
  attempt: ['ordinal', 'eventAt', 'intentEvidence', 'transport'],
  acknowledgement: ['observation', 'attemptEvidence'],
  after: ['native', 'read', 'comparison'],
  result: [
    'schema',
    'outcome',
    'reason',
    'source',
    'desiredContentHash',
    'preservationHash',
    'hashBasesHash',
    'evidence',
    'post',
    'ownerCheckedAt',
    'cleanup',
    'atomicRevision',
  ],
};
