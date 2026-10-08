import { type LoginState } from '../own-identity.js';

import { type BrowserCallOptions } from '../contracts.js';

export type StartLoginOperation = (
  options?: BrowserCallOptions,
) => Promise<LoginState & { interactionMode: 'visible_browser' | 'screenshot'; pageUrl: string }>;
