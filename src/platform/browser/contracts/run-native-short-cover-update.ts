import {
  type NativeShortCoverApiResult,
  type NativeShortCoverApiOptions,
} from '../../short-native-cover-api.js';

import { type BrowserCallOptions } from '../contracts.js';

export type RunNativeShortCoverUpdateOperation = (
  workId: string,
  options: Omit<NativeShortCoverApiOptions, 'deadline' | 'assertBorrowedActive' | 'onQuarantine'> &
    BrowserCallOptions,
) => Promise<NativeShortCoverApiResult>;
