import { type BrowserCallOptions } from '../contracts.js';
import { type WithPageOperation } from '../contracts/with-page.js';
import { type ScreenshotOperation } from '../contracts/screenshot.js';
interface Dependencies {
  withPage: WithPageOperation;
}
export function createScreenshot(deps: Dependencies): ScreenshotOperation {
  function screenshot(options: BrowserCallOptions = {}): Promise<Buffer> {
    return deps.withPage((page) => page.screenshot({ type: 'png', fullPage: false }), options);
  }
  return screenshot;
}
