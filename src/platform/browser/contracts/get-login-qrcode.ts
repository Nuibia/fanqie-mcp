import { type BrowserCallOptions } from '../contracts.js';

import { type LoginQrcodeResult } from '../qr-login.js';

export type GetLoginQrcodeOperation = (options?: BrowserCallOptions) => Promise<LoginQrcodeResult>;
