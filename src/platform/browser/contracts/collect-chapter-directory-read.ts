import { type Page } from 'playwright';

import { type DatasetResult, type ChapterRecord } from '../../reads.js';

import { type CurrentChapterDirectoryOptions, type CurrentChapterBodyRead } from '../contracts.js';

export type CollectChapterDirectoryReadOperation = (
  page: Page,
  workId: string,
  options: CurrentChapterDirectoryOptions,
  bodyRead?: CurrentChapterBodyRead,
) => Promise<DatasetResult<ChapterRecord>>;
