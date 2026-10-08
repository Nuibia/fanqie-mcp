import * as draftDirectory from '../../platform/short-draft-directory.js';
import {
  type EvidenceRef,
  type EvidenceDocument,
  type Manifest,
  type Job,
} from '../../runtime/store.js';
import * as bodyRuntime from '../../platform/short-native-body-runtime.js';

import { datasets } from '../shared.js';

export type DirectoryViewOperation = (
  job: Job | null,
  manifest: Manifest | null,
  refs: EvidenceRef[],
  documents: EvidenceDocument[],
  readFailure?: unknown,
) => {
  native: boolean;
  directory: boolean;
  valid: boolean;
  verifiedLive: boolean;
  reason:
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
    | null;
  evidence: draftDirectory.ShortDraftDirectorySafeRef[];
  data: draftDirectory.ShortDraftDirectoryBusiness[];
  manifest: draftDirectory.ShortDraftDirectorySafeManifest | null;
  collectionMode: 'live' | 'fixture' | null;
  safeJob: draftDirectory.ShortDraftDirectorySafeJob;
};
export type EvidenceViewOperation = (
  job: Job | null,
  manifest: Manifest | null,
  refs: EvidenceRef[],
  includeDataset?: boolean,
  legacyRefs?: EvidenceRef[],
  purpose?: 'current' | 'creation-event',
) =>
  | {
      native: boolean;
      bodyRead: boolean;
      valid: boolean;
      verifiedLive: boolean;
      collectionMode: 'live' | 'fixture' | null;
      safeJob: {
        id: string | null;
        kind: string;
        operation: string;
        status: import('../../runtime/store.js').JobStatus | null;
        projectionStatus: string;
        requestedAt: string | null;
        startedAt: string | null;
        platformReadStartedAt: string | null;
        platformWriteStartedAt: null;
        endedAt: string | null;
      };
      evidence: {
        id: string;
        dataset: string;
        sha256: string;
        capturedAt: string;
      }[];
      manifest: {
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
      } | null;
      data: {
        schema: string;
        status: string;
        reason: string | null;
        source: {
          mode: 'live' | 'fixture';
        } | null;
        verifiedLive: boolean;
        bodyIncluded: boolean;
      }[];
    }
  | {
      native: boolean;
      directory: boolean;
      valid: boolean;
      verifiedLive: boolean;
      reason:
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
        | null;
      evidence: draftDirectory.ShortDraftDirectorySafeRef[];
      data: draftDirectory.ShortDraftDirectoryBusiness[];
      manifest: draftDirectory.ShortDraftDirectorySafeManifest | null;
      collectionMode: 'live' | 'fixture' | null;
      safeJob: draftDirectory.ShortDraftDirectorySafeJob;
    }
  | {
      native: boolean;
      valid: boolean;
      evidence: Record<string, unknown>[];
      data: Record<string, unknown>[];
      manifest: Record<string, unknown> | null;
      collectionMode: 'live' | 'fixture' | null;
      safeJob: Record<string, unknown>;
    }
  | bodyRuntime.NativeShortBodyEvidenceView
  | {
      native: boolean;
      valid: boolean;
      evidence: never[];
      data: {
        schema: string;
        status: string;
        reason: string;
        state: string;
        statusFacts: null;
        statusSource: null;
      }[];
      manifest: null;
      collectionMode: null;
      safeJob: Record<string, unknown> | null;
    }
  | {
      native: boolean;
      valid: boolean;
      evidence: Record<string, unknown>[];
      data: Record<string, unknown>[];
      manifest: null;
      collectionMode: 'live' | 'fixture' | null;
      safeJob: {
        operation: string | null;
        projectionStatus: string;
        result:
          | import('../../platform/short-native-metadata-proof.js').NativeShortWriteResultEvidence
          | import('../../platform/short-native-metadata-proof.js').NativeShortSafeClosure
          | null;
        id: string | null;
        accountId: string;
        kind: import('../../runtime/store.js').JobKind;
        scope: string | null;
        datasets: string[];
        status: import('../../runtime/store.js').JobStatus;
        requestedAt: string | null;
        startedAt: string | null;
        platformReadStartedAt: string | null;
        platformWriteStartedAt: string | null;
        endedAt: string | null;
        updatedAt: string | null;
        inputHash: string | null;
        error: {
          code: string;
          message: string;
        } | null;
        target: {
          kind: string;
          id: string;
        } | null;
        metadata: {};
        timeoutMs: number;
        deadlineAt: string | null;
        cancellationRequestedAt: string | null;
        cancellationReason: {
          code: string;
          message: string;
        } | null;
      };
      generic?: undefined;
      tuple?: undefined;
    }
  | {
      native: boolean;
      valid: boolean;
      evidence: {
        id: string;
        accountId: string;
        jobId: string;
        dataset: string;
        capturedAt: string;
        sha256: string;
      }[];
      data: Record<string, unknown>[];
      manifest: {
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
      };
      collectionMode: string;
      safeJob: {
        operation: string | null;
        scope: string | null;
        datasets: string[];
        projectionStatus: string;
        target: {
          kind: 'short-story';
          id: string;
        } | null;
        result: {
          manifest: {
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
          };
        } | null;
        id: string | null;
        accountId: string;
        kind: import('../../runtime/store.js').JobKind;
        status: import('../../runtime/store.js').JobStatus;
        requestedAt: string | null;
        startedAt: string | null;
        platformReadStartedAt: string | null;
        platformWriteStartedAt: string | null;
        endedAt: string | null;
        updatedAt: string | null;
        inputHash: string | null;
        error: {
          code: string;
          message: string;
        } | null;
        metadata: {};
        timeoutMs: number;
        deadlineAt: string | null;
        cancellationRequestedAt: string | null;
        cancellationReason: {
          code: string;
          message: string;
        } | null;
      };
      generic?: undefined;
      tuple?: undefined;
    }
  | {
      native: boolean;
      valid: boolean;
      evidence: {
        id: string;
        accountId: string;
        jobId: string;
        dataset: string;
        capturedAt: string;
        sha256: string;
      }[];
      data: Record<string, unknown>[];
      manifest: {
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
      };
      collectionMode: unknown;
      safeJob?: undefined;
      generic?: undefined;
      tuple?: undefined;
    }
  | {
      safeJob: {
        operation: string | null;
        scope: string | null;
        datasets: string[];
        projectionStatus: string;
        target: {
          kind: 'short-story';
          id: string;
        } | null;
        result: {
          manifest: {
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
          };
        } | null;
        id: string | null;
        accountId: string;
        kind: import('../../runtime/store.js').JobKind;
        status: import('../../runtime/store.js').JobStatus;
        requestedAt: string | null;
        startedAt: string | null;
        platformReadStartedAt: string | null;
        platformWriteStartedAt: string | null;
        endedAt: string | null;
        updatedAt: string | null;
        inputHash: string | null;
        error: {
          code: string;
          message: string;
        } | null;
        metadata: {};
        timeoutMs: number;
        deadlineAt: string | null;
        cancellationRequestedAt: string | null;
        cancellationReason: {
          code: string;
          message: string;
        } | null;
      };
      native: boolean;
      valid: boolean;
      evidence: never[];
      data: Record<string, unknown>[];
      manifest: null;
      collectionMode: null;
      generic?: undefined;
      tuple?: undefined;
    }
  | {
      native: boolean;
      generic: boolean;
      valid: boolean;
      evidence: EvidenceRef[];
      manifest: Manifest | null;
      data: Record<string, unknown>[];
      collectionMode: null;
      safeJob: Job & import('../../runtime/store.js').GenericShortPublicationTuple;
      tuple: import('../../runtime/store.js').GenericShortPublicationTuple;
    }
  | {
      native: boolean;
      valid: boolean;
      evidence: EvidenceRef[];
      manifest: Manifest | null;
      collectionMode: null;
      data: Record<string, unknown>[];
      safeJob?: undefined;
      generic?: undefined;
      tuple?: undefined;
    };
export type ListedJobOperation = (
  job: Job,
) =>
  | Record<string, unknown>
  | import('../../platform/short-native-body-proof.js').NativeShortBodySafeJob
  | undefined;
export type OutputJobOperation = (
  job: Job,
  purpose?: 'current' | 'creation-event',
) =>
  | Record<string, unknown>
  | import('../../platform/short-native-body-proof.js').NativeShortBodySafeJob
  | undefined;
export type UnavailableDirectoryProjectionOperation =
  () => draftDirectory.ShortDraftDirectoryProjection;
