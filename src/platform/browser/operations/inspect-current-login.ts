import { type Page } from 'playwright';
import { type LoginState } from '../own-identity.js';
import { type BrowserCallOptions } from '../contracts.js';
import { type WithPageOperation } from '../contracts/with-page.js';
import { type InspectLoginOperation } from '../contracts/inspect-login.js';
import { type InspectCurrentLoginOperation } from '../contracts/inspect-current-login.js';
interface Dependencies {
  withPage: WithPageOperation;
  inspectLogin: InspectLoginOperation;
  qrLoginPage: Page | null;
}
export function createInspectCurrentLogin(deps: Dependencies): InspectCurrentLoginOperation {
  function inspectCurrentLogin(options: BrowserCallOptions = {}): Promise<LoginState> {
    return deps.withPage(async (page) => {
      const state = await deps.inspectLogin(page);
      if (state.status === 'authenticated') deps.qrLoginPage = null;
      return state;
    }, options);
  }
  return inspectCurrentLogin;
}
