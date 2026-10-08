import {
  type NativeShortTrialApiResult,
  type NativeShortTrialApiWriteOptions,
} from '../../short-native-trial-api.js';

import { type BrowserCallOptions } from '../contracts.js';

export type RunNativeShortTrialUpdateOperation = (
  workId: string,
  options: Omit<
    NativeShortTrialApiWriteOptions,
    'deadline' | 'assertBorrowedActive' | 'onQuarantine'
  > &
    BrowserCallOptions,
) => Promise<NativeShortTrialApiResult>;
