import {
  type EvidenceRef,
  type EvidenceDocument,
  type Manifest,
  type Job,
} from '../../runtime/store.js';

import { type NativeShortReconciliationContext } from '../../platform/short-native-metadata-proof.js';

export type ExplicitBodyReadViewOperation = (
  job: Job | null,
  manifest: Manifest | null,
  refs: EvidenceRef[],
  documents: Map<string, EvidenceDocument>,
  readFailure?: unknown,
) => {
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
};
export type IsExplicitBodyReadOperation = (job: Job | null) => boolean;
export type JobManifestOperation = (job: Job) => Manifest | null;
export type NativeClosureContextOperation = (original: Job) => NativeShortReconciliationContext;
export type NativeOriginalContextOperation = (job: Job) => {
  accountId: string;
  job: Job;
  manifest: null;
  refs: EvidenceRef[];
  documents: EvidenceDocument[];
};
export type NativeReconciliationContextOperation = (
  original: Job,
  readJob: Job,
  manifest: Manifest | null,
  refs: EvidenceRef[],
  documents: EvidenceDocument[],
) => NativeShortReconciliationContext;
export type PublicJobOperation = (id: string) => Job | null;
export type RefsForOperation = (job: Job) => EvidenceRef[];
export type UnavailableNativeViewOperation = () => Record<string, unknown>;
