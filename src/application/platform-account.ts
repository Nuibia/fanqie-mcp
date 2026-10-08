import { RuntimeError } from '../runtime/store.js';
import { AccountBinding } from './shared.js';
import { type PlatformAccountOperation } from './contracts/capabilities.js';

interface Dependencies {
  bound: AccountBinding | undefined;
}

export function createPlatformAccount(deps: Dependencies): PlatformAccountOperation {
  function platformAccount() {
    if (!deps.bound)
      throw new RuntimeError(
        'capability_unavailable',
        'A stable platform identity must be verified before write operations',
      );
    return deps.bound.platformId;
  }
  return platformAccount;
}
