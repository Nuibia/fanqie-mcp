import { type Page } from 'playwright';

export type EnsurePageOperation = (ownedInitialization?: boolean) => Promise<Page>;
