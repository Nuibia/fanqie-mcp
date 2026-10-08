import { type Page } from 'playwright';

import { type BrowserCallOptions } from '../contracts.js';

export type WithPageOperation = <T>(
  reader: (page: Page) => Promise<T>,
  options?: BrowserCallOptions,
) => Promise<T>;
