import { type PlatformIdentity } from '../own-identity.js';
import { type RememberIdentityOperation } from '../contracts/remember-identity.js';
interface Dependencies {
  identity: PlatformIdentity | null;
}
export function createRememberIdentity(deps: Dependencies): RememberIdentityOperation {
  function rememberIdentity(identity: PlatformIdentity): void {
    // A name-only account envelope cannot erase the current document's verified stable own ID.
    if (
      identity.accountId ||
      identity.authorId ||
      (!deps.identity?.accountId && !deps.identity?.authorId)
    )
      deps.identity = identity;
  }
  return rememberIdentity;
}
