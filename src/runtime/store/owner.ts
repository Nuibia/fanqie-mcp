import {
  type StoreReadPort,
  type EvidenceObservation,
  type Job,
  type GenericShortTrustedContext,
} from './runtime-error.js';
import { type ServiceLeaseLostSignal } from './native-closure-signal.js';
import * as bodyProof from '../../platform/short-native-body-proof.js';

import { DatabaseSync } from 'node:sqlite';
import { PublicReadCoordinator } from '../public-read.js';
import { type APIRequest } from 'playwright';

import { type StoreOperations } from './operations.js';
export interface StoreOwner extends StoreOperations {
  databasePath: string;
  evidenceDirectory: string;
  ownerId: `${string}-${string}-${string}-${string}-${string}`;
  db: DatabaseSync;
  leaseDurationMs: number;
  evidenceMode: 'live' | 'fixture';
  nativeShortSubmissionEvidenceMode: 'live' | 'fixture';
  explicitBodyReadEvidenceMode: 'live' | 'fixture';
  heartbeatTimer: NodeJS.Timeout | undefined;
  closed: boolean;
  ownershipLost: boolean;
  lossNotificationQueued: boolean;
  lossAnnounced: boolean;
  lossListeners: Set<{ listener(signal: ServiceLeaseLostSignal): void; delivered: boolean }>;
  nativeShortBodyWriteEnabled: boolean;
  publicReads: PublicReadCoordinator;
  genericReadScope: {
    token: object;
    accountId: string;
    open: boolean;
    ports: Map<string, StoreReadPort<unknown>>;
    files: Map<string, StoreReadPort<EvidenceObservation>>;
  } | null;
  newGenericJobs: Map<string, Job>;
  genericShortStatusContext: ((jobId: string) => GenericShortTrustedContext | null) | undefined;
  nativeShortBodyFactory: Pick<APIRequest, 'newContext'>;
  nativeShortBodySource: bodyProof.NativeShortBodySource;
}
