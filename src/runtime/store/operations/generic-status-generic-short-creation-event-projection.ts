import {
  type StoreReadPort,
  type EvidenceObservation,
  type Job,
  type EvidenceRef,
  type Manifest,
  type GenericShortPublicationTuple,
} from '../runtime-error.js';
import { genericUnavailable, genericObject } from '../has-generic-short-status-signal.js';
import {
  type CaptureGenericShortPublicationGraphOperation,
  type RereadGenericShortPublicationGraphOperation,
  type GenericShortPublicJobOperation,
  type GenericShortEvidenceRowsOperation,
  type GenericReadFailureOperation,
  type GenericShortCreationEventProjectionOperation,
} from '../contracts/generic-status-generic-refs.js';
import { type GenericCreationEventOperation } from '../contracts/creation-recovery-generic-creation-prior.js';

import { type WithPublicProjectionReadOperation } from '../contracts/jobs-api-with-public-projection-read.js';

import { captureShortStatusJson } from '../../../platform/short-status.js';

interface GenericShortCreationEventProjectionDependencies {
  captureGenericShortPublicationGraph: CaptureGenericShortPublicationGraphOperation;
  genericCreationEvent: GenericCreationEventOperation;
  rereadGenericShortPublicationGraph: RereadGenericShortPublicationGraphOperation;
  genericShortPublicJob: GenericShortPublicJobOperation;
  genericShortEvidenceRows: GenericShortEvidenceRowsOperation;
  genericReadScope: {
    token: object;
    accountId: string;
    open: boolean;
    ports: Map<string, StoreReadPort<unknown>>;
    files: Map<string, StoreReadPort<EvidenceObservation>>;
  } | null;
  withPublicProjectionRead: WithPublicProjectionReadOperation;
  genericReadFailure: GenericReadFailureOperation;
}

export function createGenericShortCreationEventProjection(
  deps: GenericShortCreationEventProjectionDependencies,
): GenericShortCreationEventProjectionOperation {
  function genericShortCreationEventProjection(
    memberId: string,
    accountId: string,
    includeDataset = true,
  ): {
    job: Job & GenericShortPublicationTuple;
    tuple: GenericShortPublicationTuple;
    manifest: Manifest | null;
    evidence: EvidenceRef[];
    data: Record<string, unknown>[];
  } {
    const run = () => {
      const plan = deps.captureGenericShortPublicationGraph(memberId, accountId);
      deps.genericCreationEvent(plan.first);
      const final = deps.rereadGenericShortPublicationGraph(plan),
        event = deps.genericCreationEvent(final),
        node = final.jobs[memberId];
      if (!node) return genericUnavailable();
      return {
        job: deps.genericShortPublicJob(node.job, event.tuple),
        tuple: event.tuple,
        manifest: node.manifest,
        evidence: node.refs,
        data: deps.genericShortEvidenceRows(event.rows, includeDataset),
      };
    };
    try {
      return deps.genericReadScope ? run() : deps.withPublicProjectionRead(accountId, 'jobs', run);
    } catch (error) {
      return deps.genericReadFailure(error);
    }
  }
  return genericShortCreationEventProjection;
}

interface GenericShortPublicJobDependencies {}

export function createGenericShortPublicJob(
  deps: GenericShortPublicJobDependencies,
): GenericShortPublicJobOperation {
  function genericShortPublicJob(
    job: Job,
    tuple: GenericShortPublicationTuple,
  ): Job & GenericShortPublicationTuple {
    const safe = captureShortStatusJson(job) as Job;
    const copyMetadata = (input: unknown) => {
      const metadata = genericObject(input);
      return Object.fromEntries(
        Object.entries(metadata).filter(([key]) => key !== 'genericShortStatus'),
      );
    };
    safe.metadata = copyMetadata(safe.metadata);
    const copyPrior = (result: unknown, depth = 0): unknown => {
      if (depth >= 128) return genericUnavailable();
      if (!result || typeof result !== 'object') return result;
      const value = genericObject(result);
      if (Object.hasOwn(value, 'supersededByVerifiedRepair')) {
        const prior = genericObject(value.prior),
          out = { ...prior };
        if (Object.hasOwn(prior, 'metadata')) out.metadata = copyMetadata(prior.metadata);
        if (Object.hasOwn(prior, 'result')) out.result = copyPrior(prior.result, depth + 1);
        return { ...value, prior: out };
      }
      return value;
    };
    safe.result = copyPrior(safe.result);
    return { ...safe, ...tuple };
  }
  return genericShortPublicJob;
}
