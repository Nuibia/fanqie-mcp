import { type Page } from 'playwright';
import { type PlatformIdentity, type LoginState } from '../own-identity.js';
import { BrowserSessionError } from '../errors.js';
import { type BrowserCallOptions, WRITER_HOME } from '../contracts.js';
import { type WithPageOperation } from '../contracts/with-page.js';
import { type InspectLoginOperation } from '../contracts/inspect-login.js';
import { type VerifyCurrentAccountOperation } from '../contracts/verify-current-account.js';
import { type CheckLoginOperation } from '../contracts/check-login.js';
interface Dependencies {
  withPage: WithPageOperation;
  qrLoginPage: Page | null;
  inspectLogin: InspectLoginOperation;
  verifyCurrentAccount: VerifyCurrentAccountOperation;
  identityEpoch: number;
  identity: PlatformIdentity | null;
}
export function createCheckLogin(deps: Dependencies): CheckLoginOperation {
  async function checkLogin(options: BrowserCallOptions = {}): Promise<LoginState> {
    return deps.withPage(async (page) => {
      if (deps.qrLoginPage === page) {
        const state = await deps.inspectLogin(page, false);
        if (state.status === 'authenticated') {
          const fresh = await deps.verifyCurrentAccount(page);
          if (fresh.status === 'authenticated') deps.qrLoginPage = null;
          return fresh;
        }
        if (state.status === 'login_required') return state;
        // A completed scan redirects to the official writer root. Do not infer
        // authentication from that route: management must still be verified.
        const completedRedirect = await page
          .evaluate(() => {
            if (
              location.origin !== 'https://fanqienovel.com' ||
              !/^\/main\/writer\/?$/.test(location.pathname)
            )
              return false;
            const visible = (element: Element): boolean => {
              const box = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return (
                box.width > 0 &&
                box.height > 0 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.opacity !== '0'
              );
            };
            return ![
              ...document.querySelectorAll(
                '.slogin-pc-form-header__title__tab,.slogin-qrcode-scan-page,input[type="tel"],input[autocomplete="one-time-code"]',
              ),
            ].some(visible);
          })
          .catch(() => {
            throw new BrowserSessionError(
              'login_status_unavailable',
              'The current scan completion state could not be inspected',
            );
          });
        if (!completedRedirect) return state;
        deps.qrLoginPage = null;
      }
      deps.identityEpoch += 1;
      deps.identity = null;
      await page.goto(WRITER_HOME, { waitUntil: 'domcontentloaded' }).catch(() => {
        throw new BrowserSessionError(
          'login_page_unavailable',
          'The official platform login page could not be opened',
        );
      });
      await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => undefined);
      return deps.verifyCurrentAccount(page);
    }, options);
  }
  return checkLogin;
}
