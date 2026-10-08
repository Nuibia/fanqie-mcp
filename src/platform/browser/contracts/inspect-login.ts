import { type Page } from 'playwright';

import { type LoginState } from '../own-identity.js';

export type InspectLoginOperation = (
  page: Page,
  allowCachedIdentity?: boolean,
) => Promise<LoginState>;
