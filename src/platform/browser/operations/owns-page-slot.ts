import { type Page } from 'playwright';
import { AsyncLocalStorage } from 'node:async_hooks';
import { type BrowserPageSlot } from '../body-options.js';
import { type IsCurrentPageSlotOperation } from '../contracts/is-current-page-slot.js';
import { type OwnsPageSlotOperation } from '../contracts/owns-page-slot.js';
interface Dependencies {
  isCurrentPageSlot: IsCurrentPageSlotOperation;
  pageSlots: AsyncLocalStorage<BrowserPageSlot>;
}
export function createOwnsPageSlot(deps: Dependencies): OwnsPageSlotOperation {
  function ownsPageSlot(page: Page): boolean {
    return deps.isCurrentPageSlot(deps.pageSlots.getStore(), page);
  }
  return ownsPageSlot;
}
