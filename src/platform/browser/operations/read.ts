import { type Page } from 'playwright';
import { type BrowserCallOptions } from '../contracts.js';
import { type WithPageOperation } from '../contracts/with-page.js';
import { type ReadOperation } from '../contracts/read.js';
interface Dependencies {
  withPage: WithPageOperation;
}
export function createRead(deps: Dependencies): ReadOperation {
  function read<T>(
    reader: (page: Page) => Promise<T>,
    options: BrowserCallOptions = {},
  ): Promise<T> {
    return deps.withPage(reader, options);
  }
  return read;
}
