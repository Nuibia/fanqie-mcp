import { type Config } from '../config.js';
import { AccountBinding } from './shared.js';
import { type NativeBoundAccountOperation } from './contracts/capabilities.js';

interface Dependencies {
  bound: AccountBinding | undefined;
  config: Config;
}

export function createNativeBoundAccount(deps: Dependencies): NativeBoundAccountOperation {
  function nativeBoundAccount(): string | null {
    return deps.bound &&
      deps.bound.accountId === deps.config.accountId &&
      deps.bound.platformIdType === 'account' &&
      typeof deps.bound.platformId === 'string' &&
      /^[0-9]{1,30}$/.test(deps.bound.platformId)
      ? deps.bound.platformId
      : null;
  }
  return nativeBoundAccount;
}
