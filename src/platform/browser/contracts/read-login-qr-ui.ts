import { type Page } from 'playwright';

export type ReadLoginQrUiOperation = (page: Page) => Promise<{
  challenge: boolean;
  expired: boolean;
  appInstructions: string | null;
  expiryText: string | null;
}>;
