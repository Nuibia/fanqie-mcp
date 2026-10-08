import { type Page } from 'playwright';
import { type DatasetResult, type ChapterRecord } from '../../reads.js';
import { type CurrentChapterDirectoryOptions } from '../contracts.js';
import { type AssertAccountUsableOperation } from '../contracts/assert-account-usable.js';
import { type CollectChapterDirectoryReadOperation } from '../contracts/collect-chapter-directory-read.js';
import { type CollectCurrentChapterDirectoryOperation } from '../contracts/collect-current-chapter-directory.js';
interface Dependencies {
  assertAccountUsable: AssertAccountUsableOperation;
  collectChapterDirectoryRead: CollectChapterDirectoryReadOperation;
}
export function createCollectCurrentChapterDirectory(
  deps: Dependencies,
): CollectCurrentChapterDirectoryOperation {
  async function collectCurrentChapterDirectory(
    page: Page,
    workId: string,
    options: CurrentChapterDirectoryOptions,
  ): Promise<DatasetResult<ChapterRecord>> {
    deps.assertAccountUsable();
    return deps.collectChapterDirectoryRead(page, workId, options);
  }
  return collectCurrentChapterDirectory;
}
