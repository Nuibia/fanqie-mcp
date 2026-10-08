import { type Page } from 'playwright';

import { type DatasetResult, type ChapterDraftRecord } from '../../reads.js';

import { type CurrentChapterDirectoryOptions } from '../contracts.js';

export type CollectCurrentChapterDraftDirectoryOperation = (
  page: Page,
  workId: string,
  options: CurrentChapterDirectoryOptions,
) => Promise<DatasetResult<ChapterDraftRecord>>;
