import { type Page } from 'playwright';

import { type LoginState } from '../own-identity.js';

export type VerifyCurrentAccountOperation = (page: Page) => Promise<LoginState>;
