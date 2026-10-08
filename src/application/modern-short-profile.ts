import * as writes from '../platform/writes.js';
import { type ModernShortProfileOperation } from './contracts/generic-write.js';

interface Dependencies {
  writeProfiles:
    | (Partial<Record<'short' | 'chapter', writes.UiWriteProfile>> & {
        'long-book'?: writes.UiLongBookMetadataProfile;
      })
    | undefined;
}

export function createModernShortProfile(deps: Dependencies): ModernShortProfileOperation {
  function modernShortProfile(): boolean {
    return (
      deps.writeProfiles?.short?.kind === 'short' &&
      deps.writeProfiles.short.serverState === 'short_article_edit_v1'
    );
  }
  return modernShortProfile;
}
