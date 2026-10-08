import { type Page } from 'playwright';

export type WaitForWriterReadyOperation = (page: Page, timeoutMs: number) => Promise<boolean>;
