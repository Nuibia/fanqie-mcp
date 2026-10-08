import { type Page } from 'playwright';

import {
  type DatasetResult,
  type ChapterRecord,
  type CurrentChapterCollectionFailureDiagnostic,
} from '../../reads.js';

import {
  type BrowserCallOptions,
  type CurrentChapterDirectoryOptions,
  type CurrentChapterBodyRead,
} from '../contracts.js';

import { type ReadPageDiagnostic } from '../chapter-diagnostics.js';

export type ReadCurrentChapterContextOperation = (
  page: Page,
  targetRef: string,
  options: BrowserCallOptions,
  collection?: {
    result: DatasetResult<ChapterRecord>;
    options: CurrentChapterDirectoryOptions;
    failureMetadata: CurrentChapterCollectionFailureDiagnostic;
    bodyRead?: CurrentChapterBodyRead;
  },
) => Promise<ReadPageDiagnostic>;
