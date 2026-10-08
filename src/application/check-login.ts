import { Store } from '../runtime/store.js';
import { type JobContext } from '../runtime/jobs.js';
import { BrowserSession, type LoginState } from '../platform/browser.js';
import { type CheckLoginOperation, type BindIdentityOperation } from './contracts/identity.js';

interface Dependencies {
  store: Store;
  login: LoginState | null;
  browser: BrowserSession;
  bindIdentity: BindIdentityOperation;
}

export function createCheckLogin(deps: Dependencies): CheckLoginOperation {
  async function checkLogin(ctx: JobContext) {
    deps.store.assertPublicReadMutationAllowed();
    ctx.beforePlatformRead();
    deps.login = await deps.browser.checkLogin({ signal: ctx.signal });
    deps.bindIdentity(deps.login);
    return deps.login;
  }
  return checkLogin;
}
