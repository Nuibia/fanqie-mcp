import {
  type ShortMetadataResult,
  type ShortMetadataOptions,
} from '../../short-metadata-schema.js';

import { type BrowserCallOptions } from '../contracts.js';

export type DiagnoseShortMetadataSchemaOperation = (
  workId: string,
  options: Omit<ShortMetadataOptions, 'deadline' | 'assertBorrowedActive'> & BrowserCallOptions,
) => Promise<ShortMetadataResult>;
