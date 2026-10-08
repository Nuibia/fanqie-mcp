import * as draftDirectory from '../../platform/short-draft-directory.js';
import { type EvidenceRef } from '../../runtime/store.js';
import { type CompletedOperation } from './query.js';
type SafeBodyRef =
  import('../../platform/short-native-body-proof.js').NativeShortBodyProjection['evidence'][number];
export type RepairCreatedDraftOperation = (args: Record<string, unknown>) => Promise<{
  job:
    | Record<string, unknown>
    | import('../../platform/short-native-body-proof.js').NativeShortBodySafeJob
    | undefined;
  original: ReturnType<CompletedOperation>;
  recovered: ReturnType<CompletedOperation>;
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
}>;
export type ResumeCreateDraftOperation = (args: Record<string, unknown>) => Promise<{
  job:
    | Record<string, unknown>
    | import('../../platform/short-native-body-proof.js').NativeShortBodySafeJob
    | undefined;
  original: ReturnType<CompletedOperation>;
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
}>;
