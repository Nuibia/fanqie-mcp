import * as draftDirectory from '../platform/short-draft-directory.js';
import { type Config } from '../config.js';
import {
  Store,
  canonicalJson,
  type EvidenceRef,
  type EvidenceDocument,
  type Manifest,
  type Job,
} from '../runtime/store.js';
import {
  type DirectoryViewOperation,
  type UnavailableDirectoryProjectionOperation,
} from './contracts/evidence-projection.js';

interface Dependencies {
  store: Store;
  config: Config;
  directoryApplicationOrigin: 'default' | 'injected';
  unavailableDirectoryProjection: UnavailableDirectoryProjectionOperation;
}

export function createDirectoryView(deps: Dependencies): DirectoryViewOperation {
  function directoryView(
    job: Job | null,
    manifest: Manifest | null,
    refs: EvidenceRef[],
    documents: EvidenceDocument[],
    readFailure?: unknown,
  ) {
    let projection: draftDirectory.ShortDraftDirectoryProjection;
    try {
      if (readFailure || !job) throw Error('Invalid directory context');
      if (manifest) {
        const actual = deps.store.getManifestForJob(deps.config.accountId, job.id);
        if (!actual || canonicalJson(actual) !== canonicalJson(manifest))
          throw Error('Invalid directory manifest');
      }
      projection = draftDirectory.projectShortDraftDirectoryContext({
        accountId: deps.config.accountId,
        job,
        manifest,
        refs,
        documents,
        evaluationAt: new Date().toISOString(),
      });
      if (deps.directoryApplicationOrigin === 'default' && projection.collectionMode === 'fixture')
        throw Error('Fixture directory cannot verify production');
    } catch {
      projection = deps.unavailableDirectoryProjection();
    }
    return {
      native: true,
      directory: true,
      valid: projection.validated,
      verifiedLive: projection.verifiedLive,
      reason: projection.reason,
      evidence: projection.evidence,
      data: projection.data,
      manifest: projection.manifest,
      collectionMode: projection.collectionMode,
      safeJob: draftDirectory.safeShortDraftDirectoryJob(
        job,
        projection.validated ? projection : null,
      ),
    };
  }
  return directoryView;
}
