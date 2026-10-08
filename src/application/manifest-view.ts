import { type Manifest } from '../runtime/store.js';
import { type ManifestViewOperation } from './contracts/query.js';
import { type PublicJobOperation, type RefsForOperation } from './contracts/evidence-context.js';

import { type EvidenceViewOperation } from './contracts/evidence-projection.js';
interface Dependencies {
  publicJob: PublicJobOperation;
  refsFor: RefsForOperation;
  evidenceView: EvidenceViewOperation;
}

export function createManifestView(deps: Dependencies): ManifestViewOperation {
  function manifestView(manifest: Manifest, includeDataset = true) {
    const job = deps.publicJob(manifest.jobId);
    // Extra durable references also invalidate a native manifest; do not hide them
    // by projecting only the subset supplied to completeReadJob.
    const refs = job ? deps.refsFor(job) : manifest.evidence;
    const view = deps.evidenceView(job, manifest, refs, includeDataset, manifest.evidence);
    return {
      manifest: view.manifest,
      data: view.data,
      ...('generic' in view ? view.tuple : {}),
      ...('directory' in view
        ? {
            verifiedLive: view.verifiedLive,
            reason: view.reason,
            sourceMode: view.valid && job?.status === 'succeeded' ? 'saved' : 'incomplete',
          }
        : {}),
    };
  }
  return manifestView;
}
