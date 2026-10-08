import { safeNativeShortJob } from '../platform/short-native-metadata-proof.js';
import { type Job } from '../runtime/store.js';
import { record, GenericReadPurpose } from './shared.js';
import { type CompletedOperation } from './contracts/query.js';
import {
  type PublicJobOperation,
  type JobManifestOperation,
  type RefsForOperation,
} from './contracts/evidence-context.js';

import { type EvidenceViewOperation } from './contracts/evidence-projection.js';
interface Dependencies {
  publicJob: PublicJobOperation;
  jobManifest: JobManifestOperation;
  refsFor: RefsForOperation;
  evidenceView: EvidenceViewOperation;
}

export function createCompleted(deps: Dependencies): CompletedOperation {
  function completed(
    job: Job,
    retrievalMode: 'saved' | 'live' = 'saved',
    purpose: GenericReadPurpose = 'current',
  ) {
    job = deps.publicJob(job.id) ?? job;
    const manifest = deps.jobManifest(job),
      refs = deps.refsFor(job),
      view = deps.evidenceView(job, manifest, refs, true, refs, purpose);
    const body = view.data.some((item) =>
      ['native-short-body-summary/v1', 'native-short-body-summary/v2'].includes(
        String(record(item).schema),
      ),
    );
    const sourceMode = body
      ? retrievalMode === 'saved'
        ? 'saved'
        : view.valid && 'verifiedLive' in view && view.verifiedLive === true
          ? 'live'
          : 'incomplete'
      : job.status !== 'succeeded' || !view.valid
        ? 'incomplete'
        : retrievalMode === 'saved'
          ? 'saved'
          : view.native
            ? view.collectionMode
            : 'live';
    return {
      job:
        'generic' in view
          ? view.safeJob
          : view.native
            ? (view.safeJob ?? safeNativeShortJob(job, view.valid ? manifest : null))
            : job,
      retrievalMode,
      sourceMode,
      evidence: view.evidence,
      data: view.data,
      ...('directory' in view ? { verifiedLive: view.verifiedLive, reason: view.reason } : {}),
    };
  }
  return completed;
}
