import { safeNativeShortJob } from '../platform/short-native-metadata-proof.js';
import { type Job } from '../runtime/store.js';
import { GenericReadPurpose } from './shared.js';
import {
  type OutputJobOperation,
  type EvidenceViewOperation,
} from './contracts/evidence-projection.js';
import {
  type PublicJobOperation,
  type JobManifestOperation,
  type RefsForOperation,
} from './contracts/evidence-context.js';

interface Dependencies {
  publicJob: PublicJobOperation;
  jobManifest: JobManifestOperation;
  refsFor: RefsForOperation;
  evidenceView: EvidenceViewOperation;
}

export function createOutputJob(deps: Dependencies): OutputJobOperation {
  function outputJob(job: Job, purpose: GenericReadPurpose = 'current') {
    job = deps.publicJob(job.id) ?? job;
    const manifest = deps.jobManifest(job),
      refs = deps.refsFor(job),
      view = deps.evidenceView(job, manifest, refs, true, refs, purpose);
    return 'generic' in view
      ? view.safeJob
      : view.native
        ? (view.safeJob ?? safeNativeShortJob(job, view.valid ? manifest : null))
        : job;
  }
  return outputJob;
}
