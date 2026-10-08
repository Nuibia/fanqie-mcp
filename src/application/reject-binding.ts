import { Store } from '../runtime/store.js';
import { type LoginState } from '../platform/browser.js';
import { type RejectBindingOperation } from './contracts/identity.js';

interface Dependencies {
  store: Store;
  login: LoginState | null;
}

export function createRejectBinding(deps: Dependencies): RejectBindingOperation {
  function rejectBinding(state: LoginState, error: Error): never {
    deps.store.assertPublicReadMutationAllowed();
    deps.login = {
      status: 'unknown',
      identity: null,
      sourceUrl: state.sourceUrl,
      checkedAt: state.checkedAt,
      reason: 'The current identity could not be verified against the service account binding',
    };
    throw error;
  }
  return rejectBinding;
}
