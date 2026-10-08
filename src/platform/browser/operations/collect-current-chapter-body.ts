import { type Page } from 'playwright';
import { type DatasetResult, makeDataset } from '../../reads.js';
import { BrowserSessionError } from '../errors.js';
import { type CurrentChapterDirectoryOptions, type CurrentChapterBodyRead } from '../contracts.js';
import { type ChapterBodyRecord } from '../../chapter-body.js';
import { type AssertAccountUsableOperation } from '../contracts/assert-account-usable.js';
import { type OwnsPageSlotOperation } from '../contracts/owns-page-slot.js';
import { type CollectChapterDirectoryReadOperation } from '../contracts/collect-chapter-directory-read.js';
import { type CollectCurrentChapterBodyOperation } from '../contracts/collect-current-chapter-body.js';
interface Dependencies {
  assertAccountUsable: AssertAccountUsableOperation;
  ownsPageSlot: OwnsPageSlotOperation;
  collectChapterDirectoryRead: CollectChapterDirectoryReadOperation;
}
export function createCollectCurrentChapterBody(
  deps: Dependencies,
): CollectCurrentChapterBodyOperation {
  async function collectCurrentChapterBody(
    page: Page,
    workId: string,
    chapterId: string,
    options: CurrentChapterDirectoryOptions,
  ): Promise<DatasetResult<ChapterBodyRecord>> {
    deps.assertAccountUsable();
    if (!deps.ownsPageSlot(page))
      throw new BrowserSessionError(
        'chapter_directory_slot_required',
        'Body reads require the active service-owned browser slot',
      );
    const body = makeDataset<ChapterBodyRecord>(
      'chapter_body',
      'https://fanqienovel.com/api/author/edit_article/v0/',
    );
    body.limitations.push(
      'This single-target public_contract_api GET is independent of the natural directory source contract. It grants no write capability and uses no editor, WebSocket, signer, headers or hidden parameters.',
      'The returned representation is author_edit_current with publishedVersionVerified=false; raw publish/creation/version values do not establish a published body or a writable version.',
      'The target must appear uniquely in this invocation’s actual management records. Fresh typed own-before/after, book and inventory checks, original canonical fences and complete cleanup still apply.',
      'Only the complete returned content string, at most 3000000 UTF-8 bytes, is retained and hashed without normalization. This is not a platform revision, media extent or statistics cutoff. A single nonrenewable 60-second budget covers this invocation.',
    );
    if (!/^[1-9]\d{9,29}$/.test(workId) || !/^[1-9]\d{9,29}$/.test(chapterId)) {
      body.errors.push({ code: 'chapter_body_target_unverified', scope: 'chapter_body' });
      return body;
    }
    const bodyRead: CurrentChapterBodyRead = {
      chapterId,
      deadline: performance.now() + Math.min(60_000, Math.max(1, options.timeoutMs ?? 60_000)),
      result: body,
    };
    try {
      await deps.collectChapterDirectoryRead(page, workId, options, bodyRead);
    } catch {
      body.status = 'capability_unavailable';
      body.records = [];
      body.coverage.complete = body.coverage.paginationComplete = false;
      body.coverage.pagesFetched = body.coverage.recordsFetched = 0;
      body.coverage.fields = [];
    }
    if (body.status !== 'success') {
      body.records = [];
      body.coverage.complete = body.coverage.paginationComplete = false;
      body.coverage.pagesFetched = body.coverage.recordsFetched = 0;
      body.coverage.fields = [];
      body.coverage.totalRecords = body.coverage.pagesDiscovered = null;
      body.errors.push({ code: 'chapter_body_read_unverified', scope: 'chapter_body' });
    }
    return body;
  }
  return collectCurrentChapterBody;
}
