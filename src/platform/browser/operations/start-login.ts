import { type Page } from 'playwright';
import { type PlatformIdentity, type LoginState } from '../own-identity.js';
import { BrowserSessionError } from '../errors.js';
import { type BrowserSessionConfig, type BrowserCallOptions, WRITER_HOME } from '../contracts.js';
import { type WithPageOperation } from '../contracts/with-page.js';
import { type InspectLoginOperation } from '../contracts/inspect-login.js';
import { type StartLoginOperation } from '../contracts/start-login.js';
interface Dependencies {
  withPage: WithPageOperation;
  qrLoginPage: Page | null;
  identityEpoch: number;
  identity: PlatformIdentity | null;
  inspectLogin: InspectLoginOperation;
  config: BrowserSessionConfig;
}
export function createStartLogin(deps: Dependencies): StartLoginOperation {
  async function startLogin(
    options: BrowserCallOptions = {},
  ): Promise<LoginState & { interactionMode: 'visible_browser' | 'screenshot'; pageUrl: string }> {
    return deps.withPage(async (page) => {
      if (deps.qrLoginPage !== page) {
        deps.identityEpoch += 1;
        deps.identity = null;
        await page.goto(WRITER_HOME, { waitUntil: 'domcontentloaded' }).catch(() => {
          throw new BrowserSessionError(
            'login_page_unavailable',
            'The official platform login page could not be opened',
          );
        });
        await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => undefined);
      }
      const state = await deps.inspectLogin(page);
      return {
        ...state,
        interactionMode: deps.config.headless ? 'screenshot' : 'visible_browser',
        pageUrl: state.sourceUrl,
      };
    }, options);
  }
  return startLogin;
}
