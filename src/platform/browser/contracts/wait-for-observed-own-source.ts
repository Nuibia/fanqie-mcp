import { type Page } from 'playwright';

export type WaitForObservedOwnSourceOperation = (page: Page, timeoutMs: number) => Promise<void>;
