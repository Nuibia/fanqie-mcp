import {
  type NativeShortOriginalAudit,
  type NativeShortCompensationSourceContext,
} from '../../platform/short-native-metadata-proof.js';
import { type EvidenceRef, type EvidenceDocument, type Job } from '../../runtime/store.js';

import { type CompletedOperation } from './query.js';

export type NativeAuditBeforeReadOperation = (original: Job) => {
  context: {
    accountId: string;
    job: Job;
    manifest: null;
    refs: EvidenceRef[];
    documents: EvidenceDocument[];
  };
  audit: NativeShortOriginalAudit;
};
export type ReconcileBookMetadataOperation = (original: Job) => Promise<{
  reconciliation: ReturnType<CompletedOperation>;
  original: ReturnType<CompletedOperation>;
}>;
export type ReconcileNativeCompensationOperation = (
  source: NativeShortCompensationSourceContext,
) => Promise<
  | {
      reconciliation: ReturnType<CompletedOperation>;
      original: ReturnType<CompletedOperation>;
      settlement?: undefined;
    }
  | {
      reconciliation: ReturnType<CompletedOperation>;
      original: ReturnType<CompletedOperation>;
      settlement: {
        status: string;
        reason: string;
      };
    }
>;
export type ReconcileNativeShortMetadataOperation = (original: Job) => Promise<
  | {
      reconciliation: ReturnType<CompletedOperation>;
      original: ReturnType<CompletedOperation>;
      settlement?: undefined;
    }
  | {
      reconciliation: ReturnType<CompletedOperation>;
      original: ReturnType<CompletedOperation>;
      settlement: {
        status: string;
        reason: string;
      };
    }
>;
