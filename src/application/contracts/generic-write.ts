import { type JobContext, type JobHandle } from '../../runtime/jobs.js';
import { type GenericShortTrustedContext, type EvidenceRef } from '../../runtime/store.js';
import * as writes from '../../platform/writes.js';

export type AdvanceGenericShortStatusOperation = (
  ctx: JobContext,
  stage: string,
  failure?: {
    kind: string;
    at: string;
  },
) => void;
export type BeginGenericShortStatusOperation = (
  ctx: JobContext,
  execution: Pick<GenericShortTrustedContext, 'target' | 'creationContext' | 'requestBindings'>,
) => void;
export type BindGenericShortTargetOperation = (
  ctx: JobContext,
  target: NonNullable<GenericShortTrustedContext['target']>,
) => void;
export type GenericBusinessExecutionOperation = (
  ctx: JobContext,
  operation: string,
  args: Record<string, unknown>,
) => Pick<GenericShortTrustedContext, 'target' | 'creationContext' | 'requestBindings'>;
export type GenericCanonicalResultOperation = (
  ctx: JobContext,
  input: writes.WriteResult,
) => writes.WriteResult;
export type GenericCaptureOperation = <T>(input: T) => T;
export type GenericShortRunOperation = <T>(
  ctx: JobContext,
  execution: Pick<GenericShortTrustedContext, 'target' | 'creationContext' | 'requestBindings'>,
  run: () => Promise<T>,
) => Promise<T>;
export type ModernShortProfileOperation = () => boolean;
export type PersistGenericShortObservationOperation = (
  ctx: JobContext,
  role: {
    dataset: string;
    phase: string;
    payload?: Record<string, unknown>;
  },
  snapshotInput: unknown,
) => EvidenceRef;
export type RetainGenericShortContextOperation = (handle: JobHandle) => JobHandle;
