import { BrowserSessionError } from '../errors.js';
import { type AssertAccountUsableOperation } from '../contracts/assert-account-usable.js';
interface Dependencies {
  apiQuarantined: boolean;
}
export function createAssertAccountUsable(deps: Dependencies): AssertAccountUsableOperation {
  function assertAccountUsable(): void {
    if (deps.apiQuarantined)
      throw new BrowserSessionError(
        'shutdown_incomplete',
        'Owned API disposal is unverified; the account session is quarantined',
      );
  }
  return assertAccountUsable;
}
