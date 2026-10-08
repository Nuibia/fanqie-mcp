import { DatabaseSync } from 'node:sqlite';
import { type ServiceLeaseLostSignal } from '../native-closure-signal.js';
import {
  RuntimeError,
  type Job,
  type EvidenceRef,
  type EvidenceDocument,
} from '../runtime-error.js';
import * as bodyProof from '../../../platform/short-native-body-proof.js';

export type RunLeaseLossCleanupOperation = <T>(action: () => T) => T;

export type PrepareOperation = (sql: string) => ReturnType<DatabaseSync['prepare']>;
export type EnsureOpenOperation = () => void;
export type HasLostServiceLeaseOperation = () => boolean;

export type OnServiceLeaseLostOperation = (
  listener: (signal: ServiceLeaseLostSignal) => void,
) => () => void;

export type DeliverLeaseLossOperation = (entry: {
  listener(signal: ServiceLeaseLostSignal): void;
  delivered: boolean;
}) => void;
export type LoseOwnershipOperation = () => void;

export type LostLeaseErrorOperation = () => RuntimeError;
export type AssertOwnershipOperation = () => void;
export type AssertLeaseOwnershipOperation = () => void;
export type TransactionOperation = <T>(action: () => T) => T;
export type RenewLeaseOperation = () => void;
export type CloseOperation = () => void;

export type PrepareNativeShortBodyReconciliationOperation = (
  jobId: string,
  accountId: string,
) => {
  audit: bodyProof.NativeShortBodyOriginalAudit;
  recoveryContext?: bodyProof.NativeShortBodyRecoveryContextV2;
  comparisonPolicy?: 'native-short-body-derived-word-number/v2';
};

export type PreparePhysicalEvidenceOperation = (
  job: Job,
  dataset: string,
  payload: unknown,
  capturedAt?: string,
) => { reference: EvidenceRef; document: EvidenceDocument };
