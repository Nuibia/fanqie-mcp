import * as submissionRuntime from '../platform/short-native-submission-runtime.js';
import * as draftDirectory from '../platform/short-draft-directory.js';
import { type Config } from '../config.js';
import { Store, RuntimeError, type Manifest, type Job } from '../runtime/store.js';
import {
  type JobManifestOperation,
  type IsExplicitBodyReadOperation,
} from './contracts/evidence-context.js';

interface Dependencies {
  store: Store;
  config: Config;
  isExplicitBodyRead: IsExplicitBodyReadOperation;
}

export function createJobManifest(deps: Dependencies): JobManifestOperation {
  function jobManifest(job: Job): Manifest | null {
    return deps.store.memoPublicProjection('jobManifest', [job], () => {
      try {
        return deps.store.getManifestForJob(deps.config.accountId, job.id);
      } catch (error) {
        if (
          submissionRuntime.hasReservedNativeShortSubmissionSignal(job) ||
          deps.isExplicitBodyRead(job) ||
          draftDirectory.hasReservedShortDraftDirectorySignal(job)
        )
          return null;
        if (error instanceof RuntimeError) throw error;
        throw new RuntimeError('capability_unavailable', 'Saved data is unavailable.');
      }
    });
  }
  return jobManifest;
}
