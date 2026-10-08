import { type Page } from 'playwright';
import { type WaitForWriterReadyOperation } from '../contracts/wait-for-writer-ready.js';
interface Dependencies {}
export function createWaitForWriterReady(deps: Dependencies): WaitForWriterReadyOperation {
  async function waitForWriterReady(page: Page, timeoutMs: number): Promise<boolean> {
    try {
      await page.waitForFunction(
        () =>
          Boolean(document.querySelector('.new-nav-wrap')) ||
          [...document.querySelectorAll('.slogin-tab')].some((element) =>
            /扫码登录|验证码登录|手机号登录/.test(element.textContent ?? ''),
          ),
        undefined,
        { timeout: timeoutMs },
      );
      return true;
    } catch {
      return false;
    }
  }
  return waitForWriterReady;
}
