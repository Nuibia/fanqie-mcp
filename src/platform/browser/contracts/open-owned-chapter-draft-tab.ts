import { type Page } from 'playwright';

import { type CurrentChapterDirectoryOptions } from '../contracts.js';

export type OpenOwnedChapterDraftTabOperation = (
  page: Page,
  targetRef: string,
  options: CurrentChapterDirectoryOptions,
  deadline: number,
) => Promise<string>;
