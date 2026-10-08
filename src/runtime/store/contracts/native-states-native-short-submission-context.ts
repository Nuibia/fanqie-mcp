import {
  type Job,
  type RuntimeFailure,
  type EvidenceRef,
  type Manifest,
  type EvidenceDocument,
} from '../runtime-error.js';
import { type NativeShortSubmissionContext } from '../../../platform/short-native-submission-proof.js';
import { type NativeShortTrialContext } from '../../../platform/short-native-trial-proof.js';
import { type NativeShortCoverContext } from '../../../platform/short-native-cover-proof.js';

export type NativeShortSubmissionContextOperation = (job: Job) => NativeShortSubmissionContext;

export type NativeShortTrialContextOperation = (job: Job) => NativeShortTrialContext;

export type NativeShortCoverContextOperation = (job: Job) => NativeShortCoverContext;

export type NativeShortSubmissionSettlementErrorOperation = (
  status: 'succeeded' | 'failed' | 'uncertain',
) => RuntimeFailure | null;

export type NativeShortSubmissionLaterReadOperation = (readId: string) => {
  readJob: Job;
  manifest: Manifest;
  ref: EvidenceRef;
  document: EvidenceDocument;
};

export type NativeShortTrialSettlementErrorOperation = (
  status: 'succeeded' | 'failed' | 'uncertain',
) => RuntimeFailure | null;

export type NativeShortTrialLaterReadOperation = (readId: string) => {
  readJob: Job;
  manifest: Manifest;
  ref: EvidenceRef;
  document: EvidenceDocument;
};

export type NativeShortCoverSettlementErrorOperation = (
  status: 'succeeded' | 'failed' | 'uncertain',
) => RuntimeFailure | null;

export type NativeShortCoverLaterReadOperation = (readId: string) => {
  readJob: Job;
  manifest: Manifest;
  ref: EvidenceRef;
  document: EvidenceDocument;
};
