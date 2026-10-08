import {
  type Job,
  type EvidenceRef,
  type Manifest,
  type EvidenceDocument,
  type RuntimeFailure,
} from '../runtime-error.js';
import * as bodyProof from '../../../platform/short-native-body-proof.js';
import { type NativeShortEvidenceContext } from '../../../platform/short-native-metadata-proof.js';

export type NativeShortBodySignalOperation = (job: Job, closureJson?: string) => boolean;

export type NativeShortBodyContextOperation = (
  job: Job,
) => bodyProof.NativeShortBodyEvidenceContext;

export type NativeShortBodyStageOperation = (
  job: Job,
  kind: bodyProof.NativeShortBodyStageKind,
  payload: unknown,
  eventAt: string,
) => bodyProof.NativeShortBodyStageEvidence;
export type NativeShortBodyIssuerOperation = () => void;

export type NativeShortBodyRecoveryFreshReadOperation = (
  recovery: bodyProof.NativeShortBodyOwnedGetRecoveryV2,
  accountId: string,
) => NativeShortEvidenceContext;

export type NativeShortBodyRecoveryFromPayloadOperation = (
  input: unknown,
  accountId: string,
) => bodyProof.NativeShortBodyRecoveryContextV2 | undefined;

export type NativeShortBodyReconciliationRowsOperation = (
  originalJobId: string,
  accountId: string,
  recovery?: bodyProof.NativeShortBodyOwnedGetRecoveryV2,
) => { rows: string; refs: EvidenceRef[] };

export type NativeShortBodyLaterReadOperation = (readId: string) => {
  readJob: Job;
  manifest: Manifest;
  ref: EvidenceRef;
  document: EvidenceDocument;
};

export type NativeShortBodySettlementErrorOperation = (
  status: 'succeeded' | 'failed' | 'uncertain',
) => RuntimeFailure | null;
