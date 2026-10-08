import {
  type ShortMetadataApiResult,
  type ShortMetadataApiOptions,
} from '../../short-metadata-api-schema.js';

import { type BrowserCallOptions } from '../contracts.js';

export type DiagnoseShortMetadataApiSchemaOperation = (
  workId: string,
  options: Omit<ShortMetadataApiOptions, 'deadline' | 'assertBorrowedActive' | 'onQuarantine'> &
    BrowserCallOptions,
) => Promise<ShortMetadataApiResult>;
