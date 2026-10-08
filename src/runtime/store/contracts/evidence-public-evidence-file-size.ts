import {
  type EvidenceRef,
  type StoreReadPort,
  type EvidenceObservation,
  type EvidenceDocument,
  type Job,
  type Manifest,
} from '../runtime-error.js';

export type PublicEvidenceFileSizeOperation = (ref: EvidenceRef, file: string) => number;

export type BindEvidenceReadOperation = (ref: EvidenceRef) => StoreReadPort<EvidenceObservation>;
export type PrefetchPublicRowsOperation = (accountId: string) => void;
export type EnsurePublicEvidenceIndexOperation = () => void;

export type SaveEvidenceOperation = (
  jobId: string,
  dataset: string,
  payload: unknown,
) => EvidenceRef;

export type InsertPhysicalEvidenceOperation = (ref: EvidenceRef) => void;

export type ListEvidenceOperation = (jobId: string) => EvidenceRef[];

export type ReadEvidenceOperation = (reference: EvidenceRef) => EvidenceDocument;

export type ReadEvidenceFreshOperation = (
  reference: EvidenceRef,
  mark: (input: unknown) => void,
  readStored: () => unknown,
) => EvidenceDocument;

export type NativeBoundedReferencesOperation = (jobId: string, maximum: number) => EvidenceRef[];

export type NativeOriginalEvidenceOperation = (original: Job) => {
  refs: EvidenceRef[];
  documents: EvidenceDocument[];
};

export type GetManifestForJobOperation = (accountId: string, jobId: string) => Manifest | null;
