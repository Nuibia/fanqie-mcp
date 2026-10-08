import { Store, RuntimeError } from '../runtime/store.js';
import { type JobContext } from '../runtime/jobs.js';
import { type RequireLoginOperation, type CheckLoginOperation } from './contracts/identity.js';

interface Dependencies {
  store: Store;
  checkLogin: CheckLoginOperation;
}

export function createRequireLogin(deps: Dependencies): RequireLoginOperation {
  async function requireLogin(ctx: JobContext) {
    deps.store.assertPublicReadMutationAllowed();
    const state = await deps.checkLogin(ctx);
    if (state.status === 'login_required')
      throw new RuntimeError('requires_login', 'Log in through the service-owned browser', {
        status: state.status,
      });
    if (state.status !== 'authenticated')
      throw new RuntimeError(
        'capability_unavailable',
        'The current platform session and own-account identity could not be verified',
      );
    if (!state.identity?.authorId && !state.identity?.accountId)
      throw new RuntimeError(
        'capability_unavailable',
        'A fresh stable own-account identity must be verified before account data or maintenance operations',
      );
    return state;
  }
  return requireLogin;
}
