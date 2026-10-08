import { type EvidenceRef, type Job, type Manifest } from '../../runtime/store.js';
import { type JobContext, type JobHandle } from '../../runtime/jobs.js';
import { Dataset, datasets } from '../shared.js';
import * as draftDirectory from '../../platform/short-draft-directory.js';

type SafeBodyRef =
  import('../../platform/short-native-body-proof.js').NativeShortBodyProjection['evidence'][number];
export type CollectOperation = (
  dataset: Dataset,
  ctx: JobContext,
  options?: {
    workId?: string;
    category?: string;
  },
) => Promise<EvidenceRef>;
export type CompletedOperation = (
  job: Job,
  retrievalMode?: 'saved' | 'live',
  purpose?: 'current' | 'creation-event',
) => {
  verifiedLive?: boolean | undefined;
  reason?:
    | 'cancelled'
    | 'response_unverified'
    | 'context_unavailable'
    | 'identity_unverified'
    | 'owner_changed'
    | 'source_changed'
    | 'redirect_blocked'
    | 'response_unavailable'
    | 'bounded_unavailable'
    | 'pagination_inconsistent'
    | 'unsupported_schema'
    | 'timeout'
    | 'cleanup_failed'
    | 'lease_unavailable'
    | 'callback_failed'
    | null
    | undefined;
  job:
    | Record<string, unknown>
    | import('../../platform/short-native-body-proof.js').NativeShortBodySafeJob
    | undefined;
  retrievalMode: 'live' | 'saved';
  sourceMode: unknown;
  evidence:
    | EvidenceRef[]
    | {
        id: string;
        dataset: string;
        sha256: string;
        capturedAt: string;
      }[]
    | draftDirectory.ShortDraftDirectorySafeRef[]
    | Record<string, unknown>[]
    | never[]
    | {
        id: string;
        accountId: string;
        jobId: string;
        dataset: string;
        capturedAt: string;
        sha256: string;
      }[]
    | readonly SafeBodyRef[];
  data:
    | {
        schema: string;
        status: string;
        reason: string | null;
        source: {
          mode: 'live' | 'fixture';
        } | null;
        verifiedLive: boolean;
        bodyIncluded: boolean;
      }[]
    | draftDirectory.ShortDraftDirectoryBusiness[]
    | Record<string, unknown>[]
    | {
        schema: string;
        status: string;
        reason: string;
        state: string;
        statusFacts: null;
        statusSource: null;
      }[]
    | readonly Readonly<Record<string, unknown>>[];
};
export type EnqueueNativeShortMetadataReadOperation = (
  workId: string,
  explicitBodyRead?: boolean,
) => JobHandle;
export type ManifestViewOperation = (
  manifest: Manifest,
  includeDataset?: boolean,
) => {
  verifiedLive?: boolean | undefined;
  reason?:
    | 'cancelled'
    | 'response_unverified'
    | 'context_unavailable'
    | 'identity_unverified'
    | 'owner_changed'
    | 'source_changed'
    | 'redirect_blocked'
    | 'response_unavailable'
    | 'bounded_unavailable'
    | 'pagination_inconsistent'
    | 'unsupported_schema'
    | 'timeout'
    | 'cleanup_failed'
    | 'lease_unavailable'
    | 'callback_failed'
    | null
    | undefined;
  sourceMode?: string | undefined;
  state?: string | undefined;
  statusFacts?: unknown;
  statusSource?:
    | {
        phase: string;
        sourceRef: string;
        evidenceHash: string;
        evidenceCapturedAt: string;
      }
    | null
    | undefined;
  statusEvidence?:
    | {
        id: string;
        jobId: string;
        dataset: string;
        sha256: string;
        capturedAt: string;
      }
    | null
    | undefined;
  manifest:
    | Record<string, unknown>
    | Manifest
    | {
        id: string;
        jobId: string;
        operation: string;
        committedAt: string;
        evidence: {
          id: string;
          dataset: string;
          sha256: string;
          capturedAt: string;
        }[];
      }
    | draftDirectory.ShortDraftDirectorySafeManifest
    | {
        schemaVersion: number;
        id: string;
        accountId: string;
        jobId: string;
        operation: string;
        scope: string | null;
        datasets: string[];
        requestedAt: string | null;
        platformReadStartedAt: string | null;
        committedAt: string | null;
        evidence: {
          id: string;
          accountId: string;
          jobId: string;
          dataset: string;
          capturedAt: string;
          sha256: string;
        }[];
      }
    | {
        schemaVersion: number;
        id: string;
        accountId: string;
        jobId: string;
        operation: string;
        scope: string;
        datasets: string[];
        requestedAt: string;
        platformReadStartedAt: string;
        committedAt: string;
        evidence: {
          id: string;
          accountId: string;
          jobId: string;
          dataset: string;
          capturedAt: string;
          sha256: string;
        }[];
      }
    | {
        id: string;
        operation: string;
        committedAt: string;
        evidence: import('../../platform/short-native-body-proof.js').NativeShortBodyProjection['evidence'];
      }
    | null;
  data:
    | {
        schema: string;
        status: string;
        reason: string | null;
        source: {
          mode: 'live' | 'fixture';
        } | null;
        verifiedLive: boolean;
        bodyIncluded: boolean;
      }[]
    | draftDirectory.ShortDraftDirectoryBusiness[]
    | Record<string, unknown>[]
    | {
        schema: string;
        status: string;
        reason: string;
        state: string;
        statusFacts: null;
        statusSource: null;
      }[]
    | readonly Readonly<Record<string, unknown>>[];
};
export type RefreshOperation = (
  selected: Dataset[],
  scope?: string,
  options?: {
    workId?: string;
    category?: string;
  },
) => JobHandle;
export type SnapshotOperation = (scope?: string) =>
  | {
      verifiedLive?: boolean | undefined;
      reason?:
        | 'cancelled'
        | 'response_unverified'
        | 'context_unavailable'
        | 'identity_unverified'
        | 'owner_changed'
        | 'source_changed'
        | 'redirect_blocked'
        | 'response_unavailable'
        | 'bounded_unavailable'
        | 'pagination_inconsistent'
        | 'unsupported_schema'
        | 'timeout'
        | 'cleanup_failed'
        | 'lease_unavailable'
        | 'callback_failed'
        | null
        | undefined;
      sourceMode: string;
      state?: string | undefined;
      statusFacts?: unknown;
      statusSource?:
        | {
            phase: string;
            sourceRef: string;
            evidenceHash: string;
            evidenceCapturedAt: string;
          }
        | null
        | undefined;
      statusEvidence?:
        | {
            id: string;
            jobId: string;
            dataset: string;
            sha256: string;
            capturedAt: string;
          }
        | null
        | undefined;
      manifest:
        | Record<string, unknown>
        | Manifest
        | {
            id: string;
            jobId: string;
            operation: string;
            committedAt: string;
            evidence: {
              id: string;
              dataset: string;
              sha256: string;
              capturedAt: string;
            }[];
          }
        | draftDirectory.ShortDraftDirectorySafeManifest
        | {
            schemaVersion: number;
            id: string;
            accountId: string;
            jobId: string;
            operation: string;
            scope: string | null;
            datasets: string[];
            requestedAt: string | null;
            platformReadStartedAt: string | null;
            committedAt: string | null;
            evidence: {
              id: string;
              accountId: string;
              jobId: string;
              dataset: string;
              capturedAt: string;
              sha256: string;
            }[];
          }
        | {
            schemaVersion: number;
            id: string;
            accountId: string;
            jobId: string;
            operation: string;
            scope: string;
            datasets: string[];
            requestedAt: string;
            platformReadStartedAt: string;
            committedAt: string;
            evidence: {
              id: string;
              accountId: string;
              jobId: string;
              dataset: string;
              capturedAt: string;
              sha256: string;
            }[];
          }
        | {
            id: string;
            operation: string;
            committedAt: string;
            evidence: import('../../platform/short-native-body-proof.js').NativeShortBodyProjection['evidence'];
          }
        | null;
      data:
        | {
            schema: string;
            status: string;
            reason: string | null;
            source: {
              mode: 'live' | 'fixture';
            } | null;
            verifiedLive: boolean;
            bodyIncluded: boolean;
          }[]
        | draftDirectory.ShortDraftDirectoryBusiness[]
        | Record<string, unknown>[]
        | {
            schema: string;
            status: string;
            reason: string;
            state: string;
            statusFacts: null;
            statusSource: null;
          }[]
        | readonly Readonly<Record<string, unknown>>[];
    }
  | {
      sourceMode: string;
      manifest: null;
      data: never[];
      reason: string;
    };
export type WaitOperation = (
  handle: JobHandle,
  purpose?: 'current' | 'creation-event',
) => Promise<ReturnType<CompletedOperation>>;
