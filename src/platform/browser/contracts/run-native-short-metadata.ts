import {
  type NativeShortMetadataApiResult,
  type NativeShortMetadataApiOptions,
} from '../../short-native-metadata-api.js';

import { type BrowserCallOptions } from '../contracts.js';

export type RunNativeShortMetadataOperation = (
  workId: string,
  options: Omit<
    NativeShortMetadataApiOptions,
    'deadline' | 'assertBorrowedActive' | 'onQuarantine'
  > &
    BrowserCallOptions,
) => Promise<NativeShortMetadataApiResult>;
