import { createDecodeJob } from './operations/jobs-api-with-public-projection-read.js';
import { type StoreReadPort, type Job, type EvidenceRef } from './runtime-error.js';
import { type ServiceLeaseLostSignal, timestamp } from './native-closure-signal.js';

import { type StoreOperations } from './operations.js';
import { StoreGenericInternals } from './store-generic-internals.js';
export class StoreRuntimeInternals extends StoreGenericInternals {
  private publicEvidenceFileSize(
    ref: EvidenceRef,
    file: string,
  ): ReturnType<StoreOperations['publicEvidenceFileSize']> {
    return this.operation('publicEvidenceFileSize')(ref, file);
  }
  private bindExistingSqlRead<T = unknown>(
    sql: string,
    mode: 'get' | 'all',
    params: readonly unknown[],
  ): StoreReadPort<T> {
    return this.operation('bindExistingSqlRead')(sql, mode, params);
  }
  private bindEvidenceRead(ref: EvidenceRef): ReturnType<StoreOperations['bindEvidenceRead']> {
    return this.operation('bindEvidenceRead')(ref);
  }
  private prepare(sql: string): ReturnType<StoreOperations['prepare']> {
    return this.operation('prepare')(sql);
  }
  private rawAccountAttemptRows(
    accountId: string,
    mode: 'tracked' | 'native' = 'tracked',
  ): ReturnType<StoreOperations['rawAccountAttemptRows']> {
    return this.operation('rawAccountAttemptRows')(accountId, mode);
  }
  private prefetchPublicRows(accountId: string): ReturnType<StoreOperations['prefetchPublicRows']> {
    return this.operation('prefetchPublicRows')(accountId);
  }
  private ensurePublicEvidenceIndex(): ReturnType<StoreOperations['ensurePublicEvidenceIndex']> {
    return this.operation('ensurePublicEvidenceIndex')();
  }
  private ensureOpen(): ReturnType<StoreOperations['ensureOpen']> {
    return this.operation('ensureOpen')();
  }
  private deliverLeaseLoss(entry: {
    listener(signal: ServiceLeaseLostSignal): void;
    delivered: boolean;
  }): ReturnType<StoreOperations['deliverLeaseLoss']> {
    return this.operation('deliverLeaseLoss')(entry);
  }
  private loseOwnership(): ReturnType<StoreOperations['loseOwnership']> {
    return this.operation('loseOwnership')();
  }
  private lostLeaseError(): ReturnType<StoreOperations['lostLeaseError']> {
    return this.operation('lostLeaseError')();
  }
  private assertOwnership(): ReturnType<StoreOperations['assertOwnership']> {
    return this.operation('assertOwnership')();
  }
  private transaction<T>(action: () => T): T {
    return this.operation('transaction')(action);
  }
  private renewLease(): ReturnType<StoreOperations['renewLease']> {
    return this.operation('renewLease')();
  }
  private decodeJob(row: Record<string, unknown>): ReturnType<StoreOperations['decodeJob']> {
    return createDecodeJob({})(row);
  }
  private rawJob(id: string): ReturnType<StoreOperations['rawJob']> {
    return this.operation('rawJob')(id);
  }
  private runningJob(id: string): ReturnType<StoreOperations['runningJob']> {
    return this.operation('runningJob')(id);
  }
  private assertNotCancelled(job: Job): ReturnType<StoreOperations['assertNotCancelled']> {
    return this.operation('assertNotCancelled')(job);
  }
  private preparePhysicalEvidence(
    job: Job,
    dataset: string,
    payload: unknown,
    capturedAt = timestamp(),
  ): ReturnType<StoreOperations['preparePhysicalEvidence']> {
    return this.operation('preparePhysicalEvidence')(job, dataset, payload, capturedAt);
  }
  private insertPhysicalEvidence(
    ref: EvidenceRef,
  ): ReturnType<StoreOperations['insertPhysicalEvidence']> {
    return this.operation('insertPhysicalEvidence')(ref);
  }
  private readEvidenceFresh(
    reference: EvidenceRef,
    mark: (input: unknown) => void,
    readStored: () => unknown,
  ): ReturnType<StoreOperations['readEvidenceFresh']> {
    return this.operation('readEvidenceFresh')(reference, mark, readStored);
  }
  private creationRepairJobs(
    originalId: string,
    recoveryId: string,
  ): ReturnType<StoreOperations['creationRepairJobs']> {
    return this.operation('creationRepairJobs')(originalId, recoveryId);
  }
  private creationRepairPrior(job: Job): ReturnType<StoreOperations['creationRepairPrior']> {
    return this.operation('creationRepairPrior')(job);
  }
  private verifyUnknownRepairChain(
    jobs: Job[],
    original: Job,
    recovery: Job,
    bindings: Record<string, string>,
  ): ReturnType<StoreOperations['verifyUnknownRepairChain']> {
    return this.operation('verifyUnknownRepairChain')(jobs, original, recovery, bindings);
  }
}
