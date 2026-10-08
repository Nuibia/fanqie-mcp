import { type Page } from 'playwright';

import { type ChapterDirectoryCallOptions } from '../contracts.js';

export type EnterCurrentChapterDirectoryOperation = (
  page: Page,
  workId: string,
  options?: ChapterDirectoryCallOptions,
) => Promise<{ sourceUrl: string }>;
