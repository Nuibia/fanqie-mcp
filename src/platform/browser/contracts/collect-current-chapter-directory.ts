import { type Page } from 'playwright';

import { type DatasetResult, type ChapterRecord } from '../../reads.js';

import { type CurrentChapterDirectoryOptions } from '../contracts.js';

export type CollectCurrentChapterDirectoryOperation = (
  page: Page,
  workId: string,
  options: CurrentChapterDirectoryOptions,
) => Promise<DatasetResult<ChapterRecord>>;
