import { type BrowserCallOptions } from '../contracts.js';

export type ScreenshotOperation = (options?: BrowserCallOptions) => Promise<Buffer>;
