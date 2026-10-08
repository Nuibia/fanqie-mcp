import { type Page } from 'playwright';

import { type DatasetResult } from '../../reads.js';

import { type CurrentChapterDirectoryOptions } from '../contracts.js';

import { type ChapterBodyRecord } from '../../chapter-body.js';

export type CollectCurrentChapterBodyOperation = (
  page: Page,
  workId: string,
  chapterId: string,
  options: CurrentChapterDirectoryOptions,
) => Promise<DatasetResult<ChapterBodyRecord>>;
