import { type Page } from 'playwright';
import { Store, RuntimeError } from '../runtime/store.js';
import { type JobContext } from '../runtime/jobs.js';
import { BrowserSession, type LoginState } from '../platform/browser.js';
import { type ReadAccountPageOperation, type BindIdentityOperation } from './contracts/identity.js';

interface Dependencies {
  store: Store;
  browser: BrowserSession;
  login: LoginState | null;
  bindIdentity: BindIdentityOperation;
}

export function createReadAccountPage(deps: Dependencies): ReadAccountPageOperation {
  async function readAccountPage<T>(
    ctx: JobContext,
    read: (page: Page) => Promise<T>,
    verifyResult: (result: T) => boolean = () => true,
  ): Promise<T> {
    deps.store.assertPublicReadMutationAllowed();
    return deps.browser.withPage(
      async (page) => {
        const result = await read(page);
        if (verifyResult(result)) {
          // Keep the fresh own-account observation in the same browser FIFO slot
          // as collection. A different or unproved identity cannot become live
          // evidence for the account checked before navigation.
          deps.login = await deps.browser.verifyCurrentAccount(page);
          deps.bindIdentity(deps.login);
          if (deps.login.status === 'login_required')
            throw new RuntimeError('requires_login', 'Log in through the service-owned browser', {
              status: deps.login.status,
            });
          if (deps.login.status !== 'authenticated')
            throw new RuntimeError(
              'capability_unavailable',
              'The collected page did not establish a fresh stable own-account identity',
            );
        }
        return result;
      },
      { signal: ctx.signal },
    );
  }
  return readAccountPage;
}
