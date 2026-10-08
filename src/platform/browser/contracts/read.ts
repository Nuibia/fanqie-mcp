import { type Page } from 'playwright';

import { type BrowserCallOptions } from '../contracts.js';

export type ReadOperation = <T>(
  reader: (page: Page) => Promise<T>,
  options?: BrowserCallOptions,
) => Promise<T>;
