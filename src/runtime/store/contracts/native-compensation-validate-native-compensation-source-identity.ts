import {
  type NativeShortCompensationAuthority,
  type NativeShortCompensationSourceContext,
} from '../../../platform/short-native-metadata-proof.js';
import { type Job } from '../runtime-error.js';

import { type NativeReconciliationRow } from '../native-closure-signal.js';

export type ValidateNativeCompensationSourceIdentityOperation = (
  authority: NativeShortCompensationAuthority,
) => void;

export type ValidateNativeCompensationInstalledSourceOperation = (
  authority: NativeShortCompensationAuthority,
) => void;

export type NativeCompensationSourceOperation = (
  originalId: string,
  registration: Job | null,
  supplied?: { operatorJobId: string; authority: NativeShortCompensationAuthority },
) => NativeShortCompensationSourceContext;

export type GetNativeCompensationContextOperation = (
  originalJobId: string,
) => NativeShortCompensationSourceContext | null;

export type RegisterNativeCompensationAttestationOperation = (input: unknown) => Job;

export type ValidateNativeCompensatedClosureOperation = (original: Job) => void;

export type ReconcileNativeCompensationOperation = (
  source: NativeShortCompensationSourceContext,
  readJob: Job,
  resolution: { status: 'succeeded' | 'failed' | 'uncertain'; result: unknown },
) => Job;

export type NativeReconciliationRowOperation = (
  originalId: string,
  position: 'first' | 'last',
  before?: number,
) => NativeReconciliationRow | null;
