import { type Page } from 'playwright';
import { ownInfoSource } from '../own-identity.js';
import { type WaitForObservedOwnSourceOperation } from '../contracts/wait-for-observed-own-source.js';
interface Dependencies {
  ownInfoUrls: WeakMap<Page, Set<string>>;
}
export function createWaitForObservedOwnSource(
  deps: Dependencies,
): WaitForObservedOwnSourceOperation {
  async function waitForObservedOwnSource(page: Page, timeoutMs: number): Promise<void> {
    if (deps.ownInfoUrls.get(page)?.size) return;
    try {
      await page.waitForResponse(
        (response) => {
          try {
            return (
              response.request().method() === 'GET' &&
              response.ok() &&
              ownInfoSource(new URL(response.url()))
            );
          } catch {
            return false;
          }
        },
        { timeout: timeoutMs },
      );
    } catch {
      /* Identity remains unavailable unless an actual own GET was observed. */
    }
  }
  return waitForObservedOwnSource;
}
