import { type Config } from '../config.js';
import { AppError } from '../errors.js';
import { type RequireEditorWritesEnabledOperation } from './contracts/tool-input.js';

interface Dependencies {
  config: Config;
}

export function createRequireEditorWritesEnabled(
  deps: Dependencies,
): RequireEditorWritesEnabledOperation {
  // Loading an editor may save through its own HTTP/WebSocket lifecycle.
  // This deployment gate does not make enabled editor access side-effect-free.
  function requireEditorWritesEnabled(): void {
    if (!deps.config.writesEnabled)
      throw new AppError(
        'writes_disabled',
        'Platform writes are disabled for this deployment',
        403,
      );
  }
  return requireEditorWritesEnabled;
}
