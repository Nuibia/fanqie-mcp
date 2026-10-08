import { type Page } from 'playwright';

import {
  type DatasetResult,
  type ChapterDraftRecord,
  type CurrentChapterCollectionFailureDiagnostic,
} from '../../reads.js';

import { type BrowserCallOptions, type CurrentChapterDirectoryOptions } from '../contracts.js';

export type ReadCurrentChapterDraftContextOperation = (
  page: Page,
  targetRef: string,
  options: BrowserCallOptions,
  collection: {
    result: DatasetResult<ChapterDraftRecord>;
    options: CurrentChapterDirectoryOptions;
    failureMetadata: CurrentChapterCollectionFailureDiagnostic;
  },
  deadline: number,
) => Promise<void>;
