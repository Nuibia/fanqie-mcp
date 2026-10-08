import { type Page } from 'playwright';

export type OwnsPageSlotOperation = (page: Page) => boolean;
