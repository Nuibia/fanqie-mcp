import { type APIRequest } from 'playwright';

import {
  type ShortDraftDirectoryResult,
  type ShortDraftDirectoryOptions,
} from '../../short-draft-directory.js';

import { type BrowserCallOptions } from '../contracts.js';

export type RunShortDraftDirectoryOperation = (
  options: Omit<ShortDraftDirectoryOptions, 'deadline' | 'assertBorrowedActive' | 'onQuarantine'> &
    BrowserCallOptions,
  fixtureFactory?: Pick<APIRequest, 'newContext'>,
) => Promise<ShortDraftDirectoryResult>;
