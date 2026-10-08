import { type LoginState } from '../own-identity.js';

import { type BrowserCallOptions } from '../contracts.js';

export type CheckLoginOperation = (options?: BrowserCallOptions) => Promise<LoginState>;
