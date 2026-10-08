import { type BrowserContext, type Page } from 'playwright';
import { type BrowserPageSlot } from '../body-options.js';
import { type IsCurrentPageSlotOperation } from '../contracts/is-current-page-slot.js';
interface Dependencies {
  activePageSlot: BrowserPageSlot | null;
  context: BrowserContext | null;
  activeReaderPage: Page | null;
  page: Page | null;
  closed: boolean;
  apiQuarantined: boolean;
}
export function createIsCurrentPageSlot(deps: Dependencies): IsCurrentPageSlotOperation {
  function isCurrentPageSlot(slot: BrowserPageSlot | null | undefined, page: Page): boolean {
    return (
      !!slot &&
      slot === deps.activePageSlot &&
      slot.page === page &&
      slot.context === deps.context &&
      page.context() === slot.context &&
      page === deps.activeReaderPage &&
      page === deps.page &&
      !page.isClosed() &&
      !deps.closed &&
      !deps.apiQuarantined
    );
  }
  return isCurrentPageSlot;
}
