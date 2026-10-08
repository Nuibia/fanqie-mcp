import { type Page } from 'playwright';

import { type LoginState } from '../own-identity.js';

import { type BrowserCallOptions } from '../contracts.js';

export type PrepareChapterDiagnosticOperation = (
  page: Page,
  targetRef: string,
  before: LoginState,
  timeoutMs: number,
  options: BrowserCallOptions,
) => Promise<{
  ready: boolean;
  login: LoginState;
  assertCurrent: () => void;
  close: () => Promise<void>;
  openVolumeOptions: () => Promise<LoginState>;
}>;
