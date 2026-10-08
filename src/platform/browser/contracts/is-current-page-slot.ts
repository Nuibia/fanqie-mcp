import { type Page } from 'playwright';

import { type BrowserPageSlot } from '../body-options.js';

export type IsCurrentPageSlotOperation = (
  slot: BrowserPageSlot | null | undefined,
  page: Page,
) => boolean;
