import {
  type NativeShortMetadataApiWriteResult,
  type NativeShortMetadataApiWriteOptions,
} from '../../short-native-metadata-api.js';

import { type BrowserCallOptions } from '../contracts.js';

export type RunNativeShortMetadataUpdateOperation = (
  workId: string,
  options: Omit<
    NativeShortMetadataApiWriteOptions,
    'deadline' | 'assertBorrowedActive' | 'onQuarantine'
  > &
    BrowserCallOptions,
) => Promise<NativeShortMetadataApiWriteResult>;
