import * as draftDirectory from '../platform/short-draft-directory.js';
import path from 'node:path';
import { type UnavailableDirectoryProjectionOperation } from './contracts/evidence-projection.js';

interface Dependencies {}

export function createUnavailableDirectoryProjection(
  deps: Dependencies,
): UnavailableDirectoryProjectionOperation {
  function unavailableDirectoryProjection(): draftDirectory.ShortDraftDirectoryProjection {
    const result = draftDirectory.unavailableShortDraftDirectory('response_unverified');
    return {
      validated: false,
      collectionMode: null,
      verifiedLive: false,
      reason: 'response_unverified',
      evidence: [],
      manifest: null,
      data: [
        {
          schema: 'fanqie-short-draft-directory/v1',
          dataset: 'short_drafts',
          status: 'capability_unavailable',
          reason: 'response_unverified',
          records: [],
          coverage: result.coverage,
          source: {
            mode: 'fixture',
            origin: 'https://fanqienovel.com',
            path: '/api/author/short_article/draft_list/v0/',
          },
          proof: result.proof,
          requests: result.requests,
          transport: result.transport,
          cleanup: result.cleanup,
          verifiedLive: false,
          bodyIncluded: false,
        },
      ],
    };
  }
  return unavailableDirectoryProjection;
}
