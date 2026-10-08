import * as bodyRuntime from '../platform/short-native-body-runtime.js';
import * as draftDirectory from '../platform/short-draft-directory.js';
import { type Config } from '../config.js';
import { Store, RuntimeError } from '../runtime/store.js';
import { type SnapshotOperation, type ManifestViewOperation } from './contracts/query.js';

import { type UnavailableDirectoryProjectionOperation } from './contracts/evidence-projection.js';
interface Dependencies {
  store: Store;
  config: Config;
  manifestView: ManifestViewOperation;
  unavailableDirectoryProjection: UnavailableDirectoryProjectionOperation;
}

export function createSnapshot(deps: Dependencies): SnapshotOperation {
  function snapshot(scope = 'account') {
    try {
      const manifest = deps.store.getCurrent(deps.config.accountId, scope);
      return manifest
        ? { sourceMode: 'saved', ...deps.manifestView(manifest) }
        : {
            sourceMode: 'saved',
            manifest: null,
            data: [],
            reason: 'No complete saved snapshot exists',
          };
    } catch (error) {
      if (bodyRuntime.hasReservedNativeShortBodySignal({ scope }))
        throw new RuntimeError('capability_unavailable', 'Saved native short body is unavailable.');
      if (
        scope === draftDirectory.SHORT_DRAFT_DIRECTORY_SCOPE ||
        scope === 'short_drafts' ||
        !(error instanceof RuntimeError)
      ) {
        const projection = deps.unavailableDirectoryProjection();
        return {
          sourceMode: 'incomplete',
          manifest: null,
          data: projection.data,
          reason: projection.reason,
          verifiedLive: false,
        };
      }
      throw error;
    }
  }
  return snapshot;
}
